import { getDb } from '@/db';
import { pruneAuditLog } from '@/lib/audit';
import { withCron } from '@/lib/cron-auth';
import { pruneRateLimits } from '@/lib/rate-limit';

/**
 * Denní úklid dat, která už nemáme držet: audit log (/soukromi slibuje 90 dní)
 * a prošlá okna rate limitů (drží mimo jiné syrové IP adresy z waitlistu
 * a nemají cizí klíč, takže přežijí i smazání účtu).
 */
export const GET = withCron('maintenance', async (_request: Request): Promise<Response> => {
  const db = await getDb();
  const auditDeleted = await pruneAuditLog(db);
  const rateLimitsDeleted = await pruneRateLimits(db);
  return Response.json({ auditDeleted, rateLimitsDeleted });
});
