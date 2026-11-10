/**
 * Druhý zdroj vestavěného číselníku ISIN: soubor GLEIF „ISIN-to-LEI
 * relationship“ (ISIN přidělené firmám s LEI, denně, zveřejňovaný jako open
 * source; data GLEIF jsou pod CC0) a k němu z OpenFIGI, na které burze a pod
 * jakým tickerem se ISIN obchoduje.
 *
 * Proč: Wikidata znají ISIN jen u ~10 000 firem a burzovní ticker u ~6 000.
 * GLEIF má 9,5 milionu ISIN od ~100 000 firem — většinou dluhopisy
 * a strukturované produkty, mezi nimi ale akcie a ETF skoro všech
 * evropských a amerických emitentů. Chybí země, jejichž agentury do mapování
 * nepřispívají (Japonsko, Austrálie, část Kajmanských ostrovů) — ty kryjí
 * Wikidata.
 *
 * Z odpovědi OpenFIGI se bere ticker a burza (fakta o kotaci) a název
 * titulu; identifikátory FIGI se neukládají.
 */
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import JSZip from 'jszip';
import type { IsinDirectoryRecord } from '../src/isin-directory/data';
import { MARKET_CODES, MARKETS, normalizeTicker, type MarketCode } from '../src/isin-directory/markets';

const GLEIF_LIST = 'https://mapping.gleif.org/api/v2/isin-lei';

/** Americký ISIN akcie nebo fondu: číslo emise číselné (dluhopisy mají písmena). */
const US_EQUITY_SHAPE = /^US[A-Z0-9]{6}\d{2}[A-Z0-9]\d$/;

/**
 * Firmy s víc ISIN než tolik jsou vydavatelé strukturovaných produktů
 * (německé certifikáty bank jdou do milionů). Jejich akcie pokryjí Wikidata
 * — velké firmy kvůli dluhopisům mají stovky až nižší tisíce ISIN.
 */
export const MAX_ISINS_PER_ISSUER = 5000;

/**
 * Předvýběr ISIN, které stojí za dotaz na OpenFIGI: bez eurobondů (`XS`, `EU`
 * — mezinárodní dluhopisy, nikdy akcie), z amerických jen tvar akcie či
 * fondu a bez emitentů strukturovaných produktů (víc než
 * `MAX_ISINS_PER_ISSUER` ostatních ISIN). Z 9,5 milionu zbude ~500 000.
 *
 * Běží proudově: od emitenta, který limit překročí, se ISIN přestanou držet
 * — celý soubor v paměti by stál přes gigabajt.
 */
export function createPrefilter(): {
  add: (lei: string, isin: string) => void;
  result: () => string[];
} {
  const byIssuer = new Map<string, string[] | null>();
  const usEquities = new Set<string>();
  return {
    add(lei, isin) {
      const country = isin.slice(0, 2);
      if (country === 'XS' || country === 'EU') return;
      if (country === 'US') {
        if (US_EQUITY_SHAPE.test(isin)) usEquities.add(isin);
        return;
      }
      const list = byIssuer.get(lei);
      if (list === null) return;
      if (!list) byIssuer.set(lei, [isin]);
      else if (list.length >= MAX_ISINS_PER_ISSUER) byIssuer.set(lei, null);
      else list.push(isin);
    },
    result() {
      const kept = new Set(usEquities);
      for (const list of byIssuer.values()) for (const isin of list ?? []) kept.add(isin);
      return [...kept];
    },
  };
}

/** Předvýběr nad hotovým seznamem dvojic (LEI, ISIN) — viz `createPrefilter`. */
export function prefilterIsins(rows: Iterable<readonly [lei: string, isin: string]>): string[] {
  const prefilter = createPrefilter();
  for (const [lei, isin] of rows) prefilter.add(lei, isin);
  return prefilter.result();
}

/** Kotace z odpovědi OpenFIGI (jen pole, která generátor potřebuje). */
export interface FigiListing {
  ticker?: string;
  exchCode?: string;
  securityType?: string;
  name?: string;
  figi?: string;
  compositeFIGI?: string;
  shareClassFIGI?: string;
}

/** Odpověď OpenFIGI na jeden dotaz: data, nebo varování „nic nenalezeno“, nebo chyba. */
export interface FigiAnswer {
  data?: FigiListing[];
  warning?: string;
  error?: string;
}

