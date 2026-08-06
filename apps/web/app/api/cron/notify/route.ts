import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { errorText } from '@/lib/log';
import { billingEnabled, usersWithActiveSubscription } from '@/lib/entitlements';
import {
  listNotificationTargets,
  processUserNotifications,
  resolveEmailSender,
} from '@/lib/notifications';

/** Denní notifikace (po ranním syncu) — chráněno CRON_SECRET. */
export const GET = withCron('notify', async (_request: Request): Promise<Response> => {


  const db = await getDb();
  const send = resolveEmailSender();
  const allTargets = await listNotificationTargets(db);

  // Celoroční hlídání je placené (docs/19). Neplatícím se denní běh nedělá vůbec —
  // ne kvůli e-mailu, ale protože ten přepočet je ta drahá část. Svůj stav uvidí
  // kdykoli v aplikaci, počítá se jim on-demand při otevření.
  const paying = await usersWithActiveSubscription(db);
  const targets = billingEnabled()
    ? allTargets.filter((target) => paying.has(target.id))
    : allTargets;

  const results: Array<{ userId: string; created?: number; emailed?: number; error?: string }> =
    [];
  for (const target of targets) {
    try {
      const outcome = await processUserNotifications(db, target, { send });
      results.push({ userId: target.id, ...outcome });
    } catch (error) {
      results.push({
        userId: target.id,
        error: errorText(error),
      });
    }
  }

  return Response.json({
    users: targets.length,
    withoutSubscription: allTargets.length - targets.length,
    results,
  });
});
