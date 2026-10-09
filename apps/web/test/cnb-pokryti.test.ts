import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import type { ProfileRow } from '@/lib/portfolio';

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

/**
 * Roční sada, kterou `cnbYearCoverage` uzná za kompletní (≥ 1000 řádků).
 * S `lastDay` končí dřív — tak vypadá rok stažený naposledy ranním cronem.
 */
function fullYear(
  year: number,
  lastDay = `${year}-12-31`,
): Array<{ day: string; currency: string; rate: string }> {
  const rows: Array<{ day: string; currency: string; rate: string }> = [];
  const day = new Date(Date.UTC(year, 0, 1));
  while (day.getUTCFullYear() === year) {
    const iso = day.toISOString().slice(0, 10);
    if (iso > lastDay) break;
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) {
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

/**
 * L11-01: mezi 1. lednem a prvním novoročním fixingem (v roce 2027 až pondělí
 * 4. 1. kolem 14:30) ČNB za běžný rok nevyhlásila ani jeden kurz. Rozsah
 * potřebných let přitom vždy sahá do běžného roku, takže ten byl „chybějící“,
 * `loadDailyRates` vrátil `undefined` a CELÝ výpočet — i za dávno uzavřené
 * roky — spadl na jednotný kurz. Uživatel s denními kurzy tak 2. ledna viděl
 * za loňský rok jiný základ daně než na Silvestra (na doloženém případu
 * o 7 770 Kč), přestože se v jeho datech nezměnilo nic (R-06, R-06c).
 *
 * Testy posouvají hodiny a ČNB nahrazují podvrženým ročním souborem — bez sítě.
 */
describe('první dny ledna před prvním fixingem ČNB (L11-01, L11-02)', () => {
  /** Kurz 25 Kč za jednotku má každá měna každý den; jednotný kurz USD 2026 je jiný. */
  const cnbFile = (...days: string[]): string =>
    ['Datum|1 EUR|1 HUF|1 USD', ...days.map((day) => `${day}|25,000|25,000|25,000`)].join('\n');

  /**
   * Podvrhne roční soubory ČNB: rok → obsah souboru, nebo HTTP stav výpadku.
   * Rok, se kterým test nepočítal, skončí výpadkem. Vrací seznam vyžádaných let.
   */
  function stubCnb(files: Record<number, string | number>): number[] {
    const requested: number[] = [];
    vi.stubGlobal('fetch', async (url: string | URL) => {
      const year = Number(new URL(String(url)).searchParams.get('rok'));
      requested.push(year);
      const file = files[year];
      if (typeof file === 'string') return new Response(file);
      return new Response('výpadek', { status: file ?? 503 });
    });
    return requested;
  }

  const profile = (fxMethod: 'UNIFIED' | 'CNB_DAILY'): ProfileRow => ({
    userId: 'u1',
    regime: 'PAUSAL',
    hasBusinessAssets: false,
    w8benFiled: true,
    otherIncomeCzk: '0',
    matchingMethod: 'FIFO',
    fxMethod,
    limit100kStrict: true,
    timeTestBasis: 'settlement',
    derivativesExpensesPerType: false,
    emtTimeTestExempt: false,
    returnOfCapitalReducesBasis: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /** Nákup a prodej v roce 2026: denním kurzem 25 vyjde základ 250 000 Kč. */
  const TRADES_2026 = [
    {
      type: 'BUY',
      id: 'buy-2026',
      isin: 'US0378331005',
      quantity: '100',
      pricePerShare: '100',
      currency: 'USD',
      tradeDate: '2026-02-10',
      settlementDate: '2026-02-11',
    },
    {
      type: 'SELL',
      id: 'sell-2026',
      isin: 'US0378331005',
      quantity: '100',
      pricePerShare: '200',
      currency: 'USD',
      tradeDate: '2026-06-10',
      settlementDate: '2026-06-11',
    },
  ];

  /**
   * Týž obchod jednotným kurzem: zisk 10 000 USD × jednotný kurz dolaru 2026.
   * Čte se z konfigurace — kurz běžného roku je do lednového pokynu GFŘ jen
   * orientační odhad a mění se (naposledy 9. 10. 2026 z 20,80 na 20,96), takže
   * opsané číslo by test shodilo při každé údržbě.
   */
  async function unifiedBaseCzk(): Promise<string> {
    const { UNIFIED_RATES } = await import('@/lib/tax-config');
    const { d } = await import('@danero/shared');
    const base = d(UNIFIED_RATES[2026]!.USD!).mul(10_000).toString();
    // kdyby se jednotný kurz někdy trefil do 25, test by obě soustavy nerozlišil
    expect(base).not.toBe('250000');
    return base;
  }

  /**
   * Vlastní databáze pro každý test: `getDb()` drží jedinou instanci přes celý
   * soubor, takže by kurz roku 2027 z jednoho testu rozhodl o výsledku dalšího.
   */
  async function seedYears(...years: number[]): Promise<Db> {
    const { createPgliteDb } = await import('@/db');
    const { fxRates } = await import('@/db/schema');
    const db = await createPgliteDb();
    for (const year of years) {
      await db.insert(fxRates).values(fullYear(year)).onConflictDoNothing();
    }
    return db;
  }

  /** Rok 2026 tak, jak ho stránky spočítají v daný okamžik (běžný rok z hodin). */
  async function closedYearAt(db: Db, instant: string, cnb: Record<number, string | number>) {
    vi.setSystemTime(new Date(instant));
    const requested = stubCnb(cnb);
    const { currentTaxYear, today } = await import('@/lib/clock');
    const { analyzeForUser, dailyRatesForProfile } = await import('@/lib/portfolio');
    const { parseTransactions } = await import('@danero/shared');
    const txs = parseTransactions(TRADES_2026);
    const currentYear = currentTaxYear();
    const rates = await dailyRatesForProfile(db, txs, profile('CNB_DAILY'), currentYear);
    const { result } = analyzeForUser(txs, profile('CNB_DAILY'), 2026, today(), rates);
    return {
      currentYear,
      dailyRates: rates !== undefined,
      base10Czk: result.securities.base10Czk.toString(),
      fxWarnings: result.warnings.filter((w) => w.code.startsWith('FX_')).map((w) => w.code),
      requested,
    };
  }

  beforeEach(() => {
    // `vi.doMock` z testu výš `resetModules` nezruší — bez odhlášení by tu
    // `ensureCnbYears` zůstala vypnutá a nic se nestáhlo
    vi.doUnmock('@/lib/cnb');
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it(
    'uzavřený rok vyjde na Silvestra, 2. 1. i 4. 1. před fixingem stejně — denními kurzy (R-06b)',
    { timeout: 60_000 },
    async () => {
      const db = await seedYears(2025, 2026);
      const daily = { dailyRates: true, base10Czk: '250000', fxWarnings: [] };

      // 31. 12. 2026 v 11:00 pražského času: běžný rok 2026, nic se nestahuje
      expect(await closedYearAt(db, '2026-12-31T10:00:00Z', {})).toEqual({
        ...daily,
        currentYear: 2026,
        requested: [],
      });

      // 1. 1. 2027 v 0:30 pražského času (v UTC je ještě Silvestr): soubor roku
      // 2027 je jen hlavička — přesně stav, který `fetchCnbYear` popisuje jako
      // legitimní. Dřív: základ jednotným kurzem a FX_DAILY_RATE_MISSING.
      expect(await closedYearAt(db, '2026-12-31T23:30:00Z', { 2027: cnbFile() })).toEqual({
        ...daily,
        currentYear: 2027,
        requested: [2027],
      });

      // 2. 1. 2027 v poledne (sobota)
      expect(await closedYearAt(db, '2027-01-02T11:00:00Z', { 2027: cnbFile() })).toEqual({
        ...daily,
        currentYear: 2027,
        requested: [2027],
      });

      // 4. 1. 2027 v 10:00, před fixingem. ČNB na dotaz po roce, za který nic
      // nevyhlásila, umí vrátit i řádky roku předchozího — rozhoduje, že žádný
      // řádek nemá datum běžného roku, ne že je soubor prázdný.
      expect(
        await closedYearAt(db, '2027-01-04T09:00:00Z', { 2027: cnbFile('30.12.2026', '31.12.2026') }),
      ).toEqual({ ...daily, currentYear: 2027, requested: [2027] });

      // 4. 1. 2027 v 15:00, po prvním fixingu: rok 2027 už kurz má
      expect(await closedYearAt(db, '2027-01-04T14:00:00Z', { 2027: cnbFile('04.01.2027') })).toEqual({
        ...daily,
        currentYear: 2027,
        requested: [2027],
      });
    },
  );

  it(
    'běžný rok po neúspěšném stažení zůstává chybějící — o výpadku ČNB nevíme, co nevyhlásila',
    { timeout: 60_000 },
    async () => {
      const db = await seedYears(2025, 2026);

      // napřed úspěšné stažení bez kurzů, potom výpadek: starší výsledek
      // nesmí přežít novější neúspěch
      expect((await closedYearAt(db, '2027-01-02T11:00:00Z', { 2027: cnbFile() })).dailyRates).toBe(true);
      expect(await closedYearAt(db, '2027-01-03T11:00:00Z', { 2027: 503 })).toEqual({
        currentYear: 2027,
        dailyRates: false,
        base10Czk: await unifiedBaseCzk(),
        fxWarnings: expect.arrayContaining(['FX_DAILY_RATE_MISSING']),
        requested: [2027],
      });
    },
  );

  it(
    'výpadek ČNB na dřívějším roce nenechá běžný rok omluvený starším stažením (B01-R1-01)',
    { timeout: 60_000 },
    async () => {
      // stav o půlnoci: ranní cron stáhl 31. 12. rok 2026 jen do 30. 12.
      const db = await seedYears(2025);
      const { fxRates } = await import('@/db/schema');
      await db.insert(fxRates).values(fullYear(2026, '2026-12-30'));

      // 1. 1. 2027 v 0:30 pražského času: ČNB odpovídá, rok 2027 je jen
      // hlavička. Rok 2026 je podle UTC ještě běžný, takže se nedotahuje.
      expect(await closedYearAt(db, '2026-12-31T23:30:00Z', { 2027: cnbFile() })).toEqual({
        currentYear: 2027,
        dailyRates: true,
        base10Czk: '250000',
        fxWarnings: [],
        requested: [2027],
      });

      // 1. 1. 2027 v 9:00: ČNB má výpadek na všech letech. Rok 2026 je teď
      // uzavřený a nedotažený, stahuje se první, spadne — a na rok 2027 se už
      // nikdo nezeptá. Osm hodin starý výsledek „bez kurzu“ ho omluvit nesmí:
      // studený proces by v tu chvíli počítal jednotným kurzem a dvě instance
      // by při témž výpadku ukázaly jiný základ.
      expect(await closedYearAt(db, '2027-01-01T08:00:00Z', {})).toEqual({
        currentYear: 2027,
        dailyRates: false,
        base10Czk: await unifiedBaseCzk(),
        fxWarnings: expect.arrayContaining(['FX_DAILY_RATE_MISSING']),
        requested: [2026],
      });

      // Jakmile ČNB zase odpovídá, rok 2027 je znovu ČERSTVĚ bez kurzu a počítá
      // se zase denními kurzy. (Rok 2026 se v témž procesu podruhé nedotahuje —
      // uzavřený rok se zkouší jednou za život procesu, to je starší chování.)
      expect(await closedYearAt(db, '2027-01-01T08:02:00Z', { 2027: cnbFile() })).toEqual({
        currentYear: 2027,
        dailyRates: true,
        base10Czk: '250000',
        fxWarnings: [],
        requested: [2027],
      });
    },
  );

  it(
    'soubor bez kurzů neomlouvá díru uprostřed rozsahu — jen běžný rok (F-3-2)',
    { timeout: 60_000 },
    async () => {
      // rok 2026 v databázi není a ČNB za něj vrátí jen hlavičku
      const db = await seedYears(2025);

      const state = await closedYearAt(db, '2027-01-02T11:00:00Z', {
        2026: cnbFile(),
        2027: cnbFile(),
      });

      expect(state.requested).toEqual([2026, 2027]);
      expect(state.dailyRates).toBe(false);
    },
  );

  it(
    'příjem v cizí měně z 1.–2. ledna výpočet běžného roku neshodí — platí kurz ze Silvestra (R-06b, L11-02)',
    { timeout: 60_000 },
    async () => {
      const db = await seedYears(2026);
      vi.setSystemTime(new Date('2027-01-02T11:00:00Z'));
      stubCnb({ 2027: cnbFile() });
      const { today } = await import('@/lib/clock');
      const { analyzeForUser, dailyRatesForProfile, unifiedRatesCover } = await import(
        '@/lib/portfolio'
      );
      const { parseTransactions } = await import('@danero/shared');

      const interestOf2027 = async (
        fxMethod: 'UNIFIED' | 'CNB_DAILY',
        interest: { amount: string; currency: string; date: string },
      ) => {
        const txs = parseTransactions([{ type: 'INTEREST', id: 'urok-2027', ...interest }]);
        const rates = await dailyRatesForProfile(db, txs, profile(fxMethod), 2027);
        const { result } = analyzeForUser(txs, profile(fxMethod), 2027, today(), rates);
        return {
          covered: unifiedRatesCover(txs),
          interestCzk: result.dividends.taxableInterestCzk.toString(),
          // jeden úrok projde přepočtem vícekrát — zajímá nás druh varování, ne počet
          fxWarnings: [
            ...new Set(result.warnings.filter((w) => w.code.startsWith('FX_')).map((w) => w.code)),
          ],
        };
      };

      // Zvolené denní kurzy: 1. 1. je svátek, engine jde zpět na 31. 12. 2026.
      // Dřív EngineError „Chybí denní i jednotný kurz pro EUR k 2027-01-01“.
      expect(
        await interestOf2027('CNB_DAILY', { amount: '100', currency: 'EUR', date: '2027-01-01' }),
      ).toMatchObject({ interestCzk: '2500', fxWarnings: [] });

      // Výchozí jednotný kurz a měna, kterou jednotná tabulka nemá: záchranou
      // je denní kurz s varováním. Dřív EngineError „Chybí jednotný kurz pro HUF
      // v roce 2027 a denní kurz není k dispozici.“ a místo přehledu karta s chybou.
      expect(
        await interestOf2027('UNIFIED', { amount: '1000', currency: 'HUF', date: '2027-01-02' }),
      ).toEqual({ covered: false, interestCzk: '25000', fxWarnings: ['FX_UNIFIED_RATE_MISSING'] });
    },
  );
});
