import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { processPendingJobs } from '@/lib/jobs';

/**
 * Záchranná síť background jobů (viz lib/jobs.ts): dorovná joby zabité restartem
 * procesu a zpracuje čekající, které after() nestihl vzít. Bez CRON_SECRET odmítá vše.
 */
// Vercel: plný sync trvá minuty (T212 ~1 req/min) — default limit by ho zabil
// uprostřed; 800 s vyžaduje Pro plán (hobby max 300 s — viz docs/08)
export const maxDuration = 800;

export const GET = withCron('jobs', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  const { recovered, results } = await processPendingJobs(db);
  return Response.json({ recovered, results });
});
