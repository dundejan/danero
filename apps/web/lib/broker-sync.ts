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

/**
 * Rozsah dat, nad kterými rekonciliace běžela (B-6). Rekonciliace porovnává jen
 * OTEVŘENÉ pozice — chybí-li v historii nákup i prodej téhož titulu, zůstatek
 * vyjde a „pozice sedí“ by stálo nad neúplnými daty. Rozsah to musí říct nahlas.
 */
export interface ReconciliationCoverage {
  /** Rok nejstarší transakce, kterou k účtu (a jeho ručním doplňkům) máme. */
  firstYear: number | null;
  /** Rok nejnovější transakce. */
  lastYear: number | null;
  /** Roky, které tento běh u brokera skutečně stáhl (T212 stahuje po letech). */
  syncedYears?: number[];
  /** Roky v rozsahu historie, ze kterých nemáme nic a ani je tento běh neověřil. */
  missingYears: number[];
  /** Prodej převýšil evidovanou pozici → historie nesahá k prvnímu nákupu. */
  historyBeforeFirstBuyMissing: boolean;
  /** Instrumenty, u kterých k prodeji chyběly nakoupené kusy. */
  incompleteIsins: string[];
}

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
  /** Rozsah dat pod rekonciliací — bez něj by „sedí“ nešlo brát vážně. */
  coverage?: ReconciliationCoverage;
}

export type SyncStatus = 'ok' | 'incomplete' | 'mismatch' | 'errors';

/**
 * České popisky stavů syncu — surové enum hodnoty do UI nepatří.
 *
 * `incomplete` je schválně oddělené od `mismatch`: díra v historii (rok, který
 * jsme nikdy nestáhli) NENÍ nesoulad pozic. Tvrdit „pozice nesedí" tam, kde
 * sedí, je stejná lež jako zelené „sedí" nad neúplnými daty — a navíc
 * neodstranitelná, protože API brokera starý rok často doložit nedokáže
 * (IBKR Flex Query pokrývá jen posledních 365 dní).
 */
