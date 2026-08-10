import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { deleteInBatches } from '@/lib/retention';
import { ts } from '@/lib/sql';
import { brokerAccounts, jobs } from '@/db/schema';
import type { SyncJobView } from '@/components/sync-job-progress';
import {
  markAccountSyncError,
  type SyncProgress,
  type SyncStatus,
  type SyncYearProgress,
} from '@/lib/broker-sync';
import { isUniqueViolation } from '@/lib/db-errors';
import { errorText } from '@/lib/log';
import { syncIbkr } from '@/lib/ibkr-sync';
import { explainT212SyncError, syncTrading212, type SyncOptions } from '@/lib/t212-sync';

/**
 * Background joby (docs/09, G1). Zvolený model zpracování:
 *
 * 1. Server action job zapíše (`pending`) a hned vrátí odpověď — UI nečeká.
 * 2. Zpracování startuje `after()` z next/server po odeslání odpovědi (funguje
 *    lokálně v `next dev/start` i na Vercelu, kde `after()` prodlužuje život funkce).
 * 3. Záchranné sítě pro joby zabité restartem procesu: cron tick /api/cron/jobs
 *    (globálně) a samoléčba při čtení v latestSyncJob/enqueueSyncJob (per uživatel —
 *    zaseknutý job nikdy trvale neblokuje UI, ani když cron neběží, např. v dev).
 *
 * Souběh řeší DB: převzetí jobu je atomický UPDATE podmíněný `status = 'pending'`
 * a unikátní index jobs_active_unique_idx pouští nejvýš jeden aktivní job na
 * (uživatel, typ, dedupeKey) — klik uživatele a cron tick se nikdy neporvou.
 */

export type JobRow = typeof jobs.$inferSelect;

export const JOB_TYPE_T212_SYNC = 't212-sync';
export const JOB_TYPE_IBKR_SYNC = 'ibkr-sync';

/** Všechny typy sync jobů — /import a polling se dívají napříč brokery. */
const SYNC_JOB_TYPES = [JOB_TYPE_T212_SYNC, JOB_TYPE_IBKR_SYNC];

/** Typ jobu pro broker účet; vyhodí na neznámém brokeru (nový broker = doplnit sem). */
export function jobTypeForBroker(broker: string): string {
  if (broker === 'trading212') return JOB_TYPE_T212_SYNC;
  if (broker === 'ibkr') return JOB_TYPE_IBKR_SYNC;
  throw new Error(`Broker ${broker} nemá synchronizační job.`);
}

interface SyncJobPayload {
  accountId: string;
}

export interface SyncJobResult {
  added: number;
  duplicates: number;
  errorCount: number;
  yearsCovered?: number[];
  syncStatus: SyncStatus;
}

/** Volby běhu pro testy (mock fetch, rychlý poll, deterministický čas). */
export type JobRunOptions = Pick<SyncOptions, 'fetchImpl' | 'pollIntervalMs' | 'now'> & {
  /** Strop pro jeden tick cronu (G-P5) — po jeho překročení se další job už nezačíná. */
  budgetMs?: number;
};

/**
 * Rozpočet jednoho ticku. `maxDuration` cronu je 800 s; necháváme si rezervu,
 * aby se stihl dopsat výsledek a odpověď — utnutá funkce by nechala job viset
 * v `running` až do `recoverStaleJobs`.
 */
const DEFAULT_JOB_BUDGET_MS = 600_000;

/**
 * Job bez známky života déle než 15 minut = mrtvý proces. Sync zapisuje heartbeat
 * s každou změnou průběhu; nejdelší tichý úsek je čekání na export jednoho roku
 * (max 10 min), 15 minut je tedy bezpečná rezerva.
 */
const STALE_AFTER_MS = 15 * 60_000;

const STALE_MESSAGE =
  'Zpracování bylo přerušeno (nejspíš restart serveru). Spusť synchronizaci znovu — nic se nezdvojí.';

const ACTIVE_STATUSES = ['pending', 'running'] as const;

