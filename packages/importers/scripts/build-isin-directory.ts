/**
 * Generátor vestavěného číselníku ISIN (`src/isin-directory/data.ts`).
 *
 * Spouští se ručně, ne při buildu ani za běhu aplikace:
 *
 *   OPENFIGI_API_KEY=… pnpm --filter @danero/importers isin-directory   # stáhne a zapíše
 *   … isin-directory --dry-run              # jen vypíše, co by se změnilo
 *   … isin-directory --gleif-csv <soubor>   # GLEIF z už staženého CSV
 *   … isin-directory --no-gleif             # jen Wikidata
 *
 * Dva zdroje: Wikidata (níž) a GLEIF s kotacemi z OpenFIGI
 * (`isin-directory-gleif.ts`) — ten bez bezplatného klíče OpenFIGI neběží
 * (~500 000 ISIN, s klíčem asi půl hodiny). Klíč provozovatele leží
 * v `~/.config/danero/openfigi.key` (mimo `~/.danero`, kam smí jen skripty
 * pro produkci), do repozitáře nepatří.
 *
 * Zdroj: Wikidata (query.wikidata.org), data pod CC0 1.0 — položky s ISIN
 * (P946) a výpisem na burze (P414) s kvalifikátorem ticker (P249). Burzy
 * jsou v `src/isin-directory/markets.ts`: NYSE a Nasdaq, a pro eToro
 * Londýn, Xetra, Paříž, Tokio, Lisabon a Hongkong.
 *
 * Kandidáty jsou všechny dvojice (trh, ticker, ISIN) jedné položky —
 * Wikidata u položky nepíšou, ke kterému tickeru který ISIN patří (Alphabet
 * má GOOG i GOOGL a oba ISIN, TSMC ISIN tchajwanské akcie i amerického ADR). Které
 * dvojici patří, rozhodne až ověření přes OpenFIGI (viz níž). Vyřazuje se:
 * - firma, která zanikla (P576), byla nahrazena (P1366), ukončena (P2669) nebo
 *   má mateřskou společnost (P749 — převzatá firma, VMware pod Broadcomem):
 *   její ticker burza časem přidělí jinému emitentovi. Wikidata převzetí
 *   nezapíšou vždy hned (Juniper, Hess), takže úplná ochrana to není — proto
 *   import každou doplněnou dvojici ukládá do číselníku uživatele, kde ji vidí
 *   a může opravit,
 * - výpis nebo ISIN s koncem (P582) či zastaralým hodnocením (deprecated),
 * - ticker, který tvaru trhu neodpovídá (v USA jen 1–5 písmen — třídy BRK.B),
 * - ISIN s chybnou kontrolní číslicí a americký ISIN, který není akcie
 *   (číslo emise s písmeny = dluhopis; Paramount Global měl `US124857AK99`),
 * - položka s víc než `MAX_TICKERS` tickery nebo `MAX_ISINS` ISIN na trhu,
 * - po ověření ticker, který na trhu vede na víc ověřených ISIN, a ISIN
 *   s víc tickery.
 *
 * Zahraniční ISIN u amerického tickeru se bere, jen když ho OpenFIGI na
 * amerických burzách vede pod TÍMŽ tickerem: ticker TSM na NYSE je ADR
 * s jiným ISIN než tchajwanská akcie (ta je v USA jen mimoburzovně pod
 * TSMWF), kdežto Alcon kotuje v New Yorku přímo akcii se švýcarským
 * ISIN.
 *
 * Wikidata samy nestačí: revize 15. 10. 2026 v nich našla 20 % chyb — ISIN
 * jiného emitenta (TT → ISIN Ingersoll Rand, CB → stará Chubb Corp,
 * recyklované tickery LB, TEN…), zastaralý ISIN téže firmy (XOM) a tickery,
 * které emitent už nepoužívá. Každý kandidát proto projde OVĚŘENÍM PŘES
 * OpenFIGI (`verifyWithOpenFigi`): dotaz na ISIN na burze trhu musí
 * vrátit FIGI se STEJNÝM tickerem a druhem cenného papíru ze seznamu
 * `ALLOWED_SECURITY_TYPES`. U Wikidat se z odpovědi bere jen ano/ne;
 * u GLEIF z ní pochází ticker a burza (viz `isin-directory-gleif.ts`).
 * Na trhu musí ticker vést na jediný ISIN; jeden ISIN pod víc tickery
 * (ETF v librách i dolarech) nevadí. Volá se jen při ručním běhu skriptu; bez klíče platí limit
 * OpenFIGI (dávky po 10, 25 dotazů za minutu), s `OPENFIGI_API_KEY`
 * v prostředí jde běh rychleji.
 *
 * Soubor se při každém běhu sestaví ZNOVU: co ověřením neprojde, z něj
 * vypadne, a skript změny vypíše. Je to bezpečné, protože import každou
 * doplněnou dvojici ukládá do uživatelova číselníku (`instrument_aliases`)
 * — změna souboru se už naimportovaných dat netkne. Pouštěj ho pravidelně
 * (čtvrtletně), ať se do souboru propíší přejmenování a zániky firem.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidIsin } from '@danero/shared';
import { ISIN_DIRECTORY, type IsinDirectoryRecord } from '../src/isin-directory/data';
import {
  defaultCacheFile,
  eligibleRecord,
  fetchLatestGleifIsins,
  gleifIsinsFromCsv,
  listingsFromOpenFigi,
  recordsFromListings,
  uniqueTickers,
  type FigiAnswer,
  type FigiBatch,
  type ListedRecord,
} from './isin-directory-gleif';
import {
  MARKET_CODES,
  MARKETS,
  normalizeTicker,
  type MarketCode,
} from '../src/isin-directory/markets';

const OUTPUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'isin-directory',
  'data.ts',
);
const ENDPOINT = 'https://query.wikidata.org/sparql';
/** Wikimedia chce v User-Agent kontakt — odkaz na repozitář projektu. */
const USER_AGENT = 'DaneroIsinDirectory/1.0 (https://github.com/dundejan/danero)';

