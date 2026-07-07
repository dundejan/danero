import {
  mapPositionsToIsin,
  reconcilePositions,
  Trading212ApiError,
  Trading212Client,
  type RowIssue,
} from '@danero/importers';
import { buildLedger, positionsAt, resolveOptions, WarningCollector } from '@danero/engine';
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { decryptSecret } from '@/lib/crypto';
import {
  detectAndParse,
  importParsed,
  loadDedupeKeys,
  type ImportSummary,
} from '@/lib/import-service';
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

export type SyncStatus = 'ok' | 'mismatch' | 'errors';

export interface SyncOutcome {
  batches: ImportSummary[];
  yearsCovered: number[];
  added: number;
  duplicates: number;
  errors: RowIssue[];
  reconciliation: StoredReconciliation;
  status: SyncStatus;
}

/** Rekonciliace „nedoběhla" — jediný tvar pro všechna chybová místa. */
export function emptyReconciliation(error: string): StoredReconciliation {
  return { ok: false, matchedCount: 0, unmatchedTickers: [], issues: [], error };
}

/**
 * Propíše chybu syncu k broker účtu (ukazuje ji /import). U 403 doplní nápovědu
 * k oprávněním T212 klíče. POZOR: lastSyncedAt se při chybě NIKDY nenastavuje —
 * jinak by další pokus přeskočil plnou historii (mode se odvozuje z lastSyncedAt).
 */
export async function markAccountSyncError(
  db: Db,
  accountId: string,
  userId: string,
  message: string,
): Promise<void> {
  const explained = message.includes('403')
    ? `${message} — klíč zřejmě nemá potřebná oprávnění (Account data, History + podkategorie, Metadata, Portfolio). Vygeneruj nový klíč podle návodu v nastavení.`
    : message;
  await db
    .update(brokerAccounts)
    .set({ lastSyncStatus: 'error', lastReconciliation: emptyReconciliation(explained) })
    .where(and(eq(brokerAccounts.id, accountId), eq(brokerAccounts.userId, userId)));
}

/** Stav jednoho roku v průběhu syncu — pro progress UI. */
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
  mode: 'full' | 'incremental';
  years: SyncYearProgress[];
}

export interface SyncOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
  pollIntervalMs?: number;
  /** Default: 'full' při první synchronizaci účtu, jinak 'incremental'. */
  mode?: 'full' | 'incremental';
  /** Průběžné hlášení stavu (job runner ho zapisuje do DB pro UI). */
  onProgress?: (progress: SyncProgress) => void | Promise<void>;
}

/** T212 Invest existuje od ~2017 — pod tento rok nemá smysl exporty žádat. */
const T212_MIN_YEAR = 2016;

/** Uložené přihlašovací údaje: nový formát JSON {keyId, secret}, starší = samotný klíč. */
interface StoredCredentials {
  keyId?: string;
  secret: string;
}

function parseCredentials(encrypted: string): StoredCredentials {
  const plain = decryptSecret(encrypted);
  try {
    const parsed = JSON.parse(plain) as { keyId?: unknown; secret?: unknown };
    if (typeof parsed?.secret === 'string') {
      return {
        keyId: typeof parsed.keyId === 'string' && parsed.keyId !== '' ? parsed.keyId : undefined,
        secret: parsed.secret,
      };
    }
  } catch {
    // starší formát: plaintext je přímo klíč
  }
  return { secret: plain };
}

/**
 * T212 dokumentace je nejednoznačná v tom, zda se autentizuje párem ID+secret
 * (HTTP Basic), nebo samotným tajným klíčem v Authorization. Ověříme si to sami
 * levným getCash(): zkusíme Basic, na 401 spadneme na samotný secret.
 */
/**
 * Testovací háky pro E2E (mock server, rychlý poll). Mimo produkci ZÁMĚRNĚ —
 * omylem nastavená T212_API_BASE_URL v produkci by tiše přesměrovala provoz
 * včetně API klíčů v hlavičkách na cizí host.
 */
const isProduction = () => process.env.NODE_ENV === 'production';

function testBaseUrl(): string | undefined {
  if (isProduction()) return undefined;
  return process.env.T212_API_BASE_URL || undefined;
}