const isActive = (job: JobRow): boolean =>
  job.status === 'pending' || job.status === 'running';

const STALE_PENDING_AFTER_MS = 24 * 60 * 60_000;

const isStale = (job: JobRow, now: Date): boolean => {
  const lastAlive = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
  // pending ve frontě denního cronu čeká legitimně i desítky minut (T212
  // limit 1 req/min, účty sekvenčně) — mrtvý je až po dni; running po 15 min
  const threshold = job.status === 'pending' ? STALE_PENDING_AFTER_MS : STALE_AFTER_MS;
  return lastAlive.getTime() <= now.getTime() - threshold;
};

const jobPayload = (job: JobRow): Partial<SyncJobPayload> =>
  (job.payload ?? {}) as Partial<SyncJobPayload>;

/** Registr handlerů — nový typ jobu sem jen přidá záznam. */
const JOB_HANDLERS: Record<
  string,
  (db: Db, job: JobRow, options: JobRunOptions) => Promise<unknown>
> = {
  [JOB_TYPE_T212_SYNC]: runT212SyncJob,
  [JOB_TYPE_IBKR_SYNC]: runIbkrSyncJob,
};

/**
 * Zařadí sync job pro účet; existující aktivní job vrátí (žádné dvojité
 * synchronizace), zaseknutý nejdřív dorovná na error. Volající spouští zpracování
 * jen pro `pending` job — atomický claim zaručí, že poběží právě jednou.
 */
export async function enqueueSyncJob(
  db: Db,
  userId: string,
  accountId: string,
  type: string,
): Promise<JobRow> {
  const now = new Date();
  const active = await findActiveJob(db, userId, accountId, type);
  if (active) {
    if (!isStale(active, now)) return active;
    await recoverJob(db, active, now);
  }

  try {
    const inserted = await db
      .insert(jobs)
      .values({
        id: crypto.randomUUID(),
        userId,
        type,
        dedupeKey: accountId,
        payload: { accountId } satisfies SyncJobPayload,
      })
      .returning();
    return inserted[0]!;
  } catch (error) {
    // 23505 = unique_violation na jobs_active_unique_idx: souběžný enqueue vyhrál
    if (!isUniqueViolation(error)) throw error;
    const winner = await findActiveJob(db, userId, accountId, type);
    if (winner) return winner;
    throw error;
  }
}

async function findActiveJob(
  db: Db,
  userId: string,
  accountId: string,
  type: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, type),
        eq(jobs.dedupeKey, accountId),
        inArray(jobs.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Atomické převzetí jobu: pending → running. Vrátí null, když ho vzal někdo jiný. */
async function claimJob(db: Db, jobId: string, now: Date): Promise<JobRow | null> {
  const claimed = await db
    .update(jobs)
    .set({ status: 'running', startedAt: now, heartbeatAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'pending')))
    .returning();
  return claimed[0] ?? null;
}

/**
 * Zpracuje jeden job (claim + běh + zápis výsledku) a vrátí jeho konečný stav
 * (null = job nebyl pending). Nikdy nevyhazuje — chyby končí ve sloupci `error`,
 * protože běží na pozadí a nemá je kdo chytit. Finální zápis je podmíněný
 * `status = 'running'`: job mezitím dorovnaný recovery nesmí pomalý proces přepsat.
 */
export async function processJob(
  db: Db,
  jobId: string,
  options: JobRunOptions = {},
): Promise<JobRow | null> {
  const job = await claimJob(db, jobId, options.now ?? new Date());
  if (!job) return null;

  const { logEvent } = await import('@/lib/log');
  const startedAt = performance.now();
  logEvent('info', 'job.started', { jobId: job.id, type: job.type });

  let outcome: { status: 'success'; result: unknown } | { status: 'error'; error: string };
  try {
    const handler = JOB_HANDLERS[job.type];
    if (!handler) throw new Error(`Neznámý typ jobu: ${job.type}`);
    outcome = { status: 'success', result: await handler(db, job, options) };
  } catch (error) {
    outcome = { status: 'error', error: errorText(error) };
  }
  logEvent(outcome.status === 'error' ? 'error' : 'info', 'job.finished', {
    jobId: job.id,
    type: job.type,
    status: outcome.status,
    durationMs: Math.round(performance.now() - startedAt),
    ...(outcome.status === 'error' ? { error: outcome.error } : {}),
  });

  const finished = await db
    .update(jobs)
    .set({
      status: outcome.status,
      result: outcome.status === 'success' ? outcome.result : undefined,
      error: outcome.status === 'error' ? outcome.error : undefined,
      finishedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'running')))
    .returning();
  return finished[0] ?? null;
}

