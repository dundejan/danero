import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import {
  listNotificationTargets,
  processUserNotifications,
  resolveEmailSender,
} from '@/lib/notifications';

/** Denní notifikace (po ranním syncu) — chráněno CRON_SECRET. */
export const GET = withCron('notify', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  const send = resolveEmailSender();
  const targets = await listNotificationTargets(db);

  const results: Array<{ userId: string; created?: number; emailed?: number; error?: string }> =
    [];
  for (const target of targets) {
    try {
      const outcome = await processUserNotifications(db, target, { send });
      results.push({ userId: target.id, ...outcome });
    } catch (error) {
      results.push({
        userId: target.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return Response.json({ users: targets.length, results });
});
