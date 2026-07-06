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
}

export const DEFAULT_OPTIONS: EngineOptions = {
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  timeTestDateBasis: 'settlement',
  limit100kIncludesTimeTestExempt: true,
  spinoffCostBasisAllocation: 'zero',
  treatyWithholdingCap: { US: '0.15' },
  defaultTreatyCap: '0.15',
};

export const resolveOptions = (partial?: Partial<EngineOptions>): EngineOptions => ({
  ...DEFAULT_OPTIONS,
  ...partial,
});
