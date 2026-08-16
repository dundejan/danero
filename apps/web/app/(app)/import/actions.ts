'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { and, eq, like } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { brokerAccounts, importBatches, notifications, transactions } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { encryptSecret } from '@/lib/crypto';
import { isSyncBatchFilename } from '@/lib/broker-sync';
import { invalidateUserCache } from '@/lib/engine-cache';
import { reportFailedImport } from '@/lib/failed-imports';
import { importFileIsolated } from '@/lib/import-service';
import { ISIN_ONLY_BROKERS, saveAliases, type AliasInput } from '@/lib/instrument-aliases';
import { enqueueSyncJob, jobTypeForBroker, processJob } from '@/lib/jobs';
import { resolveEntitlements } from '@/lib/entitlements';
import { requireUser } from '@/lib/session';

/**
 * Strop velikosti nahraného souboru.
 *
 * NENÍ to naše volba, ale tvrdý limit platformy: Vercel utne tělo požadavku
 * na **4,5 MB** dřív, než se dostane k aplikaci. Změřeno naostro proti
 * `https://danero.cz/api/health` (POST s rostoucím tělem): 4 300 kB projde
 * (HTTP 405 od aplikace), **4 400 kB → HTTP 413 `FUNCTION_PAYLOAD_TOO_LARGE`**,
 * a to je syrová anglická stránka od Vercelu, ne naše česká hláška.
 *
 * Do 9. 8. 2026 tu bylo 20 MB, takže uživatel s velkým exportem dostal
 * nesrozumitelnou chybu místo rady, co dělat (nález F-3-3). 4 MB nechává
 * rezervu na multipart hlavičky a ostatní pole formuláře.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export async function uploadImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const files = formData
    .getAll('soubory')
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length === 0) redirect('/import?chyba=zadny-soubor');
  if (files.some((f) => f.size > MAX_FILE_BYTES)) redirect('/import?chyba=velikost');

  const db = await getDb();
  const { checkRateLimit } = await import('@/lib/rate-limit');
  if (!(await checkRateLimit(db, `upload:${user.id}`, { max: 30, windowMs: 10 * 60_000 }))) {
    redirect('/import?chyba=limit');
  }
  // každý soubor zvlášť: poškozený druhý soubor nesmí sebrat třetí ani zamlčet
  // první (F-3-7) — selhání se zapíše jako dávka s chybou a je vidět v seznamu
  for (const file of files) {
    await importFileIsolated(db, user.id, file.name, await file.arrayBuffer());
  }

  revalidatePath('/prehled');
  revalidatePath('/import');
  redirect('/import');
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Uloží doplněné ISIN/měny k symbolům (XTB, Fio) do číselníku uživatele.
 * Po uložení stačí soubor nahrát znovu — deduplikace nic nezdvojí.
 */
/** Brokeři, pro které číselník dává smysl (XTB chce i měnu instrumentu). */
// XTB (ISIN+měna) + brokeři s ISIN-only mapou (lib/instrument-aliases)
const ALIAS_BROKERS = new Set(['xtb', ...ISIN_ONLY_BROKERS]);
const MAX_ALIAS_ROWS = 200;

export async function saveAliasesAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  // tvrdý strop a celočíselnost — count je z formuláře (DoS přes Infinity/1e9)
  const rawCount = Number(formData.get('pocet') ?? 0);
  const count = Number.isInteger(rawCount) ? Math.min(Math.max(rawCount, 0), MAX_ALIAS_ROWS) : 0;
  const rows: AliasInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const broker = String(formData.get(`broker-${i}`) ?? '');
    const symbol = String(formData.get(`symbol-${i}`) ?? '');
    const isin = String(formData.get(`isin-${i}`) ?? '').trim().toUpperCase();
    const currency = String(formData.get(`currency-${i}`) ?? '').trim().toUpperCase();
    if (!ALIAS_BROKERS.has(broker) || !symbol) continue;
    if (isin === '' && currency === '') continue; // nevyplněný řádek přeskoč
    if (!ISIN_RE.test(isin)) redirect('/import?chyba=isin');
    if (currency !== '' && !CURRENCY_RE.test(currency)) redirect('/import?chyba=mena');
    // XTB bez měny by se v číselníku ignoroval — vynutit i na serveru
    if (broker === 'xtb' && currency === '') redirect('/import?chyba=mena');
    rows.push({ broker, symbol, isin, ...(currency ? { currency } : {}) });
  }
  if (rows.length > 0) {
    const db = await getDb();
    await saveAliases(db, user.id, rows);
  }
  revalidatePath('/import');
  redirect('/import?ulozeno=ciselnik');
}

