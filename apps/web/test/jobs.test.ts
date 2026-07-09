import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { portfolios, brokerAccounts, importBatches, jobs, user } from '@/db/schema';
import { encryptSecret } from '@/lib/crypto';
import {
  enqueueSyncJob,
  latestSyncJob,
  processJob,
  processPendingJobs,
  recoverStaleJobs,
} from '@/lib/jobs';
import type { SyncProgress } from '@/lib/broker-sync';
import { makeMockFetch, MOCK_CREDENTIALS } from './t212-mock';

async function setupAccount(db: Db, userId = 'u1') {
  await db.insert(user).values({ id: userId, name: 'Test', email: `${userId}@danero.cz` });
  await db.insert(portfolios).values({ id: `pf-${userId}`, userId, name: 'Moje portfolio' });
  await db.insert(brokerAccounts).values({
    id: `acc-${userId}`,
    userId,
    portfolioId: `pf-${userId}`,
    broker: 'trading212',
    credentialsEncrypted: encryptSecret(MOCK_CREDENTIALS),
  });
  return `acc-${userId}`;
}

const NOW = new Date('2026-07-07T12:00:00Z');
const HOUR_AGO = new Date(NOW.getTime() - 60 * 60_000);

describe('background joby (in-memory PGlite)', () => {
  it(
    'enqueue je idempotentní per účet: druhé zařazení vrátí týž aktivní job, jiný účet dostane vlastní',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);

      const first = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');
      expect(first.status).toBe('pending');
      const second = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');
      expect(second.id).toBe(first.id);
      expect(await db.select().from(jobs)).toHaveLength(1);

      // jiný účet (po přepojení klíče vzniká nové id) není blokovaný cizím aktivním jobem
      await db.insert(brokerAccounts).values({
        id: 'acc-u1-novy',
        userId: 'u1',
        portfolioId: 'pf-u1',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(MOCK_CREDENTIALS),
      });
      const other = await enqueueSyncJob(db, 'u1', 'acc-u1-novy', 't212-sync');
      expect(other.id).not.toBe(first.id);
      expect(other.status).toBe('pending');
    },
  );

  it(
    'unikátní index aktivních jobů: přímý souběžný INSERT druhého aktivního jobu selže',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);
      await enqueueSyncJob(db, 'u1', accountId, 't212-sync');

      const race = db.insert(jobs).values({
        id: 'zavodnik',
        userId: 'u1',
        type: 't212-sync',
        dedupeKey: accountId,
        payload: { accountId },
      });
      // drizzle chybu balí — unique violation (23505) je v cause řetězu
      const error = await race.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      const codes: string[] = [];
      for (let e = error as Error | undefined; e instanceof Error; e = e.cause as Error) {
        codes.push((e as { code?: string }).code ?? '');
        if (!(e.cause instanceof Error)) break;
      }
      expect(codes).toContain('23505');

      // a enqueue race přežije: vrátí vítězný job místo výjimky
      const survived = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');
      expect(survived.status).toBe('pending');
    },
  );

  it(
    'processJob: plný sync doběhne, zapisuje průběh po letech a výsledek',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);
      const job = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');

      const mock = makeMockFetch();
      const finished = await processJob(db, job.id, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });

      expect(finished?.status).toBe('success');
      expect(finished?.startedAt).not.toBeNull();
      expect(finished?.finishedAt).not.toBeNull();
      expect(finished?.error).toBeNull();

      const result = finished?.result as {
        added: number;
        yearsCovered: number[];
        syncStatus: string;
      };
      expect(result.added).toBe(2);
      expect(result.yearsCovered).toEqual([2026, 2025, 2024, 2023, 2022]);
      expect(result.syncStatus).toBe('ok');

      // průběh: všechny roky uzavřené, s počty u neprázdných
      const progress = finished?.progress as SyncProgress;
      expect(progress.mode).toBe('full');
      expect(progress.years!.map((y) => [y.year, y.status])).toEqual([
        [2026, 'done'],
        [2025, 'empty'],
        [2024, 'done'],
        [2023, 'empty'],
        [2022, 'empty'],
      ]);
      expect(progress.years![0]!.added).toBe(1);

      const account = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId))
      )[0]!;
      expect(account.lastSyncStatus).toBe('ok');
      expect(account.lastSyncedAt).not.toBeNull();

      // hotový job se znovu nespustí (claim vyžaduje pending)
      const batchesBefore = (await db.select().from(importBatches)).length;
      const again = await processJob(db, job.id, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });
      expect(again).toBeNull();
      expect((await db.select().from(importBatches)).length).toBe(batchesBefore);
    },
  );

  it(
    'processJob: chyba API skončí v jobs.error i u účtu, lastSyncedAt zůstane prázdný',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);
      const job = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');

      const mock = makeMockFetch({ failExports: true });
      const finished = await processJob(db, job.id, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });

      expect(finished?.status).toBe('error');
      expect(finished?.error).toContain('403');

      const account = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId))
      )[0]!;
      expect(account.lastSyncStatus).toBe('error');
      // klíčový invariant: po chybě se lastSyncedAt nenastavuje (plná historie se dotáhne)
      expect(account.lastSyncedAt).toBeNull();
      const reconciliation = account.lastReconciliation as { error?: string };
      expect(reconciliation.error).toContain('oprávnění');
    },
  );

  it('processJob: neznámý typ jobu skončí chybou, ne T212 cestou', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'u1@danero.cz' });
      await db.insert(portfolios).values({ id: 'pf-' + 'u1', userId: 'u1', name: 'Moje portfolio' });
    await db.insert(jobs).values({
      id: 'cizi-typ',
      userId: 'u1',
      type: 'xtb-sync',
      dedupeKey: 'acc-x',
      payload: {},
    });

    const finished = await processJob(db, 'cizi-typ');
    expect(finished?.status).toBe('error');
    expect(finished?.error).toContain('Neznámý typ jobu');
  });

  it(
    'recoverStaleJobs: running bez heartbeatu → error (a nový enqueue projde)',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);

      await db.insert(jobs).values({
        id: 'stale-1',
        userId: 'u1',
        type: 't212-sync',
        dedupeKey: accountId,
        status: 'running',
        payload: { accountId },
        startedAt: HOUR_AGO,
        heartbeatAt: HOUR_AGO,
      });
      // čerstvý running (jiného uživatele) se dorovnat nesmí
      await db.insert(user).values({ id: 'u2', name: 'Test 2', email: 'u2@danero.cz' });
      await db.insert(portfolios).values({ id: 'pf-' + 'u2', userId: 'u2', name: 'Moje portfolio' });
      await db.insert(jobs).values({
        id: 'fresh-1',
        userId: 'u2',
        type: 't212-sync',
        dedupeKey: 'acc-jiny',
        status: 'running',
        payload: {},
        startedAt: NOW,
        heartbeatAt: NOW,
      });

      const recovered = await recoverStaleJobs(db, NOW);
      expect(recovered).toBe(1);

      const stale = (await db.select().from(jobs).where(eq(jobs.id, 'stale-1')))[0]!;
      expect(stale.status).toBe('error');
      expect(stale.error).toContain('přerušeno');
      const fresh = (await db.select().from(jobs).where(eq(jobs.id, 'fresh-1')))[0]!;
      expect(fresh.status).toBe('running');

      const account = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId))
      )[0]!;
      expect(account.lastSyncStatus).toBe('error');

      // po dorovnání jde zařadit nový job (starý už není aktivní)
      const next = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');
      expect(next.id).not.toBe('stale-1');
      expect(next.status).toBe('pending');
    },
  );

  it(
    'latestSyncJob: zaseknutý pending job se při čtení sám dorovná (UI se nikdy nezamkne)',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);

      // osiřelý pending: proces umřel mezi INSERTem a after() — nikdo ho neclaimnul
      await db.insert(jobs).values({
        id: 'sirotek',
        userId: 'u1',
        type: 't212-sync',
        dedupeKey: accountId,
        payload: { accountId },
        createdAt: HOUR_AGO,
      });

      const seen = await latestSyncJob(db, 'u1');
      expect(seen?.id).toBe('sirotek');
      expect(seen?.status).toBe('error');
      expect(seen?.error).toContain('přerušeno');

      // čerstvý pending se dorovnat nesmí
      const freshJob = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');
      const stillPending = await latestSyncJob(db, 'u1');
      expect(stillPending?.id).toBe(freshJob.id);
      expect(stillPending?.status).toBe('pending');
    },
  );

  it(
    'processPendingJobs zpracuje frontu a vrátí výsledek per job',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupAccount(db);
      const job = await enqueueSyncJob(db, 'u1', accountId, 't212-sync');

      const mock = makeMockFetch();
      const summary = await processPendingJobs(db, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });
      expect(summary.recovered).toBe(0);
      expect(summary.results).toEqual([
        { jobId: job.id, type: 't212-sync', status: 'success', error: null },
      ]);

      const latest = await latestSyncJob(db, 'u1');
      expect(latest?.id).toBe(job.id);
      expect(latest?.status).toBe('success');
    },
  );
});
