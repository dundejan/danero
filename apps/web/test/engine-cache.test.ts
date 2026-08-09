import { describe, expect, it } from 'vitest';
import { parseUniversalCsv } from '@danero/importers';
import { d, type Transaction } from '@danero/shared';
import {
  analyzeForUserCached,
  compareVariantsForUserCached,
  createResultCache,
  engineCacheStats,
  estimateAnalysisBytes,
  reportDataCached,
} from '@/lib/engine-cache';
import type { CnbRateProvider } from '@/lib/cnb';
import type { ProfileRow, YearAnalysis } from '@/lib/portfolio';

/**
 * F-3-4: cache výsledků enginu měla strop v POČTU záznamů (50), ne v paměti.
 * Jeden záznam drží celý `YearAnalysis` a jeho velikost roste s historií
 * uživatele — naměřeno na retained setu (`NODE_OPTIONS=--expose-gc`):
 * 1 000 transakcí → 1,7 MB, 10 000 → 13,7 MB, 50 000 → 68 MB. Plná cache tedy
 * znamenala 85 MB u malých účtů, ale 3,4 GB u velkých, zatímco funkce na
 * Vercelu má 2 GB. Chyběla i expirace: záznam s včerejším `atDate` se už
 * neměl jak zneplatnit, jen zabíral paměť do konce života instance.
 */

/** Kostra výsledku — cache si sahá jen na počty, ne na čísla. */
const fakeAnalysis = (transactionCount: number, ledgerRows = transactionCount): YearAnalysis =>
  ({
    result: {
      ledger: {
        lots: new Array<unknown>(Math.round(ledgerRows / 2)).fill(null),
        disposals: new Array<unknown>(Math.round(ledgerRows / 2)).fill(null),
      },
    },
    positions: [],
    labels: new Map<string, string>(),
    transactionCount,
  }) as unknown as YearAnalysis;

const MB = 1024 * 1024;

