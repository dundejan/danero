import type { Transaction } from '@danero/shared';

export interface RowIssue {
  /** Číslo řádku v souboru (1 = hlavička). */
  line: number;
  message: string;
  raw?: string;
  /**
   * Jen u chyb: řádek jsme POZNALI a vědomě ho nezaúčtujeme — hláška říká
   * uživateli, kudy si ho doplní sám (pohyby kusů u Trading 212). Není to vada
   * parseru, takže výpis, který má jen takové chyby, se neschovává jako
   * nepřečtený a neslibuje se u něj „na zpracování pracujeme“ (A04-R1-01).
   * Říká to parser příznakem, ať to import nemusí hádat z textu hlášky.
   */
  knownUnsupported?: true;
  /**
   * Hláška říká jen „doplň ISIN k tomuhle symbolu“ (broker bez ISIN ve
   * výpisu). Historie importů podle toho pozná, že ji uživatel číselníkem už
   * vyřídil — strukturovaně, ne z textu hlášky, který se smí měnit.
   */
  unmappedSymbol?: string;
}

/** Uložená událost, kterou výpis ruší — viz `ImportResult.retracted`. */
export interface RetractedEvent {
  id: string;
  /** Typy transakcí, mezi kterými se id hledá (řady id se u brokera liší podle druhu). */
  types: Array<Transaction['type']>;
  /**
   * Zrušení platí, jen když je výpis novější než uložená data (synchronizace
   * napojeného účtu). Týká se dividend složených z více řádků: zrušená položka
   * se nahrazuje jinou, a ta se u ručně nahraného výpisu nepřepisuje — smazat
   * jednu bez přepsání druhé by příjem snížilo.
   */
  onlyFromNewerStatement?: true;
}

export interface ImportResult {
  broker: string;
  transactions: Transaction[];
  /** Řádky, které nešlo zpracovat — uživatel je musí opravit/doplnit. */
  errors: RowIssue[];
  /** Řádky vědomě přeskočené (pro výpočet nejsou potřeba). */
  skipped: RowIssue[];
  warnings: RowIssue[];
  /**
   * Události, které broker tímhle výpisem ZRUŠIL: stornovaný obchod (IBKR:
   * `BUY (Ca.)` s odkazem na původní `tradeID`) nebo dividenda, kterou
   * stornoval a zaúčtoval znovu. Parser je vyřadí jen z téhož výpisu;
   * u napojeného účtu se ale uložily dřív, než zrušení přišlo, a v databázi
   * by zůstaly napořád. Import podle tohohle seznamu uložené řádky odstraní.
   * Smí sem jen id, které broker sám označil za zrušené.
   */
  retracted?: RetractedEvent[];
}

/**
 * Věta pro hlášku u řádku, který parser ULOŽIL, jen ne úplně přesně (sražená
 * daň, kterou výpis nenese; rabat; opravy ve více měnách). Radit „uprav ho
 * přes univerzální šablonu“ nejde: šablona je jiný jmenný prostor dedupe
 * a jednotlivou transakci smazat nelze, takže dopsaný řádek by se k uloženému
 * přičetl — dividenda nebo obchod by byly v evidenci dvakrát. Poctivá cesta
 * vede přes vrácení importu.
 */
export const REENTER_VIA_TEMPLATE =
  'Chceš-li to mít přesně, vrať tenhle import zpět (tlačítko v historii importů) a zapiš řádek přes univerzální šablonu — řádek dopsaný navíc by se k tomu uloženému přičetl podruhé.';

export const emptyResult = (broker: string): ImportResult => ({
  broker,
  transactions: [],
  errors: [],
  skipped: [],
  warnings: [],
});

/**
 * Mapa symbol → ISIN pro brokery, jejichž export ISIN neuvádí — plní ji
 * uživatel číselníkem při importu (vzor XTB; měnu tito brokeři ve výpisu mají).
 */
export type IsinInstrumentMap = Record<string, { isin: string }>;

/**
 * Měny, ve kterých se symbol ve výpisu obchodoval. Brokeři, kteří pod
 * podobnými symboly vedou víc trhů (Revolut, Fio), podle toho nechávají
 * poznat americký ticker vestavěnému číselníku ISIN.
 */
export type SymbolCurrencies = Map<string, Set<string>>;

/** Zapíše měnu symbolu do `SymbolCurrencies`. */
export function noteSymbolCurrency(target: SymbolCurrencies, symbol: string, currency: string): void {
  if (symbol === '' || currency === '') return;
  const seen = target.get(symbol) ?? new Set<string>();
  seen.add(currency);
  target.set(symbol, seen);
}
