import { asc, eq } from 'drizzle-orm';
import {
  parseTransactions,
  TaxpayerProfileSchema,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import {
  analyzeTaxYear,
  positionsAt,
  type EngineOptions,
  type Position,
  type TaxYearResult,
} from '@danero/engine';
import type { Db } from '@/db';
import { taxpayerProfiles, transactions } from '@/db/schema';
import { configForYear } from './tax-config';

export type ProfileRow = typeof taxpayerProfiles.$inferSelect;

export async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
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
    },
  };
}

export async function loadTransactions(db: Db, userId: string): Promise<Transaction[]> {
  const rows = await db
    .select({ payload: transactions.payload })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.txDate));
  return parseTransactions(rows.map((r) => r.payload));
}

/** Mapa ISIN → ticker/název z transakcí (pro čitelné popisky pozic). */
export function instrumentLabels(txs: Transaction[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL') continue;
    if (labels.has(tx.isin)) continue;
    labels.set(tx.isin, tx.ticker ?? tx.name ?? tx.isin);
  }
  return labels;
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
): YearAnalysis {
  const { profile, options } = profileToEngine(profileRow);
  const result = analyzeTaxYear({
    transactions: txs,
    profile,
    config: configForYear(year),
    options,
  });
  return {
    result,
    positions: positionsAt(result.ledger, atDate),
    labels: instrumentLabels(txs),
    transactionCount: txs.length,
  };
}
