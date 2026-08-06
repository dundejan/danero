/**
 * Konfigurační přepínače enginu — sporné výklady z docs/02 (tabulka přepínačů).
 * Zvolená konfigurace se propisuje do výsledku (průkaznost vůči FÚ).
 */
export type MatchingMethod = 'FIFO' | 'LIFO' | 'MAX_PROFIT' | 'MAX_LOSS';
export type FxMethod = 'UNIFIED' | 'CNB_DAILY';

export interface EngineOptions {
  /** R-05c: metoda párování prodejů na loty (zákon nepředepisuje; nutná konzistence). */
  matchingMethod: MatchingMethod;
  /** R-06: jednotný kurz GFŘ vs. denní kurzy ČNB (v jednom roce nelze kombinovat). */
  fxMethod: FxMethod;
  /** R-01a: báze časového testu — D-59 ukazuje na settlement (den zápisu na majetkový účet). */
  timeTestDateBasis: 'settlement' | 'trade';
  /** R-02c: vstupují do úhrnu 100k i příjmy osvobozené časovým testem? (striktní = true) */
  limit100kIncludesTimeTestExempt: boolean;
  /** R-04f: alokace nabývací ceny na spin-off ('zero' = konzervativní default). */
  spinoffCostBasisAllocation: 'zero' | 'proportional';
  /** R-07c: smluvní strop zápočtu srážkové daně per země (desetinný zlomek). */
  treatyWithholdingCap: Record<string, string>;
  defaultTreatyCap: string;
  /**
   * R-12i: prémie opce expirované bezcenně jako výdaj druhu deriváty
   * (výklad „per druh“, § 10/4 + D-59). Default false = restriktivní výklad.
   */
  derivativesExpensesPerType: boolean;
  /**
   * R-10g: osvobozuje časový test 3 roky (§ 4/1 zk) i EMT (stablecoiny)?
   * Litera zk) EMT nevylučuje (na rozdíl od zj), výklad je ale nejednotný.
   * Default false = bezpečný výklad (EMT zdanit vždy).
   */
  emtTimeTestExempt: boolean;
}

export const DEFAULT_OPTIONS: EngineOptions = {
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  timeTestDateBasis: 'settlement',
  limit100kIncludesTimeTestExempt: true,
  spinoffCostBasisAllocation: 'zero',
  // R-07c: ověřené smluvní stropy (portfolio FO, čl. 10): US 32/1994 Sb.,
  // DE 18/1984 Sb., NL 138/1974 Sb. (10 %!), JP 46/1979 Sb., IE 163/1996 Sb.
  treatyWithholdingCap: { US: '0.15', DE: '0.15', NL: '0.10', JP: '0.15', IE: '0.15' },
  defaultTreatyCap: '0.15',
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
};

export const resolveOptions = (partial?: Partial<EngineOptions>): EngineOptions => ({
  ...DEFAULT_OPTIONS,
  ...partial,
});
