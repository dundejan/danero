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
