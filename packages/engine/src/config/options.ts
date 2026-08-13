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
  /** R-07c: smluvní strop zápočtu srážkové daně z DIVIDEND per země (desetinný zlomek). */
  treatyWithholdingCap: Record<string, string>;
  defaultTreatyCap: string;
  /**
   * R-07f: smluvní strop zápočtu srážkové daně z ÚROKŮ per země. Vlastní tabulka,
   * protože úroky řeší čl. 11 smlouvy, ne čl. 10 jako dividendy — a ten skoro
   * vždy nechává právo zdanit úrok jen státu rezidenta (strop 0 %).
   */
  treatyInterestWithholdingCap: Record<string, string>;
  defaultInterestTreatyCap: string;
  /**
   * R-12i: prémie opce expirované bezcenně jako výdaj druhu deriváty
   * (výklad „per druh“, § 10/4 + D-59). Default false = restriktivní výklad.
   */
  derivativesExpensesPerType: boolean;
  /**
   * R-13b: kdy plyne příjem z prodeje nakrátko (short na spotu)?
   *
   * Default `true` = při PRODEJI (hotovostní princip § 5/1) — dřívější zdanění,
   * tedy bezpečný výklad. `false` = až uzavřením pozice, kdy se daní jen rozdíl
   * (výklad se objevuje v poradenské praxi, oporu v zákoně nemá).
   *
   * Rozdíl je vidět jen u shortu drženého přes konec roku; jinak vyjde totéž.
   */
  shortSaleIncomeOnSale: boolean;
  /**
   * R-10g: osvobozuje časový test 3 roky (§ 4/1 zk) i EMT (stablecoiny)?
   * Litera zk) EMT nevylučuje (na rozdíl od zj), výklad je ale nejednotný.
   * Default false = bezpečný výklad (EMT zdanit vždy).
   */
  emtTimeTestExempt: boolean;
  /**
   * R-07h: snižuje vratka kapitálu (return of capital) nabývací cenu pozice
   * místo toho, aby se danila jako dividenda? Default false = bezpečný výklad
   * (zdanit hned podle R-07b) — nikdy nepodhodnotí daň, jen ji vybere dřív.
   */
  returnOfCapitalReducesBasis: boolean;
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
  // R-07f: ověřené smluvní stropy pro ÚROKY (čl. 11) — US/DE/NL/IE/GB nechávají
  // právo zdanit úrok jen státu rezidenta (0 %), JP dovoluje obecných 10 %.
  // Default 0 % je bezpečný: neověřenou smlouvu nikdy nenadhodnotíme, srážka
  // nad strop se žádá zpět ve státě zdroje (engine to řekne ve varování).
  treatyInterestWithholdingCap: { US: '0', DE: '0', NL: '0', IE: '0', GB: '0', JP: '0.10' },
  defaultInterestTreatyCap: '0',
  derivativesExpensesPerType: false,
  shortSaleIncomeOnSale: true,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
};

export const resolveOptions = (partial?: Partial<EngineOptions>): EngineOptions => ({
  ...DEFAULT_OPTIONS,
  ...partial,
});