const OPENFIGI_ENDPOINT = 'https://api.openfigi.com/v3/mapping';

/**
 * Druhy cenných papírů z OpenFIGI, které do číselníku smí. Preferenční akcie
 * (CHSCP), warranty, dluhopisy ani fondy sem nepatří — ticker by vedl jinam
 * než na kmenovou akcii.
 */
export const ALLOWED_SECURITY_TYPES = new Set([
  'Common Stock',
  'ADR',
  'GDR',
  'NY Reg Shrs',
  'REIT',
  'MLP',
  // ETF: na eToro běžné (VUSA.L); s americkým fondem se nesplete, hledá se
  // vždy na konkrétní burze
  'ETP',
]);

/** Burza ve Wikidatech → trh číselníku. */
const MARKET_BY_EXCHANGE = new Map<string, MarketCode>(
  MARKET_CODES.flatMap((code) => MARKETS[code].wikidata.map((qid) => [qid, code] as const)),
);

/** Kolik tickerů a ISIN jedné položky na jednom trhu ještě zkoušíme spárovat. */
const MAX_TICKERS = 3;
const MAX_ISINS = 4;

const QUERY = `
SELECT ?item ?label ?exchange ?ticker ?listingRank ?listingEnd ?isin ?isinRank ?isinEnd ?ended WHERE {
  VALUES ?exchange { ${[...MARKET_BY_EXCHANGE.keys()].map((qid) => `wd:${qid}`).join(' ')} }
  ?item p:P414 ?listing .
  ?listing ps:P414 ?exchange ; pq:P249 ?ticker ; wikibase:rank ?listingRank .
  OPTIONAL { ?listing pq:P582 ?listingEnd }
  ?item p:P946 ?isinStatement .
  ?isinStatement ps:P946 ?isin ; wikibase:rank ?isinRank .
  OPTIONAL { ?isinStatement pq:P582 ?isinEnd }
  BIND(EXISTS { ?item wdt:P576|wdt:P1366|wdt:P2669|wdt:P749 ?gone } AS ?ended)
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
}`;

