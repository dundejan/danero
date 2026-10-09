import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { like } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { getAuth as GetAuth } from '@/lib/auth';
import { emailsIn, postAuth, signUpVerified } from './auth-helpers';

/**
 * L8a-03 (rozhodnutí R14): strop neúspěšných přihlášení na jednu adresu.
 *
 * Vestavěný limit Better Authu se počítá podle IP adresy, takže kdo adresy
 * střídá, hádal heslo jednoho účtu bez brzdy (naměřeno 68 špatných pokusů
 * a pak úspěšné přihlášení). Strop je klíčovaný adresou, ne účtem — pro
 * adresu bez účtu se chová stejně, takže neprozradí, jestli účet existuje.
 */
type Auth = Awaited<ReturnType<typeof GetAuth>>;

const PASSWORD = 'spravne-heslo-uctu-01';
const WRONG = 'spatne-heslo-utocnika-99';
/** Musí sedět s `SIGN_IN_FAILURE_MAX` v lib/auth-hooks.ts. */
const MAX_FAILURES = 10;

const signIn = (auth: Auth, email: string, password: string): Promise<Response> =>
  postAuth(auth, '/sign-in/email', { email, password });

async function failTimes(auth: Auth, email: string, times: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    statuses.push((await signIn(auth, email, WRONG)).status);
  }
  return statuses;
}

describe('strop neúspěšných přihlášení na adresu (L8a-03, R14)', () => {
  let auth: Auth;

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    auth = await getAuth();
  }, 30_000);

  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
  });

  it(
    'po deseti špatných heslech se adresa na čas zamkne i pro správné heslo',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-ucet@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });

      expect(await failTimes(auth, email, MAX_FAILURES)).toEqual(Array(MAX_FAILURES).fill(401));

      const locked = await signIn(auth, email, PASSWORD);
      expect(locked.status).toBe(429);
      expect(((await locked.json()) as { code: string }).code).toBe('SIGN_IN_LOCKED');

      // jiná adresa se tím nezamkla
      const other = 'zamek-jiny@priklad.test';
      await signUpVerified(auth, { email: other, password: PASSWORD, name: 'Jiný' });
      expect((await signIn(auth, other, PASSWORD)).status).toBe(200);
    },
  );

  it(
    'adresa bez účtu se chová stejně — strop neprozradí, že účet existuje',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-bez-uctu@priklad.test';
      expect(await failTimes(auth, email, MAX_FAILURES)).toEqual(Array(MAX_FAILURES).fill(401));
      const locked = await signIn(auth, email, WRONG);
      expect(locked.status).toBe(429);
      expect(((await locked.json()) as { code: string }).code).toBe('SIGN_IN_LOCKED');
    },
  );

  it(
    'úspěšné přihlášení počítadlo vynuluje',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-vynulovani@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });

      await failTimes(auth, email, MAX_FAILURES - 1);
      expect((await signIn(auth, email, PASSWORD)).status).toBe(200);
      // dalších devět překlepů je zase jen devět, ne osmnáct
      expect(await failTimes(auth, email, MAX_FAILURES - 1)).toEqual(
        Array(MAX_FAILURES - 1).fill(401),
      );
      expect((await signIn(auth, email, PASSWORD)).status).toBe(200);
    },
  );

  it(
    'obnova hesla zámek uvolní hned — majitel nečeká čtvrt hodiny',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-obnova@priklad.test';
      const newPassword = 'nove-heslo-po-obnove-02';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      await failTimes(auth, email, MAX_FAILURES);
      expect((await signIn(auth, email, PASSWORD)).status).toBe(429);

      const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
      process.env.DANERO_EMAIL_LOG = logPath;
      await auth.api.requestPasswordReset({ body: { email } });
      const token = emailsIn(logPath).at(-1)?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      if (!token) throw new Error('E-mail neobsahuje odkaz na obnovu hesla');
      await auth.api.resetPassword({ body: { newPassword, token } });

      expect((await signIn(auth, email, newPassword)).status).toBe(200);
    },
  );

  it('po vypršení okna se počítá od nuly', { timeout: 60_000 }, async () => {
    const email = 'zamek-vyprseni@priklad.test';
    await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
    await failTimes(auth, email, MAX_FAILURES);
    expect((await signIn(auth, email, PASSWORD)).status).toBe(429);

    const { getDb } = await import('@/db');
    const { appRateLimits } = await import('@/db/schema');
    const db = await getDb();
    await db
      .update(appRateLimits)
      .set({ resetAt: new Date(Date.now() - 1000) })
      .where(like(appRateLimits.key, 'signin_fail:%'));

    expect((await signIn(auth, email, PASSWORD)).status).toBe(200);
  });

  it('klíč v tabulce limitů nenese adresu v čitelné podobě', { timeout: 30_000 }, async () => {
    const email = 'zamek-otisk@priklad.test';
    await failTimes(auth, email, 1);
    const { getDb } = await import('@/db');
    const { appRateLimits } = await import('@/db/schema');
    const rows = await (await getDb())
      .select({ key: appRateLimits.key })
      .from(appRateLimits)
      .where(like(appRateLimits.key, 'signin_fail:%'));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.key.includes('@'))).toBe(false);
  });
});
