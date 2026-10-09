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

export interface ImportResult {
  broker: string;
  transactions: Transaction[];
  /** Řádky, které nešlo zpracovat — uživatel je musí opravit/doplnit. */
  errors: RowIssue[];
  /** Řádky vědomě přeskočené (pro výpočet nejsou potřeba). */
  skipped: RowIssue[];
  warnings: RowIssue[];
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
