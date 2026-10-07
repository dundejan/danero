import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { withCron } from '@/lib/cron-auth';
import { continueJobsElsewhere } from '@/lib/cron-handoff';
import { errorText } from '@/lib/log';
import { enqueueSyncJob, jobTypeForBroker, processPendingJobs } from '@/lib/jobs';

/**
 * Denní synchronizace všech napojených broker účtů (Vercel Cron / externí
 * plánovač): pro každý účet zařadí background job a fronta se hned zpracuje.
 * Průběh je tak vidět v UI stejně jako u ručního syncu a odpověď nese výsledek
 * per job — selhání syncu musí být z monitoringu cronu poznat. Chráněno CRON_SECRET.
 */
// Strop běhu funkce: 300 s je maximum Vercel Hobby. Fronta delší než jeden běh
// (T212 ~65 s na účet) se dojede v navazujících invokacích /api/cron/jobs.
export const maxDuration = 300;

export const GET = withCron('sync-brokers', async (request: Request): Promise<Response> => {
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
        error: errorText(error),
      });
    }
  }
  const { recovered, results, deferred, paused } = await processPendingJobs(db);
  // na co se nedostalo (nebo co se přerušilo), dojede hned v další invokaci —
  // jinak by to čekalo den na příští plánované spuštění
  if ((deferred > 0 || paused > 0) && results.length > 0) {
    continueJobsElsewhere(new URL(request.url).origin, 0);
  }

  return Response.json({
    accounts: accounts.length,
    recovered,
    deferred,
    paused,
    // konvence pro withCron: > 0 zvedne úroveň logu běhu na error — jinak by
    // den, kdy se nesynchronizoval ani jeden účet, vypadal v logu stejně jako
    // úspěšný (detail už zalogoval processJob jako `job.finished`)
    failed: results.filter((result) => result.status === 'error').length + skipped.length,
    results,
    skipped,
  });
});
