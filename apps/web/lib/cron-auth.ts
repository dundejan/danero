import { timingSafeEqual } from 'node:crypto';

/** Ochrana cron endpointů: bez nastaveného CRON_SECRET odmítají vše.
 *  Porovnání v konstantním čase — běžné !== končí na prvním rozdílném bajtu. */
export function requireCronAuth(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization') ?? '';
  const expected = secret ? `Bearer ${secret}` : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}

import { errorText, logEvent } from '@/lib/log';

/**
 * Počty z těla odpovědi do logu: čísla tak, jak jsou, u polí jejich délka.
 * Nic jiného — v `results` bývají identifikátory uživatelů a ty do logu nepatří.
 */
async function countsFrom(response: Response): Promise<Record<string, number>> {
  try {
    const body = (await response.clone().json()) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'number') out[key] = value;
      else if (Array.isArray(value)) out[`${key}Count`] = value.length;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Rám cron routy: auth check (401 loguje jako warn) + strukturovaný log běhu.
 * Nová cron routa nemůže zapomenout na CRON_SECRET — invariant žije tady.
 *
 * G-6: loguje se i konec běhu (s trváním a počty zpracovaných položek) a
 * selhání. Bez toho z monitoringu nejde poznat cron, který tiše nic neudělal —
 * tělo odpovědi Vercel Cron neuchovává.
 */
export function withCron(
  name: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const unauthorized = requireCronAuth(request);
    if (unauthorized) {
      logEvent('warn', `cron.${name}.unauthorized`);
      return unauthorized;
    }
    const startedAt = Date.now();
    logEvent('info', `cron.${name}.run`);
    try {
      const response = await handler(request);
      const level = response.ok ? 'info' : 'error';
      logEvent(level, `cron.${name}.finished`, {
        durationMs: Date.now() - startedAt,
        status: response.status,
        ...(await countsFrom(response)),
      });
      return response;
    } catch (error) {
      logEvent('error', `cron.${name}.failed`, {
        durationMs: Date.now() - startedAt,
        error: errorText(error),
      });
      throw error;
    }
  };
}
