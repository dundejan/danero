/**
 * Generátor vestavěného číselníku ISIN (`src/isin-directory/data.ts`).
 *
 * Spouští se ručně, ne při buildu ani za běhu aplikace:
 *
 *   pnpm --filter @danero/importers isin-directory            # stáhne a zapíše
 *   pnpm --filter @danero/importers isin-directory --dry-run  # jen vypíše, co by se změnilo
 *
 * Zdroj: Wikidata (query.wikidata.org), data pod CC0 1.0 — položky s ISIN
 * (P946) a výpisem na NYSE nebo Nasdaqu (P414) s kvalifikátorem ticker (P249).
 *
 * Do souboru jde jen JEDNOZNAČNÁ dvojice ticker → ISIN. Vyřazuje se:
 * - firma, která zanikla (P576), byla nahrazena (P1366), ukončena (P2669) nebo
 *   má mateřskou společnost (P749 — převzatá firma, VMware pod Broadcomem):
 *   její ticker burza časem přidělí jinému emitentovi. Wikidata převzetí
 *   nezapíšou vždy hned (Juniper, Hess), takže úplná ochrana to není — proto
 *   import každou doplněnou dvojici ukládá do číselníku uživatele, kde ji vidí
 *   a může opravit,
 * - výpis nebo ISIN s koncem (P582) či zastaralým hodnocením (deprecated),
 * - ticker, který není jen 1–5 písmen (třídy BRK.B, preferované akcie),
 * - položka, která nemá PRÁVĚ JEDEN platný americký ISIN akcie (prefix US,
 *   číselné číslo emise — dluhopisy mají písmena — a sedící kontrolní číslice). Wikidata u položky nepíšou, ke kterému tickeru
 *   který ISIN patří — Alphabet má oba (GOOG i GOOGL) a přiřadit je nejde.
 *   Zahraniční ISIN (ADR vs. domácí akcie) se nebere vůbec: ticker TSM na NYSE
 *   je ADR s jiným ISIN než tchajwanská akcie, kterou má položka TSMC.
 * - položka s víc tickery na amerických burzách (zase třídy akcií),
 * - ticker, který napříč položkami vede na víc ISIN, a ISIN s víc tickery.
 *
 * Wikidata samy nestačí: revize 15. 10. 2026 v nich našla 20 % chyb — ISIN
 * jiného emitenta (TT → ISIN Ingersoll Rand, CB → stará Chubb Corp,
 * recyklované tickery LB, TEN…), zastaralý ISIN téže firmy (XOM) a tickery,
 * které emitent už nepoužívá. Každý kandidát proto projde OVĚŘENÍM PŘES
 * OpenFIGI (`verifyWithOpenFigi`): dotaz na ISIN na amerických burzách musí
 * vrátit FIGI se STEJNÝM tickerem a druhem cenného papíru ze seznamu
 * `ALLOWED_SECURITY_TYPES`. Z odpovědi se bere jen ano/ne, nic se z ní
 * neukládá. Volá se jen při ručním běhu skriptu; bez klíče platí limit
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
export const ALLOWED_SECURITY_TYPES = new Set(['Common Stock', 'ADR', 'REIT', 'MLP']);

/** NYSE (Q13677) a Nasdaq (Q82059). */
const QUERY = `
SELECT ?item ?label ?ticker ?listingRank ?listingEnd ?isin ?isinRank ?isinEnd ?ended WHERE {
  VALUES ?exchange { wd:Q13677 wd:Q82059 }
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
const US_TICKER = /^[A-Z]{1,5}$/;

interface SparqlRow {
  item: { value: string };
  label?: { value: string };
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
  tickers: Set<string>;
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

/** Kandidáti z Wikidat po všech vyřazovacích pravidlech (viz hlavička souboru). */
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
    const facts = items.get(qid) ?? {
      qid,
      label: undefined,
      tickers: new Set(),
      isins: new Set(),
      ended: false,
    };
    facts.label ??= row.label?.value;
    if (row.ended?.value === 'true') facts.ended = true;
    if (row.listingRank.value !== DEPRECATED && !row.listingEnd)
      facts.tickers.add(row.ticker.value);
    if (row.isinRank.value !== DEPRECATED && !row.isinEnd) {
      facts.isins.add(row.isin.value.trim().toUpperCase());
    }
    items.set(qid, facts);
  }

  const proposed: IsinDirectoryRecord[] = [];
  for (const facts of items.values()) {
    const usIsins = [...facts.isins].filter(isUsEquityIsin);
    const tickers = [...facts.tickers];
    // Zaniklá nebo převzatá firma: její ticker burza časem přidělí jinému
    // emitentovi a starý ISIN by se mu potichu přiřadil (VMW, FRC, SPLK…).
    if (facts.ended) exclude('firma zanikla, byla nahrazena nebo převzata');
    else if (tickers.length === 0) exclude('výpis ukončený nebo zastaralý');
    else if (usIsins.length !== 1)
      exclude(usIsins.length === 0 ? 'bez platného US ISIN' : 'víc US ISIN u jedné položky');
    else if (tickers.length !== 1) exclude('víc tickerů u jedné položky');
    else if (!US_TICKER.test(tickers[0]!)) exclude('ticker není jen písmena');
    else if (!facts.label) exclude('bez anglického názvu');
    else {
      proposed.push({
        market: 'US',
        ticker: tickers[0]!,
        isin: usIsins[0]!,
        name: facts.label,
        source: `wikidata:${facts.qid}`,
      });
    }
  }

  // jednoznačnost napříč položkami: ticker → jeden ISIN, ISIN → jeden ticker
  const isinsByTicker = new Map<string, Set<string>>();
  const tickersByIsin = new Map<string, Set<string>>();
  for (const record of proposed) {
    isinsByTicker.set(
      record.ticker,
      (isinsByTicker.get(record.ticker) ?? new Set()).add(record.isin),
    );
    tickersByIsin.set(
      record.isin,
      (tickersByIsin.get(record.isin) ?? new Set()).add(record.ticker),
    );
  }
  const records: IsinDirectoryRecord[] = [];
  const seen = new Set<string>();
  for (const record of proposed) {
    if (isinsByTicker.get(record.ticker)!.size > 1) exclude('ticker vede na víc ISIN');
    else if (tickersByIsin.get(record.isin)!.size > 1) exclude('ISIN má víc tickerů');
    else if (!seen.has(record.ticker)) {
      seen.add(record.ticker);
      records.push(record);
    }
  }
  return { records, excluded };
}

interface FigiEntry {
  ticker?: string;
  securityType?: string;
}

type FigiFetch = (jobs: Array<Record<string, string>>) => Promise<Array<{ data?: FigiEntry[] }>>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Dotaz na OpenFIGI s trpělivým opakováním při překročení limitu (HTTP 429). */
function openFigiFetch(apiKey: string | undefined): FigiFetch {
  return async (jobs) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(OPENFIGI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          ...(apiKey ? { 'X-OPENFIGI-APIKEY': apiKey } : {}),
        },
        body: JSON.stringify(jobs),
      });
      if (response.status === 429) {
        console.warn('OpenFIGI: limit dotazů, čekám minutu…');
        await sleep(61_000);
        continue;
      }
      if (!response.ok)
        throw new Error(`OpenFIGI odpověděla ${response.status} ${response.statusText}`);
      return (await response.json()) as Array<{ data?: FigiEntry[] }>;
    }
    throw new Error('OpenFIGI: limit dotazů se nepodařilo přečkat');
  };
}

/**
 * Ověření kandidátů přes OpenFIGI: ISIN na amerických burzách (`exchCode: US`)
 * musí vést na FIGI se stejným tickerem a povoleným druhem cenného papíru.
 * Vrací ověřené záznamy a důvody vyřazení ostatních.
 */
export async function verifyWithOpenFigi(
  records: readonly IsinDirectoryRecord[],
  fetchBatch: FigiFetch,
  { batchSize = 10, pauseMs = 0 }: { batchSize?: number; pauseMs?: number } = {},
): Promise<{
  records: IsinDirectoryRecord[];
  rejected: Array<{ record: IsinDirectoryRecord; reason: string }>;
}> {
  const verified: IsinDirectoryRecord[] = [];
  const rejected: Array<{ record: IsinDirectoryRecord; reason: string }> = [];
  for (let start = 0; start < records.length; start += batchSize) {
    const chunk = records.slice(start, start + batchSize);
    const answers = await fetchBatch(
      chunk.map((record) => ({ idType: 'ID_ISIN', idValue: record.isin, exchCode: 'US' })),
    );
    chunk.forEach((record, index) => {
      const entries = answers[index]?.data ?? [];
      const sameTicker = entries.filter((entry) => entry.ticker === record.ticker);
      if (entries.length === 0)
        rejected.push({ record, reason: 'OpenFIGI ISIN na US burzách nezná' });
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
      } else verified.push(record);
    });
    if (pauseMs > 0 && start + batchSize < records.length) await sleep(pauseMs);
  }
  return { records: verified, rejected };
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

export function renderDataFile(records: readonly IsinDirectoryRecord[]): string {
  const lines = records.map(
    (record) =>
      `  { market: 'US', ticker: '${record.ticker}', isin: '${record.isin}', name: ${JSON.stringify(record.name)}, source: '${record.source}' },`,
  );
  return [
    '/**',
    ' * Vestavěný číselník ISIN — VYGENEROVÁNO skriptem',
    ' * `scripts/build-isin-directory.ts`, ručně neupravovat (soubor se při',
    ' * každém běhu sestaví znovu).',
    ' *',
    ' * Zdroj: Wikidata (https://www.wikidata.org), data pod licencí CC0 1.0;',
    ' * každá dvojice ověřená přes OpenFIGI (https://www.openfigi.com).',
    ' */',
    '',
    'export interface IsinDirectoryRecord {',
    "  market: 'US';",
    '  ticker: string;',
    '  isin: string;',
    '  name: string;',
    '  /** Odkud záznam je, např. `wikidata:Q312`. */',
    '  source: string;',
    '}',
    '',
    '// prettier-ignore',
    'export const ISIN_DIRECTORY: readonly IsinDirectoryRecord[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const apiKey = process.env.OPENFIGI_API_KEY || undefined;
  const rows = await fetchRows();
  const { records: candidates, excluded } = candidatesFrom(rows);
  console.log(`Wikidata: ${rows.length} řádků, ${candidates.length} jednoznačných dvojic.`);
  for (const [reason, count] of Object.entries(excluded))
    console.log(`  vyřazeno (${reason}): ${count}`);

  console.log(
    `OpenFIGI: ověřuji ${candidates.length} dvojic${apiKey ? ' (s klíčem)' : ' (bez klíče, potrvá to)'}…`,
  );
  const { records: verified, rejected } = await verifyWithOpenFigi(
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

  // Výpadek nebo změna API by jinak tiše vyprázdnila soubor.
  if (verified.length < candidates.length / 2) {
    throw new Error(
      `OpenFIGI ověřila jen ${verified.length} z ${candidates.length} dvojic — podezřelé, soubor nepřepisuji.`,
    );
  }
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
