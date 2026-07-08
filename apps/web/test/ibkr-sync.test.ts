import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { brokerAccounts, user } from '@/db/schema';
import { encryptSecret } from '@/lib/crypto';
import { enqueueSyncJob, processJob } from '@/lib/jobs';
import { loadTransactions } from '@/lib/portfolio';
import { IBKR_MOCK_CREDENTIALS, makeIbkrMockFetch } from './ibkr-mock';

async function setupIbkrAccount(db: Db) {
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'ibkr@danero.cz' });
  await db.insert(brokerAccounts).values({
    id: 'acc-ibkr',
    userId: 'u1',
    broker: 'ibkr',
    label: 'Interactive Brokers',
    credentialsEncrypted: encryptSecret(IBKR_MOCK_CREDENTIALS),
  });
  return 'acc-ibkr';
}

const NOW = new Date('2026-07-08T12:00:00Z');

describe('IBKR sync job (mock Flex, in-memory PGlite)', () => {
  it(
    'stáhne výpis, naimportuje transakce a rekonciliace sedí',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupIbkrAccount(db);
      const job = await enqueueSyncJob(db, 'u1', accountId, 'ibkr-sync');

      const mock = makeIbkrMockFetch();
      const finished = await processJob(db, job.id, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });

      expect(finished?.status).toBe('success');
      const result = finished?.result as { added: number; syncStatus: string };
      expect(result.added).toBe(3); // buy + sell + dividenda
      expect(result.syncStatus).toBe('ok');

      const txs = await loadTransactions(db, 'u1', 'ibkr');
      expect(txs).toHaveLength(3);
      const dividend = txs.find((tx) => tx.type === 'DIVIDEND');
      if (!dividend || dividend.type !== 'DIVIDEND') throw new Error('unreachable');
      expect(dividend.withholdingTax.toString()).toBe('3.75');

      const account = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId))
      )[0]!;
      expect(account.lastSyncStatus).toBe('ok');
      expect(account.lastSyncedAt).not.toBeNull();
      const reconciliation = account.lastReconciliation as { ok: boolean; matchedCount: number };
      expect(reconciliation.ok).toBe(true);
      expect(reconciliation.matchedCount).toBe(1);

      // idempotence: druhý sync nic nezdvojí
      const second = await enqueueSyncJob(db, 'u1', accountId, 'ibkr-sync');
      const mock2 = makeIbkrMockFetch();
      const finished2 = await processJob(db, second.id, {
        fetchImpl: mock2.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });
      const result2 = finished2?.result as { added: number; duplicates: number };
      expect(result2.added).toBe(0);
      expect(result2.duplicates).toBe(3);
    },
  );

  it(
    'expirovaný token: chyba u jobu i účtu, lastSyncedAt zůstane prázdný',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      const accountId = await setupIbkrAccount(db);
      const job = await enqueueSyncJob(db, 'u1', accountId, 'ibkr-sync');

      const mock = makeIbkrMockFetch({ failToken: true });
      const finished = await processJob(db, job.id, {
        fetchImpl: mock.fetchImpl,
        now: NOW,
        pollIntervalMs: 5,
      });

      expect(finished?.status).toBe('error');
      expect(finished?.error).toContain('vygeneruj v IBKR nový');

      const account = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, accountId))
      )[0]!;
      expect(account.lastSyncStatus).toBe('error');
      expect(account.lastSyncedAt).toBeNull();
    },
  );
});
