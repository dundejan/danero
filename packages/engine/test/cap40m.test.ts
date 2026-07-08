import { describe, expect, it } from 'vitest';
import { buy, CFG_2025, hasWarning, run, sell } from './helpers';

/**
 * R-03: strop úhrnu příjmů osvobozených časovým testem (§ 4 odst. 3).
 * 2025: 40 mil. Kč, poměrné krácení; od 2026 pro CP zrušen (cap null).
 */
describe('R-03 strop 40M — poměrné krácení osvobození', () => {
  // nákup 2021 (test splněn), prodej 2025 za 60M s náklady 30M
  const txs = [
    buy({
      quantity: '30000',
      pricePerShare: '1000',
      tradeDate: '2021-01-10',
      settlementDate: '2021-01-10',
    }),
    sell({ quantity: '30000', pricePerShare: '2000' }),
  ];

  it('nad strop se osvobození krátí poměrně a zbytek dodaní (R-03)', () => {
    const result = run(txs);
    const securities = result.securities;

    // úhrn časově osvobozených příjmů 60M (pre-cap hodnota zůstává pro § 38v)
    expect(securities.timeTestExemptProceedsCzk.toString()).toBe('60000000');
    // exemptRatio = 40M / 60M = 2/3 → dodaní se 1/3 příjmů (20M) − 1/3 výdajů (10M)
    // 2/3 neterminuje — porovnáváme zaokrouhleně na haléře
    expect(securities.taxableIncomeCzk.toDecimalPlaces(2).toString()).toBe('20000000');
    expect(securities.expensesCzk.toDecimalPlaces(2).toString()).toBe('10000000');
    expect(securities.base10Czk.toDecimalPlaces(2).toString()).toBe('10000000');

    const disposal = securities.disposals[0]!;
    expect(disposal.exemptProceedsCzk.toDecimalPlaces(2).toString()).toBe('40000000');
    expect(disposal.taxableProceedsCzk.toDecimalPlaces(2).toString()).toBe('20000000');

    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(true);
    expect(result.limits.cap40M?.exceeded).toBe(true);
  });

  it('pod stropem se nic nekrátí', () => {
    const result = run([
      buy({
        quantity: '10000',
        pricePerShare: '1000',
        tradeDate: '2021-01-10',
        settlementDate: '2021-01-10',
      }),
      sell({ quantity: '10000', pricePerShare: '2000' }),
    ]);
    // 20M příjmů, vše osvobozeno časovým testem
    expect(result.securities.taxableIncomeCzk.toString()).toBe('0');
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(false);
    expect(result.limits.cap40M?.exceeded).toBe(false);
  });

  it('strop platí i při mírnějším výkladu limitu 100k (pool ≤ 100k nevypíná R-03)', () => {
    // 60M časově osvobozené + žádné neosvobozené tržby → lenient pool = 0 ≤ 100k
    const result = run(txs, { options: { limit100kIncludesTimeTestExempt: false } });
    expect(result.securities.exemptUnder100k).toBe(true);
    // dodanění části nad strop proběhne i tak
    expect(result.securities.taxableIncomeCzk.toDecimalPlaces(2).toString()).toBe('20000000');
    expect(result.securities.base10Czk.toDecimalPlaces(2).toString()).toBe('10000000');
    const disposal = result.securities.disposals[0]!;
    expect(disposal.taxableProceedsCzk.toDecimalPlaces(2).toString()).toBe('20000000');
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(true);
  });

  it('od 2026 strop pro CP neplatí (cap null) — žádné krácení ani nad 40M', () => {
    const config2026 = {
      ...CFG_2025,
      year: 2026,
      limits: { ...CFG_2025.limits, timeTestExemptionCap: null },
    };
    const txs2026 = [
      buy({
        quantity: '30000',
        pricePerShare: '1000',
        tradeDate: '2022-01-10',
        settlementDate: '2022-01-10',
      }),
      sell({
        quantity: '30000',
        pricePerShare: '2000',
        tradeDate: '2026-03-05',
        settlementDate: '2026-03-05',
      }),
    ];
    const result = run(txs2026, { config: config2026 });
    expect(result.securities.taxableIncomeCzk.toString()).toBe('0');
    expect(result.limits.cap40M).toBeNull();
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(false);
  });

  it('krátí se jen časově osvobozené alokace; zdanitelné zůstávají celé', () => {
    // 60M časově osvobozené + 1M zdanitelný prodej (nákup 2025, bez testu)
    const mixed = [
      ...txs,
      buy({
        isin: 'CZ0000000002',
        quantity: '500',
        pricePerShare: '1000',
        tradeDate: '2025-01-05',
        settlementDate: '2025-01-05',
      }),
      sell({
        isin: 'CZ0000000002',
        quantity: '500',
        pricePerShare: '2000',
        tradeDate: '2025-06-01',
        settlementDate: '2025-06-01',
      }),
    ];
    const result = run(mixed);
    // dodaněno: 20M (krácení) + 1M (běžný zdanitelný příjem) − výdaje 10M + 0.5M
    expect(result.securities.taxableIncomeCzk.toString()).toBe('21000000');
    expect(result.securities.expensesCzk.toString()).toBe('10500000');
    expect(result.securities.base10Czk.toString()).toBe('10500000');
  });
});
