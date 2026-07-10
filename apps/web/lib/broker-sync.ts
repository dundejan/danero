import { reconcilePositions } from '@danero/importers';
import { buildLedger, positionsAt, resolveOptions, WarningCollector } from '@danero/engine';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { loadTransactions } from '@/lib/portfolio';

/**
 * Broker-neutrální základ synchronizací (G2 multi-broker): sdílené tvary
 * průběhu a rekonciliace + zápisy stavu k účtu. Broker-specifika (T212 roky,
 * IBKR Flex) žijí v t212-sync.ts / ibkr-sync.ts.
 */

export type BrokerAccountRow = typeof brokerAccounts.$inferSelect;

/** Serializovaná rekonciliace pro JSONB (Decimal → string). */
export interface StoredReconciliation {
  ok: boolean;
  matchedCount: number;
  unmatchedTickers: string[];
  issues: Array<{
    kind: string;
    isin: string;
    expected: string;
    actual: string;
    suggestedSplitRatio?: { from: string; to: string };
  }>;
  /** Sync selhal (výjimka) — UI ukazuje červeně. */
  error?: string;
  /** Rekonciliaci nešlo provést, ale sync PROBĚHL (např. chybí OpenPositions) — jantarově. */
  warning?: string;
}

export type SyncStatus = 'ok' | 'mismatch' | 'errors';

/** České popisky stavů syncu — surové enum hodnoty do UI nepatří. */
export const SYNC_STATUS_LABELS: Record<string, string> = {
  ok: 'v pořádku',
  mismatch: 'pozice nesedí',
  errors: 'import s chybami',
  error: 'chyba',
};

export const syncStatusLabel = (status: string | null): string =>
  (status && SYNC_STATUS_LABELS[status]) || status || 'neznámý';

/** Stav jednoho roku v průběhu syncu — pro progress UI (T212 stahuje po letech). */
export interface SyncYearProgress {
  year: number;
  status: 'running' | 'done' | 'empty';
  added?: number;
  duplicates?: number;
  errors?: number;
}

/** Průběžný stav syncu (serializovatelný do jobs.progress). */
export interface SyncProgress {
  phase: 'connecting' | 'exporting' | 'reconciling';
  /** Broker-specifické detaily (T212: plná historie po letech) — pro jiné brokery chybí. */
  mode?: 'full' | 'incremental';
  years?: SyncYearProgress[];
}

/** Rekonciliace „nedoběhla“ — jediný tvar pro všechna chybová místa. */
export function emptyReconciliation(error: string): StoredReconciliation {
  return { ok: false, matchedCount: 0, unmatchedTickers: [], issues: [], error };
}

/**
 * Propíše chybu syncu k broker účtu (ukazuje ji /import). POZOR: lastSyncedAt
 * se při chybě NIKDY nenastavuje — jinak by další pokus přeskočil plnou
 * historii (mode se odvozuje z lastSyncedAt).
 */
export async function markAccountSyncError(
  db: Db,
  accountId: string,
  userId: string,
  message: string,
): Promise<void> {
  await db
    .update(brokerAccounts)
    .set({ lastSyncStatus: 'error', lastReconciliation: emptyReconciliation(message) })
    .where(and(eq(brokerAccounts.id, accountId), eq(brokerAccounts.userId, userId)));
}

/**
 * Porovná pozice vypočtené z transakcí brokera s pozicemi hlášenými brokerem
 * k `atDate` a vrátí serializovaný report. Do výpočtu vstupují i transakce
 * z univerzální šablony (broker='universal') — je to dokumentovaná cesta, jak
 * ručně doplnit chybějící historii či korporátní akci k broker účtu, a bez
 * nich by rekonciliace navždy hlásila nesoulad přesně o doplněné kusy.
 */
export async function reconcileBrokerPositions(
  db: Db,
  userId: string,
  broker: string,
  brokerPositions: Array<{ isin: string; quantity: string | number }>,
  atDate: string,
  unmatchedTickers: string[] = [],
): Promise<StoredReconciliation> {
  const [own, manual] = await Promise.all([
    loadTransactions(db, userId, broker),
    loadTransactions(db, userId, 'universal'),
  ]);
  const txs = [...own, ...manual].sort((a, b) => {
    const dateOf = (tx: (typeof own)[number]) =>
      tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;
    return dateOf(a) < dateOf(b) ? -1 : 1;
  });
  const ledger = buildLedger(txs, resolveOptions(), new WarningCollector());
  const computed = positionsAt(ledger, atDate).map((position) => ({
    isin: position.isin,
    quantity: position.totalRemaining,
  }));
  const report = reconcilePositions(computed, brokerPositions);
  return {
    ok: report.ok && unmatchedTickers.length === 0,
    matchedCount: report.matchedIsins.length,
    unmatchedTickers,
    issues: report.issues.map((issue) => ({
      kind: issue.kind,
      isin: issue.isin,
      expected: issue.expectedQuantity.toString(),
      actual: issue.brokerQuantity.toString(),
      ...(issue.suggestedSplitRatio ? { suggestedSplitRatio: issue.suggestedSplitRatio } : {}),
    })),
  };
}

/** Jednotné odvození stavu syncu (jediné místo pravdy pro tri-state). */
export function deriveSyncStatus(
  errorCount: number,
  reconciliation: StoredReconciliation,
): SyncStatus {
  return errorCount > 0 ? 'errors' : reconciliation.ok ? 'ok' : 'mismatch';
}

/**
 * Úspěšný závěr syncu: odvodí stav a zapíše ho k účtu — JEDINÉ místo, které
 * smí nastavit lastSyncedAt (známá zrada: po neúspěchu se nastavit nesmí,
 * jinak se plná historie už nestáhne). Tenancy guard přímo v dotazu.
 */
export async function finishBrokerSync(
  db: Db,
  account: BrokerAccountRow,
  reconciliation: StoredReconciliation,
  errorCount: number,
  now: Date,
): Promise<SyncStatus> {
  const status = deriveSyncStatus(errorCount, reconciliation);
  await db
    .update(brokerAccounts)
    .set({ lastSyncedAt: now, lastSyncStatus: status, lastReconciliation: reconciliation })
    .where(and(eq(brokerAccounts.id, account.id), eq(brokerAccounts.userId, account.userId)));
  const { logAudit } = await import('@/lib/audit');
  await logAudit(db, account.userId, 'SYNC', `${account.broker} (${account.label})`);
  return status;
}

/**
 * Testovací hák pro E2E: base URL broker API z env, ale VÝHRADNĚ mimo produkci —
 * omylem nastavená proměnná v produkci by tiše přesměrovala provoz včetně
 * API klíčů v hlavičkách/query na cizí host.
 */
export function testEnvBaseUrl(envVar: string): string | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  return process.env[envVar] || undefined;
}
