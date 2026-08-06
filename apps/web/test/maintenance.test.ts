import { afterEach, describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { appRateLimits } from '@/db/schema';
import { checkRateLimit, pruneRateLimits } from '@/lib/rate-limit';
import { resolveEmailSender } from '@/lib/email';

describe('úklid provozních tabulek', () => {
  it('prošlá okna rate limitů se smažou, běžící zůstanou', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    // klíč z waitlistu drží syrovou IP — po vypršení okna ji nemáme proč držet
    await db.insert(appRateLimits).values([
      { key: 'waitlist:203.0.113.7', count: 1, resetAt: new Date('2026-01-01T00:00:00Z') },
      { key: 'upload:smazany-uzivatel', count: 3, resetAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    await checkRateLimit(db, 'upload:aktivni', { max: 10, windowMs: 600_000 });

    const deleted = await pruneRateLimits(db, new Date('2026-08-06T00:00:00Z'));

    expect(deleted).toBe(2);
    const zbytek = await db.select({ key: appRateLimits.key }).from(appRateLimits);
    expect(zbytek.map((r) => r.key)).toEqual(['upload:aktivni']);
  });
});

describe('pojistka na DANERO_EMAIL_LOG', () => {
  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
    delete process.env.RESEND_API_KEY;
  });

  it('vedle nastaveného Resendu se e-maily nesmí přesměrovat do souboru', () => {
    process.env.DANERO_EMAIL_LOG = '/tmp/danero-e2e-maily.log';
    process.env.RESEND_API_KEY = 're_testovaci_klic';
    expect(() => resolveEmailSender()).toThrow(/DANERO_EMAIL_LOG/);
  });

  it('bez Resendu soubor dál funguje — E2E (i to produkční) ho potřebuje', () => {
    process.env.DANERO_EMAIL_LOG = '/tmp/danero-e2e-maily.log';
    expect(resolveEmailSender()).toBeTypeOf('function');
  });
});