const DEPRECATED = 'http://wikiba.se/ontology#DeprecatedRank';

/**
 * Americký ISIN AKCIE: `US` + CUSIP + kontrolní číslice. Dvě znaky za šestimístným
 * kódem emitenta jsou číslo emise — u akcií a fondů číslice, u dluhopisů
 * písmena. Wikidata u firmy občas vedou i ISIN dluhopisu (Paramount Global
 * měl `US124857AK99`, což jsou směnky CBS), ten se brát nesmí.
 */
export const isUsEquityIsin = (isin: string): boolean =>
  /^US[A-Z0-9]{6}\d{2}[A-Z0-9]\d$/.test(isin) && isValidIsin(isin);

/** ISIN, který do číselníku smí: platný, a když je americký, tak akcie. */
export const isEquityIsin = (isin: string): boolean =>
  isValidIsin(isin) && (!isin.startsWith('US') || isUsEquityIsin(isin));

interface SparqlRow {
  item: { value: string };
  label?: { value: string };
  /** Burza (P414) — URI položky ve Wikidatech. */
  exchange: { value: string };
  ticker: { value: string };
  listingRank: { value: string };
  listingEnd?: { value: string };
  isin: { value: string };
  isinRank: { value: string };
  isinEnd?: { value: string };
  /** Firma zanikla (P576), byla nahrazena (P1366), ukončena (P2669) nebo má mateřskou (P749). */
  ended?: { value: string };
}

interface ItemFacts {
  qid: string;
  label: string | undefined;
  /** Tickery v jednotném tvaru po trzích. */
  tickers: Map<MarketCode, Set<string>>;
  isins: Set<string>;
  ended: boolean;
}

async function fetchRows(): Promise<SparqlRow[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(QUERY)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
  });
  if (!response.ok)
    throw new Error(`Wikidata odpověděla ${response.status} ${response.statusText}`);
  const body = (await response.json()) as { results: { bindings: SparqlRow[] } };
  return body.results.bindings;
}

/**
 * Kandidátní dvojice z Wikidat po vyřazovacích pravidlech (viz hlavička
 * souboru). Jednoznačnost se tu NEhlídá — rozhoduje až ověření
 * (`verifyWithOpenFigi`) a výběr (`selectUnambiguous`).
 */
export function candidatesFrom(rows: SparqlRow[]): {
  records: IsinDirectoryRecord[];
  excluded: Record<string, number>;
} {
  const items = new Map<string, ItemFacts>();
  const excluded: Record<string, number> = {};
  const exclude = (reason: string): void => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };
  for (const row of rows) {
    const qid = row.item.value.replace('http://www.wikidata.org/entity/', '');
    const market = MARKET_BY_EXCHANGE.get(row.exchange.value.replace('http://www.wikidata.org/entity/', ''));
    const facts = items.get(qid) ?? {
      qid,
      label: undefined,
      tickers: new Map(),
      isins: new Set(),
      ended: false,
    };
    facts.label ??= row.label?.value;
    if (row.ended?.value === 'true') facts.ended = true;
    if (market && row.listingRank.value !== DEPRECATED && !row.listingEnd) {
      const ticker = normalizeTicker(market, row.ticker.value);
      const known = facts.tickers.get(market) ?? new Set<string>();
      if (ticker) facts.tickers.set(market, known.add(ticker));
      else {
        exclude('ticker neodpovídá tvaru trhu');
        facts.tickers.set(market, known);
      }
    }
    if (row.isinRank.value !== DEPRECATED && !row.isinEnd) {
      facts.isins.add(row.isin.value.trim().toUpperCase());
    }
    items.set(qid, facts);
  }

  const records: IsinDirectoryRecord[] = [];
  for (const facts of items.values()) {
    const isins = [...facts.isins].filter(isEquityIsin);
    // Zaniklá nebo převzatá firma: její ticker burza časem přidělí jinému
    // emitentovi a starý ISIN by se mu potichu přiřadil (VMW, FRC, SPLK…).
    if (facts.ended) {
      exclude('firma zanikla, byla nahrazena nebo převzata');
      continue;
    }
    if (!facts.label) {
      exclude('bez anglického názvu');
      continue;
    }
    if (isins.length === 0) {
      exclude('bez platného ISIN akcie');
      continue;
    }
    if (isins.length > MAX_ISINS) {
      exclude('příliš mnoho ISIN u jedné položky');
      continue;
    }
    for (const [market, tickers] of facts.tickers) {
      if (tickers.size === 0) exclude('výpis ukončený, zastaralý nebo bez platného tickeru');
      else if (tickers.size > MAX_TICKERS) exclude('příliš mnoho tickerů u jedné položky');
      else {
        for (const ticker of tickers) {
          for (const isin of isins) {
            records.push({ market, ticker, isin, name: facts.label, source: `wikidata:${facts.qid}` });
          }
        }
      }
    }
  }
  return { records, excluded };
}

