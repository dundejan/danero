import { after } from 'next/server';
import { getDb } from '@/db';
import { withCron } from '@/lib/cron-auth';
import { errorText, logEvent } from '@/lib/log';
import { billingEnabled, usersWithActiveSubscription } from '@/lib/entitlements';
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
export const maxDuration = 800;

/** Kolik uživatelů zpracuje jedna invokace, než předá práci další. */
const BATCH_SIZE = 25;
/** Časový strop dávky — pod limitem funkce, ať se stihne předat štafeta. */
const BATCH_BUDGET_MS = 600_000;
/**
 * Jak dlouho čekáme na odpověď navazující dávky. Není to čekání na její
 * dokončení: každá dávka je vlastní invokace s vlastním limitem, tohle je jen
 * pojistka, že požadavek opravdu odešel.
 */
const HANDOFF_TIMEOUT_MS = 10_000;

/** Předá zbytek fronty další invokaci (`?offset=`), ať se stihne celý den. */
function handOff(request: Request, offset: number): void {
  const next = new URL(request.url);
  next.searchParams.set('offset', String(offset));
  logEvent('info', 'cron.notify.handoff', { offset });
  after(async () => {
    try {
      const response = await fetch(next, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
      });
      // K5-12: `fetch` na chybový stav NEVYHAZUJE. Selhání navazující dávky
      // (500) se sice zaloguje v ní samé, ale požadavek, který do aplikace
      // vůbec nedorazil (Vercel 429/502) nebo skončil na 401 (přenastavené
      // CRON_SECRET), by tady prošel jako úspěšné předání — a zbytek fronty
      // ten den nedostane nic, aniž by se to kdekoli objevilo jako chyba.
      if (!response.ok) {
        logEvent('error', 'cron.notify.handoff_failed', {
          offset,
          status: response.status,
          error: `štafeta odmítnuta se stavem ${response.status}`,
        });
      }
    } catch (error) {
      // TimeoutError = dávka běží dál ve vlastní invokaci, jen jsme přestali
      // čekat na její odpověď; cokoli jiného je skutečné selhání předání
      if (error instanceof Error && error.name === 'TimeoutError') return;
      logEvent('error', 'cron.notify.handoff_failed', { offset, error: errorText(error) });
    }
  });
}

/** Denní notifikace (po ranním syncu) — chráněno CRON_SECRET. */
export const GET = withCron('notify', async (request: Request): Promise<Response> => {
  const rawOffset = Number(new URL(request.url).searchParams.get('offset') ?? '0');
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const db = await getDb();
  const send = resolveEmailSender();
  // stabilní pořadí: navazující dávka musí navázat přesně tam, kde ta předchozí
  // skončila — bez seřazení by se fronta mezi invokacemi zamíchala
  const allTargets = (await listNotificationTargets(db)).sort((a, b) => a.id.localeCompare(b.id));

  // Celoroční hlídání je placené (docs/19). Neplatícím se denní běh nedělá vůbec —
  // ne kvůli e-mailu, ale protože ten přepočet je ta drahá část. Svůj stav uvidí
  // kdykoli v aplikaci, počítá se jim on-demand při otevření.
  const paying = await usersWithActiveSubscription(db);
  const targets = billingEnabled()
    ? allTargets.filter((target) => paying.has(target.id))
    : allTargets;

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
  if (remaining > 0 && results.length > 0) handOff(request, nextOffset);

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
    withoutSubscription: allTargets.length - targets.length,
    offset,
    processed: results.length,
    // konvence pro withCron: > 0 zvedne úroveň logu běhu na error
    failed: failures.length,
    remaining,
    results,
  });
});
