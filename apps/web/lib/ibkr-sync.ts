import { IbkrFlexClient, parseIbkrFlexXml, type RowIssue } from '@danero/importers';
import type { Db } from '@/db';
import {
  finishBrokerSync,
  previouslyVerifiedYears,
  reconcileBrokerPositions,
  testEnvBaseUrl,
  type BrokerAccountRow,
  type StoredReconciliation,
  type SyncProgress,
  type SyncStatus,
} from '@/lib/broker-sync';
import { decryptSecret } from '@/lib/crypto';
import { errorText } from '@/lib/log';
import { importParsed, type ImportSummary } from '@/lib/import-service';
import { upsertInstrumentPrices } from '@/lib/prices';

/**
 * Synchronizace IBKR přes Flex Web Service (docs/09 G2): jedna query pokrývá
 * období nastavené v IBKR (typicky posledních 365 dní) — starší historii
 * uživatel jednorázově nahraje jako XML soubory v Importu (dedupe zajistí,
 * že se nic nezdvojí). Rekonciliace jde proti OpenPositions z téhož výpisu.
 */

export interface IbkrSyncOutcome {
  batch: ImportSummary | null;
  added: number;
  duplicates: number;
  errors: RowIssue[];
  reconciliation: StoredReconciliation | null;
  status: SyncStatus;
}

export interface IbkrSyncOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  pollIntervalMs?: number;
  onProgress?: (progress: SyncProgress) => void | Promise<void>;
}

/** Uložené přihlašovací údaje IBKR: token + query ID (šifrovaný JSON). */
interface IbkrCredentials {
  token: string;
  queryId: string;
}

function parseCredentials(encrypted: string): IbkrCredentials {
  const plain = decryptSecret(encrypted);
  const parsed = JSON.parse(plain) as { token?: unknown; queryId?: unknown };
  if (typeof parsed.token !== 'string' || typeof parsed.queryId !== 'string') {
    throw new Error('Uložené IBKR přihlašovací údaje mají neplatný formát — připoj účet znovu.');
  }
  return { token: parsed.token, queryId: parsed.queryId };
}

export async function syncIbkr(
  db: Db,
  account: BrokerAccountRow,
  options: IbkrSyncOptions = {},
): Promise<IbkrSyncOutcome> {
  const now = options.now ?? new Date();
  const report = async (phase: SyncProgress['phase']) => {
    await options.onProgress?.({ phase });
  };

  await report('connecting');
  const credentials = parseCredentials(account.credentialsEncrypted);
  const baseUrl = testEnvBaseUrl('IBKR_FLEX_BASE_URL');
  const client = new IbkrFlexClient({
    token: credentials.token,
    queryId: credentials.queryId,
    ...(baseUrl ? { baseUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  await report('exporting');
  // onPoll = heartbeat: generování výpisu trvá i minuty a bez známky života
  // by recovery jobů (15 min) mohla legitimní běh falešně prohlásit za mrtvý
  const xml = await client.fetchStatementXml(options.pollIntervalMs ?? 10_000, 600_000, () =>
    report('exporting'),
  );
  const parsed = parseIbkrFlexXml(xml);

  const hasContent =
    parsed.transactions.length > 0 ||
    parsed.errors.length > 0 ||
    parsed.skipped.length > 0 ||
    parsed.warnings.length > 0;
  const filename = `ibkr-flex-${now.toISOString().slice(0, 10)}.xml`;
  const batch = hasContent ? await importParsed(db, account.userId, filename, parsed) : null;

  await report('reconciling');
  await upsertInstrumentPrices(
    db,
    account.userId,
    account.broker,
    parsed.openPositions
      .filter((p) => p.markPrice)
      .map((p) => ({ isin: p.isin, price: p.markPrice!, currency: p.currency })),
    now,
  );
  let reconciliation: StoredReconciliation | null = null;
  let reconciliationError: string | null = null;
  if (parsed.openPositions.length > 0) {
    try {
      reconciliation = await reconcileBrokerPositions(
        db,
        account.userId,
        account.broker,
        parsed.openPositions,
        now.toISOString().slice(0, 10),
        [],
        // rozsah výpisu (fromDate–toDate): rok bez transakcí uvnitř něj je
        // ověřeně prázdný, mimo něj je to díra v historii
        [...previouslyVerifiedYears(account), ...parsed.coveredYears],
      );
    } catch (error) {
      // přechodné selhání rekonciliace nepřepisuje poslední platný stav —
      // chyba jde do lastSyncError (stejně jako v t212-sync)
      reconciliationError = errorText(error);
    }
  } else {
    // bez OpenPositions nemáme s čím srovnávat — sync ale PROBĚHL, takže
    // warning (jantarově), ne error (červené „synchronizace selhala“)
    reconciliation = {
      ok: false,
      matchedCount: 0,
      unmatchedTickers: [],
      issues: [],
      warning:
        'Výpis neobsahuje sekci Open Positions — přidej ji do Flex Query (úroveň Summary), ať můžeme kontrolovat, že pozice sedí. Transakce se naimportovaly v pořádku.',
    };
  }

  const errors = batch?.errors ?? [];
  const status = await finishBrokerSync(db, account, reconciliation, errors.length, now, {
    reconciliationError,
  });

  return {
    batch,
    added: batch?.added ?? 0,
    duplicates: batch?.duplicates ?? 0,
    errors,
    reconciliation,
    status,
  };
}
