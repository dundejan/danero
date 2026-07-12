import { describe, expect, it } from 'vitest';
import { exemptFromDate, type TaxYearConfig } from '../src';
import { buy, CFG_2025, run, sell } from './helpers';

describe('R-01 časový test 3 roky', () => {
  it('R-01: osvobození až když doba PŘESÁHNE 3 roky — přesně 3 roky nestačí', () => {
    expect(exemptFromDate('2022-06-03')).toBe('2025-06-04');

    const txs = (sellSettlement: string) => [
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2022-06-01', settlementDate: '2022-06-03' }),
      sell({ quantity: '100', pricePerShare: '1100', tradeDate: sellSettlement, settlementDate: sellSettlement }),
    ];

    // prodej přesně v den 3. výročí vypořádání → NEosvobozeno
    const exactly3y = run(txs('2025-06-03'));
    expect(exactly3y.securities.exemptUnder100k).toBe(false); // tržba 110k > 100k
    expect(exactly3y.securities.base10Czk.toString()).toBe('10000');
    expect(exactly3y.securities.timeTestExemptProceedsCzk.toString()).toBe('0');

    // o den později → osvobozeno
    const oneDayLater = run(txs('2025-06-04'));
    expect(oneDayLater.securities.base10Czk.toString()).toBe('0');
    expect(oneDayLater.securities.timeTestExemptProceedsCzk.toString()).toBe('110000');
    expect(oneDayLater.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
  });

  it('R-01a: přepínač timeTestDateBasis — trade vs. settlement rozhoduje o osvobození', () => {
    const txs = [
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2022-06-01', settlementDate: '2022-06-03' }),
      sell({ quantity: '100', pricePerShare: '1100', tradeDate: '2025-06-02', settlementDate: '2025-06-03' }),
    ];

    // settlement báze (default, D-59): nabytí 2022-06-03, prodej 2025-06-03 → přesně 3 roky → NE
    const bySettlement = run(txs);
    expect(bySettlement.securities.base10Czk.toString()).toBe('10000');

    // trade báze: nabytí 2022-06-01 → osvobozeno od 2025-06-02, prodej (trade) 2025-06-02 → ANO
    const byTrade = run(txs, { options: { timeTestDateBasis: 'trade' } });
    expect(byTrade.securities.base10Czk.toString()).toBe('0');
    expect(byTrade.securities.timeTestExemptProceedsCzk.toString()).toBe('110000');
  });

  it('R-01a × R-05a/R-06a: báze trade mění JEN časový test — rok příjmu a kurz jdou po vypořádání', () => {
    // prodej obchodovaný 30. 12. 2025, vypořádaný 2. 1. 2026 — s bází trade
    // nesmí příjem sklouznout do 2025 ani se přepočítat kurzem 2025
    const cfg2026: TaxYearConfig = {
      ...CFG_2025,
      year: 2026,
      unifiedRatesByYear: { ...CFG_2025.unifiedRatesByYear, 2026: { USD: '25', EUR: '25' } },
      limits: { ...CFG_2025.limits, timeTestCap: null },
    };
    const txs = [
      buy({ isin: 'US0000000001', currency: 'USD', quantity: '100', pricePerShare: '50', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ isin: 'US0000000001', currency: 'USD', quantity: '100', pricePerShare: '60', tradeDate: '2025-12-30', settlementDate: '2026-01-02' }),
    ];

    // rok 2025 prodej nevidí — příjem patří roku připsání (R-05a)
    const year2025 = run(txs, { options: { timeTestDateBasis: 'trade' } });
    expect(year2025.securities.disposals).toHaveLength(0);

    // rok 2026: tržba 6 000 USD × jednotný kurz 2026 (25), NE kurz 2025 (20)
    const year2026 = run(txs, { config: cfg2026, options: { timeTestDateBasis: 'trade' } });
    expect(year2026.securities.disposals).toHaveLength(1);
    expect(year2026.securities.totalGrossProceedsCzk.toString()).toBe('150000');
    // báze trade zůstává rozhodná pro časový test (saleDate = trade)
    expect(year2026.securities.disposals[0]!.saleDate).toBe('2025-12-30');
  });

  it('R-01c: cenné papíry v obchodním majetku nemají nárok na osvobození', () => {
    const txs = [
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2019-01-10', settlementDate: '2019-01-10' }),
      sell({ quantity: '100', pricePerShare: '1100', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ];
    const result = run(txs, { profile: { hasSecuritiesInBusinessAssets: true } });
    expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('0');
    expect(result.securities.base10Czk.toString()).toBe('10000');
  });

  it('auditovatelnost: alokace prodeje nese datum nabytí lotu (acquisitionDate)', () => {
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2022-06-01', settlementDate: '2022-06-03' }),
      sell({ quantity: '100', pricePerShare: '1100', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ]);
    const alloc = result.securities.disposals[0]!.allocations[0]!;
    expect(alloc.acquisitionDate).toBe('2022-06-03'); // settlement báze (R-01a)
  });

  it('hlídač: otevřená pozice zná datum osvobození a odpočet dní', () => {
    const result = run([
      buy({ quantity: '50', pricePerShare: '2000', tradeDate: '2024-03-01', settlementDate: '2024-03-01' }),
    ]);
    expect(result.positions).toHaveLength(1);
    const position = result.positions[0]!;
    expect(position.totalRemaining.toString()).toBe('50');
    const lot = position.lots[0]!;
    expect(lot.exemptFrom).toBe('2027-03-02');
    expect(lot.isExempt).toBe(false);
    expect(lot.daysToExempt).toBe(426); // od 2025-12-31 do 2027-03-02
  });
});
