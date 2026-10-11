import { describe, expect, it } from 'vitest';
import {
  FIRST_TAXPAYER_CREDIT_YEAR,
  LAST_CONFIGURED_TAX_YEAR,
  TAX_YEAR_CONFIGS,
  taxpayerCreditCzk,
} from '../src';

/**
 * R-15a: registr zdaňovacích období je výčet čísel, která stát vyhlásil nebo
 * která stojí v zákoně — a každé z nich má držet test (nález L4-08 revize 5).
 *
 * Do téhle chvíle držel test jen hranici 23 % a paušální zálohy let 2026
 * a 2027 (`apps/web/test/year-rollover.test.ts`). Přepis paušální zálohy 2024
 * z 7 498 na 9 999 Kč, limitu zaměstnance z 20 000 na 30 000 Kč nebo hranice
 * pro oznámení z 5 na 6 mil. Kč prošel celou sadou; limit 50 000 Kč paušální
 * daně chytil jen náhodou jeden webový test, jehož fixtura má dividendy
 * přesně 60 000 Kč.
 *
 * Čísla jsou tu schválně opsaná ještě jednou a pro každý rok zvlášť: test má
 * spadnout při úpravě HISTORICKÉHO řádku registru, která by se jinak propsala
 * do každého přiznání za ten rok. Rok 2027 tu zatím není — jeho limity § 38g
 * se v registru teprve srovnávají s novelou (revize 5, nález L3-01) a připne
 * je test, který tu změnu doprovází.
 */

/** Limity, které jsou v zákoně pevnou částkou (R-15b) — pro roky 2024 až 2026 beze změny. */
const STATUTORY_LIMITS = {
  // R-08b: úhrn příjmů § 8–10, do kterého je daň rovna paušální dani (§ 7a odst. 1 písm. b)
  flatTaxOtherIncome: '50000',
  // R-09b: vedlejší příjmy zaměstnance, nad které podává přiznání (§ 38g odst. 2)
  employeeSideIncome: '20000',
  // R-09a: obecný limit pro povinnost podat přiznání (§ 38g odst. 1)
  generalFiling: '50000',
  // R-09d: oznámení osvobozeného příjmu (§ 38v)
  exemptIncomeReporting: '5000000',
} as const;

describe('R-15a: registr let si drží vyhlášená a zákonná čísla', () => {
  it.each([2024, 2025, 2026])('R-08b, R-09a, R-09b, R-09d: limity roku %i', (year) => {
    const config = TAX_YEAR_CONFIGS[year];
    expect(config, `rok ${year} v registru chybí`).toBeDefined();
    expect(config?.year).toBe(year);

    const { flatTaxOtherIncome, employeeSideIncome, generalFiling, exemptIncomeReporting } =
      config?.limits ?? {};
    expect({
      flatTaxOtherIncome,
      employeeSideIncome,
      generalFiling,
      exemptIncomeReporting,
    }).toEqual(STATUTORY_LIMITS);
  });

  it('R-08f: paušální záloha 1. pásma 2024 je 7 498 Kč měsíčně, z toho daň 100 Kč', () => {
    // § 38lk: 100 Kč daň + 4 430 Kč důchodové + 2 968 Kč zdravotní pojištění
    expect(TAX_YEAR_CONFIGS[2024]?.flatTaxAdvance).toEqual({
      monthlyTotalCzk: '7498',
      monthlyTaxCzk: '100',
    });
  });

  it('R-08f: paušální záloha 1. pásma 2025 je 8 716 Kč měsíčně, z toho daň 100 Kč', () => {
    // § 38lk: 100 Kč daň + 5 473 Kč důchodové + 3 143 Kč zdravotní pojištění
    expect(TAX_YEAR_CONFIGS[2025]?.flatTaxAdvance).toEqual({
      monthlyTotalCzk: '8716',
      monthlyTaxCzk: '100',
    });
  });
});

/**
 * R-14g: základní sleva na poplatníka (§ 35ba odst. 1 písm. a) ZDP) se rok od
 * roku lišila. Do 11. 10. 2026 ji engine vedl jako jedinou konstantu
 * 30 840 Kč, takže report za rok 2021 radil zapsat na ř. 64 o 3 000 Kč víc,
 * než kolik zákon pro ten rok dával (a za rok 2020 a starší o 6 000 Kč víc).
 *
 * Částky jsou opsané pro každý rok zvlášť — stejně jako limity výš má test
 * spadnout při úpravě historického řádku.
 */
describe('R-14g: sleva na poplatníka podle zdaňovacího období', () => {
  it.each([
    // zák. č. 609/2020 Sb., čl. XI bod 62: „24840 Kč“ se nahrazuje „27840 Kč“ —
    // do roku 2020 tedy platilo 24 840 Kč
    [2012, '24840'],
    [2013, '24840'],
    [2014, '24840'],
    [2015, '24840'],
    [2016, '24840'],
    [2017, '24840'],
    [2018, '24840'],
    [2019, '24840'],
    [2020, '24840'],
    // čl. XII bod 20: znění bodu 62 „se použije již pro zdaňovací období roku 2021“
    [2021, '27840'],
    // čl. XI bod 63 (27840 → 30840), účinný od 1. 1. 2022 (čl. XLVIII písm. c)
    [2022, '30840'],
    [2023, '30840'],
    [2024, '30840'],
    [2025, '30840'],
    [2026, '30840'],
    [2027, '30840'],
  ])('za rok %i je sleva %s Kč', (year, amountCzk) => {
    expect(taxpayerCreditCzk(year)).toBe(amountCzk);
  });

  it('každý rok v registru slevu má — XML i report ji na ř. 64 potřebují', () => {
    for (const year of Object.keys(TAX_YEAR_CONFIGS).map(Number)) {
      expect(taxpayerCreditCzk(year), `rok ${year}`).not.toBeNull();
    }
  });

  it('rok před první známou částkou vrací „nevím“, ne nejbližší číslo', () => {
    // 2011 mělo slevu sníženou („povodňová stokoruna“), starší roky jiné
    // částky — neověřili jsme je, takže je netvrdíme
    expect(FIRST_TAXPAYER_CREDIT_YEAR).toBe(2012);
    expect(taxpayerCreditCzk(FIRST_TAXPAYER_CREDIT_YEAR - 1)).toBeNull();
    expect(taxpayerCreditCzk(2008)).toBeNull();
  });

  it('rok za registrem dědí poslední zákonnou částku (R-15b)', () => {
    expect(taxpayerCreditCzk(LAST_CONFIGURED_TAX_YEAR + 1)).toBe(
      taxpayerCreditCzk(LAST_CONFIGURED_TAX_YEAR),
    );
  });
});