/** Společný rám sync handlerů: načtení účtu (s tenancy guardem) + progress zápis. */
async function withSyncAccount<T>(
  db: Db,
  job: JobRow,
  run: (
    account: typeof brokerAccounts.$inferSelect,
    onProgress: (progress: SyncProgress) => Promise<void>,
  ) => Promise<T>,
  explainError: (message: string) => string = (message) => message,
): Promise<T> {
  const { accountId } = jobPayload(job);
  const accounts = accountId
    ? await db
        .select()
        .from(brokerAccounts)
        .where(and(eq(brokerAccounts.id, accountId), eq(brokerAccounts.userId, job.userId)))
    : [];
  const account = accounts[0];
  if (!account) throw new Error('Účet u brokera už neexistuje.');

  const onProgress = async (progress: SyncProgress) => {
    // odpojení účtu uprostřed běhu musí sync zastavit — jinak by „odpojený“
    // broker ještě minuty zapisoval transakce do portfolia
    const stillThere = await db
      .select({ id: brokerAccounts.id })
      .from(brokerAccounts)
      .where(eq(brokerAccounts.id, account.id));
    if (stillThere.length === 0) {
      throw new Error('Účet u brokera byl během synchronizace odpojen — sync přerušen.');
    }
    // podmínka na running: job dorovnaný recovery už průběh aktualizovat nesmí
    await db
      .update(jobs)
      .set({ progress, heartbeatAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running')));
  };

  try {
    return await run(account, onProgress);
  } catch (error) {
    await markAccountSyncError(
      db,
      account.id,
      job.userId,
      explainError(errorText(error)),
    );
    throw error;
  }
}

/**
 * Průběh posledního NEúspěšného plného syncu účtu (jobs.progress přežívá
 * dorovnání na error) — nový plný běh z něj přeskočí už dokončené roky.
 * Plný T212 sync (poll exportu ~65 s za KAŽDÝ rok) se jinak na serverless
 * platformě nikdy nedokončí: každý pokus by čekání platil celé znovu.
 */
async function fullSyncResume(
  db: Db,
  job: JobRow,
): Promise<{ years: SyncYearProgress[]; syncedAt: Date } | undefined> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, job.userId),
        eq(jobs.type, job.type),
        eq(jobs.dedupeKey, job.dedupeKey),
        eq(jobs.status, 'error'),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const failed = rows[0];
  if (!failed) return undefined;
  const progress = (failed.progress ?? null) as SyncProgress | null;
  if (progress?.mode !== 'full' || !progress.years || progress.years.length === 0) {
    return undefined;
  }
  // základ 7denní rezervy = START neúspěšného běhu: finishedAt může být až čas
  // pozdějšího recovery (dorovnání zaseknutého jobu), což by rezervu posunulo
  // a ocas posledního staženého roku by se už nikdy nestáhl
  return { years: progress.years, syncedAt: failed.startedAt ?? failed.createdAt };
}

/** Běh T212 sync jobu — průběh se zapisuje do jobs.progress, ať ho UI může pollovat. */
async function runT212SyncJob(
  db: Db,
  job: JobRow,
  options: JobRunOptions,
): Promise<SyncJobResult> {
  return withSyncAccount(
    db,
    job,
    async (account, onProgress) => {
      const resume = await fullSyncResume(db, job);
      const outcome = await syncTrading212(db, account, {
        ...options,
        onProgress,
        ...(resume ? { resume } : {}),
      });
      return {
        added: outcome.added,
        duplicates: outcome.duplicates,
        errorCount: outcome.errors.length,
        yearsCovered: outcome.yearsCovered,
        syncStatus: outcome.status,
      };
    },
    explainT212SyncError,
  );
}