/**
 * Z ověřených dvojic jen ty jednoznačné: na trhu ticker → jeden ISIN. Tatáž
 * dvojice z víc zdrojů nebo položek se vezme jednou — první (záznamy
 * z Wikidat jdou napřed, mají hezčí název). Jeden ISIN pod víc tickery na
 * témže trhu nevadí: ETF se v Londýně kotuje v librách i dolarech (VUSA,
 * VUSD) a hledá se vždy podle tickeru.
 */
export function selectUnambiguous(verified: readonly IsinDirectoryRecord[]): {
  records: IsinDirectoryRecord[];
  excluded: Record<string, number>;
} {
  const excluded: Record<string, number> = {};
  const isinsByTicker = new Map<string, Set<string>>();
  for (const record of verified) {
    const ticker = `${record.market}|${record.ticker}`;
    isinsByTicker.set(ticker, (isinsByTicker.get(ticker) ?? new Set()).add(record.isin));
  }
  const records: IsinDirectoryRecord[] = [];
  const seen = new Set<string>();
  for (const record of verified) {
    const ticker = `${record.market}|${record.ticker}`;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    if (isinsByTicker.get(ticker)!.size > 1) {
      excluded['ticker vede na víc ISIN'] = (excluded['ticker vede na víc ISIN'] ?? 0) + 1;
    } else records.push(record);
  }
  return { records, excluded };
}

type FigiFetch = FigiBatch;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dotaz na OpenFIGI s trpělivým opakováním při překročení limitu (HTTP 429)
 * a při chybě serveru (5xx) — jedna výpadková odpověď nesmí shodit
 * půlhodinový běh.
 */
function openFigiFetch(apiKey: string | undefined): FigiFetch {
  return async (jobs) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(OPENFIGI_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
            ...(apiKey ? { 'X-OPENFIGI-APIKEY': apiKey } : {}),
          },
          body: JSON.stringify(jobs),
        });
      } catch (error) {
        // výpadek sítě (10. 11. 2026: ENETUNREACH uprostřed běhu) — počkat a zkusit znovu
        console.warn(`OpenFIGI: spojení selhalo (${error instanceof Error ? error.message : String(error)}), zkusím to znovu…`);
        await sleep(15_000 * (attempt + 1));
        continue;
      }
      if (response.status === 429) {
        console.warn('OpenFIGI: limit dotazů, čekám minutu…');
        await sleep(61_000);
        continue;
      }
      if (response.status >= 500) {
        console.warn(`OpenFIGI: chyba serveru ${response.status}, zkusím to znovu…`);
        await sleep(10_000 * (attempt + 1));
        continue;
      }
      if (!response.ok)
        throw new Error(`OpenFIGI odpověděla ${response.status} ${response.statusText}`);
      return (await response.json()) as FigiAnswer[];
    }
    throw new Error('OpenFIGI: odpověď se nepodařilo získat ani na šestý pokus');
  };
}

