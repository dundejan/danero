import type { Transaction } from '@danero/shared';
import type { ImportResult } from './types';

/**
 * Den transakce je den z výpisu (docs/02 R-05d) — a u brokerů, kteří píšou
 * světový čas (UTC), se tím může lišit ROK: 31. 12. ve 23:30 UTC je v Česku
 * už 1. 1. Pravidlo se nemění, ale uživatel se to má dozvědět, protože jde
 * o to, do kterého přiznání příjem patří.
 *
 * Česko je na přelomu roku vždy v zimním čase (UTC+1), takže stačí poslední
 * hodina 31. prosince. Čte se jen tvar `RRRR-12-31 23:…` (i s `T`), který
 * píšou Trading 212, Kraken, Coinbase, Anycoin i Revolut; cokoli jiného není
 * UTC okamžik, se kterým tu umíme pracovat, a varování nedostane.
 */
const UTC_YEAR_BOUNDARY = /^(\d{4})-12-31[ T]23:(\d{2})/;

/** Věta do varování, nebo `null`, když okamžik na hranici roku neleží. */
export function utcYearBoundaryNote(timestamp: string): string | null {
  const match = UTC_YEAR_BOUNDARY.exec(timestamp.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return `Transakce z 31. 12. ${year} ve 23:${match[2]} světového času (UTC): v Česku už bylo 1. 1. ${year + 1}. Danero počítá dnem z výpisu, takže ji řadí do roku ${year}.`;
}

/**
 * Rozhoduje u téhle transakce o roce příjmu DEN z výpisu?
 *
 * Ano u dividend, úroků a krypta (připsáno hned, T+0). Ne u nákupu a prodeje
 * cenných papírů: příjem tam patří do roku VYPOŘÁDÁNÍ (R-05a), takže prodej
 * z 31. 12. spadne do dalšího roku tak jako tak a věta „řadí ji do roku X“
 * by tvrdila opak toho, co engine spočítá. A ne u vkladů, výběrů a převodů —
 * ty do žádného přiznání nevstupují.
 */
function dayDecidesTaxYear(tx: Transaction): boolean {
  if (tx.type === 'DIVIDEND' || tx.type === 'INTEREST') return true;
  return (tx.type === 'BUY' || tx.type === 'SELL') && tx.assetClass === 'CRYPTO';
}

/**
 * Hlídá řádky parseru a varování přidá jen k těm, ze kterých vznikla
 * transakce, u které den rozhoduje o roce. Parser zavolá `row()` na začátku
 * každého řádku a `flush()` po posledním.
 *
 * Varování jde NA ZAČÁTEK seznamu: historie importů vypisuje jen prvních pár
 * a tohle se týká roku, do kterého příjem patří — nesmí zapadnout za desítky
 * hlášek o přeskočených řádcích.
 */
export class YearBoundaryWatch {
  private pending: { line: number; note: string; count: number } | null = null;
  private found = 0;

  constructor(private readonly result: ImportResult) {}

  row(line: number, timestamp: string): void {
    this.flush();
    const note = utcYearBoundaryNote(timestamp);
    if (note) this.pending = { line, note, count: this.result.transactions.length };
  }

  flush(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    const produced = this.result.transactions.slice(pending.count);
    if (!produced.some(dayDecidesTaxYear)) return;
    // před ostatní varování, mezi sebou v pořadí řádků
    this.result.warnings.splice(this.found, 0, { line: pending.line, message: pending.note });
    this.found += 1;
  }
}
