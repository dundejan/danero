import { describe, expect, it } from 'vitest';
import { buy, dividend, hasWarning, interest, run, sell } from './helpers';

/**
 * Drobné hranice a příznaky, které do revize 5 nehlídal žádný test (nález
 * L4-10): každá z nich šla v enginu otočit a celá sada zůstala zelená. Po
 * jednom tvrzení na pravidlo, vždy z obou stran hranice.
 *
 * Čtvrtá hranice z téhož nálezu — denní kurz ČNB se dohledává nejvýš 10 dní
 * zpět (R-06b) — má test v `fx.test.ts` u ostatních případů chybějícího
 * denního kurzu; sem se neopisuje.
 */
describe('hranice bez vlastního testu (nález L4-10)', () => {
  it('R-07: úrok přijatý v jiném roce nevstoupí do základu § 8 ani do limitu 50 000 Kč', () => {
    // Počítá se rok 2025; úrok z roku 2024 i z ledna 2026 patří do svého roku.
    // Filtr úroků podle roku nehlídalo nic — a cizí roky by paušalistovi zvedly
    // základ § 8 a čerpání jeho limitu z 1 000 na 58 000 Kč, tedy „prolomeno“ (R-08).
    const result = run([
      interest({ amount: '50000', date: '2024-05-01' }),
      interest({ amount: '1000', date: '2025-05-01' }),
      interest({ amount: '7000', date: '2026-01-02' }),
    ]);

    expect(result.dividends.interestItems).toHaveLength(1);
    expect(result.dividends.interestItems[0]!.date).toBe('2025-05-01');
    expect(result.dividends.base8Czk.toString()).toBe('1000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('1000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
  });

  it('R-09a: obecný limit pro podání přiznání se týká jen režimu JINE', () => {
    // Paušalista má vlastní limit (R-08), zaměstnanec taky (R-09b) a OSVČ
    // podává přiznání tak jako tak — odměrka „Podání přiznání“ jim nepatří.
    const applicableFor = (regime: string): boolean =>
      run([dividend({ gross: '1000' })], { profile: { regime } }).limits.generalFiling50k.applicable;

    expect(applicableFor('JINE')).toBe(true);
    expect(applicableFor('PAUSAL')).toBe(false);
    expect(applicableFor('ZAMESTNANEC')).toBe(false);
    expect(applicableFor('OSVC')).toBe(false);
  });

  it('R-07i: při dani § 16 přesně rovné slevě na poplatníka nic nepropadá, a tedy se nevaruje', () => {
    // Dividenda bez zahraniční srážky jde do § 16a, v obecném základu zůstane
    // jen § 10. Základ 205 600 Kč × 15 % = 30 840 Kč = sleva na poplatníka
    // (§ 35ba odst. 1 písm. a) — vyčerpá se do koruny. O stovku nižší základ
    // už 15 Kč slevy nechá propadnout.
    const withBase10 = (sellPrice: string) =>
      run([
        buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2025-01-10' }),
        sell({ quantity: '100', pricePerShare: sellPrice, tradeDate: '2025-03-05' }),
        dividend({ gross: '1800000', withholdingTax: '0' }),
      ]);

    const exact = withBase10('3056');
    expect(exact.securities.base10Czk.toString()).toBe('205600');
    expect(exact.tax.recommended).toBe('SEPARATE_16A');
    expect(hasWarning(exact, 'SEPARATE_16A_CREDIT_LOSS')).toBe(false);

    const justBelow = withBase10('3055');
    expect(justBelow.securities.base10Czk.toString()).toBe('205500');
    expect(justBelow.tax.recommended).toBe('SEPARATE_16A');
    const warning = justBelow.warnings.find((w) => w.code === 'SEPARATE_16A_CREDIT_LOSS');
    expect(warning?.context?.taxUnderSection16Czk).toBe('30825.00');
    expect(warning?.context?.unusedCreditCzk).toBe('15.00');
  });
});
