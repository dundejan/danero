import type { YearAnalysis, ProfileRow } from '@/lib/portfolio';
import type { Transaction } from '@danero/shared';
import type { EngineInput } from '@danero/engine';
import { fnv1a64 } from '@danero/importers';
import { analyzeForUser } from '@/lib/portfolio';

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

export interface AnalysisCache {
  get(key: string, now?: number): YearAnalysis | undefined;
  set(key: string, value: YearAnalysis, now?: number): void;
  stats(): { entries: number; bytes: number };
}

interface CacheEntry {
  value: YearAnalysis;
  bytes: number;
  storedAt: number;
}

/**
 * Cache s paměťovým stropem, TTL a FIFO vyhazováním. Vlastní instance kvůli
 * testům (produkční strop 128 MB by se testem plnil minutu) — v aplikaci
 * existuje jediná, níž.
 */
export function createAnalysisCache(limits: CacheLimits): AnalysisCache {
  const entries = new Map<string, CacheEntry>();
  let bytes = 0;

  const drop = (key: string, entry: CacheEntry): void => {
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
      const entryBytes = estimateAnalysisBytes(value);
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

const cache = createAnalysisCache({
  maxBytes: MAX_CACHE_BYTES,
  maxEntries: MAX_ENTRIES,
  ttlMs: TTL_MS,
});

/** Obsazenost cache — pro testy a případnou diagnostiku. */
export const engineCacheStats = (): { entries: number; bytes: number } => cache.stats();

export function analysisFingerprint(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  hasDailyRates: boolean,
): string {
  // hash ID transakcí: levný a citlivý na přidání/odebrání i pořadí
  const txHash = fnv1a64(txs.map((tx) => tx.id).join('|'));
  return [
    userId,
    year,
    atDate,
    txs.length,
    txHash,
    profileRow.updatedAt.getTime(),
    hasDailyRates ? 'daily' : 'unified',
  ].join(':');
}

export function analyzeForUserCached(
  userId: string,
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  dailyRates?: EngineInput['dailyRates'],
): YearAnalysis {
  // denní kurzy ČNB se do otisku promítnout neumí (jejich obsah se mění
  // nezávisle na transakcích — backfill po výpadku by servíroval stará čísla)
  // → s denními kurzy cache vynecháváme; jednotný kurz je za rok neměnný
  if (dailyRates !== undefined) {
    return analyzeForUser(txs, profileRow, year, atDate, dailyRates);
  }
  const key = analysisFingerprint(userId, txs, profileRow, year, atDate, false);
  const hit = cache.get(key);
  if (hit) return hit;
  const value = analyzeForUser(txs, profileRow, year, atDate, dailyRates);
  cache.set(key, value);
  return value;
}
