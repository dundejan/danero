import { ISIN_DIRECTORY, type IsinDirectoryRecord } from './data';
import { etoroListing, MARKETS, type MarketCode } from './markets';

/**
 * Vestavěný číselník ISIN: ticker na burze → ISIN, pro brokery, kteří ISIN
 * do výpisu nedávají (Schwab, Tastytrade, Revolut, Fio, eToro, XTB). Burzy
 * jsou americké a u eToro i ty evropské a asijské, jejichž příponu výpisy
 * dokládají (`markets.ts`). Import se uživatele ptá jen na to, co tady není.
 *
 * Data jsou statická (`data.ts`), generuje je ručně spouštěný skript
 * `scripts/build-isin-directory.ts` z Wikidat (CC0) s ověřením každé dvojice
 * přes OpenFIGI; za běhu se nikam nevolá. Do souboru se dostane jen
 * JEDNOZNAČNÁ a ověřená dvojice: OpenFIGI musí potvrdit, že ISIN na dané
 * burze vede právě na tenhle ticker, a ticker, který vede na víc ISIN,
 * v něm není vůbec.
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
export type { MarketCode };

/** Doplněný údaj pro jeden symbol z výpisu. */
export interface BuiltinInstrument {
  /** Symbol tak, jak ho má výpis brokera (u XTB s příponou trhu). */
  symbol: string;
  isin: string;
  name: string;
  /** Měna instrumentu — jen u XTB, kde ji výpis neuvádí. */
  currency?: string;
}

let byListing: Map<string, IsinDirectoryRecord> | undefined;
const directoryRecord = (market: MarketCode, ticker: string): IsinDirectoryRecord | undefined => {
  byListing ??= new Map(ISIN_DIRECTORY.map((record) => [`${record.market}|${record.ticker}`, record]));
  return byListing.get(`${market}|${ticker}`);
};

/** Trh a ticker, pod kterým se symbol z výpisu hledá v číselnících ISIN. */
export interface Listing {
  market: MarketCode;
  ticker: string;
  /** Měna instrumentu — jen u XTB, kde ji výpis neuvádí. */
  currency?: string;
}

/**
 * Trh a ticker symbolu z výpisu brokera:
 *
 * - Schwab a Tastytrade jsou americké brokery — symbol JE americký ticker.
 * - eToro dává tickerům mimo USA příponu burzy (`BARC.L`, `SAP.DE`), holý
 *   ticker je americký — kromě titulu, který výpis vede v librách či pencích
 *   (`TSCO/GBX`, Londýn). Viz `etoroListing`.
 * - XTB má příponu trhu vždy; bereme jen `.US` (měna USD).
 * - Revolut a Fio vedou i evropské trhy pod podobnými symboly. Americký
 *   ticker v nich poznáme jen podle měny: symbol, který se ve výpisu
 *   obchodoval VÝHRADNĚ v USD. Bez měny (nebo s jinou) se nedoplňuje.
 */
export function listingFor(
  broker: string,
  symbol: string,
  /** Měny, ve kterých se symbol ve výpisu objevil (Revolut, Fio, eToro). */
  currencies: readonly string[] = [],
): Listing | undefined {
  const us = MARKETS.US.pattern;
  switch (broker) {
    case 'schwab':
    case 'tastytrade':
      return us.test(symbol) ? { market: 'US', ticker: symbol } : undefined;
    case 'etoro':
      return etoroListing(symbol, currencies);
    case 'revolut':
    case 'fio':
      if (currencies.length === 0 || currencies.some((code) => code !== 'USD')) return undefined;
      return us.test(symbol) ? { market: 'US', ticker: symbol } : undefined;
    case 'xtb': {
      const match = /^([A-Z]{1,5})\.US$/.exec(symbol);
      return match ? { market: 'US', ticker: match[1]!, currency: 'USD' } : undefined;
    }
    default:
      return undefined;
  }
}

/** Americký ticker, pod kterým se symbol z výpisu hledá v číselnících ISIN. */
export interface UsTicker {
  ticker: string;
  /** Měna instrumentu — jen u XTB, kde ji výpis neuvádí. */
  currency?: string;
}

/**
 * Americký ticker symbolu — pro ISIN odvozený z uživatelových obchodů
 * u brokera, který ISIN uvádí (ty jsou jen americké, viz `ownTickerIsins`).
 */
export function usTickerFor(
  broker: string,
  symbol: string,
  currencies: readonly string[] = [],
): UsTicker | undefined {
  const listing = listingFor(broker, symbol, currencies);
  if (listing?.market !== 'US') return undefined;
  return { ticker: listing.ticker, ...(listing.currency ? { currency: listing.currency } : {}) };
}

/** ISIN z vestavěného číselníku pro symbol z výpisu brokera. */
export function builtinInstrument(
  broker: string,
  symbol: string,
  currencies: readonly string[] = [],
): BuiltinInstrument | undefined {
  const listing = listingFor(broker, symbol, currencies);
  const record = listing ? directoryRecord(listing.market, listing.ticker) : undefined;
  if (!listing || !record) return undefined;
  return {
    symbol,
    isin: record.isin,
    name: record.name,
    ...(listing.currency ? { currency: listing.currency } : {}),
  };
}

/** Všechny záznamy (pro testy a generátor). */
export const isinDirectoryRecords = (): readonly IsinDirectoryRecord[] => ISIN_DIRECTORY;
