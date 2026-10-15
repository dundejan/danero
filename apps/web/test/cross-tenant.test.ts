import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { getAuth } from '@/lib/auth';
import { postAuth, signUpVerified } from './auth-helpers';

/**
 * Cizí id v cizích rukou (bezpečnostní revize před propagací, 15. 10. 2026).
 *
 * Strážce tenancy (`tenancy-scan.test.ts`) hlídá, že každá cesta zjistí, KDO
 * volá. Neověří ale, že pak sahá jen na jeho data — server action je veřejný
 * endpoint, který vezme jakékoli id z formuláře. Tady uživatel B posílá id
 * dat uživatele A do každé akce a routy, která id z požadavku bere, a test
 * měří, že B nic nedostal a u A se nic nepohnulo.
 *
 * Relace jsou skutečné (Better Auth nad PGlite), Next je jen podvržený:
 * `redirect` je výjimka s adresou, `after` se nespustí.
 */

type Auth = Awaited<ReturnType<typeof getAuth>>;

const HESLO = 'superbezpecneheslo';
const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/session', () => ({
  requireUser: async () => {
    const { getAuth } = await import('@/lib/auth');
    const session = await (await getAuth()).api.getSession({ headers: request.headers });
    if (!session) throw new Error('Test nemá přihlášeného uživatele');
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
    };
  },
  authApi: async () => {
    const { getAuth } = await import('@/lib/auth');
    return { api: (await getAuth()).api, requestHeaders: request.headers };
  },
}));

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** Výpis Trading 212 s titulem, který se v datech B nikde neobjeví. */
const T212_VYPIS = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Tajny Titul A,100,185.50,USD,,,,,,,,,CIZI1',
].join('\n');

/** Výpis od vymyšlené platformy — skončí jako nepřečtený a uschovaný. */
const NEZNAMY_VYPIS = [
  'Obchodni den;Titul;Operace;Mnozstvi;Kurz;Mena',
  '2026-01-05;CEZ;Nakup;10;1050,50;CZK',
].join('\n');

