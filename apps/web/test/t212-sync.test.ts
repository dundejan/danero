import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { brokerAccounts, user } from '@/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { loadTransactions } from '@/lib/portfolio';
import { syncTrading212 } from '@/lib/t212-sync';

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

const SYNC_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2026-02-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOFSYNC1',
].join('\n');

/** Mock T212 API: export → download → pozice/instrumenty pro rekonciliaci. */
const mockT212Fetch: typeof fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  if (url.endsWith('/history/exports') && url.includes('live.trading212.com')) {
    // POST i GET sdílí path — rozlišíme pořadím: první volání je POST (request), další GET (list)
    exportCalls += 1;
    if (exportCalls === 1) return json({ reportId: 42 });
    return json([
      { reportId: 42, status: 'Finished', downloadLink: 'https://downloads.t212.test/42.csv' },
    ]);
  }
  if (url === 'https://downloads.t212.test/42.csv') return new Response(SYNC_CSV, { status: 200 });
  if (url.endsWith('/equity/portfolio')) {
    return json([
      { ticker: 'AAPL_US_EQ', quantity: 100, averagePrice: 185.5, currentPrice: 210, ppl: 0 },
    ]);
  }
  if (url.endsWith('/equity/metadata/instruments')) {
    return json([{ ticker: 'AAPL_US_EQ', isin: 'US0378331005', currencyCode: 'USD', name: 'Apple' }]);
  }
  throw new Error(`Mock nezná URL: ${url}`);
}) as typeof fetch;
let exportCalls = 0;

describe('syncTrading212 (mock API, in-memory PGlite)', () => {
  it('export → import → rekonciliace → stav na účtu', { timeout: 30_000 }, async () => {
    exportCalls = 0;
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'sync@danero.cz' });
    await db.insert(brokerAccounts).values({
      id: 'acc1',
      userId: 'u1',
      broker: 'trading212',
      credentialsEncrypted: encryptSecret('mock-api-key'),
    });
    const account = (await db.select().from(brokerAccounts))[0]!;

    const outcome = await syncTrading212(db, account, {
      fetchImpl: mockT212Fetch,
      now: new Date('2026-07-07T12:00:00Z'),
      pollIntervalMs: 5,
    });

    expect(outcome.summary.added).toBe(1);
    expect(outcome.summary.errors).toEqual([]);
    expect(outcome.reconciliation.ok).toBe(true); // 100 ks AAPL sedí s API pozicí
    expect(outcome.reconciliation.matchedCount).toBe(1);

    const txs = await loadTransactions(db, 'u1');
    expect(txs).toHaveLength(1);

    const updated = (await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc1')))[0]!;
    expect(updated.lastSyncStatus).toBe('ok');
    expect(updated.lastSyncedAt).not.toBeNull();

    // opakovaný sync je idempotentní (dedupe)
    exportCalls = 0;
    const again = await syncTrading212(db, account, {
      fetchImpl: mockT212Fetch,
      now: new Date('2026-07-07T13:00:00Z'),
      pollIntervalMs: 5,
    });
    expect(again.summary.added).toBe(0);
    expect(again.summary.duplicates).toBe(1);
  });
});
