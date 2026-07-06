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
