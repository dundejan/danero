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
 * cache je optimalizace, ne zdroj pravdy). FIFO strop drží paměť na uzdě.
 */
const MAX_ENTRIES = 50;
const cache = new Map<string, YearAnalysis>();

export function analysisFingerprint(
  userId: string,
  portfolioId: string,
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
    portfolioId,
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
  portfolioId: string,
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
  const key = analysisFingerprint(
    userId,
    portfolioId,
    txs,
    profileRow,
    year,
    atDate,
    false,
  );
  const hit = cache.get(key);
  if (hit) return hit;
  const value = analyzeForUser(txs, profileRow, year, atDate, dailyRates);
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}
