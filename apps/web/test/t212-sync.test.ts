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

const CSV_HEADER =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID';

/** Data per rok: 2026 prodej, 2024 nákup (a 2025 prázdný — mezera se přeskočí). */
const CSV_BY_YEAR: Record<number, string> = {
  2026: [
    CSV_HEADER,
    'Market sell,2026-03-05 15:01:10,US0378331005,AAPL,Apple Inc,50,210.00,USD,,,,,,,,,EOFSYNC2',
  ].join('\n'),
  2024: [
    CSV_HEADER,
    'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOFSYNC1',
  ].join('\n'),
};

/** Mock T212 API: exporty per rok (rok čteme z těla requestu), pozice pro rekonciliaci. */
function makeMockFetch(options: { rejectBasicAuth?: boolean } = {}) {
  const reportYears = new Map<number, number>();
  let lastReportId = 100;
  const requestedYears: number[] = [];
  const authorizations: string[] = [];

  const fetchImpl: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    authorizations.push(authorization);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

    if (url.endsWith('/equity/account/cash')) {
      // simulace API, které pár ID+secret přes Basic odmítá (nejednoznačná dokumentace)
      if (options.rejectBasicAuth && authorization.startsWith('Basic ')) {
        return new Response('{"message":"unauthorized"}', { status: 401 });
      }
      return json({ free: 100, total: 100, invested: 0 });
    }
    if (url.endsWith('/history/exports') && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { timeFrom: string };
      const year = Number(body.timeFrom.slice(0, 4));
      requestedYears.push(year);
      lastReportId += 1;
      reportYears.set(lastReportId, year);
      return json({ reportId: lastReportId });
    }
    if (url.endsWith('/history/exports')) {
      return json([
        {
          reportId: lastReportId,
          status: 'Finished',
          downloadLink: `https://downloads.t212.test/${lastReportId}.csv`,
        },
      ]);
    }
    const download = /downloads\.t212\.test\/(\d+)\.csv/.exec(url);
    if (download) {
      const year = reportYears.get(Number(download[1]))!;
      return new Response(CSV_BY_YEAR[year] ?? CSV_HEADER, { status: 200 });
    }
    if (url.endsWith('/equity/portfolio')) {
      return json([
        { ticker: 'AAPL_US_EQ', quantity: 50, averagePrice: 185.5, currentPrice: 210, ppl: 0 },
      ]);
    }
    if (url.endsWith('/equity/metadata/instruments')) {
      return json([
        { ticker: 'AAPL_US_EQ', isin: 'US0378331005', currencyCode: 'USD', name: 'Apple' },
      ]);
    }
    throw new Error(`Mock nezná URL: ${method} ${url}`);
  }) as typeof fetch;

  return { fetchImpl, requestedYears, authorizations };
}

const CREDENTIALS = JSON.stringify({ keyId: 'key-id-123', secret: 'mock-secret-456789' });

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
      expect(outcome.reconciliation.ok).toBe(true);
      expect(outcome.reconciliation.matchedCount).toBe(1);

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
