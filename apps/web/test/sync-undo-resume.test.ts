import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { brokerAccounts, jobs, user } from '@/db/schema';
import { finishBrokerSync, type SyncProgress } from '@/lib/broker-sync';
import { encryptSecret } from '@/lib/crypto';
import { importFileIsolated } from '@/lib/import-service';
import { undoImportBatch } from '@/lib/import-undo';
import { processJob } from '@/lib/jobs';
import { makeMockFetch, MOCK_CREDENTIALS } from './t212-mock';

/**
 * K6a-01 a K6a-02 — dvoje dveře k téže ztrátě dat.
 *
 * Vrácení dávky ze syncu zahodí `lastSyncedAt`, aby se rok stáhl znovu. Jenže
 * plný sync si průběh bere z posledního SPADLÉHO jobu, a ten v tabulce zůstává
 * navždy (pruneJobs nejnovější job každého dedupeKey nechává). Rok označený
 * `complete: true` se tím pádem přeskočil — a `lastSyncedAt` se na konci
 * nastavil, takže další běhy jsou inkrementální a rok už se nikdy nedotáhne.
 * Naměřeno v auditu: `[2026, 2023, 2022]`, v DB 1 transakce místo 2, a při
 * uzavřeném obchodu o díře nedá vědět ani rekonciliace.
 */

const T212_2024_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,UNDO1',
].join('\n');

const NOW = new Date('2026-07-07T12:00:00Z');
const SYNC_TYPE = 't212-sync';

async function setup(db: Db, userId: string): Promise<string> {
  await db.insert(user).values({ id: userId, name: 'Test', email: `${userId}@danero.cz` });
  const accountId = `acc-${userId}`;
  await db.insert(brokerAccounts).values({
    id: accountId,
    userId,
    broker: 'trading212',
    credentialsEncrypted: encryptSecret(MOCK_CREDENTIALS),
  });
  return accountId;
}

/** Průběh plného syncu, ve kterém rok 2024 doběhl celý. */
const progressWith2024Done = (): SyncProgress => ({
  phase: 'exporting',
  mode: 'full',
  years: [
    { year: 2026, status: 'done', added: 1, duplicates: 0, errors: 0, complete: true },
    { year: 2025, status: 'empty', complete: true },
    { year: 2024, status: 'done', added: 1, duplicates: 0, errors: 0, complete: true },
  ],
});

async function insertJob(
  db: Db,
  {
    id,
    userId,
    accountId,
    status,
    createdAt,
    progress,
  }: {
    id: string;
    userId: string;
    accountId: string;
    status: string;
    createdAt: Date;
    progress?: SyncProgress;
  },
): Promise<void> {
  await db.insert(jobs).values({
    id,
    userId,
    type: SYNC_TYPE,
    dedupeKey: accountId,
    status,
    payload: { accountId },
    progress: progress ?? null,
    createdAt,
    startedAt: createdAt,
    finishedAt: createdAt,
  });
}

/** Nechá doběhnout nový plný sync a vrátí roky, na které se opravdu ptal. */
async function runFullSync(db: Db, userId: string, accountId: string): Promise<number[]> {
  await db
    .update(brokerAccounts)
    .set({ lastSyncedAt: null })
    .where(eq(brokerAccounts.id, accountId));
  await insertJob(db, {
    id: `job-run-${userId}`,
    userId,
    accountId,
    status: 'pending',
    createdAt: NOW,
  });
  const mock = makeMockFetch();
  await processJob(db, `job-run-${userId}`, {
    now: NOW,
    fetchImpl: mock.fetchImpl,
    pollIntervalMs: 5,
  });
  return mock.requestedYears;
}

