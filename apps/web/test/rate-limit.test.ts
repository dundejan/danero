import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { checkRateLimit } from '@/lib/rate-limit';

describe('aplikační rate limit (G10a)', () => {
  it('povolí max požadavků v okně, pak blokuje; nové okno resetuje', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const opts = { max: 3, windowMs: 60_000 };
    expect(await checkRateLimit(db, 'op:u1', opts)).toBe(true);
    expect(await checkRateLimit(db, 'op:u1', opts)).toBe(true);
    expect(await checkRateLimit(db, 'op:u1', opts)).toBe(true);
    expect(await checkRateLimit(db, 'op:u1', opts)).toBe(false);
    // jiný klíč (uživatel/operace) má vlastní čítač
    expect(await checkRateLimit(db, 'op:u2', opts)).toBe(true);
    // po vypršení okna se čítač resetuje → znovu povoleno
    const { appRateLimits } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    await db
      .update(appRateLimits)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(eq(appRateLimits.key, 'op:u1'));
    expect(await checkRateLimit(db, 'op:u1', opts)).toBe(true);
  });
});
