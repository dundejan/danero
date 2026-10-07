import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { handOffCron } from '@/lib/cron-handoff';
import { errorText, logEvent } from '@/lib/log';
import {
  listNotificationTargets,
  processUserNotifications,
  resolveEmailSender,
} from '@/lib/notifications';

/**
 * G-11: běh je O(uživatelů) a na každého se pouští celý engine. Bez stropu by
 * ho default limit funkce zabil uprostřed — a bez dávkování by timeout
 * u 50. uživatele znamenal, že zbytek ten den nedostane nic.
 */
export const maxDuration = 300;

/** Kolik uživatelů zpracuje jedna invokace, než předá práci další. */
const BATCH_SIZE = 25;
/** Časový strop dávky — pod limitem funkce, ať se stihne předat štafeta. */
const BATCH_BUDGET_MS = 225_000;

/** Denní notifikace (po ranním syncu) — chráněno CRON_SECRET. */
export const GET = withCron('notify', async (request: Request): Promise<Response> => {
  const rawOffset = Number(new URL(request.url).searchParams.get('offset') ?? '0');
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const db = await getDb();
  const send = resolveEmailSender();
  // stabilní pořadí: navazující dávka musí navázat přesně tam, kde ta předchozí
  // skončila — bez seřazení by se fronta mezi invokacemi zamíchala
  const targets = (await listNotificationTargets(db)).sort((a, b) => a.id.localeCompare(b.id));

  const startedAt = Date.now();
  const results: Array<{ userId: string; created?: number; emailed?: number; error?: string }> =
    [];
  for (const target of targets.slice(offset, offset + BATCH_SIZE)) {
    if (results.length > 0 && Date.now() - startedAt > BATCH_BUDGET_MS) break;
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

  const nextOffset = offset + results.length;
  const remaining = Math.max(0, targets.length - nextOffset);
  // `results.length > 0` je pojistka proti nekonečnému řetězu: bez postupu
  // se štafeta nepředává
  if (remaining > 0 && results.length > 0) {
    const next = new URL(request.url);
    next.searchParams.set('offset', String(nextOffset));
    handOffCron('notify', next, { offset: nextOffset });
  }

  // G-O1: bez tohohle logu končily chyby jednotlivých uživatelů jen v těle
  // odpovědi, cron vracel 200 a výpadek Resendu se z monitoringu nedal poznat.
  // Text chyby (ne identifikátor uživatele) je jediné, čím se odliší výpadek
  // odesílatele od chyby v datech jednoho účtu.
  const failures = results.filter((result) => result.error !== undefined);
  if (failures.length > 0) {
    logEvent('error', 'cron.notify.failures', {
      failed: failures.length,
      processed: results.length,
      error: failures[0]!.error!,
    });
  }

  return Response.json({
    users: targets.length,
    offset,
    processed: results.length,
    // konvence pro withCron: > 0 zvedne úroveň logu běhu na error
    failed: failures.length,
    remaining,
    results,
  });
});
