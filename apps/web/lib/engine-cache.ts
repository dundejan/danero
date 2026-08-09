import type { YearAnalysis, ProfileRow } from '@/lib/portfolio';
import type { Transaction } from '@danero/shared';
import type { EngineInput, TaxYearResult, VariantComparison } from '@danero/engine';
import { fnv1a64 } from '@danero/importers';
import type { CnbRateProvider } from '@/lib/cnb';
import {
  analyzeForUser,
  compareVariantsForUser,
  dailyRatesAffectAnalysis,
} from '@/lib/portfolio';

/**
 * In-process cache výsledků enginu (G10b). Engine je čistá funkce → výsledek
 * je plně určen otiskem vstupů: množina transakcí (počet + hash ID), profil
 * (updatedAt nese každou změnu přepínačů), rok, datum pozic a metoda kurzů.
 * Invalidace = jiný otisk; serverless instance mají každá svou mapu (OK —
 * cache je optimalizace, ne zdroj pravdy).
 *
 * Strop je PAMĚŤOVÝ, ne počet záznamů (nález F-3-4). Jeden záznam drží celý
 * `YearAnalysis` — ledger (loty + disposals), sestavy prodejů, pozice — a jeho
 * velikost roste s historií uživatele. Naměřeno na retained setu
 * (`--expose-gc`, `test/engine-cache.test.ts` hlídá kalibraci):
 *
 * | transakcí | drží záznam |
 * |---|---|
 * | 1 000 | 1,7 MB |
 * | 10 000 | 13,7 MB |
 * | 50 000 | 68 MB |
 *
 * Původních „50 záznamů bez ohledu na velikost" tedy znamenalo 85 MB u malých
 * účtů, ale 3,4 GB u velkých — funkce na Vercelu má 2 GB, takže plná cache
 * jednoho velkého uživatele instanci zabila.
 */

/**
 * Odhad paměti záznamu. Naměřeno ~1,4 kB na transakci; počítáme s 2 kB
 * a k tomu s ledgerem zvlášť — strop má radši podstřelit (menší cache) než
 * přetéct (mrtvá instance). Pro 50 000 transakcí vyjde odhad 125 MB proti
 * skutečným 68 MB, tedy rezerva ~1,8×.
 */
const BYTES_PER_TRANSACTION = 2048;
const BYTES_PER_LEDGER_ROW = 512;
const ENTRY_OVERHEAD_BYTES = 64 * 1024;

/**
 * Kolik odhadnutých bajtů smí cache držet. 128 MB odhadu ≈ 70 MB skutečných,
 * tj. ~3,5 % paměti funkce (2 GB) — zbytek patří samotnému výpočtu, který nad
 * velkou historií potřebuje desítky MB sám o sobě. Malých účtů se strop
 * prakticky nedotkne (1 000 transakcí = 2,4 MB odhadu → ~53 záznamů, tedy
 * zhruba původních 50).
 */
const MAX_CACHE_BYTES = 128 * 1024 * 1024;

/** Pojistka na režii mapy a klíčů u drobných záznamů. */
const MAX_ENTRIES = 50;

/**
 * Po téhle době záznam vyhazujeme, i kdyby se strop nenaplnil. Bez TTL držel
 * záznam s včerejším `atDate` paměť do konce života instance: nový den má jiný
 * otisk, takže se na starý záznam už nikdy nikdo nezeptá a jen zabíral místo.
 */
const TTL_MS = 10 * 60_000;

/** Odhad paměti, kterou drží jeden výsledek (viz konstanty výš). */
export function estimateAnalysisBytes(analysis: YearAnalysis): number {
  const { lots, disposals } = analysis.result.ledger;
  return (
    ENTRY_OVERHEAD_BYTES +
    analysis.transactionCount * BYTES_PER_TRANSACTION +
    (lots.length + disposals.length) * BYTES_PER_LEDGER_ROW
  );
}

export interface CacheLimits {
  maxBytes: number;
  maxEntries: number;
  ttlMs: number;
}

export interface ResultCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, now?: number): void;
  stats(): { entries: number; bytes: number };
}

interface CacheEntry<T> {
  value: T;
  bytes: number;
  storedAt: number;
}

/**
 * Cache s paměťovým stropem, TTL a FIFO vyhazováním. Vlastní instance kvůli
 * testům (produkční strop 128 MB by se testem plnil minutu) — v aplikaci
 * existují dvě, níž: výsledky roku a srovnání variant.
 */
export function createResultCache<T>(
  limits: CacheLimits,
  estimateBytes: (value: T) => number,
): ResultCache<T> {
  const entries = new Map<string, CacheEntry<T>>();
  let bytes = 0;

  const drop = (key: string, entry: CacheEntry<T>): void => {
    entries.delete(key);
    bytes -= entry.bytes;
  };

  const dropExpired = (now: number): void => {
    for (const [key, entry] of entries) {
      if (now - entry.storedAt >= limits.ttlMs) drop(key, entry);
    }
  };

  return {
    get(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now - entry.storedAt >= limits.ttlMs) {
        drop(key, entry);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, now = Date.now()) {
      const existing = entries.get(key);
      if (existing) drop(key, existing);
      dropExpired(now);
      const entryBytes = estimateBytes(value);
      // záznam větší než celý strop se necachuje vůbec — jinak by kvůli němu
      // vypadlo všechno ostatní a stejně by se hned vyhodil sám
      if (entryBytes > limits.maxBytes) return;
      // FIFO: nejstarší zápis jde ven jako první (Map drží pořadí vložení)
      for (const [oldKey, oldEntry] of entries) {
        if (bytes + entryBytes <= limits.maxBytes && entries.size < limits.maxEntries) break;
        drop(oldKey, oldEntry);
      }
      entries.set(key, { value, bytes: entryBytes, storedAt: now });
      bytes += entryBytes;
    },
    stats: () => ({ entries: entries.size, bytes }),
  };
}