/**
 * Ověření kandidátů přes OpenFIGI: ISIN na burze trhu (`exchCode` z
 * `markets.ts`, v USA `US`) musí vést na FIGI se stejným tickerem (v jednotném
 * tvaru trhu — OpenFIGI píše londýnské `BA/` a hongkongské bez nul) a povoleným
 * druhem cenného papíru. Vrací ověřené záznamy a důvody vyřazení ostatních.
 */
export async function verifyWithOpenFigi(
  records: readonly IsinDirectoryRecord[],
  fetchBatch: FigiFetch,
  { batchSize = 10, pauseMs = 0 }: { batchSize?: number; pauseMs?: number } = {},
): Promise<{
  records: ListedRecord[];
  rejected: Array<{ record: IsinDirectoryRecord; reason: string }>;
}> {
  const verified: ListedRecord[] = [];
  const rejected: Array<{ record: IsinDirectoryRecord; reason: string }> = [];
  for (let start = 0; start < records.length; start += batchSize) {
    const chunk = records.slice(start, start + batchSize);
    const answers = await fetchBatch(
      chunk.map((record) => ({
        idType: 'ID_ISIN',
        idValue: record.isin,
        exchCode: MARKETS[record.market].openFigiExchCode,
      })),
    );
    chunk.forEach((record, index) => {
      const entries = answers[index]?.data ?? [];
      const sameTicker = entries.filter(
        (entry) => normalizeTicker(record.market, entry.ticker ?? '') === record.ticker,
      );
      if (entries.length === 0)
        rejected.push({ record, reason: 'OpenFIGI ISIN na burze trhu nezná' });
      else if (sameTicker.length === 0) {
        const tickers = [...new Set(entries.map((entry) => entry.ticker))].join(', ');
        rejected.push({ record, reason: `OpenFIGI vede ISIN na jiný ticker (${tickers})` });
      } else if (
        !sameTicker.some((entry) => ALLOWED_SECURITY_TYPES.has(entry.securityType ?? ''))
      ) {
        rejected.push({
          record,
          reason: `druh cenného papíru ${sameTicker[0]!.securityType ?? '?'}`,
        });
      } else verified.push({ ...record, figiTicker: sameTicker[0]!.ticker! });
    });
    if (pauseMs > 0 && start + batchSize < records.length) await sleep(pauseMs);
  }
  return { records: verified, rejected };
}

/** Zdroj záznamu pro pojistku: Wikidata, nebo GLEIF. */
const sourceKind = (record: IsinDirectoryRecord): 'wikidata' | 'gleif' =>
  record.source === 'gleif' ? 'gleif' : 'wikidata';

/**
 * Pojistka proti výpadku nebo změně API, které by tiše vyprázdnily soubor:
 * na každém trhu a z každého zdroje, který tenhle běh opravdu prošel, musí
 * zůstat aspoň 80 % stávajících záznamů. Zdroj, který se vynechal
 * (`--no-gleif`, běh bez klíče), se nehlídá — jeho záznamy pak v souboru
 * nebudou, což skript vypíše jako odebrané. Vrací popis problému, nebo null.
 */
export function sanityProblem(
  before: readonly IsinDirectoryRecord[],
  after: readonly IsinDirectoryRecord[],
  sources: ReadonlySet<'wikidata' | 'gleif'>,
): string | null {
  for (const kind of sources) {
    for (const market of MARKET_CODES) {
      const was = before.filter((record) => record.market === market && sourceKind(record) === kind).length;
      const now = after.filter((record) => record.market === market && sourceKind(record) === kind).length;
      if (was >= 10 && now < was * 0.8) {
        return `zdroj ${kind} na trhu ${market}: jen ${now} záznamů (dřív ${was}) — podezřelé, soubor nepřepisuji.`;
      }
    }
  }
  return null;
}