describe('vrácení importu × resume plného syncu (K6a-01)', () => {
  it(
    'po pozdějším ÚSPĚŠNÉM syncu se ze spadlého jobu nedědí nic',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setup(db, 'u-uspech');
      // starý pád s dokončeným rokem 2024…
      await insertJob(db, {
        id: 'job-error',
        userId: 'u-uspech',
        accountId,
        status: 'error',
        createdAt: new Date('2026-05-01T10:00:00Z'),
        progress: progressWith2024Done(),
      });
      // …po němž ale proběhl celý plný sync
      await insertJob(db, {
        id: 'job-success',
        userId: 'u-uspech',
        accountId,
        status: 'success',
        createdAt: new Date('2026-06-01T10:00:00Z'),
      });

      expect(await runFullSync(db, 'u-uspech', accountId)).toContain(2024);
    },
  );

  it('bez pozdějšího úspěchu resume dál funguje', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const accountId = await setup(db, 'u-pad');
    await insertJob(db, {
      id: 'job-error',
      userId: 'u-pad',
      accountId,
      status: 'error',
      createdAt: new Date('2026-05-01T10:00:00Z'),
      progress: progressWith2024Done(),
    });

    // rok 2024 doběhl a od pádu uplynulo víc než 7 dní → přeskočí se
    expect(await runFullSync(db, 'u-pad', accountId)).not.toContain(2024);
  });

  it(
    'vrácení dávky ze syncu zneplatní i značku roku v průběhu',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setup(db, 'u-vraceni');
      await insertJob(db, {
        id: 'job-error',
        userId: 'u-vraceni',
        accountId,
        status: 'error',
        createdAt: new Date('2026-05-01T10:00:00Z'),
        progress: progressWith2024Done(),
      });

      // dávka pojmenovaná jako ze syncu (syncBatchFilename) s obchodem roku 2024
      const batch = await importFileIsolated(
        db,
        'u-vraceni',
        't212-api-2024.csv',
        new TextEncoder().encode(T212_2024_CSV).buffer as ArrayBuffer,
      );
      expect(batch.added).toBe(1);

      // celou cestou přes tutéž funkci, kterou volá server action
      expect((await undoImportBatch(db, 'u-vraceni', batch.batchId))?.count).toBe(1);

      const [job] = await db.select().from(jobs).where(eq(jobs.id, 'job-error'));
      const years = (job!.progress as SyncProgress).years!;
      expect(years.find((entry) => entry.year === 2024)?.complete).toBe(false);
      // ostatní roky zůstávají — jinak by se resume zbytečně zahodil celý
      expect(years.find((entry) => entry.year === 2026)?.complete).toBe(true);

      expect(await runFullSync(db, 'u-vraceni', accountId)).toContain(2024);
    },
  );
});

describe('závěr syncu nesmí přebít reset z vrácení importu (K6a-02)', () => {
  it('lastSyncedAt vynulovaný během běhu zůstane null', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const accountId = await setup(db, 'u-cas');
    const startedWith = new Date('2026-06-01T10:00:00Z');
    await db
      .update(brokerAccounts)
      .set({ lastSyncedAt: startedWith })
      .where(eq(brokerAccounts.id, accountId));
    const account = (await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId)))[0]!;

    // uživatel mezitím vrátil dávku ze syncu → reset na null
    await db
      .update(brokerAccounts)
      .set({ lastSyncedAt: null })
      .where(eq(brokerAccounts.id, accountId));

    await finishBrokerSync(db, account, null, 0, NOW);

    const [after] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId));
    expect(after!.lastSyncedAt).toBeNull();
    // zbytek stavu se zapsat MUSÍ, jinak by účet zůstal viset na starém výsledku
    expect(after!.lastSyncStatus).toBe('errors'); // deriveSyncStatus(0, null)
  });

  it('nedotčený plný sync se uzavře normálně (null → now)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const accountId = await setup(db, 'u-plny');
    const account = (await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId)))[0]!;
    expect(account.lastSyncedAt).toBeNull();

    await finishBrokerSync(db, account, null, 0, NOW);

    const [after] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId));
    expect(after!.lastSyncedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('nedotčený inkrementální sync posune čas dopředu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const accountId = await setup(db, 'u-inkrement');
    const startedWith = new Date('2026-06-01T10:00:00Z');
    await db
      .update(brokerAccounts)
      .set({ lastSyncedAt: startedWith })
      .where(eq(brokerAccounts.id, accountId));
    const account = (await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId)))[0]!;

    await finishBrokerSync(db, account, null, 0, NOW);

    const [after] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId));
    expect(after!.lastSyncedAt?.toISOString()).toBe(NOW.toISOString());
  });
});
