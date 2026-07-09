import { and, asc, eq } from 'drizzle-orm';
import {
  parseTransactions,
  TaxpayerProfileSchema,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import {
  analyzeTaxYear,
  positionsAt,
  type EngineInput,
  type EngineOptions,
  type Position,
  type TaxYearResult,
} from '@danero/engine';
import type { Db } from '@/db';
import { taxpayerProfiles, transactions } from '@/db/schema';
import { configForYear } from './tax-config';

export type ProfileRow = typeof taxpayerProfiles.$inferSelect;

export async function getProfile(
  db: Db,
  userId: string,
  portfolioId: string,
): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(taxpayerProfiles)
    .where(
      and(eq(taxpayerProfiles.userId, userId), eq(taxpayerProfiles.portfolioId, portfolioId)),
    );
  return rows[0] ?? null;
}

/** Převod DB řádku profilu na vstup enginu (profil + přepínače z docs/02). */
export function profileToEngine(row: ProfileRow): {
  profile: TaxpayerProfile;
  options: Partial<EngineOptions>;
} {
  return {
    profile: TaxpayerProfileSchema.parse({
      regime: row.regime,
      hasSecuritiesInBusinessAssets: row.hasBusinessAssets,
      w8benFiled: row.w8benFiled,
      otherTaxableIncome8to10Czk: row.otherIncomeCzk,
    }),
    options: {
      matchingMethod: row.matchingMethod as EngineOptions['matchingMethod'],
      fxMethod: row.fxMethod as EngineOptions['fxMethod'],
      limit100kIncludesTimeTestExempt: row.limit100kStrict,
      timeTestDateBasis: row.timeTestBasis as EngineOptions['timeTestDateBasis'],
      derivativesExpensesPerDruh: row.derivativesExpensesPerDruh,
    },
  };
}

/** `broker` zúží na transakce jednoho brokera — rekonciliace pozic je per broker. */
export async function loadTransactions(
  db: Db,
  userId: string,
  portfolioId: string,
  broker?: string,
): Promise<Transaction[]> {
  const scope = and(eq(transactions.userId, userId), eq(transactions.portfolioId, portfolioId));
  const rows = await db
    .select({ payload: transactions.payload })
    .from(transactions)
    .where(broker ? and(scope, eq(transactions.broker, broker)) : scope)
    .orderBy(asc(transactions.txDate));
  return parseTransactions(rows.map((r) => r.payload));
}

/** Mapa ISIN → celý název společnosti/fondu z transakcí (doplněk k tickeru). */
export function instrumentNames(txs: Transaction[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL' && tx.type !== 'TRANSFER_IN') continue;
    if (names.has(tx.isin) || !tx.name) continue;
    names.set(tx.isin, tx.name);
  }
  return names;
}

/** Mapa ISIN → ticker/název z transakcí (pro čitelné popisky pozic). */
export function instrumentLabels(txs: Transaction[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL' && tx.type !== 'TRANSFER_IN') continue;
    if (labels.has(tx.isin)) continue;
    const label = tx.ticker ?? tx.name;
    if (label) labels.set(tx.isin, label);
  }
  return labels;
}

/** Roky, ve kterých má uživatel transakce (sestupně), vždy včetně aktuálního. */
export function availableYears(txs: Transaction[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const tx of txs) {
    const date = tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;
    years.add(Number(date.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

export function engineInputForUser(
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  dailyRates?: EngineInput['dailyRates'],
): EngineInput {
  const { profile, options } = profileToEngine(profileRow);
  return { transactions: txs, profile, options, config: configForYear(year), dailyRates };
}

/**
 * Denní kurzy ČNB pro výpočet (R-06b): načte provider z DB a při prvním
 * použití doplní chybějící roky z oficiálního ČNB API (jednorázový backfill,
 * ~1 request na rok). Vrací undefined, když kurzy nejsou potřeba ani po ruce.
 */
export async function loadDailyRates(
  db: Db,
  txs: Transaction[],
  currentYear: number,
): Promise<EngineInput['dailyRates']> {
  const { ensureCnbYears, loadCnbRateProvider } = await import('@/lib/cnb');
  const years = availableYears(txs, currentYear);
  // rok−1 kvůli transakcím z 1.–2. ledna: fallback bere poslední vyhlášený
  // kurz PŘEDCHOZÍHO roku (Silvestr)
  const fromYear = Math.min(...years) - 1;
  try {
    await ensureCnbYears(db, [fromYear, ...years]);
  } catch {
    // offline/backfill selhal — zkusíme, co už v DB je; report stav přizná
  }
  const provider = await loadCnbRateProvider(db, fromYear, currentYear);
  return provider.isEmpty ? undefined : provider;
}

export interface YearAnalysis {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  transactionCount: number;
}

export function analyzeForUser(
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  dailyRates?: EngineInput['dailyRates'],
): YearAnalysis {
  const result = analyzeTaxYear(engineInputForUser(txs, profileRow, year, dailyRates));
  return {
    result,
    positions: positionsAt(result.ledger, atDate),
    labels: instrumentLabels(txs),
    transactionCount: txs.length,
  };
}

/**
 * Denní kurzy jen když je uživatel ZVOLIL (fxMethod CNB_DAILY) — jinak by
 * každé načtení stránky platilo backfill. Report si je bere vždy (srovnání).
 */
export async function dailyRatesForProfile(
  db: Db,
  txs: Transaction[],
  profileRow: ProfileRow,
  currentYear: number,
): Promise<EngineInput['dailyRates']> {
  if (profileRow.fxMethod !== 'CNB_DAILY') return undefined;
  return loadDailyRates(db, txs, currentYear);
}