/**
 * Záznam číselníku s tickerem tak, jak ho píše OpenFIGI (`BA/`, `5`) — pro
 * zpětnou kontrolu jednoznačnosti (`uniqueTickers`); do souboru nejde.
 */
export type ListedRecord = IsinDirectoryRecord & { figiTicker: string };

/**
 * Burzy v USA, kde je titul opravdu kotovaný. Kód `US` (souhrnný) zahrnuje
 * i mimoburzovní trh (`UV`, `PQ`) — zahraniční akcie tam mají tickery jako
 * TSCDF (Tesco), které žádný broker v Daneru nepoužívá.
 */
export const US_LISTING_EXCHANGES = new Set(['UN', 'UW', 'UQ', 'UR', 'UA', 'UP', 'UF']);

/** Kód burzy OpenFIGI → trh číselníku. */
const MARKET_BY_FIGI_EXCHANGE = new Map<string, MarketCode>(
  MARKET_CODES.map((code) => [MARKETS[code].openFigiExchCode, code]),
);

/**
 * Londýnská mezinárodní kniha (IOB): zahraniční akcie pod kódy `0R0X`
 * (Tesla), `0A0T`… ISIN mají správný, ale eToro je nepoužívá — jen by
 * přidávaly šum a plochu pro kolize.
 */
const LSE_ORDER_BOOK = /^0[A-Z0-9]{3}$/;

/**
 * Smí záznam podle dnešních pravidel do číselníku? Pro pojistku generátoru:
 * záznam, který vypadl kvůli záměrné změně pravidel (mezinárodní kniha),
 * se nemá počítat jako podezřelý úbytek.
 */
export const eligibleRecord = (record: IsinDirectoryRecord): boolean =>
  !(record.market === 'LSE' && LSE_ORDER_BOOK.test(record.ticker));

/**
 * Záznamy číselníku z kotací jednoho ISIN: kotace na trzích číselníku
 * s povoleným druhem cenného papíru, ticker v jednotném tvaru trhu.
 * Americký ticker jen tehdy, když ho OpenFIGI vede i na burze z
 * `US_LISTING_EXCHANGES`; z Londýna bez mezinárodní knihy.
 */
export function recordsFromListings(
  isin: string,
  listings: readonly FigiListing[],
  allowedTypes: ReadonlySet<string>,
): ListedRecord[] {
  const listedInUs = new Set(
    listings
      .filter((entry) => US_LISTING_EXCHANGES.has(entry.exchCode ?? ''))
      .map((entry) => entry.ticker),
  );
  const records = new Map<string, ListedRecord>();
  for (const entry of listings) {
    const market = MARKET_BY_FIGI_EXCHANGE.get(entry.exchCode ?? '');
    if (!market || !allowedTypes.has(entry.securityType ?? '')) continue;
    if (market === 'US' && !listedInUs.has(entry.ticker)) continue;
    const ticker = normalizeTicker(market, entry.ticker ?? '');
    if (!ticker || (market === 'LSE' && LSE_ORDER_BOOK.test(ticker))) continue;
    const key = `${market}|${ticker}`;
    if (!records.has(key)) {
      records.set(key, {
        market,
        ticker,
        isin,
        name: (entry.name ?? '').trim() || ticker,
        source: 'gleif',
        figiTicker: entry.ticker!,
      });
    }
  }
  return [...records.values()];
}

/** Řádky CSV GLEIF (`LEI,ISIN`) do předvýběru. */
async function feedLines(input: NodeJS.ReadableStream): Promise<string[]> {
  const prefilter = createPrefilter();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    const [lei, isin] = line.split(',');
    if (lei && isin && lei !== 'LEI') prefilter.add(lei.trim(), isin.trim().toUpperCase());
  }
  return prefilter.result();
}

/**
 * Nejnovější soubor GLEIF → předvybrané ISIN. Archiv (~33 MB) se stáhne
 * celý, rozbalené CSV (~320 MB) se čte proudem.
 */
