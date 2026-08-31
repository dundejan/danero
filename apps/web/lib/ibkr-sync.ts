import { IbkrFlexClient, parseIbkrFlexXml, type RowIssue } from '@danero/importers';
import type { Db } from '@/db';
import {
  finishBrokerSync,
  previouslyVerifiedYears,
  reconcileBrokerPositions,
  syncBatchFilename,
  syncErrorText,
  testEnvBaseUrl,
  type BrokerAccountRow,
  type StoredReconciliation,
  type SyncProgress,
  type SyncStatus,
} from '@/lib/broker-sync';
import { decryptSecret } from '@/lib/crypto';
import { errorText, logEvent } from '@/lib/log';
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

/**
 * Kolikrát se ptáme IBKR, jestli je výpis hotový. Při výchozím intervalu 10 s
 * je nejdelší čekání 580 s — vejde se do rozpočtu jednoho ticku cronu
 * (`DEFAULT_JOB_BUDGET_MS` = 600 s v `lib/jobs.ts`).
 *
 * Dřív tu stál časový rozpočet 600 000 ms, tedy PŘESNĚ rozpočet celého ticku:
 * jediný pomalý výpis ho spolykal beze zbytku a další joby se už nezačaly.
 * Navíc se kontroloval před uspáním, takže reálné čekání bylo o interval delší
 * než rozpočet. Stejná vada jako u Trading212 (`EXPORT_POLL_ATTEMPTS`
 * v `lib/t212-sync.ts`), a stejná oprava: strop v počtu pokusů.
 */
const STATEMENT_POLL_ATTEMPTS = 58;

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
  const xml = await client.fetchStatementXml({
    pollIntervalMs: options.pollIntervalMs ?? 10_000,
    maxAttempts: STATEMENT_POLL_ATTEMPTS,
    onPoll: () => report('exporting'),
  });
  const parsed = parseIbkrFlexXml(xml);

  const hasContent =
    parsed.transactions.length > 0 ||
    parsed.errors.length > 0 ||
    parsed.skipped.length > 0 ||
    parsed.warnings.length > 0;
  const filename = syncBatchFilename.ibkr(now.toISOString().slice(0, 10));
  const batch = hasContent ? await importParsed(db, account.userId, filename, parsed) : null;

  // Změna formátu na straně brokera by u napojeného účtu jinak zůstala němá:
  // parser se rozeběhne, nevydá jedinou transakci a uživatel ani provozovatel
  // se nedozví proč. Totéž dělá T212 sync (lib/t212-sync.ts).
  if (batch?.unrecognized) {
    const { keepFailedUpload } = await import('@/lib/failed-imports');
    await keepFailedUpload(db, {
      userId: account.userId,
      batchId: batch.batchId,
      filename,
      data: new TextEncoder().encode(xml).buffer as ArrayBuffer,
      reason: batch.errors[0]?.message ?? 'Formát Flex výpisu z API nepoznáváme.',
      source: 'sync',
      platform: 'Interactive Brokers',
    });
  }

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
      // rozsah výpisu (fromDate–toDate): rok bez transakcí uvnitř něj je
      // ověřeně prázdný, mimo něj je to díra v historii
      const verifiedYears = [...previouslyVerifiedYears(account), ...parsed.coveredYears];
      reconciliation = await reconcileBrokerPositions(
        db,
        account.userId,
        account.broker,
        parsed.openPositions,
        now.toISOString().slice(0, 10),
        {
          syncedYears: verifiedYears,
          // Flex Query pokrývá typicky posledních 365 dní — starší roky si
          // uživatel nahrává sám, takže nikdy netvrdíme, že je historie celá
          ...(verifiedYears.length > 0 ? { checkedFromYear: Math.min(...verifiedYears) } : {}),
        },
      );
    } catch (error) {
      // přechodné selhání rekonciliace nepřepisuje poslední platný stav —
      // chyba jde do lastSyncError (stejně jako v t212-sync), a to česky:
      // syrové „fetch failed“ uživateli neřekne nic. Původní text do logu.
      reconciliationError = syncErrorText(error);
      logEvent('warn', 'sync.reconciliation_failed', {
        accountId: account.id,
        broker: account.broker,
        error: errorText(error),
      });
    }
  } else {
    // bez OpenPositions nemáme s čím srovnávat — sync ale PROBĚHL, takže
    // warning (jantarově), ne error (červené „synchronizace selhala“)
    reconciliation = {
      ok: false,
      matchedCount: 0,
      unmatchedTickers: [],
      issues: [],
      // prázdné `issues` samo o sobě vypadá jako „pozice sedí“ — tohle říká,
      // že se neporovnávalo nic (B4-4)
      positionsUnavailable: true,
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
