import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { syncTrading212 } from '@/lib/t212-sync';

/**
 * Denní synchronizace všech napojených T212 účtů (Vercel Cron / externí plánovač).
 * Chráněno CRON_SECRET — bez něj endpoint odmítá vše.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(eq(brokerAccounts.broker, 'trading212'));

  const results: Array<{ accountId: string; ok: boolean; added?: number; error?: string }> = [];
  for (const account of accounts) {
    try {
      const outcome = await syncTrading212(db, account);
      results.push({ accountId: account.id, ok: true, added: outcome.added });
    } catch (error) {
      // lastSyncedAt při chybě nenastavovat — plná historie by se už nikdy nedotáhla
      await db
        .update(brokerAccounts)
        .set({ lastSyncStatus: 'error' })
        .where(eq(brokerAccounts.id, account.id));
      results.push({
        accountId: account.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({ accounts: accounts.length, results });
}
