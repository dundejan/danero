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