/** Běh IBKR sync jobu (Flex Web Service). */
async function runIbkrSyncJob(
  db: Db,
  job: JobRow,
  options: JobRunOptions,
): Promise<SyncJobResult> {
  return withSyncAccount(db, job, async (account, onProgress) => {
    const outcome = await syncIbkr(db, account, { ...options, onProgress });
    return {
      added: outcome.added,
      duplicates: outcome.duplicates,
      errorCount: outcome.errors.length,
      syncStatus: outcome.status,
    };
  });
}

/** Dorovná jeden zaseknutý job na error (podmíněně — jen pokud je pořád aktivní). */
async function recoverJob(db: Db, job: JobRow, now: Date): Promise<void> {
  const updated = await db
    .update(jobs)
    .set({ status: 'error', error: STALE_MESSAGE, finishedAt: now })
    .where(and(eq(jobs.id, job.id), inArray(jobs.status, [...ACTIVE_STATUSES])))
    .returning({ id: jobs.id });
  if (!updated[0]) return;

  const { accountId } = jobPayload(job);
  if (SYNC_JOB_TYPES.includes(job.type) && accountId) {
    await markAccountSyncError(db, accountId, job.userId, STALE_MESSAGE);
  }
}

/**
 * Globální dorovnání running jobů bez známky života (cron). Pending joby se tu
 * záměrně nechávají: v cron frontě mohou legitimně čekat dlouho (sekvenční
 * zpracování účtů) — osiřelé pending joby řeší per-user samoléčba v latestSyncJob.
 */
export async function recoverStaleJobs(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const recovered = await db
    .update(jobs)
    .set({ status: 'error', error: STALE_MESSAGE, finishedAt: now })
    .where(
      and(
        eq(jobs.status, 'running'),
        sql`coalesce(${jobs.heartbeatAt}, ${jobs.startedAt}, ${jobs.createdAt}) <= ${ts(cutoff)}`,
      ),
    )
    .returning();

  for (const job of recovered) {
    const { accountId } = jobPayload(job);
    if (SYNC_JOB_TYPES.includes(job.type) && accountId) {
      await markAccountSyncError(db, accountId, job.userId, STALE_MESSAGE);
    }
  }
  return recovered.length;
}

export interface ProcessedJobSummary {
  jobId: string;
  type: string;
  status: string;
  error: string | null;
}

/**
 * Cron tick: dorovná zaseknuté joby a sekvenčně zpracuje čekající (T212 limity
 * i PGlite jediné připojení — paralelismus tu nedává smysl). Vrací výsledek
 * per job, ať je selhání vidět v monitoringu cronu.
 */
export async function processPendingJobs(
  db: Db,
  options: JobRunOptions = {},
): Promise<{ recovered: number; results: ProcessedJobSummary[]; deferred: number }> {
  const recovered = await recoverStaleJobs(db, options.now ?? new Date());
  const pending = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.status, 'pending'))
    .orderBy(asc(jobs.createdAt));

  // G-P5: běh je sekvenční schválně (limity T212, jediné připojení PGlite),
  // ale neměl strop. Na Vercelu funkci utne `maxDuration` uprostřed jobu:
  // rozpracovaný job zůstane `running` a čeká na `recoverStaleJobs`, a joby
  // za ním se ten tick vůbec nespustí — a nikde to není vidět. S rozpočtem
  // se doběhne rozdělaný job, zbytek zůstane `pending` na další tick a počet
  // odložených jde do výsledku, odkud ho `withCron` propíše do logu.
  const budgetMs = options.budgetMs ?? DEFAULT_JOB_BUDGET_MS;
  const startedAt = Date.now();
  const results: ProcessedJobSummary[] = [];
  let deferred = 0;
  for (const row of pending) {
    if (results.length > 0 && Date.now() - startedAt > budgetMs) {
      deferred = pending.length - results.length;
      break;
    }
    const finished = await processJob(db, row.id, options);
    if (finished) {
      results.push({
        jobId: finished.id,
        type: finished.type,
        status: finished.status,
        error: finished.error,
      });
    }
  }
  return { recovered, results, deferred };
}

