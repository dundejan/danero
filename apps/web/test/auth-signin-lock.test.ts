import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { like } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { getAuth as GetAuth } from '@/lib/auth';
import { emailsIn, signUpVerified } from './auth-helpers';

/**
 * L8a-03 (rozhodnutí R14): strop neúspěšných přihlášení na jednu adresu.
 *
 * Vestavěný limit Better Authu se počítá podle IP adresy, takže kdo adresy
 * střídá, hádal heslo jednoho účtu bez brzdy (naměřeno 68 špatných pokusů
 * a pak úspěšné přihlášení). Strop je klíčovaný adresou, ne účtem — pro
 * adresu bez účtu se chová stejně, takže neprozradí, jestli účet existuje.
 * Prohlížeč, ze kterého se majitel už přihlásil, má vlastní počítadlo, aby mu
 * cizí člověk nemohl přihlášení zamykat dokola.
 */
type Auth = Awaited<ReturnType<typeof GetAuth>>;

const PASSWORD = 'spravne-heslo-uctu-01';
const WRONG = 'spatne-heslo-utocnika-99';
/** Musí sedět s `SIGN_IN_ATTEMPT_MAX` v lib/auth-hooks.ts. */
const MAX_FAILURES = 10;

/** Přihlášení přes HTTP router; `cookie` = co by poslal prohlížeč, který tu už byl. */
const signIn = (auth: Auth, email: string, password: string, cookie = ''): Promise<Response> =>
  auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ email, password }),
    }),
  );

/** Hodnota hlavičky `cookie`, jakou by prohlížeč poslal po téhle odpovědi. */
const cookieFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');

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

  it(
    'cizí pokusy nezamknou prohlížeč, ze kterého se majitel už přihlásil',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-znamy-prohlizec@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      const known = cookieFrom(await signIn(auth, email, PASSWORD));
      expect(known).not.toBe('');
      expect(decodeURIComponent(known)).not.toContain(email);

      // cizí člověk vyčerpá strop adresy
      await failTimes(auth, email, MAX_FAILURES);
      expect((await signIn(auth, email, PASSWORD)).status).toBe(429);

      // majitel ve svém prohlížeči se přihlásí dál
      expect((await signIn(auth, email, PASSWORD, known)).status).toBe(200);
    },
  );

  it(
    'cookie známého prohlížeče není volná vstupenka — má vlastní strop',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-strop-znameho@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      const known = cookieFrom(await signIn(auth, email, PASSWORD));

      const statuses: number[] = [];
      for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
        statuses.push((await signIn(auth, email, WRONG, known)).status);
      }
      expect(statuses).toEqual(Array(MAX_FAILURES).fill(401));
      expect((await signIn(auth, email, PASSWORD, known)).status).toBe(429);
      // a cookie pro jinou adresu se nepočítá vůbec
      const other = 'zamek-jina-cookie@priklad.test';
      await failTimes(auth, other, MAX_FAILURES);
      expect((await signIn(auth, other, WRONG, known)).status).toBe(429);
    },
  );

  it(
    'jedno známé zařízení nevyčerpá počítadlo druhému',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-dve-zarizeni@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      const first = cookieFrom(await signIn(auth, email, PASSWORD));
      const second = cookieFrom(await signIn(auth, email, PASSWORD));
      // každé zařízení má vlastní id, hodnota cookie není pro adresu jedna
      expect(first).not.toBe(second);

      for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
        await signIn(auth, email, WRONG, first);
      }
      expect((await signIn(auth, email, PASSWORD, first)).status).toBe(429);
      expect((await signIn(auth, email, PASSWORD, second)).status).toBe(200);
    },
  );

  it(
    'změna hesla dřív vydané cookies zneplatní — kdo heslo znal, je zase neznámý prohlížeč',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-stara-cookie@priklad.test';
      const newPassword = 'uplne-nove-heslo-uctu-03';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      const signedIn = await signIn(auth, email, PASSWORD);
      const stale = cookieFrom(signedIn);

      const changed = await auth.handler(
        new Request('http://localhost:3000/api/auth/change-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: stale },
          body: JSON.stringify({ currentPassword: PASSWORD, newPassword }),
        }),
      );
      expect(changed.status).toBe(200);

      // strop neznámých prohlížečů vyčerpaný → stará cookie už výjimku nedává
      await failTimes(auth, email, MAX_FAILURES);
      expect((await signIn(auth, email, newPassword, stale)).status).toBe(429);
    },
  );

  it(
    'obnova hesla pod útokem: prohlížeč, který ji dokončil, se přihlásí, i když útočník strop zase vyčerpá',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-obnova-pod-utokem@priklad.test';
      const newPassword = 'nove-heslo-pod-utokem-04';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      await failTimes(auth, email, MAX_FAILURES);

      const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
      process.env.DANERO_EMAIL_LOG = logPath;
      await auth.api.requestPasswordReset({ body: { email } });
      const token = emailsIn(logPath).at(-1)?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
      if (!token) throw new Error('E-mail neobsahuje odkaz na obnovu hesla');
      // obnovu dokončí prohlížeč majitele — přes HTTP, ať dostane cookie
      const reset = await auth.handler(
        new Request('http://localhost:3000/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newPassword, token }),
        }),
      );
      expect(reset.status).toBe(200);
      const owner = cookieFrom(reset);
      expect(owner).toContain('known_browser');

      // útočník strop neznámých prohlížečů hned zase vyčerpá
      await failTimes(auth, email, MAX_FAILURES);
      expect((await signIn(auth, email, newPassword)).status).toBe(429);
      // majitel v prohlížeči, kde obnovu dokončil, se přihlásí
      expect((await signIn(auth, email, newPassword, owner)).status).toBe(200);
    },
  );

  it(
    'změna hesla v Nastavení nechá prohlížeč, který ji provedl, známý',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-zmena-znamy@priklad.test';
      const newPassword = 'heslo-po-zmene-v-nastaveni-05';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });
      const session = cookieFrom(await signIn(auth, email, PASSWORD));
      const changed = await auth.handler(
        new Request('http://localhost:3000/api/auth/change-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: session },
          body: JSON.stringify({ currentPassword: PASSWORD, newPassword }),
        }),
      );
      expect(changed.status).toBe(200);
      const fresh = cookieFrom(changed);
      expect(fresh).toContain('known_browser');

      await failTimes(auth, email, MAX_FAILURES);
      expect((await signIn(auth, email, newPassword, fresh)).status).toBe(200);
    },
  );

  it(
    'nepotvrzený účet cookie známého prohlížeče nedostane',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-nepotvrzeny@priklad.test';
      const logPath = join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');
      process.env.DANERO_EMAIL_LOG = logPath;
      await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Test' } });

      const response = await signIn(auth, email, PASSWORD);
      expect(response.status).toBe(403);
      expect(response.headers.getSetCookie().some((entry) => entry.includes('known_browser'))).toBe(
        false,
      );
    },
  );

  it(
    'souběžné pokusy strop nepřestřelí',
    { timeout: 60_000 },
    async () => {
      const email = 'zamek-soubeh@priklad.test';
      await signUpVerified(auth, { email, password: PASSWORD, name: 'Test' });

      const responses = await Promise.all(
        Array.from({ length: MAX_FAILURES * 3 }, () => signIn(auth, email, WRONG)),
      );
      const statuses = responses.map((response) => response.status);
      // k ověření hesla se jich dostane nejvýš deset, zbytek skončí na stropu
      expect(statuses.filter((status) => status === 401)).toHaveLength(MAX_FAILURES);
      expect(statuses.filter((status) => status === 429)).toHaveLength(MAX_FAILURES * 2);
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
