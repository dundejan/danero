import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { requireCronAuth } from '@/lib/cron-auth';
import { enqueueSyncJob, processPendingJobs } from '@/lib/jobs';

/**
 * Denní synchronizace všech napojených T212 účtů (Vercel Cron / externí plánovač):
 * pro každý účet zařadí background job a fronta se hned zpracuje. Průběh je tak
 * vidět v UI stejně jako u ručního syncu a odpověď nese výsledek per job —
 * selhání syncu musí být z monitoringu cronu poznat. Chráněno CRON_SECRET.
 */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(eq(brokerAccounts.broker, 'trading212'));

  for (const account of accounts) {
    await enqueueSyncJob(db, account.userId, account.id);
  }
  const { recovered, results } = await processPendingJobs(db);

  return Response.json({ accounts: accounts.length, recovered, results });
}
