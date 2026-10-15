import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { getAuth } from '@/lib/auth';
import { emailsIn, postAuth, signUpVerified } from './auth-helpers';

/**
 * Bezpečnostní revize před propagací (15. 10. 2026): revize 5 vyjmenovala
 * v oddíle 8.3 věci, které „zůstávají neověřené“ — zneplatnění relace po
 * odhlášení a po změně hesla, jednorázovost odkazu na obnovu. Tady jsou jako
 * testy, které jdou HTTP routerem Better Authu (stejnou cestou jako
 * prohlížeč), ne přes serverové `auth.api.*`.
 *
 * Co tady NENÍ a proč: kontrola originu (CSRF), `callbackURL`/`redirectTo`
 * a podvržená hlavička Host. Better Auth kontrolu originu ve Vitestu sám
 * vypíná (`skipOriginCheck: isTest()` v `context/create-context.mjs`), takže
 * by tu prošla i děravá konfigurace — tyhle testy jsou v E2E
 * (`e2e/bezpecnost.spec.ts`) proti běžícímu serveru.
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

const logPath = () => join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');

/** Cookie z odpovědi ve tvaru hlavičky `Cookie` (bez smazaných, prázdných). */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

/** Přihlášení přes HTTP router — vrací cookie „zařízení“. */
async function signIn(auth: Auth, email: string, password = HESLO): Promise<string> {
  const response = await postAuth(auth, '/sign-in/email', { email, password });
  expect(response.status).toBe(200);
  const cookies = cookiesFrom(response);
  expect(cookies).toContain('session_token');
  return cookies;
}

/** Je relace z cookie živá? Ptá se HTTP routeru jako prohlížeč. */
async function sessionAlive(auth: Auth, cookie: string): Promise<boolean> {
  const response = await auth.handler(
    new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie } }),
  );
  return (await response.json()) !== null;
}

/** Vrátí cílovou URL redirectu, kterým server action skončila. */
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

/** Odkaz na obnovu hesla z posledního e-mailu pro adresáta. */
async function requestResetToken(auth: Auth, email: string): Promise<string> {
  const log = logPath();
  process.env.DANERO_EMAIL_LOG = log;
  try {
    const response = await postAuth(auth, '/request-password-reset', { email });
    expect(response.status).toBe(200);
  } finally {
    delete process.env.DANERO_EMAIL_LOG;
  }
  const text = emailsIn(log).at(-1)?.text ?? '';
  const token = /\/reset-password\/([^?\s]+)/.exec(text)?.[1];
  if (!token) throw new Error('E-mail neobsahuje odkaz na obnovu hesla');
  return token;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe('relace po odhlášení a po změnách účtu (bezpečnostní revize, 8.3 revize 5)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it(
    'odhlášení zneplatní relaci na serveru, ne jen cookie v prohlížeči',
    { timeout: 30_000 },
    async () => {
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();
      const email = 'odhlaseni@test.cz';
      await signUpVerified(auth, { email, password: HESLO, name: 'Odhlášení' });
      const cookie = await signIn(auth, email);
      expect(await sessionAlive(auth, cookie)).toBe(true);

      const signOut = await auth.handler(
        new Request('http://localhost:3000/api/auth/sign-out', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: '{}',
        }),
      );
      expect(signOut.status).toBe(200);

      // opsaná cookie (ukradená, zachycená v proxy) po odhlášení nic neotevře
      expect(await sessionAlive(auth, cookie)).toBe(false);
    },
  );

  it('změna hesla v Nastavení odhlásí ostatní zařízení', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'zmena-hesla@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Změna hesla' });
    const thief = await signIn(auth, email);
    const owner = await signIn(auth, email);

    request.headers = new Headers({ cookie: owner });
    const { changePasswordAction } = await import('@/app/(app)/nastaveni/actions');
    const target = await redirectTarget(() =>
      changePasswordAction(
        form({ 'stavajici-heslo': HESLO, 'nove-heslo': 'uplne-nove-heslo-2026' }),
      ),
    );
    expect(target).toBe('/nastaveni/ucet?ok=heslo');

    expect(await sessionAlive(auth, thief)).toBe(false);
  });

  it('obnova hesla odkazem z e-mailu odhlásí všechna zařízení', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'obnova-relace@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Obnova' });
    const thief = await signIn(auth, email);

    const token = await requestResetToken(auth, email);
    const reset = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'heslo-po-obnove-2026',
    });
    expect(reset.status).toBe(200);

    expect(await sessionAlive(auth, thief)).toBe(false);
  });

  it(
    '„Odhlásit ostatní zařízení“ zabije cizí relaci a vlastní nechá',
    { timeout: 30_000 },
    async () => {
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();
      const email = 'ostatni-zarizeni@test.cz';
      await signUpVerified(auth, { email, password: HESLO, name: 'Ostatní' });
      const thief = await signIn(auth, email);
      const owner = await signIn(auth, email);

      request.headers = new Headers({ cookie: owner });
      const { revokeOtherSessionsAction } = await import('@/app/(app)/nastaveni/actions');
      expect(await redirectTarget(() => revokeOtherSessionsAction())).toBe(
        '/nastaveni/ucet?ok=odhlaseno',
      );

      expect(await sessionAlive(auth, thief)).toBe(false);
      expect(await sessionAlive(auth, owner)).toBe(true);
    },
  );

  it('smazání účtu nenechá žít žádnou relaci', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'smazani-relace@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Smazání' });
    const otherDevice = await signIn(auth, email);
    const owner = await signIn(auth, email);

    request.headers = new Headers({ cookie: owner });
    const { deleteAccountAction } = await import('@/app/(app)/nastaveni/actions');
    expect(
      await redirectTarget(() => deleteAccountAction(form({ heslo: HESLO, potvrzeni: 'SMAZAT' }))),
    ).toBe('/?smazano=1');

    expect(await sessionAlive(auth, owner)).toBe(false);
    expect(await sessionAlive(auth, otherDevice)).toBe(false);
  });
});