/** Změny proti stávajícímu souboru — jen pro výpis, soubor se sestavuje znovu. */
export function diffRecords(
  existing: readonly IsinDirectoryRecord[],
  fresh: readonly IsinDirectoryRecord[],
): { added: string[]; removed: string[]; changed: string[] } {
  const key = (record: IsinDirectoryRecord): string => `${record.market}|${record.ticker}`;
  const before = new Map(existing.map((record) => [key(record), record]));
  const after = new Map(fresh.map((record) => [key(record), record]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, record] of after) {
    const old = before.get(id);
    if (!old) added.push(`${record.ticker} ${record.isin} (${record.name})`);
    else if (old.isin !== record.isin)
      changed.push(`${record.ticker}: ${old.isin} → ${record.isin}`);
  }
  for (const [id, record] of before) {
    if (!after.has(id)) removed.push(`${record.ticker} ${record.isin} (${record.name})`);
  }
  return { added, removed, changed };
}

export const sortRecords = (records: readonly IsinDirectoryRecord[]): IsinDirectoryRecord[] =>
  [...records].sort((a, b) => `${a.market}|${a.ticker}`.localeCompare(`${b.market}|${b.ticker}`));

/**
 * Obsah `data.ts`. Řádky jsou n-tice prostých řetězců seskupené po trzích
 * a trh doplní až kód: dva tisíce objektů s trhem jako řetězcovým literálem
 * TypeScript nezvládne („union type that is too complex“, TS2590).
 */
