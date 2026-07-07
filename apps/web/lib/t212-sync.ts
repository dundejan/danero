import {
  mapPositionsToIsin,
  reconcilePositions,
  Trading212Client,
} from '@danero/importers';
import { buildLedger, positionsAt, resolveOptions, WarningCollector } from '@danero/engine';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { decryptSecret } from '@/lib/crypto';
import { importCsvText, type ImportSummary } from '@/lib/import-service';
import { loadTransactions } from '@/lib/portfolio';

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
  error?: string;
}

export interface SyncOutcome {
  summary: ImportSummary;
  reconciliation: StoredReconciliation;
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  pollIntervalMs?: number;
}

/**
 * Synchronizace T212 (docs/03): API vygeneruje CSV export běžného roku → stejný
 * parser a dedupe jako ruční upload (idempotentní) → rekonciliace pozic proti API
 * (detekce chybějících korporátních akcí). Kompletní historii starších let nahrává
 * uživatel jednorázově při onboardingu.
 */
export async function syncTrading212(
  db: Db,
  account: BrokerAccountRow,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const client = new Trading212Client({
    apiKey: decryptSecret(account.credentialsEncrypted),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const now = options.now ?? new Date();
  const year = now.getUTCFullYear();

  const csv = await client.fetchHistoryCsv(
    {
      timeFrom: `${year}-01-01T00:00:00Z`,
      timeTo: `${now.toISOString().slice(0, 19)}Z`,
      dataIncluded: {
        includeOrders: true,
        includeDividends: true,
        includeTransactions: true,
        includeInterest: true,
      },
    },
    options.pollIntervalMs ?? 30_000,
  );

  const summary = await importCsvText(
    db,
    account.userId,
    `t212-api-sync-${now.toISOString().slice(0, 10)}.csv`,
    csv,
  );

  let reconciliation: StoredReconciliation;
  try {
    const [positions, instruments] = await Promise.all([
      client.getPositions(),
      client.getInstruments(),
    ]);
    const mapped = mapPositionsToIsin(positions, instruments);
    const txs = await loadTransactions(db, account.userId);
    const ledger = buildLedger(txs, resolveOptions(), new WarningCollector());
    const computed = positionsAt(ledger, now.toISOString().slice(0, 10)).map((position) => ({
      isin: position.isin,
      quantity: position.totalRemaining,
    }));
    const report = reconcilePositions(
      computed,
      mapped.positions.map((p) => ({ isin: p.isin, quantity: p.quantity })),
    );
    reconciliation = {
      ok: report.ok && mapped.unmatchedTickers.length === 0,
      matchedCount: report.matchedIsins.length,
      unmatchedTickers: mapped.unmatchedTickers,
      issues: report.issues.map((issue) => ({
        kind: issue.kind,
        isin: issue.isin,
        expected: issue.expectedQuantity.toString(),
        actual: issue.brokerQuantity.toString(),
        ...(issue.suggestedSplitRatio ? { suggestedSplitRatio: issue.suggestedSplitRatio } : {}),
      })),
    };
  } catch (error) {
    reconciliation = {
      ok: false,
      matchedCount: 0,
      unmatchedTickers: [],
      issues: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const status = summary.errors.length > 0 ? 'errors' : reconciliation.ok ? 'ok' : 'mismatch';
  await db
    .update(brokerAccounts)
    .set({ lastSyncedAt: now, lastSyncStatus: status, lastReconciliation: reconciliation })
    .where(eq(brokerAccounts.id, account.id));

  return { summary, reconciliation };
}