describe('odkaz na obnovu hesla (bezpečnostní revize, 8.3 revize 5)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it('použitý odkaz podruhé heslo nezmění', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'jednorazovy@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Jednorázový' });
    const token = await requestResetToken(auth, email);

    const first = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'heslo-majitele-2026',
    });
    expect(first.status).toBe(200);
    // kdo odkaz najde v historii prohlížeče nebo v přeposlaném e-mailu
    const replay = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'heslo-utocnika-2026',
    });
    expect(replay.status).toBe(400);

    expect(
      (await postAuth(auth, '/sign-in/email', { email, password: 'heslo-majitele-2026' })).status,
    ).toBe(200);
    expect(
      (await postAuth(auth, '/sign-in/email', { email, password: 'heslo-utocnika-2026' })).status,
    ).toBe(401);
  });

  it('prošlý odkaz heslo nezmění', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const { getDb } = await import('@/db');
    const { verification } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const email = 'prosly@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Prošlý' });
    const token = await requestResetToken(auth, email);

    // odkaz platí hodinu (`resetPasswordTokenExpiresIn`) — posuneme ho do minulosti
    const db = await getDb();
    const expired = await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`))
      .returning({ id: verification.id });
    expect(expired).toHaveLength(1);

    const reset = await postAuth(auth, '/reset-password', {
      token,
      newPassword: 'heslo-utocnika-2026',
    });
    expect(reset.status).toBe(400);
    expect((await postAuth(auth, '/sign-in/email', { email, password: HESLO })).status).toBe(200);
  });
});

describe('/update-user nepřepíše chráněná pole účtu (bezpečnostní revize)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  /**
   * `/update-user` je otevřená HTTP cesta Better Authu (aplikace ji nevolá,
   * ale zavřená není). Z unesené relace by přes ni šlo zkusit tiše změnit
   * adresu (obnova hesla by pak chodila útočníkovi), vypnout příznak 2FA nebo
   * „potvrdit“ cizí nepotvrzenou adresu. Změnit smí jen jméno a obrázek.
   */
  it(
    'e-mail, potvrzení adresy ani příznak 2FA tělem požadavku nezmění',
    { timeout: 30_000 },
    async () => {
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();
      const { getDb } = await import('@/db');
      const { user } = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');
      const email = 'chranena-pole@test.cz';
      await signUpVerified(auth, { email, password: HESLO, name: 'Chráněná pole' });
      const cookie = await signIn(auth, email);
      const db = await getDb();
      const [before] = await db.select().from(user).where(eq(user.email, email));
      await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.email, email));

      const response = await auth.handler(
        new Request('http://localhost:3000/api/auth/update-user', {
          method: 'POST',
          headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Nové jméno',
            email: 'utocnik@test.cz',
            emailVerified: false,
            twoFactorEnabled: false,
            id: 'jine-id',
            createdAt: '2000-01-01T00:00:00.000Z',
          }),
        }),
      );
      // Better Auth buď odmítne celé tělo, nebo přepíše jen povolené jméno —
      // obojí je v pořádku; chráněná pole se ale nesmí pohnout ani v jednom
      expect([200, 400]).toContain(response.status);

      const [after] = await db.select().from(user).where(eq(user.id, before!.id));
      expect(after).toMatchObject({
        email,
        emailVerified: true,
        twoFactorEnabled: true,
        createdAt: before!.createdAt,
      });
    },
  );
});
