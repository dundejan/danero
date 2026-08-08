import { and, asc, eq, gt } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { getDb, type Db } from '@/db';
import {
  auditLog,
  brokerAccounts,
  importBatches,
  instrumentAliases,
  notificationPrefs,
  notifications,
  reportPurchases,
  session,
  subscriptions,
  taxpayerProfiles,
  taxYearSettings,
  transactions,
  user,
} from '@/db/schema';

export const dynamic = 'force-dynamic';

/** Kolik transakcí načte a odešle jeden krok streamu. */
const TX_PAGE = 500;

/**
 * Transakce po stránkách přes primární klíč (userId, dedupeKey) — keyset, takže
 * dotaz i u statisíců řádků jede po indexu a v paměti je vždy jen jedna stránka.
 */
async function* transactionPages(db: Db, userId: string): AsyncGenerator<object[]> {
  let after = '';
  for (;;) {
    const page = await db
      .select({ dedupeKey: transactions.dedupeKey, payload: transactions.payload })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gt(transactions.dedupeKey, after)))
      .orderBy(asc(transactions.dedupeKey))
      .limit(TX_PAGE);
    if (page.length === 0) return;
    yield page.map((row) => row.payload as object);
    after = page.at(-1)!.dedupeKey;
    if (page.length < TX_PAGE) return;
  }
}

/** Jeden klíč exportu i s čárkou — hodnota kompaktně, klíč na vlastním řádku. */
const line = (key: string, value: unknown): string =>
  `  ${JSON.stringify(key)}: ${JSON.stringify(value)},\n`;

/**
 * Tělo exportu po kusech. Celý dokument se nikdy neslepí do jednoho řetězce,
 * takže paměť ani velikost jedné odpovědi nerostou s počtem transakcí.
 */
async function* exportChunks(
  db: Db,
  userId: string,
  account: { email: string; name: string },
): AsyncGenerator<string> {
  yield '{\n';
  yield line('exportedAt', new Date().toISOString());
  yield line('format', 'danero-export-v1');
  // 2FA jen jako příznak: tajemství TOTP ani záložní kódy do staženého souboru
  // nepatří (byl by to klíč k účtu v plaintextu ve složce Stažené)
  const [account2fa] = await db
    .select({ twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, userId));
  yield line('user', {
    email: account.email,
    name: account.name,
    twoFactorEnabled: account2fa?.twoFactorEnabled ?? false,
  });
  yield line(
    'profiles',
    await db.select().from(taxpayerProfiles).where(eq(taxpayerProfiles.userId, userId)),
  );
  // nastavení upozornění zadal uživatel sám → čl. 20 GDPR (přenositelnost)
  yield line(
    'notificationPrefs',
    await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)),
  );

  // kanonický model (docs/04) — payload je zdroj pravdy každé transakce.
  // Jediná neomezeně rostoucí část exportu, proto jde ven po stránkách.
  yield '  "transactions": [';
  let first = true;
  for await (const page of transactionPages(db, userId)) {
    yield `${first ? '' : ','}${page.map((tx) => JSON.stringify(tx)).join(',')}`;
    first = false;
  }
  yield '],\n';

  // šifrované API klíče se záměrně NEexportují
  yield line(
    'brokerAccounts',
    await db
      .select({
        id: brokerAccounts.id,
        broker: brokerAccounts.broker,
        label: brokerAccounts.label,
        lastSyncedAt: brokerAccounts.lastSyncedAt,
        lastSyncStatus: brokerAccounts.lastSyncStatus,
        createdAt: brokerAccounts.createdAt,
      })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.userId, userId)),
  );
  yield line(
    'instrumentAliases',
    await db.select().from(instrumentAliases).where(eq(instrumentAliases.userId, userId)),
  );
  yield line(
    'notifications',
    await db.select().from(notifications).where(eq(notifications.userId, userId)),
  );
  yield line(
    'importBatches',
    await db
      .select({
        id: importBatches.id,
        broker: importBatches.broker,
        filename: importBatches.filename,
        added: importBatches.added,
        duplicates: importBatches.duplicates,
        createdAt: importBatches.createdAt,
      })
      .from(importBatches)
      .where(eq(importBatches.userId, userId)),
  );
  // historie nákupů (/soukromi slibuje odnést si i ji) — stripe identifikátory
  // jsou součástí údajů o uživateli, doklad o zaplacení má Stripe
  yield line(
    'subscriptions',
    await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
  );
  // /soukromi jmenuje mezi drženými údaji i „záznamy o přihlášeních a
  // synchronizacích" a „IP adresu a typ prohlížeče u aktivních relací" —
  // právo na přístup (čl. 15 GDPR) se týká i jich. Token relace se
  // NEexportuje: je to přihlašovací tajemství, ne údaj o uživateli.
  yield line(
    'auditLog',
    await db
      .select({
        type: auditLog.type,
        detail: auditLog.detail,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(asc(auditLog.createdAt)),
  );
  yield line(
    'sessions',
    await db
      .select({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.userId, userId)),
  );
  // R-05c: konfigurace zafixovaná za roky, které už uživatel použil pro přiznání
  // (párování, kurzová soustava, výklad limitu 100k) — bez ní by z exportu nešlo
  // doložit, čím se jeho podaná čísla počítala
  yield line(
    'pinnedTaxYears',
    await db.select().from(taxYearSettings).where(eq(taxYearSettings.userId, userId)),
  );
  // poslední klíč je bez čárky
  const purchases = await db
    .select()
    .from(reportPurchases)
    .where(eq(reportPurchases.userId, userId));
  yield `  "reportPurchases": ${JSON.stringify(purchases)}\n}\n`;
}

/**
 * Generátor → tělo odpovědi. `pull` si řekne o další kus, až když je předchozí
 * odeslaný, takže funkce nikdy nedrží víc než jednu stránku transakcí.
 */
function toStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    // uživatel zavřel stahování — další stránky už z databáze netahat
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

/**
 * GDPR export (právo na přenositelnost z /soukromi): kompletní JSON všech dat
 * uživatele — transakce v kanonickém formátu, profil, nastavení upozornění,
 * broker účty (bez šifrovaných klíčů!), číselník instrumentů, notifikace,
 * importní dávky, audit log, přihlášené relace a historie nákupů
 * (předplatné + zaplacené daňové roky).
 *
 * Co se ven NIKDY nedostane, i když to u účtu leží: šifrované klíče
 * k brokerovi, tajemství TOTP a záložní kódy 2FA, token relace a otisk hesla.
 * Jsou to přístupová tajemství — uživateli o něm nic neřeknou a stažený soubor
 * by z nich udělal kopii klíčů od účtu (nález E-40).
 *
 * Odpověď se **streamuje**. Nestreamovaná má na Vercelu tvrdý strop 4,5 MB
 * (`FUNCTION_PAYLOAD_TOO_LARGE`) a export stojí ~287 B na transakci — uživatel
 * s víc než ~15 700 transakcemi by si svoje data nestáhl vůbec (audit G-P4).
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Nepřihlášen', { status: 401 });
  const userId = session.user.id;
  const db = await getDb();
  const { checkRateLimit } = await import('@/lib/rate-limit');
  if (!(await checkRateLimit(db, `export:${userId}`, { max: 5, windowMs: 60_000 }))) {
    return new Response('Příliš mnoho exportů za sebou — počkej minutu.', { status: 429 });
  }

  return new Response(toStream(exportChunks(db, userId, session.user)), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="danero-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