export async function fetchLatestGleifIsins(userAgent: string): Promise<string[]> {
  const list = (await (await fetch(GLEIF_LIST, { headers: { 'User-Agent': userAgent } })).json()) as {
    data: Array<{ attributes: { fileName: string; downloadLink: string; valid: boolean } }>;
  };
  const latest = list.data.find((item) => item.attributes.valid);
  if (!latest) throw new Error('GLEIF: v seznamu není platný soubor ISIN–LEI');
  console.log(`GLEIF: stahuji ${latest.attributes.fileName}…`);
  const response = await fetch(latest.attributes.downloadLink, { headers: { 'User-Agent': userAgent } });
  if (!response.ok) throw new Error(`GLEIF odpověděl ${response.status} ${response.statusText}`);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const entry = Object.values(zip.files).find((file) => file.name.endsWith('.csv'));
  if (!entry) throw new Error('GLEIF: v archivu není CSV');
  return feedLines(entry.nodeStream('nodebuffer'));
}

export type FigiBatch = (jobs: Array<Record<string, string>>) => Promise<FigiAnswer[]>;

interface PoolOptions {
  perMinute: number;
  concurrency: number;
}

/**
 * Dávky souběžně, ale nejvýš `perMinute` startů za minutu. Když jedna dávka
 * selže, ostatní workery přestanou brát další (jinak by běh po chybě dál
 * zatěžoval OpenFIGI) a chyba se předá dál.
 */
async function runPool<T>(chunks: readonly T[], task: (chunk: T) => Promise<void>, { perMinute, concurrency }: PoolOptions): Promise<void> {
  const spacing = 60_000 / perMinute;
  let nextStart = Date.now();
  let index = 0;
  let aborted = false;
  const worker = async (): Promise<void> => {
    while (!aborted && index < chunks.length) {
      const chunk = chunks[index]!;
      index += 1;
      const wait = nextStart - Date.now();
      nextStart = Math.max(nextStart, Date.now()) + spacing;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (aborted) return;
      try {
        await task(chunk);
      } catch (error) {
        aborted = true;
        throw error;
      }
    }
  };
  // Počkat i na rozběhnuté dávky: `Promise.all` by skončil s první chybou,
  // volající by zavřel mezipaměť a doběhnuvší dávka by zapisovala do
  // zavřeného souboru („write after end“ — chytil to test, ne provoz).
  const outcomes = await Promise.allSettled(Array.from({ length: concurrency }, worker));
  const failure = outcomes.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
}

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
};

/** Mezipaměť: řádek, který nejde přečíst (useknutý zápis při přerušení), se přeskočí. */
function readCache(cacheFile: string): Map<string, FigiListing[]> {
  const known = new Map<string, FigiListing[]>();
  if (!existsSync(cacheFile)) return known;
  for (const line of readFileSync(cacheFile, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const { isin, listings } = JSON.parse(line) as { isin: string; listings: FigiListing[] };
      if (typeof isin === 'string' && Array.isArray(listings)) known.set(isin, listings);
    } catch {
      // useknutý řádek z přerušeného běhu — ISIN se zeptá znovu
    }
  }
  return known;
}

/**
 * Kotace pro každý ISIN z OpenFIGI. Odpovědi (jen kotace na trzích
 * číselníku) se průběžně ukládají do mezipaměti, takže přerušený běh
 * naváže. Chyba u jednotlivého ISIN se neukládá — příští běh se zeptá znovu
 * (od „nic nenalezeno“, které se uloží, ji rozlišuje pole `error`).
 */
