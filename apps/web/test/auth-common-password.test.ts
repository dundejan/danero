import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { getAuth as GetAuth } from '@/lib/auth';
import { postAuth, signUpVerified } from './auth-helpers';

/**
 * L8a-04 (rozhodnutí R21): server nepřijme heslo z těch nejběžnějších nikde,
 * kde se heslo nastavuje. Co je „běžné“, testuje `password-strength.test.ts`;
 * tady jde o to, že pravidlo sedí na všech třech cestách a že ho formulář
 * pozná podle kódu chyby.
 */
type Auth = Awaited<ReturnType<typeof GetAuth>>;

const GOOD = 'kun-baterie-sponka-01';
const COMMON = 'password12';

const errorCode = async (response: Response): Promise<string | undefined> =>
  ((await response.json()) as { code?: string }).code;

describe('nejběžnější hesla server nepřijme (L8a-04, R21)', () => {
  let auth: Auth;

  beforeAll(async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    auth = await getAuth();
  }, 30_000);

  it('registrace s běžným heslem skončí vlastním kódem a účet nevznikne', { timeout: 30_000 }, async () => {
    const email = 'bezne-heslo@priklad.test';
    const response = await postAuth(auth, '/sign-up/email', {
      email,
      password: COMMON,
      name: 'Test',
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('PASSWORD_TOO_COMMON');

    const { getDb } = await import('@/db');
    const { user } = await import('@/db/schema');
    expect(await (await getDb()).select().from(user).where(eq(user.email, email))).toHaveLength(0);
  });

  it('krátké heslo dál odmítá pravidlo o délce, ne tohle', { timeout: 30_000 }, async () => {
    const response = await postAuth(auth, '/sign-up/email', {
      email: 'kratke-heslo@priklad.test',
      password: '123456789',
      name: 'Test',
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('PASSWORD_TOO_SHORT');
  });

  it('změna hesla na běžné neprojde a staré heslo platí dál', { timeout: 30_000 }, async () => {
    const email = 'zmena-na-bezne@priklad.test';
    await signUpVerified(auth, { email, password: GOOD, name: 'Test' });
    const signIn = await postAuth(auth, '/sign-in/email', { email, password: GOOD });
    const cookie = signIn.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');

    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ currentPassword: GOOD, newPassword: 'Heslo123456!' }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('PASSWORD_TOO_COMMON');
    expect((await postAuth(auth, '/sign-in/email', { email, password: GOOD })).status).toBe(200);
  });

  it('obnova hesla běžné heslo nepřijme dřív, než se podívá na odkaz', { timeout: 30_000 }, async () => {
    const response = await postAuth(auth, '/reset-password', {
      newPassword: '1234567890',
      token: 'neplatny-token',
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe('PASSWORD_TOO_COMMON');
  });
});
