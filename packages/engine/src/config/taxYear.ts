import type { IsoDate } from '@danero/shared';
import { UNIFIED_RATES_VERIFIED } from './unifiedRates';

/**
 * Druhy příjmů § 10, které engine počítá odděleně (R-05d/R-10c — bez vzájemné
 * kompenzace): cenné papíry vs. kryptoaktiva.
 */
export type AssetScope = 'SECURITIES' | 'CRYPTO';

/**
 * Legislativa je verzovaná per zdaňovací období (docs/02, sekce Roční údržba).
 * Každý leden: nový jednotný kurz (pokyn řady D), hranice 23% sazby, kontrola novel ZDP.
 */
export interface TaxYearConfig {
  year: number;
  /**
   * Jednotné kurzy GFŘ po letech: rok → měna → CZK za 1 jednotku (R-06a).
   * Výdaj se přepočítává kurzem roku vynaložení, příjem kurzem roku obdržení —
   * proto tabulka musí pokrývat i roky nákupů, ne jen cílový rok.
   */
  unifiedRatesByYear: Record<number, Record<string, string>>;
  limits: {
    /** R-02: osvobození úhrnu hrubých příjmů z prodeje CP (§ 4/1 t). */
    securitiesProceedsExemption: string;
    /** R-10a: kryptoaktiva (§ 4/1 zj) — samostatný limit vedle CP (R-02d). */
    cryptoProceedsExemption: string;
    /** R-08: úhrn příjmů § 8–10 pro daň rovnou paušální dani (§ 7a). */
    flatTaxOtherIncome: string;
    /** R-09b: vedlejší příjmy zaměstnance (§ 38g odst. 2). */
    employeeSideIncome: string;
    /** R-09a: obecný limit pro povinnost podat přiznání (§ 38g odst. 1). */
    generalFiling: string;
    /** R-09d: oznámení osvobozeného příjmu (§ 38v). */
    exemptIncomeReporting: string;
    /**
     * R-03/R-10d/R-10e: strop osvobození časovým testem (§ 4 odst. 3) a druhy
     * příjmů, na které se vztahuje — úhrn je přes uvedené druhy SPOLEČNÝ
     * (2025: CP + krypto; od 2026 jen krypto — zák. č. 360/2025 Sb.);
     * null = bez stropu (roky ≤ 2024).
     */
    timeTestCap: { amountCzk: string; appliesTo: AssetScope[] } | null;
  };
  /**
   * R-10b: dostupnost osvobození kryptoaktiv (§ 4/1 zj, zk — zák. č. 32/2025 Sb.).
   * `exemptionsAvailable: false` pro ZO ≤ 2024 (novela účinná až 15. 2. 2025,
   * krypto do té doby žádné osvobození nemělo) — explicitní flag je čitelnější
   * než sentinel datum. `effectiveFrom`: nárok na osvobození mají jen příjmy
   * realizované od tohoto data (2025: '2025-02-15', KOOV 625 závěr 2.2.1.5);
   * null = celé zdaňovací období (2026+).
   */
  cryptoRules: {
    exemptionsAvailable: boolean;
    effectiveFrom: IsoDate | null;
  };
  /** 36násobek průměrné mzdy — hranice 23% sazby (§ 16); null = neznámé (engine varuje). */
  progressiveThreshold: string | null;
}

export const TAX_YEAR_2025: TaxYearConfig = {
  year: 2025,
  // ověřené kurzy z pokynů GFŘ D-49…D-75 (viz unifiedRates.ts s citacemi);
  // aplikace může přepsat/doplnit orientační kurzy pro běžný rok
  unifiedRatesByYear: UNIFIED_RATES_VERIFIED,
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    // R-10d: v ZO 2025 jeden společný strop pro CP i krypto (§ 4/3)
    timeTestCap: { amountCzk: '40000000', appliesTo: ['SECURITIES', 'CRYPTO'] },
  },
  cryptoRules: { exemptionsAvailable: true, effectiveFrom: '2025-02-15' },
  progressiveThreshold: '1676052',
};

/**
 * Rok 2024 (a použitelné i pro starší roky se změnou progressiveThreshold):
 * strop 40M NEPLATÍ (zaveden až pro příjmy přijaté v roce 2025, zák. 349/2023 Sb.),
 * krypto nemá ŽÁDNÉ osvobození (zák. 32/2025 Sb. účinný až 15. 2. 2025 — R-10b),
 * hranice 23 % = 36× průměrné mzdy 43 967 Kč = 1 582 812 Kč (NV č. 286/2023 Sb.).
 */
export const TAX_YEAR_2024: TaxYearConfig = {
  year: 2024,
  unifiedRatesByYear: UNIFIED_RATES_VERIFIED,
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    timeTestCap: null,
  },
  cryptoRules: { exemptionsAvailable: false, effectiveFrom: null },
  progressiveThreshold: '1582812',
};

export const TAX_YEAR_2026_DRAFT: TaxYearConfig = {
  year: 2026,
  // Jednotný kurz za 2026 vyjde pokynem řady D začátkem roku 2027.
  unifiedRatesByYear: {},
  limits: {
    securitiesProceedsExemption: '100000',
    cryptoProceedsExemption: '100000',
    flatTaxOtherIncome: '50000',
    employeeSideIncome: '20000',
    generalFiling: '50000',
    exemptIncomeReporting: '5000000',
    // Zákon č. 360/2025 Sb.: strop 40M od 2026 pro CP zrušen, pro krypto trvá (R-10e).
    timeTestCap: { amountCzk: '40000000', appliesTo: ['CRYPTO'] },
  },
  cryptoRules: { exemptionsAvailable: true, effectiveFrom: null },
  // 36 × 48 967 Kč (průměrná mzda dle NV č. 365/2025 Sb.)
  progressiveThreshold: '1762812',
};
