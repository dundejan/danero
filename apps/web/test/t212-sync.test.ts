import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { brokerAccounts, user } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { loadTransactions } from '@/lib/portfolio';
import { syncTrading212 } from '@/lib/t212-sync';
import { makeMockFetch, MOCK_CREDENTIALS as CREDENTIALS } from './t212-mock';

describe('šifrování API klíčů (AES-256-GCM)', () => {
  it('round-trip a integrita (pozměněný ciphertext neprojde)', () => {
    const encrypted = encryptSecret('tajny-api-klic-123');
    expect(encrypted).not.toContain('tajny');
    expect(decryptSecret(encrypted)).toBe('tajny-api-klic-123');

    const [v, iv, tag, data] = encrypted.split('.');
    const tampered = [v, iv, tag, data!.slice(0, -4) + 'AAAA'].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret('nesmysl')).toThrow();
  });
});

describe('syncTrading212 (mock API, in-memory PGlite)', () => {
  it(
    'první sync projde roky od založení účtu, další už jen běžný rok',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u1', name: 'Test', email: 'sync@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc1',
        userId: 'u1',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      // PLNÝ sync: 2026 (data) → 2025 (prázdný, mezera) → 2024 (data) → 2023+2022 prázdné → stop
      const first = makeMockFetch();
      const outcome = await syncTrading212(db, account, {
        fetchImpl: first.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });

      expect(first.requestedYears).toEqual([2026, 2025, 2024, 2023, 2022]);
      expect(outcome.yearsCovered).toEqual([2026, 2025, 2024, 2023, 2022]);
      expect(outcome.batches).toHaveLength(2); // prázdné roky nezakládají dávky
      expect(outcome.added).toBe(2);
      expect(outcome.errors).toEqual([]);
      // nákup 100 (2024) − prodej 50 (2026) = 50 ks — sedí s API pozicí
      expect(outcome.reconciliation?.ok).toBe(true);
      expect(outcome.reconciliation?.matchedCount).toBe(1);

      const txs = await loadTransactions(db, 'u1');
      expect(txs).toHaveLength(2);

      const updated = (
        await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc1'))
      )[0]!;
      expect(updated.lastSyncStatus).toBe('ok');
      expect(updated.lastSyncedAt).not.toBeNull();

      // INKREMENTÁLNÍ sync (lastSyncedAt nastaven): jen běžný rok, dedupe
      const second = makeMockFetch();
      const again = await syncTrading212(db, updated, {
        fetchImpl: second.fetchImpl,
        now: new Date('2026-07-08T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(second.requestedYears).toEqual([2026]);
      expect(again.added).toBe(0);
      expect(again.duplicates).toBe(1);
      // pár ID+secret → HTTP Basic prošlo napoprvé
      expect(second.authorizations[0]).toMatch(/^Basic /);
    },
  );

  it(
    'inkrementální sync přes přelom roku dotáhne i ocas předchozího roku',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u3', name: 'Test', email: 'novyrok@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc3',
        userId: 'u3',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
        // poslední úspěšný sync 31. 12. — obchody z konce roku se do exportu
        // propisují se zpožděním, po Novém roce je musí dotáhnout inkrementál
        lastSyncedAt: new Date('2025-12-31T22:00:00Z'),
        lastSyncStatus: 'ok',
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch();
      await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-01-02T08:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(mock.requestedYears).toEqual([2026, 2025]);
    },
  );

  it(
    'když API odmítne Basic (401), spadne se na samotný tajný klíč',
    { timeout: 30_000 },
    async () => {
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u2', name: 'Test', email: 'fallback@danero.cz' });
      await db.insert(brokerAccounts).values({
        id: 'acc2',
        userId: 'u2',
        broker: 'trading212',
        credentialsEncrypted: encryptSecret(CREDENTIALS),
      });
      const account = (await db.select().from(brokerAccounts))[0]!;

      const mock = makeMockFetch({ rejectBasicAuth: true });
      const outcome = await syncTrading212(db, account, {
        fetchImpl: mock.fetchImpl,
        now: new Date('2026-07-07T12:00:00Z'),
        pollIntervalMs: 5,
      });
      expect(outcome.added).toBe(2);
      // po 401 na Basic pokračují všechna volání se samotným tajným klíčem
      const lastAuth = mock.authorizations[mock.authorizations.length - 1];
      expect(lastAuth).toBe('mock-secret-456789');
    },
  );
});
