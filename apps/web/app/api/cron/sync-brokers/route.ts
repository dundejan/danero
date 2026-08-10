import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { withCron } from '@/lib/cron-auth';
import { errorText } from '@/lib/log';
import { billingEnabled, usersWithActiveSubscription } from '@/lib/entitlements';
import { enqueueSyncJob, jobTypeForBroker, processPendingJobs } from '@/lib/jobs';

/**
 * Denní synchronizace všech napojených broker účtů (Vercel Cron / externí
 * plánovač): pro každý účet zařadí background job a fronta se hned zpracuje.
 * Průběh je tak vidět v UI stejně jako u ručního syncu a odpověď nese výsledek
 * per job — selhání syncu musí být z monitoringu cronu poznat. Chráněno CRON_SECRET.
 */
// Vercel: plný sync trvá minuty (T212 ~1 req/min) — default limit by ho zabil
// uprostřed; 800 s vyžaduje Pro plán (hobby max 300 s — viz docs/08)
export const maxDuration = 800;

export const GET = withCron('sync-brokers', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  const allAccounts = await db.select().from(brokerAccounts);

  // automatický sync je placený (docs/19) — neplatícím účtům se broker nesahá
  const paying = await usersWithActiveSubscription(db);
  const accounts = billingEnabled()
    ? allAccounts.filter((account) => paying.has(account.userId))
    : allAccounts;

  // per-účet izolace: jeden vadný/neznámý broker nesmí shodit denní sync všem
  const skipped: Array<{ accountId: string; error: string }> = [];
  for (const account of accounts) {
    try {
      await enqueueSyncJob(db, account.userId, account.id, jobTypeForBroker(account.broker));
    } catch (error) {
      skipped.push({
        accountId: account.id,
        error: errorText(error),
      });
    }
  }
  const { recovered, results, deferred } = await processPendingJobs(db);

  return Response.json({
    accounts: accounts.length,
    withoutSubscription: allAccounts.length - accounts.length,
    recovered,
    deferred,
    // konvence pro withCron: > 0 zvedne úroveň logu běhu na error — jinak by
    // den, kdy se nesynchronizoval ani jeden účet, vypadal v logu stejně jako
    // úspěšný (detail už zalogoval processJob jako `job.finished`)
    failed: results.filter((result) => result.status === 'error').length + skipped.length,
    results,
    skipped,
  });
});
