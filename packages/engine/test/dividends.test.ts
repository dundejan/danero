import { describe, expect, it } from 'vitest';
import { TAX_YEAR_2026_DRAFT } from '../src';
import { buy, dividend, hasWarning, interest, run, sell, CFG_2025 } from './helpers';

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
    const warning = result.warnings.find((w) => w.code === 'WITHHOLDING_ABOVE_TREATY');
    // text lidsky (datum místo technického ID) + strukturovaný context pro agregaci v UI
    expect(warning?.message).toContain('Dividenda z 1. 4. 2025 (US)');
    expect(warning?.message).not.toContain('div-');
    expect(warning?.context).toMatchObject({ country: 'US', overCzk: '3000.00' });
  });

  it('WITHHOLDING_ABOVE_TREATY: s tickerem se v textu ukáže ticker', () => {
    const result = run([
      dividend({ ticker: 'AAPL', isin: 'US0378331005', gross: '1000', currency: 'USD', withholdingTax: '300' }),
    ]);
    const warning = result.warnings.find((w) => w.code === 'WITHHOLDING_ABOVE_TREATY');
    expect(warning?.message).toContain('Dividenda AAPL z');
    expect(warning?.context).toMatchObject({ isin: 'US0378331005', country: 'US' });
  });

  it('R-07c: NL má smluvní strop 10 % — při srážce 15 % lze započíst jen 10 % brutto', () => {
    // 1000 USD brutto, sraženo 150 USD (15 %); NL smlouva (138/1974 Sb.) dovoluje jen 10 %
    const result = run([
      dividend({ sourceCountry: 'NL', gross: '1000', currency: 'USD', withholdingTax: '150' }),
    ]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('2000'); // 10 % z 20 000
    expect(hasWarning(result, 'WITHHOLDING_ABOVE_TREATY')).toBe(true);
    expect(hasWarning(result, 'TREATY_RATE_UNVERIFIED')).toBe(false); // NL je v tabulce ověřených
  });

  it('R-07c: země mimo tabulku ověřených smluv → default 15 % + TREATY_RATE_UNVERIFIED jednou per země', () => {
    const result = run([
      dividend({ sourceCountry: 'PL', gross: '1000', withholdingTax: '190' }),
      dividend({ sourceCountry: 'PL', gross: '1000', withholdingTax: '190' }),
    ]);
    // default strop 15 %: z každé dividendy jde započíst max. 150 Kč
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('300');
    expect(result.warnings.filter((w) => w.code === 'TREATY_RATE_UNVERIFIED')).toHaveLength(1);
  });

  it('R-07c: zápočet po státech v celých Kč dolů — souhrn je součtem zaokrouhlených hodnot', () => {
    // 15 % z 503 = 75,45 → per stát 75; souhrn 150 (ne 151 ze zaokrouhleného součtu 150,90)
    const result = run([
      dividend({ sourceCountry: 'US', gross: '503', withholdingTax: '75.45' }),
      dividend({ sourceCountry: 'DE', gross: '503', withholdingTax: '75.45' }),
    ]);
    const perCountry = Object.values(result.dividends.creditableByCountry);
    expect(perCountry.map((c) => c.creditableCzk.toString())).toEqual(['75', '75']);
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('150');
  });

  it('R-07c: zaokrouhlení zápočtu vždy DOLŮ (NL 10 % z 26 = 2,6 → 2, ne 3)', () => {
    const result = run([dividend({ sourceCountry: 'NL', gross: '26', withholdingTax: '2.6' })]);
    expect(result.dividends.creditableByCountry['NL']?.creditableCzk.toString()).toBe('2');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('2');
  });

  it('creditableByCountry nese i úhrn sražené daně per země', () => {
    const result = run([
      dividend({ sourceCountry: 'US', gross: '1000', withholdingTax: '300' }),
      dividend({ sourceCountry: 'US', gross: '500', withholdingTax: '75' }),
    ]);
    const us = result.dividends.creditableByCountry['US'];
    expect(us?.grossCzk.toString()).toBe('1500');
    expect(us?.withholdingCzk.toString()).toBe('375');
    expect(us?.creditableCzk.toString()).toBe('225'); // strop 15 % z 1 500
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

  it('R-07d: bez známé hranice progrese se § 16a nedoporučuje (rozdíl je jen zaokrouhlovací šum)', () => {
    const config = { ...CFG_2025, progressiveThreshold: null };
    const result = run(
      [
        // base10 = 110 050 − 100 000 = 10 050; base8 = 10 050 → oddělené zaokrouhlení
        // základů na stovky dolů dělá § 16a o pár Kč „levnější" (3 000 vs. 3 015)
        buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
        sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
        dividend({ gross: '10050', withholdingTax: '0' }),
      ],
      { config },
    );
    expect(result.tax.separate16a.taxCzk.lt(result.tax.general.taxCzk)).toBe(true);
    // …ale bez hranice 23 % je to šum a § 16a znamená ztrátu slev → GENERAL
    expect(result.tax.recommended).toBe('GENERAL');
  });

  it('rok 2026 má hranici progrese v konfiguraci — bez varování, 23 % se počítá', () => {
    // 36 × 48 967 Kč (NV č. 365/2025 Sb.) = 1 762 812 Kč
    const config = { ...TAX_YEAR_2026_DRAFT, unifiedRatesByYear: CFG_2025.unifiedRatesByYear };
    const result = run(
      [dividend({ gross: '2000000', withholdingTax: '0', date: '2026-04-01' })],
      { config },
    );
    expect(hasWarning(result, 'PROGRESSIVE_THRESHOLD_UNKNOWN')).toBe(false);
    // 1 762 812 × 15 % + (2 000 000 − 1 762 812) × 23 % = 264 421,80 + 54 553,24
    expect(result.tax.general.taxCzk.toString()).toBe('318975.04');
  });

  it('R-07d: pod známou hranicí progrese se § 16a nedoporučuje ani při šumově nižší dani', () => {
    // CFG_2025 má reálnou hranici (základ 20 100 je hluboko pod ní) — obě
    // varianty počítají 15 % a rozdíl dělá jen oddělené zaokrouhlení na sta dolů
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '10050', withholdingTax: '0' }),
    ]);
    expect(result.tax.separate16a.taxCzk.lt(result.tax.general.taxCzk)).toBe(true);
    expect(result.tax.recommended).toBe('GENERAL');
  });
});
