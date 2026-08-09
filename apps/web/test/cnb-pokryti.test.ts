import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * F-3-2: denní kurzy ČNB se smí použít, jen když jsou v databázi VŠECHNY roky,
 * které výpočet potřebuje.
 *
 * Cron `fx` stahuje jen běžný rok a historii dotahoval `ensureCnbYears` jen pro
 * roky, ve kterých má uživatel transakce — `availableYears` vrací množinu, ne
 * souvislý rozsah. Portfolio s obchody v 2023, 2024 a 2026 tedy nikdy nestáhlo
 * rok 2025 (naměřeno i na produkci: 2023 = 7 750, 2024 = 7 812, 2026 = 4 530
 * řádků, 2025 = 0). Chybějící rok se přitom nepoznal: `provider.isEmpty` se ptá
 * na CELOU tabulku, takže engine dostal poloprázdná data, `getRate` se u
 * chybějícího roku vrátil prázdný a spadlo se na jednotný kurz — v jednom
 * zdaňovacím období se tak namíchaly obě soustavy, což § 38 odst. 1 zakazuje
 * (R-06). Na doloženém případu rozdíl 2 340 Kč vyrobený z kurzů, které
 * v databázi nejsou.
 */

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'PLN', 'HUF', 'SEK', 'NOK', 'DKK'];

/** Roční sada, kterou `cnbYearCoverage` uzná za kompletní (≥ 1000 řádků). */
function fullYear(year: number): Array<{ day: string; currency: string; rate: string }> {
  const rows: Array<{ day: string; currency: string; rate: string }> = [];
  const day = new Date(Date.UTC(year, 0, 1));
  while (day.getUTCFullYear() === year) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
      const iso = day.toISOString().slice(0, 10);
      for (const currency of CURRENCIES) rows.push({ day: iso, currency, rate: '25' });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return rows;
}

describe('pokrytí denních kurzů ČNB (F-3-2)', () => {
  beforeEach(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    vi.resetModules();
  });

  it(
    'rok chybějící uprostřed rozsahu se pozná a denní varianta se nenabídne',
    { timeout: 30_000 },
    async () => {
      const { getDb } = await import('@/db');
      const { fxRates } = await import('@/db/schema');
      const { cnbYearCoverage, loadCnbRateProvider } = await import('@/lib/cnb');
      const db = await getDb();

      // přesně produkční stav: 2023 a 2024 plné, 2025 chybí
      for (const year of [2023, 2024]) {
        await db.insert(fxRates).values(fullYear(year)).onConflictDoNothing();
      }

      const now = new Date('2026-08-08T00:00:00Z');
      expect((await cnbYearCoverage(db, 2023, now)).complete).toBe(true);
      expect((await cnbYearCoverage(db, 2024, now)).complete).toBe(true);
      // tohle je ta díra, kterou dřív nikdo nepoznal
      expect((await cnbYearCoverage(db, 2025, now)).complete).toBe(false);

      // a takhle ji pozná i provider, ze kterého se počítá
      const provider = await loadCnbRateProvider(db, 2023, 2025);
      expect(provider.isEmpty).toBe(false);
      expect(provider.missingYears).toEqual([2025]);
    },
  );

  it(
    'neúplný rok znamená „bez denních kurzů“, ne poloprázdnou tabulku',
    { timeout: 30_000 },
    async () => {
      const { getDb } = await import('@/db');
      const { fxRates } = await import('@/db/schema');
      const db = await getDb();
      for (const year of [2023, 2024]) {
        await db.insert(fxRates).values(fullYear(year)).onConflictDoNothing();
      }

      // ČNB neodpovídá, takže chybějící rok se nedotáhne
      vi.doMock('@/lib/cnb', async (importOriginal) => {
        const real = await importOriginal<typeof import('@/lib/cnb')>();
        return { ...real, ensureCnbYears: async () => {} };
      });

      const { loadDailyRates } = await import('@/lib/portfolio');
      const { TransactionSchema } = await import('@danero/shared');
      const txs = [
        TransactionSchema.parse({
          type: 'BUY',
          id: 'buy-1',
          isin: 'US0378331005',
          quantity: '10',
          pricePerShare: '100',
          currency: 'USD',
          tradeDate: '2024-06-03',
          settlementDate: '2024-06-04',
        }),
      ];

      // rozsah 2023–2025 (rok−1 kvůli Silvestru + běžný rok) → 2025 chybí
      const rates = await loadDailyRates(db, txs, 2025);

      // dřív se vrátil provider, protože tabulka jako celek prázdná nebyla
      expect(rates).toBeUndefined();
    },
  );
});
