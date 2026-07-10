import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { analyzeTaxYear, positionsAt } from '@danero/engine';
import {
  dividendsByMonth,
  exemptionOutlook,
  feesByYear,
  flatTax50kSeries,
  horizonDots,
  limit100kSeries,
  portfolioAllocation,
} from '@/lib/charts-data';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import { d } from '@danero/shared';

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '10000',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerDruh: false,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'US0378331005',
    ticker: 'AAPL',
    quantity: '100',
    pricePerShare: '100',
    currency: 'USD',
    tradeDate: '2022-06-10',
    settlementDate: '2022-06-12',
    fee: { amount: '2', currency: 'USD' },
  },
  {
    type: 'BUY',
    id: 'b2',
    isin: 'IE00B4L5Y983',
    ticker: 'IWDA',
    quantity: '50',
    pricePerShare: '80',
    currency: 'USD',
    tradeDate: '2025-02-01',
    settlementDate: '2025-02-03',
  },
  // prodej kusů z 2022 → časový test splněn (osvobozeno), ale v přísném výkladu čerpá 100k
  {
    type: 'SELL',
    id: 's1',
    isin: 'US0378331005',
    quantity: '30',
    pricePerShare: '210',
    currency: 'USD',
    tradeDate: '2026-03-05',
    settlementDate: '2026-03-06',
  },
  {
    type: 'SELL',
    id: 's2',
    isin: 'US0378331005',
    quantity: '20',
    pricePerShare: '200',
    currency: 'USD',
    tradeDate: '2026-08-10',
    settlementDate: '2026-08-11',
    fee: { amount: '1.5', currency: 'USD' },
  },
  {
    type: 'DIVIDEND',
    id: 'd1',
    isin: 'US0378331005',
    gross: '100',
    withholdingTax: '15',
    currency: 'USD',
    date: '2026-05-10',
  },
  {
    type: 'INTEREST',
    id: 'i1',
    amount: '10',
    currency: 'USD',
    sourceCountry: 'US',
    date: '2026-06-01',
  },
]);

const result = analyzeTaxYear(engineInputForUser(TXS, PROFILE, 2026));

