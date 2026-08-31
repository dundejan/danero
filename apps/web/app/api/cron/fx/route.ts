import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { fetchCnbYear } from '@/lib/cnb';
import { currentTaxYear } from '@/lib/clock';

/** Denní aktualizace kurzů ČNB (R-06b) — stáhne celý běžný rok (idempotentní). */
export const GET = withCron('fx', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  // rok se láme v české zóně — ČNB vyhlašuje kurzy podle českého kalendáře
  const year = currentTaxYear();
  const rows = await fetchCnbYear(db, year);
  return Response.json({ year, rows });
});
