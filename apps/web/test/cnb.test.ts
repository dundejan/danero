import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPgliteDb } from '@/db';
import { fxRates } from '@/db/schema';
import {
  ensureCnbYears,
  fetchCnbYear,
  lastCnbDayOfYear,
  loadCnbRateProvider,
  parseCnbYearText,
  cnbYearCoverage,
} from '@/lib/cnb';

/** Formát ročního exportu ČNB: hlavička s množstvím, dny s desetinnou čárkou. */
const CNB_SAMPLE = [
  'Datum|1 EUR|1 USD|100 JPY',
  '02.01.2026|25,120|22,510|15,320',
  '05.01.2026|25,080|22,430|15,280',
].join('\n');

const CNB_LIST_CHANGE = [
  'Datum|1 EUR|100 RUB|1 USD',
  '02.01.2022|24,860|1,203|21,970',
  'Datum|1 EUR|1 USD',
  '02.03.2022|25,225|22,700',
].join('\n');

describe('denní kurzy ČNB (R-06b)', () => {
  it('změna kurzovního lístku uprostřed roku přemapuje sloupce (rok 2022, RUB)', () => {
    const { rows } = parseCnbYearText(CNB_LIST_CHANGE);
    const usdBefore = rows.find((r) => r.currency === 'USD' && r.day === '2022-01-02')!;
    const usdAfter = rows.find((r) => r.currency === 'USD' && r.day === '2022-03-02')!;
    expect(usdBefore.rate).toBe('21.97');
    expect(usdAfter.rate).toBe('22.7'); // NE hodnota ze sloupce po RUB
    expect(rows.some((r) => r.currency === 'RUB' && r.day === '2022-03-02')).toBe(false);
  });

  it('parsuje roční export a normalizuje kotace za 100 jednotek', () => {
    const { rows } = parseCnbYearText(CNB_SAMPLE);
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

  it('lastCnbDayOfYear: 31. 12. v pracovní den, jinak poslední pátek', () => {
    expect(lastCnbDayOfYear(2025)).toBe('2025-12-31'); // středa
    expect(lastCnbDayOfYear(2023)).toBe('2023-12-29'); // 31. 12. 2023 = neděle
    expect(lastCnbDayOfYear(2022)).toBe('2022-12-30'); // 31. 12. 2022 = sobota
  });

  it(
    'ensureCnbYears dotáhne chybějící konec uzavřeného roku (kurz z 31. 12. po ranním cronu)',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      // rok 2025 „stažený“ naposledy ráno 31. 12.: přes 1000 řádků, ale poslední
      // den 30. 12. — kurz z 31. 12. (vyhlášen ~14:30) už cron nestihl
      const seed: Array<{ day: string; currency: string; rate: string }> = [];
      const currencies = ['EUR', 'USD', 'GBP'];
      const cursor = new Date(Date.UTC(2025, 0, 2));
      for (;;) {
        const day = cursor.toISOString().slice(0, 10);
        if (day > '2025-12-30') break;
        for (const currency of currencies) seed.push({ day, currency, rate: '20' });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      expect(seed.length).toBeGreaterThanOrEqual(1000);
      for (let i = 0; i < seed.length; i += 500) {
        await db.insert(fxRates).values(seed.slice(i, i + 500));
      }

      let calls = 0;
      const fullYear = 'Datum|1 EUR\n31.12.2025|25,000';
      const fetchImpl: typeof fetch = (async () => {
        calls += 1;
        return new Response(fullYear, { status: 200 });
      }) as typeof fetch;

      await ensureCnbYears(db, [2025], fetchImpl);
      expect(calls).toBe(1); // maxDay 30. 12. < 31. 12. → dotáhnout

      await ensureCnbYears(db, [2025], fetchImpl);
      expect(calls).toBe(1); // po doplnění 31. 12. už rok je kompletní
    },
  );
});

/**
 * F-3-8: migrace 0030 rozšířila `rate` na numeric(18,10), ale uložené hodnoty
 * nedopočítala — u JPY, HUF, KRW a spol. tam pořád leží čísla zaokrouhlená
 * na 6 míst. `rows >= 1000` přitom znamenalo, že se uzavřený rok už NIKDY
 * nestáhne znovu, takže by tam ta hrubší čísla zůstala natrvalo.
 */
describe('zaokrouhlené kurzy se poznají a rok se dotáhne (F-3-8)', () => {
  const rok = 2023;
  const naplnit = async (db: Awaited<ReturnType<typeof createPgliteDb>>, rate: string) => {
    const radky = Array.from({ length: 1200 }, (_, i) => ({
      day: `${rok}-01-01`,
      currency: `M${i}`,
      rate,
    }));
    await db.insert(fxRates).values(radky);
  };

  it('rok se šesti desetinnými místy není kompletní, i když má přes 1000 řádků', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await naplnit(db, '0.145678');
    const coverage = await cnbYearCoverage(db, rok, new Date('2026-08-10T00:00:00Z'));
    expect(coverage.rows).toBeGreaterThanOrEqual(1000);
    expect(coverage.complete).toBe(false);
  });

  it('plná přesnost se za nekompletní nepovažuje', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await naplnit(db, '0.1456789012');
    await db.insert(fxRates).values({ day: `${rok}-12-31`, currency: 'EUR', rate: '25.1234567890' });
    const coverage = await cnbYearCoverage(db, rok, new Date('2026-08-10T00:00:00Z'));
    expect(coverage.complete).toBe(true);
  });
});
