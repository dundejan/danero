import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { continueJobsElsewhere, hopFrom } from '@/lib/cron-handoff';
import { processPendingJobs } from '@/lib/jobs';

/**
 * Záchranná síť background jobů (viz lib/jobs.ts): dorovná joby zabité restartem
 * procesu a zpracuje čekající, které after() nestihl vzít. Bez CRON_SECRET odmítá vše.
 *
 * Je to i místo, kde pokračuje fronta delší než jeden běh: denní sync i ruční
 * synchronizace sem po vyčerpání svého času předají zbytek (`?hop=`).
 */
// Strop běhu funkce: 300 s je maximum Vercel Hobby. Plný sync T212 (~65 s za
// každý rok) se do něj nevejde, proto se umí přerušit a navázat — viz
// `SyncPaused` a `DEFAULT_JOB_BUDGET_MS` v lib/jobs.ts.
export const maxDuration = 300;

export const GET = withCron('jobs', async (request: Request): Promise<Response> => {
  const db = await getDb();
  const { recovered, results, deferred, paused } = await processPendingJobs(db);
  // `results.length > 0` je pojistka proti nekonečnému řetězu: bez postupu se
  // štafeta nepředává
  if ((deferred > 0 || paused > 0) && results.length > 0) {
    continueJobsElsewhere(new URL(request.url).origin, hopFrom(request));
  }
  // konvence pro withCron: > 0 zvedne úroveň logu běhu na error (detail chyby
  // už zalogoval processJob jako `job.finished`)
  const failed = results.filter((result) => result.status === 'error').length;
  return Response.json({ recovered, failed, deferred, paused, results });
});