const cache = createResultCache<YearAnalysis>(
  { maxBytes: MAX_CACHE_BYTES, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS },
  estimateAnalysisBytes,
);

/**
 * Srovnání variant (R-05c × R-06) má vlastní cache: hodnota je proti
 * `YearAnalysis` drobná (4–8 variant po hrstce čísel), ale výpočet je
 * NEJDRAŽŠÍ v aplikaci — `compareVariants` pouští engine 4× (s denními kurzy
 * 8×) a `MAX_PROFIT`/`MAX_LOSS` stojí každý ~6,7× tolik co FIFO. Naměřeno na
 * day-traderovi: 25 000 transakcí = 42 s CPU, 50 000 = 185 s. Bez cache to
 * `/report` platil při každém přelistování strany tabulky (F-3-1).
 */
const COMPARISON_ENTRY_BYTES = 8 * 1024;
const comparisonCache = createResultCache<VariantComparison>(
  { maxBytes: 4 * 1024 * 1024, maxEntries: MAX_ENTRIES, ttlMs: TTL_MS },
  () => COMPARISON_ENTRY_BYTES,
);

/** Obsazenost cache — pro testy a případnou diagnostiku. */
export const engineCacheStats = (): { entries: number; bytes: number } => cache.stats();

/**
 * Otisk denních kurzů do klíče cache. `undefined` znamená „necachovat":
 * provider bez otisku (test, cizí zdroj) může svůj obsah měnit bez varování
 * a cache by po takové změně servírovala stará čísla. Prázdný otisk se počítá
 * jako žádný — jinak by z něj vznikl prázdný klíč SPOLEČNÝ pro všechny
 * uživatele a roky, tedy servírování cizích čísel.
 */
const ratesFingerprint = (dailyRates?: EngineInput['dailyRates']): string | undefined => {
  if (dailyRates === undefined) return 'unified';
  const { fingerprint } = dailyRates as Partial<CnbRateProvider>;
  return fingerprint ? `daily:${fingerprint}` : undefined;
};

export function analysisFingerprint(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  rates: string,
): string {
  // hash ID transakcí: levný a citlivý na přidání/odebrání i pořadí
  const txHash = fnv1a64(txs.map((tx) => tx.id).join('|'));
  return [userId, year, atDate, txs.length, txHash, profileRow.updatedAt.getTime(), rates].join(
    ':',
  );
}

/** Společné jádro obou cachovaných vstupů: klíč, hit, výpočet, uložení. */
function cached<T>(
  store: ResultCache<T>,
  key: string | undefined,
  compute: () => T,
): T {
  if (key === undefined) return compute();
  const hit = store.get(key);
  if (hit) return hit;
  const value = compute();
  store.set(key, value);
  return value;
}

export function analyzeForUserCached(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  dailyRates?: EngineInput['dailyRates'],
): YearAnalysis {
  const rates = ratesFingerprint(dailyRates);
  const key =
    rates === undefined
      ? undefined
      : analysisFingerprint(userId, txs, profileRow, year, atDate, rates);
  return cached(cache, key, () => analyzeForUser(txs, profileRow, year, atDate, dailyRates));
}

/**
 * Srovnání variant nad týmiž vstupy jako `analyzeForUserCached` — jen bez
 * `atDate`, protože varianty se počítají za celý daňový rok a na dni pozic
 * nezávisí.
 */
export function compareVariantsForUserCached(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  dailyRates?: EngineInput['dailyRates'],
): VariantComparison {
  const rates = ratesFingerprint(dailyRates);
  const key =
    rates === undefined
      ? undefined
      : analysisFingerprint(userId, txs, profileRow, year, 'varianty', rates);
  return cached(comparisonCache, key, () =>
    compareVariantsForUser(txs, profileRow, year, dailyRates),
  );
}

/**
 * Podklady pro `/report`: výsledek roku i srovnání variant z cache. Stránka je
 * jediný jejich konzument a musí je mít oba — a bez cache se obojí počítalo
 * znovu při každém přelistování strany tabulky prodejů (F-3-1).
 *
 * Denní kurzy si report bere VŽDY, protože bez nich by srovnání variant
 * neukázalo kurzovou soustavu. Do hlavního výsledku ale vstupují jen tehdy,
 * když je uživatel opravdu potřebuje — jinak by měl report v cache vlastní
 * záznam vedle přehledu, oba přes 100 MB odhadu, a při každém přepnutí mezi
 * stránkami by se navzájem vyhazovaly a počítaly znovu. Čísla to nemění:
 * u pokrytého jednotného kurzu se provider stejně nepoužije.
 */
export function reportDataCached(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  dailyRates?: EngineInput['dailyRates'],
): { result: TaxYearResult; comparison: VariantComparison } {
  const analysisRates = dailyRatesAffectAnalysis(profileRow, txs) ? dailyRates : undefined;
  return {
    result: analyzeForUserCached(userId, txs, profileRow, year, atDate, analysisRates).result,
    comparison: compareVariantsForUserCached(userId, txs, profileRow, year, dailyRates),
  };
}
