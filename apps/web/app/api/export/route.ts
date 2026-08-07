import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { getDb } from '@/db';
import {
  brokerAccounts,
  importBatches,
  instrumentAliases,
  notifications,
  reportPurchases,
  subscriptions,
  taxpayerProfiles,
  taxYearSettings,
  transactions,
} from '@/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GDPR export (právo na přenositelnost z /soukromi): kompletní JSON všech dat
 * uživatele — transakce v kanonickém formátu, profil, broker účty (bez
 * šifrovaných klíčů!), číselník instrumentů, notifikace, importní dávky
 * a historie nákupů (předplatné + zaplacené daňové roky).
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

  const profiles = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  const txRows = await db.select().from(transactions).where(eq(transactions.userId, userId));
  const accounts = await db
    .select({
      id: brokerAccounts.id,
      broker: brokerAccounts.broker,
      label: brokerAccounts.label,
      lastSyncedAt: brokerAccounts.lastSyncedAt,
      lastSyncStatus: brokerAccounts.lastSyncStatus,
      createdAt: brokerAccounts.createdAt,
    })
    .from(brokerAccounts)
    .where(eq(brokerAccounts.userId, userId));
  const aliases = await db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, userId));
  const notif = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const batches = await db
    .select({
      id: importBatches.id,
      broker: importBatches.broker,
      filename: importBatches.filename,
      added: importBatches.added,
      duplicates: importBatches.duplicates,
      createdAt: importBatches.createdAt,
    })
    .from(importBatches)
    .where(eq(importBatches.userId, userId));
  // historie nákupů (/soukromi slibuje odnést si i ji) — stripe identifikátory
  // jsou součástí údajů o uživateli, doklad o zaplacení má Stripe
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  // R-05c: metoda párování zafixovaná za roky, které už uživatel použil pro
  // přiznání — bez ní by z exportu nešlo doložit, čím se jeho podaná čísla počítala
  const pinnedMethods = await db
    .select()
    .from(taxYearSettings)
    .where(eq(taxYearSettings.userId, userId));
  const purchases = await db
    .select()
    .from(reportPurchases)
    .where(eq(reportPurchases.userId, userId));

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'danero-export-v1',
    user: { email: session.user.email, name: session.user.name },
    profiles,
    // kanonický model (docs/04) — payload je zdroj pravdy každé transakce
    transactions: txRows.map((row) => row.payload as object),
    brokerAccounts: accounts, // šifrované API klíče se záměrně NEexportují
    instrumentAliases: aliases,
    notifications: notif,
    importBatches: batches,
    subscriptions: subs,
    pinnedMatchingMethods: pinnedMethods,
    reportPurchases: purchases,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="danero-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