/**
 * Vrátí import zpět: smaže transakce z té dávky **i** záznam o ní.
 *
 * Do 13. 8. 2026 tu bylo „Smazat záznam", které mazalo JEN řádek v historii —
 * transakce zůstávaly navždy a smazat je nešlo vůbec nijak (kromě zrušení
 * účtu). Přitom hned tři hlášky uživateli radí „smaž dávku importu", aby se
 * zbavil duplicity, a stejný postup předpokládá i doplnění nového pole do už
 * naimportovaných dat. Rada tedy neplatila a historie navíc lhala: import byl
 * z výpisu pryč, jeho transakce ne.
 *
 * Transakce se mažou podle `batchId`, což je dávka, která je poprvé uložila
 * (dedupe zaručuje, že tatáž transakce ve druhé dávce nevznikne) — po vrácení
 * jde tedy tentýž soubor nahrát znovu.
 *
 * ⚠️ Dávka může pocházet i z API brokera, a tam „nahrát znovu" nestačí:
 * inkrementální sync se ptá jen na roky od poslední synchronizace
 * (`lib/t212-sync.ts`), takže vrácený rok 2019 by se už nikdy nestáhl. Takové
 * dávce se proto účtu zahodí `lastSyncedAt` — poznává se podle názvu, který
 * jim dává `syncBatchFilename` (jediná definice v `lib/broker-sync.ts`).
 */
export async function undoImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const batchId = String(formData.get('davka') ?? '');
  if (batchId) {
    const db = await getDb();
    // jedna transakce: pád mezi mazáním transakcí a dávky by nechal osiřelé
    // řádky bez záznamu v historii, tedy data, ke kterým se uživatel nedostane
    const removed = await db.transaction(async (tx) => {
      const [batch] = await tx
        .select({
          id: importBatches.id,
          filename: importBatches.filename,
          broker: importBatches.broker,
        })
        .from(importBatches)
        .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, user.id)));
      if (!batch) return null;
      const deleted = await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, user.id), eq(transactions.batchId, batchId)))
        .returning({ dedupeKey: transactions.dedupeKey, txDate: transactions.txDate });
      // Upozornění hlídače na roky, kterých se to týkalo, přestala platit —
      // „limit překročen" by na přehledu viselo za obchody, které už neexistují,
      // a dedupe klíč by jeho přepočet napořád zablokoval. Smazané se založí
      // znovu při dalším běhu cronu, pokud pořád platí.
      const years = [...new Set(deleted.map((row) => row.txDate.slice(0, 4)))];
      for (const year of years) {
        await tx
          .delete(notifications)
          .where(
            and(eq(notifications.userId, user.id), like(notifications.dedupeKey, `%|${year}`)),
          );
      }
      await tx.delete(importBatches).where(eq(importBatches.id, batch.id));
      // Jen u dávky ze SYNCU: ať se smazaná historie dá zase stáhnout (viz
      // komentář výš). U ručně nahraného výpisu by to znamenalo zbytečné
      // stahování celé historie a účet by v UI vypadal jako nesynchronizovaný.
      if (isSyncBatchFilename(batch.filename)) {
        await tx
          .update(brokerAccounts)
          .set({ lastSyncedAt: null })
          .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, batch.broker)));
      }
      return { filename: batch.filename, count: deleted.length };
    });
    // Cache výpočtů se MUSÍ zahodit ručně: otisk v klíči stojí na seznamu id
    // transakcí, ne na obsahu payloadu. Po vrácení a novém nahrání téhož výpisu
    // (dokumentovaný postup u nového pole v modelu) vyjde klíč identický s tím
    // z doby před vrácením a uživatel by deset minut viděl stará čísla.
    if (removed) {
      invalidateUserCache(user.id);
      const { plural } = await import('@/lib/format');
      await logAudit(
        db,
        user.id,
        'IMPORT_UNDONE',
        `${removed.filename}: ${removed.count} ${plural(removed.count, 'transakce', 'transakce', 'transakcí')}`,
      );
    }
  }
  revalidatePath('/prehled');
  revalidatePath('/portfolio');
  revalidatePath('/import');
}

/**
 * Uživatel doplnil, ze které platformy je výpis, který jsme nepřečetli.
 * Provozovateli o tom odejde upozornění — teprve tahle informace stačí na to,
 * aby se dal formát dohledat a doplnit.
 */
