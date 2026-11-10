/**
 * Burzy vestavěného číselníku ISIN — společné pro generátor
 * (`scripts/build-isin-directory.ts`) i pro hledání symbolu z výpisu.
 *
 * Mimo USA jen burzy, jejichž příponu eToro doložitelně používá (skutečné
 * výpisy z 9. 11. 2026 dokládají `.L`, `.DE`, `.PA`, `.T`, `.LSB` a `.HK`). Další burzu přidej, až ji doloží výpis — špatně přiřazená
 * přípona by hledala ticker na cizí burze.
 */

export type MarketCode = 'US' | 'LSE' | 'XETR' | 'XPAR' | 'XTKS' | 'XLIS' | 'XHKG';

export interface Market {
  code: MarketCode;
  /** Burzy ve Wikidatech (P414), jejichž ticker (P249) platí pro tenhle trh. */
  wikidata: readonly string[];
  /** Kód burzy v OpenFIGI, na které se dvojice ověřuje. */
  openFigiExchCode: string;
  /** Přípony, které se z tickeru odříznou (Wikidata i výpisy je občas píšou). */
  suffixes: readonly string[];
  /** Tvar tickeru po sjednocení. */
  pattern: RegExp;
}

export const MARKETS: Readonly<Record<MarketCode, Market>> = {
  // NYSE (Q13677) a Nasdaq (Q82059); třídy s tečkou (BRK.B) se nepřijímají
  US: {
    code: 'US',
    wikidata: ['Q13677', 'Q82059'],
    openFigiExchCode: 'US',
    suffixes: [],
    pattern: /^[A-Z]{1,5}$/,
  },
  LSE: {
    code: 'LSE',
    wikidata: ['Q171240'],
    openFigiExchCode: 'LN',
    suffixes: ['.L', '.LN'],
    pattern: /^[A-Z0-9]{1,5}$/,
  },
  // eToro `.DE` je Xetra; Wikidata vedou tickery u Frankfurtské burzy
  // a mnemotechnické zkratky jsou na obou stejné
  XETR: {
    code: 'XETR',
    wikidata: ['Q151139'],
    openFigiExchCode: 'GY',
    suffixes: ['.DE'],
    pattern: /^[A-Z0-9]{1,6}$/,
  },
  XPAR: {
    code: 'XPAR',
    wikidata: ['Q2385849'],
    openFigiExchCode: 'FP',
    suffixes: ['.PA'],
    pattern: /^[A-Z0-9]{1,6}$/,
  },
  XTKS: {
    code: 'XTKS',
    wikidata: ['Q217475'],
    openFigiExchCode: 'JT',
    suffixes: ['.T'],
    pattern: /^[0-9][0-9A-Z]{3}$/,
  },
  XLIS: {
    code: 'XLIS',
    wikidata: ['Q2415561'],
    openFigiExchCode: 'PL',
    suffixes: ['.LSB', '.LS'],
    pattern: /^[A-Z0-9]{1,6}$/,
  },
  // Hongkong: `0005` (Wikidata, eToro) i `5` (OpenFIGI) je tentýž titul
  XHKG: {
    code: 'XHKG',
    wikidata: ['Q496672'],
    openFigiExchCode: 'HK',
    suffixes: ['.HK'],
    pattern: /^[1-9][0-9]{0,4}$/,
  },
};

export const MARKET_CODES = Object.keys(MARKETS) as MarketCode[];

/**
 * Ticker v jednotném tvaru daného trhu, nebo `undefined`, když tvaru
 * neodpovídá. Odřízne příponu trhu, koncovou tečku či lomítko (LSE `BA.`,
 * OpenFIGI `BA/`) a u Hongkongu úvodní nuly.
 */
export function normalizeTicker(market: MarketCode, raw: string): string | undefined {
  const { suffixes, pattern } = MARKETS[market];
  let ticker = raw.trim().toUpperCase();
  for (const suffix of suffixes) {
    if (ticker.endsWith(suffix)) {
      ticker = ticker.slice(0, -suffix.length);
      break;
    }
  }
  if (market !== 'US') ticker = ticker.replace(/[./]$/, '');
  if (market === 'XHKG') ticker = ticker.replace(/^0+/, '');
  return pattern.test(ticker) ? ticker : undefined;
}

/** Přípona burzy v symbolu eToro (bez ohledu na velikost písmen) → trh. */
const ETORO_SUFFIXES: Readonly<Record<string, MarketCode>> = {
  L: 'LSE',
  DE: 'XETR',
  PA: 'XPAR',
  T: 'XTKS',
  LSB: 'XLIS',
  HK: 'XHKG',
};

/** Měny, ve kterých eToro vede londýnské tituly bez přípony (`TSCO/GBX`). */
const LONDON_CURRENCIES = new Set(['GBX', 'GBP']);

/**
 * Trh a ticker symbolu z výpisu eToro. Přípona burzy určuje trh (`BARC.L`,
 * `7203.T`); holý ticker je americký, pokud ho výpis nevede v jiné měně —
 * eToro bez přípony uvádí i londýnské tituly (`TSCO/GBX`), a ty se hledají
 * v Londýně. Holý ticker v jiné měně (EUR…) se nehledá nikde.
 */
export function etoroListing(
  symbol: string,
  currencies: readonly string[],
): { market: MarketCode; ticker: string } | undefined {
  const suffixed = /^([^.]+)\.([A-Za-z]{1,3})$/.exec(symbol.trim());
  if (suffixed) {
    const market = ETORO_SUFFIXES[suffixed[2]!.toUpperCase()];
    const ticker = market ? normalizeTicker(market, suffixed[1]!) : undefined;
    return market && ticker ? { market, ticker } : undefined;
  }
  const market: MarketCode | undefined =
    currencies.length === 0 || currencies.every((code) => code === 'USD')
      ? 'US'
      : currencies.every((code) => LONDON_CURRENCIES.has(code))
        ? 'LSE'
        : undefined;
  // americký ticker se nesjednocuje: `aapl` není AAPL (výpis píše velkými)
  if (market === 'US') return MARKETS.US.pattern.test(symbol) ? { market, ticker: symbol } : undefined;
  const ticker = market ? normalizeTicker(market, symbol) : undefined;
  return market && ticker ? { market, ticker } : undefined;
}
