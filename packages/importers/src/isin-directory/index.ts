import { ISIN_DIRECTORY, type IsinDirectoryRecord } from './data';

/**
 * Vestavěný číselník ISIN: ticker na americké burze → ISIN, pro brokery,
 * kteří ISIN do výpisu nedávají (Schwab, Tastytrade, Revolut, Fio, eToro,
 * XTB). Import se uživatele ptá jen na to, co tady není.
 *
 * Data jsou statická (`data.ts`), generuje je ručně spouštěný skript
 * `scripts/build-isin-directory.ts` z Wikidat (CC0) s ověřením každé dvojice
 * přes OpenFIGI; za běhu se nikam nevolá. Do souboru se dostane jen
 * JEDNOZNAČNÁ a ověřená dvojice: ticker, který vede na víc ISIN (třídy akcií
 * GOOG/GOOGL), v něm není vůbec.
 *
 * Soubor se při každém běhu generátoru sestaví znovu (záznamy, které ověření
 * neprojdou, z něj vypadnou). Import každou doplněnou dvojici uloží do
 * uživatelova číselníku (`instrument_aliases`), takže změna tohohle souboru
 * se už naimportovaných dat netkne — ISIN v dedupe otisku se nezmění —
 * a uživatel dvojici vidí a může opravit v seznamu „Doplněné údaje
 * instrumentů“.
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
  return byUsTicker.get(ticker);
};

/** Americký ticker, pod kterým se symbol z výpisu hledá v číselnících ISIN. */
export interface UsTicker {
  ticker: string;
  /** Měna instrumentu — jen u XTB, kde ji výpis neuvádí. */
  currency?: string;
}

/**
 * Brokeři, jejichž symbol jde spolehlivě převést na americký ticker. Platí
 * pro vestavěný číselník i pro ISIN odvozený z obchodů u jiného brokera:
 *
 * - Schwab a Tastytrade jsou americké brokery — symbol JE americký ticker.
 * - eToro dává tickerům mimo USA příponu burzy (`BARC.L`, `SAP.DE`), holý
 *   ticker je americký.
 * - XTB má příponu trhu vždy; bereme jen `.US` (měna USD).
 * - Revolut a Fio vedou i evropské trhy pod podobnými symboly. Americký
 *   ticker v nich poznáme jen podle měny: symbol, který se ve výpisu
 *   obchodoval VÝHRADNĚ v USD. Bez měny (nebo s jinou) se nedoplňuje.
 */
export function usTickerFor(
  broker: string,
  symbol: string,
  /** Měny, ve kterých se symbol ve výpisu objevil (Revolut, Fio). */
  currencies: readonly string[] = [],
): UsTicker | undefined {
  switch (broker) {
    case 'schwab':
    case 'tastytrade':
    case 'etoro':
      return US_TICKER.test(symbol) ? { ticker: symbol } : undefined;
    case 'revolut':
    case 'fio':
      if (currencies.length === 0 || currencies.some((code) => code !== 'USD')) return undefined;
      return US_TICKER.test(symbol) ? { ticker: symbol } : undefined;
    case 'xtb': {
      const match = /^([A-Z]{1,5})\.US$/.exec(symbol);
      return match ? { ticker: match[1]!, currency: 'USD' } : undefined;
    }
    default:
      return undefined;
  }
}

/** ISIN americké akcie z vestavěného číselníku pro symbol z výpisu brokera. */
export function builtinInstrument(
  broker: string,
  symbol: string,
  currencies: readonly string[] = [],
): BuiltinInstrument | undefined {
  const us = usTickerFor(broker, symbol, currencies);
  const record = us ? usRecord(us.ticker) : undefined;
  if (!us || !record) return undefined;
  return {
    symbol,
    isin: record.isin,
    name: record.name,
    ...(us.currency ? { currency: us.currency } : {}),
  };
}

/** Všechny záznamy (pro testy a generátor). */
export const isinDirectoryRecords = (): readonly IsinDirectoryRecord[] => ISIN_DIRECTORY;
