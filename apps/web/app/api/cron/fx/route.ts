import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { fetchCnbYear } from '@/lib/cnb';

/** Denní aktualizace kurzů ČNB (R-06b) — stáhne celý běžný rok (idempotentní). */
export const GET = withCron('fx', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const rows = await fetchCnbYear(db, year);
  return Response.json({ year, rows });
});