export const SYNC_STATUS_LABELS: Record<string, string> = {
  ok: 'v pořádku',
  incomplete: 'pozice sedí, historie neúplná',
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
  /**
   * Stažení I zpracování roku doběhlo CELÉ bez výjimky — jen takový rok smí
   * resume plného syncu přeskočit. Chybí u průběhů z dřívějších verzí, ty se
   * proto stáhnou znovu (bezpečný směr: radši čekání navíc než díra v historii).
   */
  complete?: boolean;
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
 * historii (mode se odvozuje z lastSyncedAt). Chyba se ukládá do vlastního
 * sloupce lastSyncError — NESMÍ přepsat lastReconciliation, jinak by recovery
 * zaseknutého jobu zahodilo poslední platné „pozice sedí“.
 */
export async function markAccountSyncError(
  db: Db,
  accountId: string,
  userId: string,
  message: string,
): Promise<void> {
  await db
    .update(brokerAccounts)
    .set({ lastSyncStatus: 'error', lastSyncError: message })
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
  syncedYears: number[] = [],
): Promise<StoredReconciliation> {
  const [own, manual] = await Promise.all([
    loadTransactions(db, userId, broker),
    loadTransactions(db, userId, 'universal'),
  ]);
  const dateOf = (tx: (typeof own)[number]) =>
    tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;
  const txs = [...own, ...manual].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
  const warnings = new WarningCollector();
  const ledger = buildLedger(txs, resolveOptions(), warnings);
  const computed = positionsAt(ledger, atDate).map((position) => ({
    isin: position.isin,
    quantity: position.totalRemaining,
  }));
  const report = reconcilePositions(computed, brokerPositions);
  const coverage = buildCoverage(txs.map(dateOf), syncedYears, warnings, atDate);
  return {
    // zelené „pozice sedí“ nesmí stát nad neúplnou historií — rekonciliace vidí
    // jen otevřené pozice, takže chybějící nákup I prodej téhož titulu by jinak
    // prošel bez povšimnutí
    ok:
      report.ok &&
      unmatchedTickers.length === 0 &&
      !coverage.historyBeforeFirstBuyMissing &&
      coverage.missingYears.length === 0,
    matchedCount: report.matchedIsins.length,
    unmatchedTickers,
    issues: report.issues.map((issue) => ({
      kind: issue.kind,
      isin: issue.isin,
      expected: issue.expectedQuantity.toString(),
      actual: issue.brokerQuantity.toString(),
      ...(issue.suggestedSplitRatio ? { suggestedSplitRatio: issue.suggestedSplitRatio } : {}),
    })),
    coverage,
    ...(report.ok && unmatchedTickers.length === 0 && !coverageComplete(coverage)
      ? { warning: coverageText(coverage) }
      : {}),
  };
}

/**
 * Roky, které u účtu ověřil některý dřívější běh (z uložené rekonciliace).
 * Inkrementální sync stahuje jen běžný rok — bez téhle paměti by roky, které
 * plný sync poctivě ověřil jako prázdné, hned zas vypadaly jako díra v historii.
 */
export function previouslyVerifiedYears(account: BrokerAccountRow): number[] {
  const stored = (account.lastReconciliation ?? null) as StoredReconciliation | null;
  return stored?.coverage?.syncedYears ?? [];
}

/** Rozsah historie + díry v ní: co rekonciliace o úplnosti dat opravdu ví. */
function buildCoverage(
  dates: string[],
  syncedYears: number[],
  warnings: WarningCollector,
  atDate: string,
): ReconciliationCoverage {
  const years = dates.map((date) => Number(date.slice(0, 4))).filter(Number.isFinite);
  const withData = new Set(years);
  const verified = new Set(syncedYears.filter(Number.isFinite));
  const firstYear = years.length > 0 ? Math.min(...years) : null;
  const lastYear = years.length > 0 ? Math.max(...years) : null;
  // rok bez jediné transakce, který tenhle běh ani nestáhl, není „ověřeně
  // prázdný“ — je to díra v historii a časový test i FIFO na ní stojí
  const missingYears: number[] = [];
  if (firstYear !== null) {
    for (let year = firstYear; year <= Number(atDate.slice(0, 4)); year += 1) {
      if (!withData.has(year) && !verified.has(year)) missingYears.push(year);
    }
  }
  // R-04: prodej nad evidovanou pozici = historie nesahá k prvnímu nákupu
  const incompleteIsins = [
    ...new Set(
      warnings.items
        .filter((w) => w.code === 'NEGATIVE_POSITION' || w.code === 'TRANSFER_OUT_EXCEEDS_POSITION')
        .map((w) => String(w.context?.isin ?? ''))
        .filter((isin) => isin !== ''),
    ),
  ];
  return {
    firstYear,
    lastYear,
    ...(verified.size > 0 ? { syncedYears: [...verified].sort((a, b) => a - b) } : {}),
    missingYears,
    historyBeforeFirstBuyMissing: incompleteIsins.length > 0,
    incompleteIsins,
  };
}

const coverageComplete = (coverage: ReconciliationCoverage): boolean =>
  !coverage.historyBeforeFirstBuyMissing && coverage.missingYears.length === 0;

/** Česká věta o díře v datech — UI ji ukazuje místo zeleného „pozice sedí“. */
export function coverageText(coverage: ReconciliationCoverage): string {
  const parts: string[] = [];
  if (coverage.historyBeforeFirstBuyMissing) {
    parts.push(
      `U ${coverage.incompleteIsins.join(', ')} jsme prodali víc kusů, než kolik jich evidujeme — historie nesahá až k prvnímu nákupu. Nahraj CSV výpisy od data, kdy jsi tyhle tituly poprvé koupil.`,
    );
  }
  if (coverage.missingYears.length > 0) {
    parts.push(
      `Z ${coverage.missingYears.length === 1 ? 'roku' : 'let'} ${coverage.missingYears.join(', ')} nemáme ani jednu transakci a synchronizace je neověřila. Pokud jsi tehdy neobchodoval, je vše v pořádku; jinak dohraj výpisy za tyhle roky.`,
    );
  }
  parts.push(
    'Počty kusů u otevřených pozic sedí, ale kontrola pozic neodhalí titul, u kterého ve výpisech chybí nákup i prodej zároveň.',
  );
  return parts.join(' ');
}

/** Jednotné odvození stavu syncu (jediné místo pravdy pro stavy účtu). */
export function deriveSyncStatus(
  errorCount: number,
  reconciliation: StoredReconciliation | null,
): SyncStatus {
  // null = rekonciliaci se nepodařilo provést (přechodná chyba API) — data
  // jsou stažená, ale ověření pozic chybí
  if (errorCount > 0 || !reconciliation) return 'errors';
  if (reconciliation.ok) return 'ok';
  // Pozice sedí a jediná vada je díra v pokrytí → není to nesoulad pozic.
  // Rozlišení je potřeba i proto, že tenhle stav uživatel často nemá jak
  // odstranit (starý rok už z API brokera nedostane).
  const positionsMatch = reconciliation.issues.length === 0 && reconciliation.unmatchedTickers.length === 0;
  return positionsMatch ? 'incomplete' : 'mismatch';
}

export interface FinishSyncOptions {
  /** Přechodné selhání rekonciliace (sync sám proběhl). */
  reconciliationError?: string | null;
  /**
   * Sync sice doběhl bez výjimky, ale výsledek je podezřelý (G-1: prázdný
   * export brokera) — účet se NESMÍ uzavřít jako synchronizovaný, jinak by
   * příští běh jel inkrementálně a plná historie se už nikdy nestáhla.
   */
  incomplete?: string | null;
}

/**
 * Úspěšný závěr syncu: odvodí stav a zapíše ho k účtu — JEDINÉ místo, které
 * smí nastavit lastSyncedAt (známá zrada: po neúspěchu se nastavit nesmí,
 * jinak se plná historie už nestáhne). Tenancy guard přímo v dotazu.
 */
export async function finishBrokerSync(
  db: Db,
  account: BrokerAccountRow,
  reconciliation: StoredReconciliation | null,
  errorCount: number,
  now: Date,
  options: FinishSyncOptions = {},
): Promise<SyncStatus> {
  const incomplete = options.incomplete ?? null;
  const status: SyncStatus | 'error' = incomplete
    ? 'error'
    : deriveSyncStatus(errorCount, reconciliation);
  await db
    .update(brokerAccounts)
    .set({
      // podezřelý běh se NEuzavírá: bez lastSyncedAt zůstane příští sync plný
      ...(incomplete ? {} : { lastSyncedAt: now }),
      lastSyncStatus: status,
      // přechodné selhání rekonciliace jde do lastSyncError; poslední platná
      // rekonciliace („pozice sedí“) se v tom případě NEpřepisuje
      lastSyncError: incomplete ?? options.reconciliationError ?? null,
      ...(reconciliation && !incomplete ? { lastReconciliation: reconciliation } : {}),
    })
    .where(and(eq(brokerAccounts.id, account.id), eq(brokerAccounts.userId, account.userId)));
  const { logAudit } = await import('@/lib/audit');
  await logAudit(db, account.userId, 'SYNC', `${account.broker} (${account.label})`);
  return incomplete ? 'errors' : (status as SyncStatus);
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
