import type { Transaction } from '@danero/shared';

export interface RowIssue {
  /** Číslo řádku v souboru (1 = hlavička). */
  line: number;
  message: string;
  raw?: string;
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