export async function listingsFromOpenFigi(
  isins: readonly string[],
  fetchBatch: FigiBatch,
  {
    cacheFile,
    batchSize = 100,
    perMinute = 240,
    concurrency = 6,
  }: { cacheFile: string; batchSize?: number; perMinute?: number; concurrency?: number },
): Promise<Map<string, FigiListing[]>> {
  const known = readCache(cacheFile);
  const pending = isins.filter((isin) => !known.has(isin));
  console.log(`OpenFIGI: ${known.size} ISIN z mezipaměti, ${pending.length} k dotazu…`);
  // zápis vždy na nový řádek — useknutý poslední řádek by se slepil s dalším
  if (existsSync(cacheFile)) {
    const content = readFileSync(cacheFile, 'utf8');
    if (content.length > 0 && !content.endsWith('\n')) appendFileSync(cacheFile, '\n');
  }
  const out = createWriteStream(cacheFile, { flags: 'a' });
  const ours = new Set(MARKET_CODES.map((code) => MARKETS[code].openFigiExchCode));
  const keep = (entry: FigiListing): boolean =>
    ours.has(entry.exchCode ?? '') || US_LISTING_EXCHANGES.has(entry.exchCode ?? '');
  const chunks = chunked(pending, batchSize);
  let done = 0;
  let failed = 0;
  try {
    await runPool(
      chunks,
      async (chunk) => {
        const answers = await fetchBatch(chunk.map((isin) => ({ idType: 'ID_ISIN', idValue: isin })));
        chunk.forEach((isin, position) => {
          const answer = answers[position];
          if (!answer || answer.error !== undefined) {
            failed += 1;
            return;
          }
          const listings = (answer.data ?? []).filter(keep).map((entry) => ({
            ticker: entry.ticker,
            exchCode: entry.exchCode,
            securityType: entry.securityType,
            name: entry.name,
          }));
          known.set(isin, listings);
          out.write(`${JSON.stringify({ isin, listings })}\n`);
        });
        done += 1;
        if (done % 250 === 0) console.log(`  OpenFIGI: ${done}/${chunks.length} dávek`);
      },
      { perMinute, concurrency },
    );
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  if (failed > 0) console.log(`  OpenFIGI: ${failed} ISIN skončilo chybou — příští běh se na ně zeptá znovu.`);
  return known;
}

/**
 * Zpětná kontrola: ticker musí na burze vést na JEDINÝ titul. Kolizi mezi
 * záznamy, které do generátoru došly, odhalí `selectUnambiguous`; tahle
 * kontrola chytí i titul, který do generátoru nedošel (předvýběr GLEIF ho
 * vyřadil, nebo v GLEIF ani Wikidatech vůbec není). Ticker, který OpenFIGI
 * na burze nenajde, nebo najde u víc tříd akcií, se vyřadí.
 */
export async function uniqueTickers<R extends IsinDirectoryRecord & { figiTicker: string }>(
  records: readonly R[],
  fetchBatch: FigiBatch,
  { batchSize = 100, perMinute = 240, concurrency = 6 }: Partial<PoolOptions> & { batchSize?: number } = {},
): Promise<{ records: R[]; rejected: Array<{ record: R; reason: string }> }> {
  const keyOf = (record: R): string => `${MARKETS[record.market].openFigiExchCode}|${record.figiTicker}`;
  const keys = [...new Set(records.map(keyOf))];
  const verdict = new Map<string, string | null>();
  await runPool(
    chunked(keys, batchSize),
    async (chunk) => {
      const answers = await fetchBatch(
        chunk.map((key) => {
          const [exchCode, ticker] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
          return { idType: 'TICKER', idValue: ticker, exchCode };
        }),
      );
      chunk.forEach((key, position) => {
        const answer = answers[position];
        if (!answer || answer.error !== undefined) {
          verdict.set(key, 'OpenFIGI ticker neověřila (chyba)');
          return;
        }
        const classes = new Set(
          (answer.data ?? []).map((entry) => entry.shareClassFIGI ?? entry.compositeFIGI ?? entry.figi),
        );
        verdict.set(
          key,
          classes.size === 0
            ? 'OpenFIGI ticker na burze nezná'
            : classes.size > 1
              ? 'ticker vede na víc titulů'
              : null,
        );
      });
    },
    { perMinute, concurrency },
  );
  // pořadí zůstává (záznamy z Wikidat napřed — viz `selectUnambiguous`)
  const kept: R[] = [];
  const rejected: Array<{ record: R; reason: string }> = [];
  for (const record of records) {
    const reason = verdict.get(keyOf(record));
    if (reason) rejected.push({ record, reason });
    else kept.push(record);
  }
  return { records: kept, rejected };
}

/**
 * Mezipaměť odpovědí OpenFIGI pro daný den (mimo repozitář). V domovském
 * adresáři, ne v `/tmp`: pád WSL bere `/tmp` s sebou (10. 11. 2026 tak
 * zmizela rozběhnutá půlhodina dotazů).
 */
export function defaultCacheFile(): string {
  const dir = join(homedir(), '.cache', 'danero-isin-directory');
  mkdirSync(dir, { recursive: true });
  return join(dir, `openfigi-${new Date().toISOString().slice(0, 10)}.jsonl`);
}

/** Předvybrané ISIN ze staženého CSV GLEIF (`--gleif-csv`, opakovaný běh bez stahování). */
export function gleifIsinsFromCsv(path: string): Promise<string[]> {
  return feedLines(createReadStream(path));
}