/**
 * Aktivní sync joby uživatele klíčované accountId (dedupeKey) — jeden dotaz
 * pro /import. Zaseknuté joby (včetně jobů mezitím odpojených účtů) cestou
 * dorovná na error, takže UI nikdy nezůstane zamčené.
 */
export async function activeSyncJobsByAccount(
  db: Db,
  userId: string,
): Promise<Map<string, JobRow>> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.type, SYNC_JOB_TYPES),
        inArray(jobs.status, [...ACTIVE_STATUSES]),
      ),
    )
    .orderBy(desc(jobs.createdAt));

  const now = new Date();
  const byAccount = new Map<string, JobRow>();
  for (const job of rows) {
    if (isStale(job, now)) {
      await recoverJob(db, job, now);
      continue;
    }
    if (job.dedupeKey && !byAccount.has(job.dedupeKey)) byAccount.set(job.dedupeKey, job);
  }
  return byAccount;
}

/**
 * Poslední sync job uživatele (volitelně zúžený na jeden broker účet) — pro
 * /import (initial render i polling endpoint). Samoléčba na čtení: zaseknutý
 * job (pending i running) se rovnou dorovná na error, aby nikdy trvale
 * neblokoval sync tlačítko v UI.
 */
export async function latestSyncJob(
  db: Db,
  userId: string,
  accountId?: string,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        inArray(jobs.type, SYNC_JOB_TYPES),
        ...(accountId ? [eq(jobs.dedupeKey, accountId)] : []),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  const job = rows[0];
  if (!job) return null;

  const now = new Date();
  if (isActive(job) && isStale(job, now)) {
    await recoverJob(db, job, now);
    const refreshed = await db.select().from(jobs).where(eq(jobs.id, job.id));
    return refreshed[0] ?? null;
  }
  return job;
}

/** Tvar jobu pro klienta — jediné mapování pro RSC props i /api/jobs/latest. */
export function toSyncJobView(job: JobRow): SyncJobView {
  return {
    status: job.status,
    progress: (job.progress ?? null) as SyncProgress | null,
  };
}

/** Kolik dní držíme záznamy o synchronizacích — /soukromi slibuje 90 dní. */
const JOB_RETENTION_DAYS = 90;

/**
 * Úklid starých jobů. `/soukromi` slibuje u záznamů o synchronizacích 90 dní,
 * ale tabulka dosud jen rostla.
 *
 * Poslední job každého klíče zůstává bez ohledu na stáří: `jobs.progress`
 * neúspěšného plného syncu nese stav per rok a slouží jako resume pro T212
 * (známá zrada z CLAUDE.md). Smazat ho by znamenalo stahovat historii od nuly —
 * nebo, hůř, považovat nedotažené roky za hotové.
 *
 * Výběr i mazání běží celé v SQL a po dávkách. Původní verze si natáhla všechna
 * id do paměti a poslala je do jednoho `IN (…)`: nad 65 534 parametry dotaz
 * spadl, nesmazal nic, backlog nikdy neklesl a denní údržba tím byla rozbitá
 * natrvalo (audit G-R2).
 */
export async function pruneJobs(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - JOB_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const newestPerKey = db
    .selectDistinctOn([jobs.dedupeKey], { id: jobs.id })
    .from(jobs)
    .orderBy(jobs.dedupeKey, desc(jobs.createdAt));

  return deleteInBatches((limit) =>
    db
      .delete(jobs)
      .where(
        inArray(
          jobs.id,
          db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(lt(jobs.createdAt, cutoff), notInArray(jobs.id, newestPerKey)))
            .limit(limit),
        ),
      )
      .returning({ id: jobs.id }),
  );
}
