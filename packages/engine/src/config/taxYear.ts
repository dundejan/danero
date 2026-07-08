import { UNIFIED_RATES_VERIFIED } from './unifiedRates';
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
    /** Kryptoaktiva (§ 4/1 zj) — samostatný limit, R-10 (post-MVP). */
    cryptoProceedsExemption: string;
    /** R-08: úhrn příjmů § 8–10 pro daň rovnou paušální dani (§ 7a). */
    flatTaxOtherIncome: string;
    /** R-09b: vedlejší příjmy zaměstnance (§ 38g odst. 2). */
    employeeSideIncome: string;
    /** R-09a: obecný limit pro povinnost podat přiznání (§ 38g odst. 1). */
    generalFiling: string;
    /** R-09d: oznámení osvobozeného příjmu (§ 38v). */
    exemptIncomeReporting: string;
    /** R-03: strop osvobození časovým testem (§ 4 odst. 3); null = bez stropu (CP od 2026). */
    timeTestExemptionCap: string | null;
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
    timeTestExemptionCap: '40000000',
  },
  progressiveThreshold: '1676052',
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
    // Zákon č. 360/2025 Sb.: strop 40M od 2026 pro CP zrušen (pro krypto trvá — R-10).
    timeTestExemptionCap: null,
  },
  // Doplnit z nařízení vlády o průměrné mzdě pro 2026; do té doby engine varuje.
  progressiveThreshold: null,
};
