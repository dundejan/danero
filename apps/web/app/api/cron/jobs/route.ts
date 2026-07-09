import { getDb } from '@/db';
import { requireCronAuth } from '@/lib/cron-auth';
import { processPendingJobs } from '@/lib/jobs';

/**
 * Záchranná síť background jobů (viz lib/jobs.ts): dorovná joby zabité restartem
 * procesu a zpracuje čekající, které after() nestihl vzít. Bez CRON_SECRET odmítá vše.
 */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;
  const { logEvent } = await import('@/lib/log');
  logEvent('info', 'cron.jobs.run');


  const db = await getDb();
  const { recovered, results } = await processPendingJobs(db);
  return Response.json({ recovered, results });
}