export function renderDataFile(records: readonly IsinDirectoryRecord[]): string {
  const groups = MARKET_CODES.flatMap((market) => {
    const rows = records.filter((record) => record.market === market);
    if (rows.length === 0) return [];
    return [
      `  ${market}: [`,
      ...rows.map(
        (record) =>
          `    [${JSON.stringify(record.ticker)}, ${JSON.stringify(record.isin)}, ${JSON.stringify(record.name)}, ${JSON.stringify(record.source)}],`,
      ),
      '  ],',
    ];
  });
  return [
    '/**',
    ' * Vestavěný číselník ISIN — VYGENEROVÁNO skriptem',
    ' * `scripts/build-isin-directory.ts`, ručně neupravovat (soubor se při',
    ' * každém běhu sestaví znovu).',
    ' *',
    ' * Zdroje: Wikidata (https://www.wikidata.org, CC0 1.0), každá dvojice',
    ' * ověřená přes OpenFIGI; a ISIN ze souboru ISIN–LEI od GLEIF',
    ' * (https://www.gleif.org) s burzou a tickerem z OpenFIGI',
    ' * (https://www.openfigi.com) — `source: "gleif"`.',
    ' */',
    '',
    "import type { MarketCode } from './markets';",
    '',
    'export interface IsinDirectoryRecord {',
    '  market: MarketCode;',
    '  ticker: string;',
    '  isin: string;',
    '  name: string;',
    '  /** Odkud záznam je, např. `wikidata:Q312`. */',
    '  source: string;',
    '}',
    '',
    '/** Ticker, ISIN, název, zdroj. */',
    'type Row = readonly [ticker: string, isin: string, name: string, source: string];',
    '',
    '// prettier-ignore',
    'const ROWS: Partial<Record<MarketCode, readonly Row[]>> = {',
    ...groups,
    '};',
    '',
    'export const ISIN_DIRECTORY: readonly IsinDirectoryRecord[] = (',
    '  Object.entries(ROWS) as Array<[MarketCode, readonly Row[]]>',
    ').flatMap(([market, rows]) =>',
    '  rows.map(([ticker, isin, name, source]) => ({ market, ticker, isin, name, source })),',
    ');',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const apiKey = process.env.OPENFIGI_API_KEY || undefined;
  const rows = await fetchRows();
  const { records: candidates, excluded } = candidatesFrom(rows);
  console.log(`Wikidata: ${rows.length} řádků, ${candidates.length} kandidátních dvojic.`);
  for (const [reason, count] of Object.entries(excluded))
    console.log(`  vyřazeno (${reason}): ${count}`);

  console.log(
    `OpenFIGI: ověřuji ${candidates.length} dvojic${apiKey ? ' (s klíčem)' : ' (bez klíče, potrvá to)'}…`,
  );
  const { records: confirmed, rejected } = await verifyWithOpenFigi(
    candidates,
    openFigiFetch(apiKey),
    {
      batchSize: apiKey ? 100 : 10,
      pauseMs: apiKey ? 300 : 2_600,
    },
  );
  const reasons = new Map<string, number>();
  for (const { reason } of rejected) {
    const kind = reason.replace(/ \(.*\)$/, '');
    reasons.set(kind, (reasons.get(kind) ?? 0) + 1);
  }
  for (const [reason, count] of reasons) console.log(`  vyřazeno (${reason}): ${count}`);
  // Druhý zdroj: GLEIF + kotace z OpenFIGI (viz isin-directory-gleif.ts).
  // Bez klíče by dotazy na ~500 000 ISIN trvaly dny — pak se přeskočí.
  const fromGleif: ListedRecord[] = [];
  const sources = new Set<'wikidata' | 'gleif'>(['wikidata']);
  if (process.argv.includes('--no-gleif')) console.log('GLEIF: přeskočeno (--no-gleif).');
  else if (!apiKey) console.log('GLEIF: přeskočeno — bez OPENFIGI_API_KEY by běh trval dny.');
  else {
    const csvArg = process.argv.indexOf('--gleif-csv');
    const isins =
      csvArg > 0 && process.argv[csvArg + 1]
        ? await gleifIsinsFromCsv(process.argv[csvArg + 1]!)
        : await fetchLatestGleifIsins(USER_AGENT);
    console.log(`GLEIF: ${isins.length} ISIN po předvýběru.`);
    const listings = await listingsFromOpenFigi(isins, openFigiFetch(apiKey), {
      cacheFile: defaultCacheFile(),
    });
    for (const [isin, entries] of listings) {
      fromGleif.push(...recordsFromListings(isin, entries, ALLOWED_SECURITY_TYPES));
    }
    console.log(`GLEIF: ${fromGleif.length} kotací na trzích číselníku.`);
    sources.add('gleif');
  }
  let candidatesAll: ListedRecord[] = [...confirmed, ...fromGleif];
  // Zpětná kontrola tickeru (viz `uniqueTickers`) — s klíčem je to pár desítek
  // vteřin, bez něj by trvala dlouho, a pak zůstane jen kontrola mezi záznamy.
  if (apiKey) {
    const unique = await uniqueTickers(candidatesAll, openFigiFetch(apiKey));
    const why = new Map<string, number>();
    for (const { reason } of unique.rejected) why.set(reason, (why.get(reason) ?? 0) + 1);
    for (const [reason, count] of why) console.log(`  vyřazeno zpětnou kontrolou (${reason}): ${count}`);
    candidatesAll = unique.records;
  }
  const { records: verified, excluded: ambiguous } = selectUnambiguous(candidatesAll);
  for (const [reason, count] of Object.entries(ambiguous))
    console.log(`  vyřazeno po ověření (${reason}): ${count}`);

  // srovnává se jen s tím, co by do souboru smělo i podle dnešních pravidel
  const problem = sanityProblem(ISIN_DIRECTORY.filter(eligibleRecord), verified, sources);
  if (problem) throw new Error(problem);
  const records = sortRecords(verified);
  const { added, removed, changed } = diffRecords(ISIN_DIRECTORY, records);
  console.log(
    `Soubor: dřív ${ISIN_DIRECTORY.length}, teď ${records.length} (+${added.length} / −${removed.length} / změněno ${changed.length}).`,
  );
  for (const line of added) console.log(`  + ${line}`);
  for (const line of removed) console.log(`  − ${line}`);
  for (const line of changed) console.log(`  ~ ${line}`);
  if (dryRun) return;
  writeFileSync(OUTPUT, renderDataFile(records));
  console.log(`Zapsáno: ${OUTPUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