async function signIn(auth: Auth, email: string): Promise<string> {
  const response = await postAuth(auth, '/sign-in/email', { email, password: HESLO });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('Server action neskončila redirectem');
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

interface VictimData {
  userId: string;
  batchId: string;
  caseId: string;
  accountId: string;
  jobId: string;
}

describe('uživatel B nesáhne na data uživatele A přes cizí id (bezpečnostní revize)', () => {
  let auth: Auth;
  let victim: VictimData;
  let attackerCookie: string;

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    auth = await getAuth();
    const { getDb } = await import('@/db');
    const db = await getDb();
    const schema = await import('@/db/schema');
    const { importFileIsolated } = await import('@/lib/import-service');
    const { saveAliases } = await import('@/lib/instrument-aliases');
    const { encryptSecret } = await import('@/lib/crypto');
    const { enqueueSyncJob } = await import('@/lib/jobs');

    await signUpVerified(auth, { email: 'obet@test.cz', password: HESLO, name: 'Oběť' });
    await signUpVerified(auth, { email: 'utocnik@test.cz', password: HESLO, name: 'Útočník' });
    const [victimUser] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, 'obet@test.cz'));
    const userId = victimUser!.id;

    const imported = await importFileIsolated(db, userId, 't212.csv', bytes(T212_VYPIS));
    expect(imported.added).toBe(1);
    await importFileIsolated(db, userId, 'nezname.csv', bytes(NEZNAMY_VYPIS));
    const [failed] = await db
      .select({ id: schema.failedImports.id })
      .from(schema.failedImports)
      .where(eq(schema.failedImports.userId, userId));
    await saveAliases(db, userId, [
      { broker: 'xtb', symbol: 'TAJNY.US', isin: 'US0378331005', currency: 'USD' },
    ]);
    const accountId = crypto.randomUUID();
    await db.insert(schema.brokerAccounts).values({
      id: accountId,
      userId,
      broker: 'trading212',
      label: 'Trading 212',
      credentialsEncrypted: encryptSecret(JSON.stringify({ secret: 'tajny-klic-obeti' })),
    });
    const job = await enqueueSyncJob(db, userId, accountId, 'T212_SYNC');

    victim = { userId, batchId: imported.batchId!, caseId: failed!.id, accountId, jobId: job.id };
    attackerCookie = await signIn(auth, 'utocnik@test.cz');
    request.headers = new Headers({ cookie: attackerCookie });
  }, 60_000);

  it('vrácení cizího importu nic nesmaže', { timeout: 30_000 }, async () => {
    const { getDb } = await import('@/db');
    const { importBatches, transactions } = await import('@/db/schema');
    const { undoImportAction } = await import('@/app/(app)/import/actions');

    expect(await redirectTarget(() => undoImportAction(form({ davka: victim.batchId })))).toBe(
      '/import?chyba=vraceni',
    );

    const db = await getDb();
    expect(
      await db.select().from(importBatches).where(eq(importBatches.id, victim.batchId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(transactions).where(eq(transactions.batchId, victim.batchId)),
    ).toHaveLength(1);
  });

  it('hlášení k cizímu nepřečtenému výpisu se neuloží', { timeout: 30_000 }, async () => {
    const { getDb } = await import('@/db');
    const { failedImports } = await import('@/db/schema');
    const { reportFailedImportAction } = await import('@/app/(app)/import/actions');
    const db = await getDb();
    const [before] = await db
      .select()
      .from(failedImports)
      .where(eq(failedImports.id, victim.caseId));

    expect(
      await redirectTarget(() =>
        reportFailedImportAction(
          form({ pripad: victim.caseId, platforma: 'podvrh', poznamka: 'přepsáno útočníkem' }),
        ),
      ),
    ).toBe('/import?chyba=hlaseni-neexistuje');

    const [after] = await db
      .select()
      .from(failedImports)
      .where(eq(failedImports.id, victim.caseId));
    expect(after).toEqual(before);
  });

  it('cizí záznam v číselníku nejde změnit ani smazat', { timeout: 30_000 }, async () => {
    const { getDb } = await import('@/db');
    const { instrumentAliases } = await import('@/db/schema');
    const { deleteAliasAction, updateAliasAction } = await import('@/app/(app)/import/actions');

    expect(
      await redirectTarget(() =>
        updateAliasAction(
          form({ broker: 'xtb', symbol: 'TAJNY.US', isin: 'US5949181045', mena: 'USD' }),
        ),
      ),
    ).toBe('/import?chyba=zaznam-neexistuje');
    expect(
      await redirectTarget(() => deleteAliasAction(form({ broker: 'xtb', symbol: 'TAJNY.US' }))),
    ).toBe('/import?chyba=zaznam-neexistuje');

    const db = await getDb();
    const rows = await db
      .select({ isin: instrumentAliases.isin })
      .from(instrumentAliases)
      .where(
        and(eq(instrumentAliases.userId, victim.userId), eq(instrumentAliases.symbol, 'TAJNY.US')),
      );
    expect(rows).toEqual([{ isin: 'US0378331005' }]);
  });

  it('cizí účet u brokera nejde odpojit ani synchronizovat', { timeout: 30_000 }, async () => {
    const { getDb } = await import('@/db');
    const { brokerAccounts, jobs } = await import('@/db/schema');
    const { disconnectBrokerAction, syncBrokerAction } = await import('@/app/(app)/import/actions');

    expect(
      await redirectTarget(() => disconnectBrokerAction(form({ ucet: victim.accountId }))),
    ).toBe('/import?chyba=zadny-ucet');
    expect(await redirectTarget(() => syncBrokerAction(form({ ucet: victim.accountId })))).toBe(
      '/import?chyba=zadny-ucet',
    );

    const db = await getDb();
    expect(
      await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, victim.accountId)),
    ).toHaveLength(1);
    // žádný další job nad cizím účtem nevznikl — oběť má dál jen svůj, útočník žádný
    // (účet je v `payload`, sloupec na něj job nemá)
    const allJobs = await db.select({ id: jobs.id, userId: jobs.userId }).from(jobs);
    expect(allJobs).toEqual([{ id: victim.jobId, userId: victim.userId }]);
  });

  it('stav cizí synchronizace se přes ?account= nevydá', { timeout: 30_000 }, async () => {
    const { GET } = await import('@/app/api/jobs/latest/route');
    const response = await GET(
      new Request(`http://localhost:3000/api/jobs/latest?account=${victim.accountId}`, {
        headers: { cookie: attackerCookie },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job: null });
  });

  it('export dat útočníka nenese nic z dat oběti', { timeout: 30_000 }, async () => {
    const { GET } = await import('@/app/api/export/route');
    const response = await GET(
      new Request('http://localhost:3000/api/export', { headers: { cookie: attackerCookie } }),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    for (const secret of [
      victim.userId,
      victim.batchId,
      victim.caseId,
      victim.accountId,
      'obet@test.cz',
      'Tajny Titul A',
      'TAJNY.US',
      'nezname.csv',
    ]) {
      expect(body).not.toContain(secret);
    }
    // kontrola, že export vůbec něco nese — jinak by test prošel i prázdný
    expect(body).toContain('utocnik@test.cz');
  });
});
