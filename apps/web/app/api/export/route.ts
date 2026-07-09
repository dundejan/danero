import { eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth';
import { getDb } from '@/db';
import {
  brokerAccounts,
  portfolios,
  importBatches,
  instrumentAliases,
  notifications,
  taxpayerProfiles,
  transactions,
} from '@/db/schema';

export const dynamic = 'force-dynamic';

/**
 * GDPR export (právo na přenositelnost z /soukromi): kompletní JSON všech dat
 * uživatele — transakce v kanonickém formátu, profil, broker účty (bez
 * šifrovaných klíčů!), číselník instrumentů, notifikace, importní dávky.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Nepřihlášen', { status: 401 });
  const userId = session.user.id;
  const db = await getDb();

  const portfolioRows = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId));
  const profiles = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  const txRows = await db.select().from(transactions).where(eq(transactions.userId, userId));
  const accounts = await db
    .select({
      id: brokerAccounts.id,
      portfolioId: brokerAccounts.portfolioId,
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

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'danero-export-v1',
    user: { email: session.user.email, name: session.user.name },
    // GDPR export pokrývá VŠECHNA portfolia účtu
    portfolios: portfolioRows,
    profiles,
    // kanonický model (docs/04) — payload je zdroj pravdy každé transakce
    transactions: txRows.map((row) => ({ portfolioId: row.portfolioId, ...(row.payload as object) })),
    brokerAccounts: accounts, // šifrované API klíče se záměrně NEexportují
    instrumentAliases: aliases,
    notifications: notif,
    importBatches: batches,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="danero-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
