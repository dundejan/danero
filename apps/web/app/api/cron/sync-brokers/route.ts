import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { requireCronAuth } from '@/lib/cron-auth';
import { enqueueSyncJob, jobTypeForBroker, processPendingJobs } from '@/lib/jobs';

/**
 * Denní synchronizace všech napojených broker účtů (Vercel Cron / externí
 * plánovač): pro každý účet zařadí background job a fronta se hned zpracuje.
 * Průběh je tak vidět v UI stejně jako u ručního syncu a odpověď nese výsledek
 * per job — selhání syncu musí být z monitoringu cronu poznat. Chráněno CRON_SECRET.
 */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const accounts = await db.select().from(brokerAccounts);

  // per-účet izolace: jeden vadný/neznámý broker nesmí shodit denní sync všem
  const skipped: Array<{ accountId: string; error: string }> = [];
  for (const account of accounts) {
    try {
      await enqueueSyncJob(db, account.userId, account.id, jobTypeForBroker(account.broker));
    } catch (error) {
      skipped.push({
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const { recovered, results } = await processPendingJobs(db);

  return Response.json({ accounts: accounts.length, recovered, results, skipped });
}
