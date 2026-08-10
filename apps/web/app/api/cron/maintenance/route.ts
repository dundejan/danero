import { getDb } from '@/db';
import { pruneAuditLog } from '@/lib/audit';
import { withCron } from '@/lib/cron-auth';
import { pruneJobs } from '@/lib/jobs';
import { pruneRateLimits } from '@/lib/rate-limit';
import {
  pruneAuthRateLimits,
  reencryptBrokerCredentials,
  pruneImportBatches,
  pruneNotifications,
  pruneSessions,
  pruneVerifications,
} from '@/lib/retention';

/**
 * Denní úklid dat, která už nemáme držet: /soukromi slibuje u technického
 * auditu (přihlášení, synchronizace) 90 dní a bez tohohle cronu by to byla lež.
 * Politika retence per tabulka žije v lib/retention.ts (a u jobů v lib/jobs.ts,
 * kde poslední job na klíč zůstává — nese resume stav syncu).
 *
 * Pořadí je od nejdůležitějšího: kdyby jedno mazání spadlo, to před ním už
 * proběhlo. Počty jdou do odpovědi, odkud je `withCron` propíše do logu.
 */
export const GET = withCron('maintenance', async (_request: Request): Promise<Response> => {
  const db = await getDb();
  const auditDeleted = await pruneAuditLog(db);
  const sessionsDeleted = await pruneSessions(db);
  const verificationsDeleted = await pruneVerifications(db);
  const rateLimitsDeleted = await pruneRateLimits(db);
  const authRateLimitsDeleted = await pruneAuthRateLimits(db);
  const credentialsRotated = await reencryptBrokerCredentials(db);
  const jobsDeleted = await pruneJobs(db);
  const importBatchesDeleted = await pruneImportBatches(db);
  const notificationsDeleted = await pruneNotifications(db);
  return Response.json({
    auditDeleted,
    sessionsDeleted,
    verificationsDeleted,
    rateLimitsDeleted,
    authRateLimitsDeleted,
    credentialsRotated,
    jobsDeleted,
    importBatchesDeleted,
    notificationsDeleted,
  });
});
