import { getDb } from '@/db';
import { requireCronAuth } from '@/lib/cron-auth';
import { fetchCnbYear } from '@/lib/cnb';

/** Denní aktualizace kurzů ČNB (R-06b) — stáhne celý běžný rok (idempotentní). */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const rows = await fetchCnbYear(db, year);
  return Response.json({ year, rows });
}