export async function reportFailedImportAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = String(formData.get('pripad') ?? '');
  const db = await getDb();
  const outcome = caseId
    ? await reportFailedImport(db, user.id, caseId, {
        platform: String(formData.get('platforma') ?? ''),
        note: String(formData.get('poznamka') ?? ''),
      })
    : 'neexistuje';

  revalidatePath('/import');
  // „Díky, máme to" se nesmí ukázat, když se nic neuložilo — hlášku o prázdném
  // formuláři i o zmizelém případu si uživatel zaslouží slyšet
  if (outcome === 'prazdne') redirect('/import?chyba=hlaseni-prazdne');
  if (outcome === 'neexistuje') redirect('/import?chyba=hlaseni-neexistuje');
  redirect('/import?ulozeno=hlaseni');
}

/* ── Napojení na brokery (Zdroje dat) ────────────────────────────────────── */

/** Uloží T212 API přístup (ID klíče + tajný klíč, šifrovaně) — jeden účet na uživatele. */
/**
 * Napojení brokera přes API je placené (docs/19) — import výpisů zůstává zdarma,
 * aby data zůstala úplná a limity se počítaly správně. Hlídá se i tady, ne jen
 * v UI: server action jde zavolat přímo.
 */
async function requireBrokerSync(db: Db, userId: string): Promise<void> {
  const entitlements = await resolveEntitlements(db, userId);
  if (!entitlements.brokerSync) redirect('/import?chyba=api-placene');
}

export async function saveTrading212KeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const keyId = String(formData.get('id-klice') ?? '').trim();
  const secret = String(formData.get('tajny-klic') ?? '').trim();
  if (secret.length < 10) redirect('/import?chyba=api-klic');

  const db = await getDb();
  await requireBrokerSync(db, user.id);
  // transakce: pád mezi delete a insert nesmí nechat uživatele bez účtu
  await db.transaction(async (tx) => {
    await tx
      .delete(brokerAccounts)
      .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
    await tx.insert(brokerAccounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      broker: 'trading212',
      label: 'Trading 212',
      credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: keyId || undefined, secret })),
    });
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Trading 212');
  revalidatePath('/import');
  redirect('/import');
}

/** Uloží IBKR Flex přístup (token + query ID, šifrovaně) — jeden IBKR účet na uživatele. */
export async function saveIbkrKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = String(formData.get('token') ?? '').trim();
  const queryId = String(formData.get('id-dotazu') ?? '').trim();
  if (token.length < 10 || !/^\d+$/.test(queryId)) redirect('/import?chyba=ibkr');

  const db = await getDb();
  await requireBrokerSync(db, user.id);
  // transakce: pád mezi delete a insert nesmí nechat uživatele bez účtu
  await db.transaction(async (tx) => {
    await tx
      .delete(brokerAccounts)
      .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'ibkr')));
    await tx.insert(brokerAccounts).values({
      id: crypto.randomUUID(),
      userId: user.id,
      broker: 'ibkr',
      label: 'Interactive Brokers',
      credentialsEncrypted: encryptSecret(JSON.stringify({ token, queryId })),
    });
  });

  await logAudit(db, user.id, 'BROKER_CONNECTED', 'Interactive Brokers');
  revalidatePath('/import');
  redirect('/import');
}

/** Odpojí jeden broker účet (multi-broker: každá karta má vlastní tlačítko). */
export async function disconnectBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('ucet') ?? '');
  const db = await getDb();
  const deleted = await db
    .delete(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)))
    .returning({ id: brokerAccounts.id });
  // tiché „nic se nesmazalo“ nesmí vypadat jako úspěch (stale formulář apod.)
  if (deleted.length === 0) redirect('/import?chyba=zadny-ucet');
  await logAudit(db, user.id, 'BROKER_DISCONNECTED');
  revalidatePath('/import');
  redirect('/import');
}

/**
 * Ruční synchronizace broker účtu: zapíše background job a hned se vrátí —
 * samotný běh (klidně deset minut) startuje after() po odeslání odpovědi,
 * průběh polluje /import. Chyby běhu končí v jobs.error (viz lib/jobs.ts).
 */
export async function syncBrokerAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const accountId = String(formData.get('ucet') ?? '');
  const db = await getDb();
  await requireBrokerSync(db, user.id);
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.id, accountId)));
  const account = accounts[0];
  if (!account) redirect('/import?chyba=zadny-ucet');

  const job = await enqueueSyncJob(db, user.id, account.id, jobTypeForBroker(account.broker));
  if (job.status === 'pending') {
    after(() => processJob(db, job.id));
  }

  revalidatePath('/import');
  redirect('/import');
}
