import { describe, expect, it } from 'vitest';
import { dividend, hasWarning, interest, run, CFG_2025 } from './helpers';

describe('R-07 dividendy a úroky (§ 8)', () => {
  it('R-07b/c: zahraniční dividenda brutto, zápočet stropovaný smlouvou (15 %)', () => {
    // 1000 USD brutto, sraženo 150 USD; fixture kurz 2025 USD 20
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })]);
    expect(result.dividends.foreignGrossCzk.toString()).toBe('20000');
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.base8Czk.toString()).toBe('20000');
  });

  it('R-07c: sraženo 30 % bez W-8BEN → započíst lze jen 15 %, zbytek propadá + varování', () => {
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '300' })]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('6000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('3000');
    expect(hasWarning(result, 'WITHHOLDING_ABOVE_TREATY')).toBe(true);
  });

  it('R-07a: česká dividenda je srážková a do § 8 nevstupuje', () => {
    const result = run([dividend({ sourceCountry: 'CZ', gross: '5000' })]);
    expect(result.dividends.czechGrossCzk.toString()).toBe('5000');
    expect(result.dividends.base8Czk.toString()).toBe('0');
  });

  it('země zdroje se odvodí z ISIN; bez ISIN i země → varování a výchozí strop', () => {
    const fromIsin = run([dividend({ sourceCountry: undefined, isin: 'US0378331005', gross: '1000' })]);
    expect(fromIsin.dividends.items[0]!.country).toBe('US');

    const unknown = run([dividend({ sourceCountry: undefined, gross: '1000' })]);
    expect(hasWarning(unknown, 'DIVIDEND_UNKNOWN_COUNTRY')).toBe(true);
    expect(unknown.dividends.base8Czk.toString()).toBe('1000'); // zachází se s ní jako zahraniční
  });

  it('úroky: zahraniční vstupují do § 8 (a limitu 50k), české srážkové ne', () => {
    const result = run([interest({ amount: '1500', sourceCountry: 'GB' }), interest({ amount: '999', sourceCountry: 'CZ' })]);
    expect(result.dividends.taxableInterestCzk.toString()).toBe('1500');
    expect(result.dividends.base8Czk.toString()).toBe('1500');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('1500');
  });

  it('R-07d: § 16a chrání před progresí — engine doporučí výhodnější variantu', () => {
    // uměle nízká hranice progrese, ať 23 % nastoupí už od 10 000 Kč základu
    const config = { ...CFG_2025, progressiveThreshold: '10000' };
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })], { config });

    // obecný základ: 10 000×15 % + 10 000×23 % = 3 800 − zápočet 3 000 = 800
    expect(result.tax.general.taxCzk.toString()).toBe('800');
    // § 16a: samostatný základ 20 000×15 % = 3 000 − zápočet 3 000 = 0
    expect(result.tax.separate16a.taxCzk.toString()).toBe('0');
    expect(result.tax.recommended).toBe('SEPARATE_16A');

    // s reálně vysokou hranicí jsou varianty rovnocenné → doporučení GENERAL
    const flat = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })]);
    expect(flat.tax.general.taxCzk.toString()).toBe(flat.tax.separate16a.taxCzk.toString());
    expect(flat.tax.recommended).toBe('GENERAL');
  });
});