describe('charts-data: agregace sedí na výstupy enginu', () => {
  it('limit100kSeries: kumulativní řada končí přesně na usedCzk', () => {
    const series = limit100kSeries(result);
    const last = series.points[series.points.length - 1]!;
    expect(last.value).toBeCloseTo(series.usedCzk, 6);
    expect(series.points[0]!.value).toBe(0);
    // monotónně neklesající
    for (let i = 1; i < series.points.length; i += 1) {
      expect(series.points[i]!.value).toBeGreaterThanOrEqual(series.points[i - 1]!.value);
    }
  });

  it('flatTax50kSeries: začíná ručními příjmy a končí na usedCzk', () => {
    const series = flatTax50kSeries(result);
    expect(series).not.toBeNull();
    expect(series!.points[0]!.value).toBeCloseTo(10000, 6);
    const last = series!.points[series!.points.length - 1]!;
    expect(last.value).toBeCloseTo(series!.usedCzk, 6);
  });

  it('flatTax50kSeries: zdanitelné krypto tržby čerpají řadu (konzistence s odměrkou)', () => {
    const cryptoTxs = parseTransactions([
      {
        type: 'BUY',
        id: 'cb',
        isin: 'BTC',
        assetClass: 'CRYPTO',
        quantity: '1',
        pricePerShare: '100000',
        currency: 'CZK',
        tradeDate: '2026-01-10',
      },
      {
        type: 'SELL',
        id: 'cs',
        isin: 'BTC',
        assetClass: 'CRYPTO',
        quantity: '1',
        pricePerShare: '150000',
        currency: 'CZK',
        tradeDate: '2026-04-01',
      },
    ]);
    const withCrypto = analyzeTaxYear(engineInputForUser([...TXS, ...cryptoTxs], PROFILE, 2026));
    // 150k > krypto limit 100k → tržba je zdanitelná a MUSÍ být v grafu i odměrce
    expect(withCrypto.limits.flatTax50k.components.nonExemptCryptoProceedsCzk.toNumber()).toBe(
      150000,
    );
    const series = flatTax50kSeries(withCrypto)!;
    const last = series.points[series.points.length - 1]!;
    expect(last.value).toBeCloseTo(series.usedCzk, 6);
    expect(series.usedCzk).toBeGreaterThanOrEqual(150000);
  });

  it('dividendsByMonth: součet měsíců = celkové brutto, květen nese US dividendu', () => {
    const data = dividendsByMonth(result);
    expect(data.countries).toEqual(['US']);
    const may = data.rows[4]!;
    expect(may.month).toBe('2026-05');
    expect(may.US).toBeCloseTo(data.totalCzk, 6);
    expect(data.totalCzk).toBeGreaterThan(0);
  });

  it('realizedGainsByYear: skutečný výsledek i u daňově osvobozených prodejů', async () => {
    const { realizedGainsByYear } = await import('@/lib/charts-data');
    // prodeje 2026 jsou osvobozené časovým testem (nákup 2022) → daňový
    // rawGainLoss je 0, ale obchodní výsledek musí být kladný a nenulový
    expect(result.securities.rawGainLossCzk.toNumber()).toBe(0);
    const bars = realizedGainsByYear(new Map([[2026, result]]));
    expect(bars).toEqual([{ year: 2026, valueCzk: expect.any(Number) }]);
    expect(bars[0]!.valueCzk).toBeGreaterThan(0);
  });

  it('feesByYear: poplatky po letech, roky bez poplatků nulou (osa nepřeskakuje čas)', () => {
    const fees = feesByYear(TXS);
    expect(fees.skippedCurrencies).toEqual([]);
    const years = fees.bars.map((bar) => bar.year);
    expect(years).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(fees.bars[0]!.valueCzk).toBeGreaterThan(0); // 2022
    expect(fees.bars[1]!.valueCzk).toBe(0); // 2023 — mezera vyplněná nulou
    expect(fees.bars[4]!.valueCzk).toBeGreaterThan(0); // 2026
  });

  it('exemptionOutlook: bez cen jde podle kusů a dojde ke 100 %', () => {
    const positions = positionsAt(result.ledger, '2026-09-01');
    const outlook = exemptionOutlook(positions, new Map(), '2026-09-01', 2026);
    expect(outlook).not.toBeNull();
    expect(outlook!.basis).toBe('quantity');
    const last = outlook!.points[outlook!.points.length - 1]!;
    expect(last.exemptShare).toBe(100);
    // AAPL kusy z 2022 už jsou osvobozené → startovní podíl > 0
    expect(outlook!.points[0]!.exemptShare).toBeGreaterThan(0);
  });

  it('horizonDots: jedna tečka = měsíc, rozpad po pozicích řazený vahou sestupně', () => {
    // dvě pozice se stejným měsícem osvobození → dřív dvě překrývající se
    // tečky, teď jedna s rozpadem v items
    const txs = parseTransactions([
      {
        type: 'BUY',
        id: 'h1',
        isin: 'US0000000001',
        ticker: 'AAA',
        quantity: '10',
        pricePerShare: '10',
        currency: 'USD',
        tradeDate: '2025-03-05',
        settlementDate: '2025-03-07',
      },
      {
        type: 'BUY',
        id: 'h2',
        isin: 'US0000000002',
        ticker: 'BBB',
        quantity: '30',
        pricePerShare: '10',
        currency: 'USD',
        tradeDate: '2025-03-20',
        settlementDate: '2025-03-22',
      },
    ]);
    const res = analyzeTaxYear(engineInputForUser(txs, PROFILE, 2026));
    const positions = positionsAt(res.ledger, '2026-09-01');
    const labels = new Map([
      ['US0000000001', 'AAA'],
      ['US0000000002', 'BBB'],
    ]);
    const dots = horizonDots(positions, labels, new Map(), 2026);

    expect(dots).toHaveLength(1);
    const dot = dots[0]!;
    expect(dot.exemptFrom).toBe('2028-03');
    expect(dot.isExempt).toBe(false);
    expect(dot.weightBasis).toBe('quantity');
    expect(dot.weight).toBe(40); // součet vah měsíce (kusy)
    expect(dot.items.map((item) => item.label)).toEqual(['BBB', 'AAA']); // podle váhy sestupně
    expect(dot.items.map((item) => item.quantity)).toEqual([30, 10]);
  });

  it('horizonDots: osvobozené a čekající loty se neslučují do jedné tečky', () => {
    const positions = positionsAt(result.ledger, '2026-09-01');
    const labels = new Map([
      ['US0378331005', 'AAPL'],
      ['IE00B4L5Y983', 'IWDA'],
    ]);
    const dots = horizonDots(positions, labels, new Map(), 2026);
    // AAPL (nákup 2022) už osvobozený, IWDA (nákup 2025) čeká na 2028
    expect(dots.map((dot) => dot.isExempt)).toEqual([true, false]);
    expect(dots[0]!.items[0]!.label).toBe('AAPL');
    expect(dots[1]!.exemptFrom).toBe('2028-02');
    expect(dots[1]!.items[0]!.label).toBe('IWDA');
  });

  it('portfolioAllocation: všechny oceněné pozice sestupně, podíly dají 100 %', () => {
    const positions = positionsAt(result.ledger, '2026-09-01');
    const prices = new Map<string, InstrumentPrice>([
      [
        'US0378331005',
        { price: d('220'), currency: 'USD', source: 'trading212', asOf: new Date() },
      ],
      [
        'IE00B4L5Y983',
        { price: d('100'), currency: 'USD', source: 'trading212', asOf: new Date() },
      ],
    ]);
    const labels = new Map([
      ['US0378331005', 'AAPL'],
      ['IE00B4L5Y983', 'IWDA'],
    ]);
    const valuation = valuePositions(positions, labels, new Map(), prices, 2026);
    const allocation = portfolioAllocation(valuation)!;

    expect(allocation.slices.map((slice) => slice.label)).toEqual(['AAPL', 'IWDA']);
    // 50 × 220 = 11000 USD vs. 50 × 100 = 5000 USD (kurz se v podílu krátí)
    expect(allocation.slices[0]!.share).toBeCloseTo(68.75, 2);
    expect(allocation.slices[1]!.share).toBeCloseTo(31.25, 2);
    expect(allocation.totalCzk).toBeCloseTo((11000 + 5000) * 20.8, 0);

    // bez cen poctivě null — graf má prázdný stav
    expect(
      portfolioAllocation(valuePositions(positions, labels, new Map(), new Map(), 2026)),
    ).toBeNull();
  });

  it('valuePositions: hodnota, CZK přepočet a nerealizovaný P/L', () => {
    const positions = positionsAt(result.ledger, '2026-09-01');
    const prices = new Map<string, InstrumentPrice>([
      [
        'US0378331005',
        { price: d('220'), currency: 'USD', source: 'trading212', asOf: new Date() },
      ],
    ]);
    const labels = new Map([['US0378331005', 'AAPL']]);
    const valuation = valuePositions(positions, labels, new Map(), prices, 2026);

    expect(valuation.pricedCount).toBe(1);
    expect(valuation.unpricedCount).toBe(1);
    const aapl = valuation.rows.find((row) => row.isin === 'US0378331005')!;
    // 100 − 30 − 20 = 50 ks × 220 USD
    expect(aapl.value!.toString()).toBe('11000');
    // × jednotný kurz 2026 (20.80)
    expect(aapl.valueCzk!.toString()).toBe('228800');
    // cost 50 × 100 (+ poměrná část poplatku nevstupuje do costPerShare lotu)
    expect(aapl.unrealized!.toNumber()).toBeCloseTo(11000 - 5000, 0);
    expect(valuation.totalCzk.toString()).toBe('228800');

    const iwda = valuation.rows.find((row) => row.isin === 'IE00B4L5Y983')!;
    expect(iwda.value).toBeUndefined();
  });
});
