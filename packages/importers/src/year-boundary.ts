import type { ImportResult } from './types';

/**
 * Den transakce je den z výpisu (docs/02 R-05d) — a u brokerů, kteří píšou
 * světový čas (UTC), se tím může lišit ROK: 31. 12. ve 23:30 UTC je v Česku
 * už 1. 1. Pravidlo se nemění, ale uživatel se to má dozvědět, protože jde
 * o to, do kterého přiznání příjem patří.
 *
 * Česko je na přelomu roku vždy v zimním čase (UTC+1), takže stačí poslední
 * hodina 31. prosince. Čte se jen tvar `RRRR-12-31 23:…` (i s `T`), který
 * píšou Trading 212, Kraken i Coinbase; cokoli jiného není UTC okamžik, se
 * kterým tu umíme pracovat, a varování nedostane.
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
 * Hlídá řádky parseru a varování přidá jen k těm, ze kterých opravdu vznikla
 * transakce (vklad nebo přeskočený řádek z poslední hodiny roku nikoho
 * nezajímá). Parser zavolá `row()` na začátku každého řádku a `flush()` po
 * posledním — o tom, jestli řádek něco vydal, rozhodne počet transakcí.
 */
export class YearBoundaryWatch {
  private pending: { line: number; note: string; count: number } | null = null;

  constructor(private readonly result: ImportResult) {}

  row(line: number, timestamp: string): void {
    this.flush();
    const note = utcYearBoundaryNote(timestamp);
    if (note) this.pending = { line, note, count: this.result.transactions.length };
  }

  flush(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending && this.result.transactions.length > pending.count) {
      this.result.warnings.push({ line: pending.line, message: pending.note });
    }
  }
}
