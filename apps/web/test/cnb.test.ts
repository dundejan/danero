import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDb } from '@/db';
import { fxRates } from '@/db/schema';
import { ensureCnbYears, fetchCnbYear, loadCnbRateProvider, parseCnbYearText } from '@/lib/cnb';

/** Formát ročního exportu ČNB: hlavička s množstvím, dny s desetinnou čárkou. */
const CNB_SAMPLE = [
  'Datum|1 EUR|1 USD|100 JPY',
  '02.01.2026|25,120|22,510|15,320',
  '05.01.2026|25,080|22,430|15,280',
].join('\n');

describe('denní kurzy ČNB (R-06b)', () => {
  it('parsuje roční export a normalizuje kotace za 100 jednotek', () => {
    const rows = parseCnbYearText(CNB_SAMPLE);
    expect(rows).toHaveLength(6);
    const jpy = rows.find((row) => row.currency === 'JPY' && row.day === '2026-01-02')!;
    expect(jpy.rate).toBe('0.1532');
    const eur = rows.find((row) => row.currency === 'EUR' && row.day === '2026-01-05')!;
    expect(eur.rate).toBe('25.08');
  });

  it(
    'fetchCnbYear ukládá idempotentně; provider dohledá kurz přes víkend',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const fetchImpl: typeof fetch = (async () =>
        new Response(CNB_SAMPLE, { status: 200 })) as typeof fetch;

      const first = await fetchCnbYear(db, 2026, fetchImpl);
      expect(first).toBe(6);
      await fetchCnbYear(db, 2026, fetchImpl); // druhé stažení nic nezdvojí
      const stored = await db.select().from(fxRates).where(eq(fxRates.currency, 'EUR'));
      expect(stored).toHaveLength(2);

      const provider = await loadCnbRateProvider(db, 2026, 2026);
      expect(provider.isEmpty).toBe(false);
      // pátek 2. 1. platí i pro sobotu 3. 1. a neděli 4. 1. (poslední vyhlášený)
      expect(provider.getRate('EUR', '2026-01-04')?.toString()).toBe('25.12');
      expect(provider.getRate('EUR', '2026-01-05')?.toString()).toBe('25.08');
      expect(provider.getRate('CZK', '2026-01-04')?.toString()).toBe('1');
      expect(provider.getRate('EUR', '2026-06-01')).toBeUndefined();
    },
  );

  it('ensureCnbYears stahuje jen chybějící roky', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls += 1;
      return new Response(CNB_SAMPLE, { status: 200 });
    }) as typeof fetch;

    await ensureCnbYears(db, [2026, 2026], fetchImpl);
    expect(calls).toBe(1); // dedup roků; 2026 je běžný rok → stáhne se
  });
});
