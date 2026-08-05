import { getDb } from '@/db';
import { pruneAuditLog } from '@/lib/audit';
import { withCron } from '@/lib/cron-auth';

/**
 * Denní úklid dat, která už nemáme držet. Zatím jen audit log — /soukromi
 * slibuje 90 dní a bez tohohle běhu by tam záznamy zůstávaly navždy.
 */
export const GET = withCron('maintenance', async (_request: Request): Promise<Response> => {
  const db = await getDb();
  const auditDeleted = await pruneAuditLog(db);
  return Response.json({ auditDeleted });
});
