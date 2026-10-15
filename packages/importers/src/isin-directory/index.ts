import { ISIN_DIRECTORY, type IsinDirectoryRecord } from './data';

/**
 * Vestavěný číselník ISIN: ticker na americké burze → ISIN, pro brokery,
 * kteří ISIN do výpisu nedávají (Schwab, Tastytrade, Revolut, Fio, eToro,
 * XTB). Import se uživatele ptá jen na to, co tady není.
 *
 * Data jsou statická (`data.ts`), generuje je ručně spouštěný skript
 * `scripts/build-isin-directory.ts` z Wikidat (CC0) a za běhu se nikam
 * nevolá. Do souboru se dostane jen JEDNOZNAČNÁ dvojice: ticker, který vede
 * na víc ISIN (třídy akcií GOOG/GOOGL, přejmenované firmy), v něm není vůbec.
 *
 * ⚠️ Záznamy se jen PŘIDÁVAJÍ, nikdy nemění ani nemažou — ISIN je součást
 * obsahového otisku transakce. Import navíc každou doplněnou dvojici uloží
 * do uživatelova číselníku (`instrument_aliases`), takže pozdější změna
 * tohohle souboru se už naimportovaných dat netkne a uživatel ji vidí
 * a může opravit v seznamu „Doplněné údaje instrumentů“.
 *
 * Modul je jen pro server (import); do klientského kódu nepatří — proto má
 * vlastní vstup balíčku a hlavní `index.ts` ho nereexportuje.
 */

export type { IsinDirectoryRecord };

/** Doplněný údaj pro jeden symbol z výpisu. */
export interface BuiltinInstrument {
  /** Symbol tak, jak ho má výpis brokera (u XTB s příponou trhu). */
  symbol: string;
  isin: string;
  name: string;
  /** Měna instrumentu — jen u XTB, kde ji výpis neuvádí. */
  currency?: string;
}

/** Ticker americké akcie: jen písmena. Třídy s tečkou či lomítkem (BRK.B) generátor vynechává. */
const US_TICKER = /^[A-Z]{1,5}$/;

let byUsTicker: Map<string, IsinDirectoryRecord> | undefined;
const usRecord = (ticker: string): IsinDirectoryRecord | undefined => {
  byUsTicker ??= new Map(
    ISIN_DIRECTORY.filter((record) => record.market === 'US').map((record) => [
      record.ticker,
      record,
    ]),
  );
  return US_TICKER.test(ticker) ? byUsTicker.get(ticker) : undefined;
};

/**
 * Brokeři, jejichž symbol jde spolehlivě převést na americký ticker:
 *
 * - Schwab a Tastytrade jsou americké brokery — symbol JE americký ticker.
 * - eToro dává tickerům mimo USA příponu burzy (`BARC.L`, `SAP.DE`), holý
 *   ticker je americký.
 * - XTB má příponu trhu vždy; bereme jen `.US` (měna USD).
 * - Revolut a Fio vedou i evropské trhy pod podobnými symboly. Americký
 *   ticker v nich poznáme jen podle měny: symbol, který se ve výpisu
 *   obchodoval VÝHRADNĚ v USD. Bez měny (nebo s jinou) se nedoplňuje.
 */
export function builtinInstrument(
  broker: string,
  symbol: string,
  /** Měny, ve kterých se symbol ve výpisu objevil (Revolut, Fio). */
  currencies: readonly string[] = [],
): BuiltinInstrument | undefined {
  let ticker: string;
  let currency: string | undefined;
  switch (broker) {
    case 'schwab':
    case 'tastytrade':
    case 'etoro':
      ticker = symbol;
      break;
    case 'revolut':
    case 'fio':
      if (currencies.length === 0 || currencies.some((code) => code !== 'USD')) return undefined;
      ticker = symbol;
      break;
    case 'xtb': {
      const match = /^([A-Z]{1,5})\.US$/.exec(symbol);
      if (!match) return undefined;
      ticker = match[1]!;
      currency = 'USD';
      break;
    }
    default:
      return undefined;
  }
  const record = usRecord(ticker);
  if (!record) return undefined;
  return { symbol, isin: record.isin, name: record.name, ...(currency ? { currency } : {}) };
}

/** Všechny záznamy (pro testy a generátor). */
export const isinDirectoryRecords = (): readonly IsinDirectoryRecord[] => ISIN_DIRECTORY;