function defaultPollIntervalMs(): number {
  if (!isProduction()) {
    const fromEnv = Number(process.env.T212_POLL_INTERVAL_MS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  }
  // GET /history/exports snese ~1 dotaz/min — pomalejší poll je nutnost, ne opatrnost
  return 65_000;
}

async function resolveClient(
  credentials: StoredCredentials,
  fetchImpl?: typeof fetch,
): Promise<Trading212Client> {
  const baseUrl = testBaseUrl();
  const clientOptions = {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  };
  const candidates: Trading212Client[] = [];
  if (credentials.keyId) {
    candidates.push(
      new Trading212Client({
        apiKey: credentials.keyId,
        apiSecret: credentials.secret,
        ...clientOptions,
      }),
    );
  }
  candidates.push(new Trading212Client({ apiKey: credentials.secret, ...clientOptions }));

  let lastError: unknown;
  for (const client of candidates) {
    try {
      await client.getCash();
      return client;
    } catch (error) {
      lastError = error;
      // jen 401 znamená „špatná varianta autentizace" — jiné chyby (403 práva,
      // síť…) rovnou probublají, ať je uživatel vidí
      if (error instanceof Trading212ApiError && error.status === 401) continue;
      throw error;
    }
  }
  throw lastError;
}

/**
 * Synchronizace T212 (docs/03): stačí API klíč. První běh projde SMYČKOU všechny
 * roky od založení účtu (dokud dva po sobě jdoucí roky nejsou prázdné), další běhy
 * stahují jen běžný rok. Každý rok = serverem vygenerovaný CSV export → stejný
 * parser a dedupe jako ruční upload (idempotentní). Ruční CSV je záložní varianta.
 * Po importu rekonciliace pozic proti API (detekce chybějících korporátních akcí).
 */
export async function syncTrading212(
  db: Db,
  account: BrokerAccountRow,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  const currentYear = now.getUTCFullYear();
  // Plná historie: dokud neproběhl žádný ÚSPĚŠNÝ sync. Po chybě se vždy zkouší
  // znovu celá (dedupe zaručí, že se nic nezdvojí — jen se dotáhne, co chybělo).
  const mode =
    options.mode ??
    (account.lastSyncedAt && account.lastSyncStatus !== 'error' ? 'incremental' : 'full');

  const yearProgress: SyncYearProgress[] = [];
  const report = async (phase: SyncProgress['phase']) => {
    await options.onProgress?.({ phase, mode, years: yearProgress });
  };

  await report('connecting');
  const client = await resolveClient(
    parseCredentials(account.credentialsEncrypted),
    options.fetchImpl,
  );
  const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs();

  const batches: ImportSummary[] = [];
  const yearsCovered: number[] = [];
  // dedupe klíče jednou za sync, ne per rok — importParsed do množiny doplňuje
  const dedupeKeys = await loadDedupeKeys(db, account.userId);
  let emptyStreak = 0;

  for (let year = currentYear; year >= T212_MIN_YEAR; year -= 1) {
    const current: SyncYearProgress = { year, status: 'running' };
    yearProgress.push(current);
    await report('exporting');
    const csv = await client.fetchHistoryCsv(
      {
        timeFrom: `${year}-01-01T00:00:00Z`,
        timeTo:
          year === currentYear
            ? `${now.toISOString().slice(0, 19)}Z`
            : `${year}-12-31T23:59:59Z`,
        dataIncluded: {
          includeOrders: true,
          includeDividends: true,
          includeTransactions: true,
          includeInterest: true,
        },
      },
      pollIntervalMs,
      600_000,
    );
    const parsed = detectAndParse(csv);
    yearsCovered.push(year);

    const hasContent =
      parsed.transactions.length > 0 ||
      parsed.errors.length > 0 ||
      parsed.skipped.length > 0 ||
      parsed.warnings.length > 0;
    if (hasContent) {
      const batch = await importParsed(
        db,
        account.userId,
        `t212-api-${year}.csv`,
        parsed,
        dedupeKeys,
      );
      batches.push(batch);
      current.added = batch.added;
      current.duplicates = batch.duplicates;
      if (batch.errors.length > 0) current.errors = batch.errors.length;
    }
    // „empty" jen když v roce opravdu nic nebylo — rok plný chybových řádků
    // musí v průběhu ukázat počty, ne „žádné transakce"
    current.status = hasContent ? 'done' : 'empty';

    // Rok bez jediné transakce počítáme jako prázdný VŽDY (i kdyby parser hlásil
    // chyby — nesmí nám resetovat počítadlo a prohnat smyčku až do 2016).
    if (parsed.transactions.length === 0) {
      emptyStreak += 1;
      if (mode === 'incremental' || emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
      if (mode === 'incremental') break;
    }
  }

  await report('reconciling');
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
    reconciliation = emptyReconciliation(error instanceof Error ? error.message : String(error));
  }

  const added = batches.reduce((sum, batch) => sum + batch.added, 0);
  const duplicates = batches.reduce((sum, batch) => sum + batch.duplicates, 0);
  const errors = batches.flatMap((batch) => batch.errors);

  const status: SyncStatus = errors.length > 0 ? 'errors' : reconciliation.ok ? 'ok' : 'mismatch';
  await db
    .update(brokerAccounts)
    .set({ lastSyncedAt: now, lastSyncStatus: status, lastReconciliation: reconciliation })
    .where(eq(brokerAccounts.id, account.id));

  return { batches, yearsCovered, added, duplicates, errors, reconciliation, status };
}