describe('cache enginu: paměťový strop a expirace (F-3-4)', () => {
  it('odhad velikosti záznamu nesmí klesnout pod naměřenou skutečnost', () => {
    // naměřeno --expose-gc nad universal CSV (25k párů BUY/SELL, 500 instrumentů)
    const namereno: Array<[transakci: number, ledgerRadku: number, skutecneMb: number]> = [
      [1_000, 1_000, 1.72],
      [10_000, 10_000, 13.71],
      [50_000, 50_000, 68.04],
    ];
    for (const [txs, ledgerRows, skutecneMb] of namereno) {
      expect(
        estimateAnalysisBytes(fakeAnalysis(txs, ledgerRows)),
        `odhad pro ${txs} transakcí je pod naměřenými ${skutecneMb} MB — strop by cache pustila přes paměť funkce`,
      ).toBeGreaterThan(skutecneMb * MB);
    }
  });

  it('starší záznamy vypadnou, jakmile by se přesáhl paměťový strop', () => {
    const cache = createResultCache({ maxBytes: 4 * MB, maxEntries: 50, ttlMs: 60_000 }, estimateAnalysisBytes);
    // každý záznam ~1,6 MB odhadu → do 4 MB se vejdou dva, třetí vytlačí první
    for (const key of ['a', 'b', 'c']) cache.set(key, fakeAnalysis(700));

    expect(cache.stats().bytes).toBeLessThanOrEqual(4 * MB);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('záznam větší než celý strop se necachuje (nevytlačí všechno ostatní)', () => {
    const cache = createResultCache({ maxBytes: 4 * MB, maxEntries: 50, ttlMs: 60_000 }, estimateAnalysisBytes);
    cache.set('maly', fakeAnalysis(700));
    cache.set('obr', fakeAnalysis(100_000));

    expect(cache.get('obr')).toBeUndefined();
    expect(cache.get('maly')).toBeDefined();
  });

  it('záznam po vypršení TTL neplatí a paměť uvolní', () => {
    const cache = createResultCache({ maxBytes: 128 * MB, maxEntries: 50, ttlMs: 10 * 60_000 }, estimateAnalysisBytes);
    cache.set('a', fakeAnalysis(700), 1_000_000);

    expect(cache.get('a', 1_000_000 + 9 * 60_000)).toBeDefined();
    expect(cache.get('a', 1_000_000 + 10 * 60_000)).toBeUndefined();
    expect(cache.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it('prošlé záznamy uvolní i zápis jiného klíče', () => {
    const cache = createResultCache({ maxBytes: 128 * MB, maxEntries: 50, ttlMs: 10 * 60_000 }, estimateAnalysisBytes);
    cache.set('a', fakeAnalysis(700), 1_000_000);
    cache.set('b', fakeAnalysis(700), 1_000_000 + 11 * 60_000);

    expect(cache.stats().entries).toBe(1);
  });
});

/* ── Ostrý průchod přes analyzeForUserCached ──────────────────────────────── */

function bigCsv(rows: number): string {
  const lines = ['type,date,isin,ticker,quantity,price,currency,note'];
  for (let i = 0; i < rows / 2; i += 1) {
    const isin = `US${String(i % 500).padStart(9, '0')}5`;
    const buyYear = 2020 + (i % 5);
    const sellYear = buyYear + 1 + (i % 2);
    const month = String(1 + (i % 12)).padStart(2, '0');
    lines.push(`BUY,${buyYear}-${month}-10,${isin},T${i % 500},10,${100 + (i % 50)},USD,b${i}`);
    lines.push(`SELL,${sellYear}-${month}-15,${isin},T${i % 500},5,${110 + (i % 60)},USD,s${i}`);
  }
  return lines.join('\n');
}

const profil = {
  userId: 'cache',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  timeTestBasis: 'settlement',
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as ProfileRow;

describe('cache enginu nad skutečnými daty', () => {
  it(
    'dva velcí uživatelé se do stropu nevejdou — první vypadne místo hromadění',
    { timeout: 300_000 },
    () => {
      // 30 000 transakcí = ~76 MB odhadu na záznam (~41 MB skutečných), takže
      // druhý uživatel musí prvního vytlačit. S původním stropem „50 záznamů"
      // zůstali v cache oba (a plná cache byla 3,4 GB na 2GB funkci).
      const txs: Transaction[] = parseUniversalCsv(bigCsv(30_000)).transactions;
      const prvni = analyzeForUserCached('u1', txs, profil, 2025, '2026-08-08');
      expect(analyzeForUserCached('u1', txs, profil, 2025, '2026-08-08')).toBe(prvni);

      analyzeForUserCached('u2', txs, profil, 2025, '2026-08-08');
      expect(engineCacheStats().bytes).toBeLessThanOrEqual(128 * MB);
      expect(engineCacheStats().entries).toBe(1);
      // první uživatel se musel přepočítat znovu (jiná instance výsledku)
      expect(analyzeForUserCached('u1', txs, profil, 2025, '2026-08-08')).not.toBe(prvni);
    },
  );
});

/* ── Denní kurzy a srovnání variant (F-3-1) ───────────────────────────────── */

/**
 * F-3-1: `/report` pouštěl engine 5× (s denními kurzy 9×) a necachoval nic —
 * každé přelistování strany tabulky stálo celý výpočet znovu. U day-tradera to
 * bylo naměřených 194 s CPU na jedno kliknutí (50 000 transakcí, 125 stran).
 * Cache se s denními kurzy vynechávala, protože se jejich obsah mění nezávisle
 * na transakcích; teď je součástí klíče otisk kurzů z `loadCnbRateProvider`.
 */
const kurzy = (fingerprint: string): CnbRateProvider => ({
  isEmpty: false,
  missingYears: [],
  fingerprint,
  getRate: (currency) => (currency === 'CZK' ? d(1) : d(20)),
});

describe('cache enginu: denní kurzy a srovnání variant (F-3-1)', () => {
  const txs: Transaction[] = parseUniversalCsv(bigCsv(200)).transactions;
  const args = ['u-kurzy', txs, profil, 2025] as const;

  it('výsledek s denními kurzy se cachuje podle otisku kurzů', () => {
    const prvni = analyzeForUserCached(...args, '2026-08-08', kurzy('abc'));
    expect(analyzeForUserCached(...args, '2026-08-08', kurzy('abc'))).toBe(prvni);
  });

  it('změna kurzů (jiný otisk) výsledek přepočítá', () => {
    const prvni = analyzeForUserCached(...args, '2026-08-08', kurzy('abc'));
    expect(analyzeForUserCached(...args, '2026-08-08', kurzy('xyz'))).not.toBe(prvni);
  });

  it('provider bez otisku se necachuje — obsah se může měnit bez varování', () => {
    const bezOtisku = { getRate: () => d(20) };
    const prvni = analyzeForUserCached(...args, '2026-08-08', bezOtisku);
    expect(analyzeForUserCached(...args, '2026-08-08', bezOtisku)).not.toBe(prvni);
  });

  it('srovnání variant se cachuje (4–8 běhů enginu na jedno zobrazení)', () => {
    const prvni = compareVariantsForUserCached(...args, kurzy('abc'));
    expect(compareVariantsForUserCached(...args, kurzy('abc'))).toBe(prvni);
    expect(compareVariantsForUserCached(...args, kurzy('xyz'))).not.toBe(prvni);
  });

  it('podklady reportu berou z cache obojí — výsledek i varianty', () => {
    const prvni = reportDataCached(...args, '2026-08-08', kurzy('abc'));
    const druhy = reportDataCached(...args, '2026-08-08', kurzy('abc'));
    expect(druhy.result).toBe(prvni.result);
    expect(druhy.comparison).toBe(prvni.comparison);
  });

  it('varianty se počítají za celý rok — jiné datum pozic je nezmění', () => {
    const prvni = compareVariantsForUserCached(...args, kurzy('abc'));
    expect(reportDataCached(...args, '2026-01-31', kurzy('abc')).comparison).toBe(prvni);
  });
});
