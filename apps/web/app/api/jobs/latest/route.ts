import { getDb } from '@/db';
import { getAuth } from '@/lib/auth';
import { latestSyncJob, toSyncJobView } from '@/lib/jobs';

/** Stav posledního sync jobu přihlášeného uživatele (volitelně ?account=) — polluje ho /import. */
export async function GET(request: Request): Promise<Response> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Unauthorized', { status: 401 });

  // `|| undefined`: prázdný string nesmí tiše vypnout filtr na účet
  const accountId = new URL(request.url).searchParams.get('account') || undefined;
  const db = await getDb();
  const job = await latestSyncJob(db, session.user.id, accountId);
  return Response.json({ job: job ? toSyncJobView(job) : null });
}
