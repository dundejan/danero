import { beforeAll, describe, expect, it } from 'vitest';
import type { getAuth } from '@/lib/auth';
import { signUpVerified } from './auth-helpers';
import { totp } from './totp-util';

type Auth = Awaited<ReturnType<typeof getAuth>>;

const HESLO = 'superbezpecneheslo';

const cookiesFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');

/**
 * TOTP krok = 30 s; server bere předchozí, aktuální i následující. Testy si
 * krok volí schválně samy: aktivace jede krokem „teď", přihlášení krokem
 * „následující" — dva různé kódy bez ohledu na to, kdy zrovna test běží.
 * (Kdyby oba braly `Date.now()`, vyšel by uvnitř jednoho kroku týž kód a
 * jednorázovost z D-01 by test shodila náhodně podle vteřin na hodinách.)
 */
const currentStep = () => Math.floor(Date.now() / 30_000);
const codeForStep = (secret: string, step: number) => totp(secret, step * 30_000);

/** Registrace uživatele se zapnutým a aktivovaným 2FA; vrací i TOTP tajemství. */
async function userWithTwoFactor(auth: Auth, email: string) {
  await signUpVerified(auth, { email, password: HESLO, name: 'Dvoufaktor' });
  const firstSignIn = await auth.api.signInEmail({
    body: { email, password: HESLO },
    asResponse: true,
  });
  const sessionCookies = cookiesFrom(firstSignIn);
  expect(sessionCookies).toContain('session_token');

  const enable = await auth.api.enableTwoFactor({
    body: { password: HESLO },
    headers: new Headers({ cookie: sessionCookies }),
  });
  expect(enable.totpURI).toContain('otpauth://totp/');
  expect(enable.backupCodes.length).toBeGreaterThan(0);
  const secret = /[?&]secret=([^&]+)/.exec(enable.totpURI)?.[1];
  expect(secret).toBeTruthy();

  await auth.api.verifyTOTP({
    body: { code: codeForStep(secret!, currentStep()) },
    headers: new Headers({ cookie: sessionCookies }),
  });
  return { secret: secret!, sessionCookies };
}

/** Přihlášení heslem u účtu s 2FA — vrací cookie přihlašovací výzvy. */
async function startSignIn(auth: Auth, email: string): Promise<string> {
  const response = await auth.api.signInEmail({
    body: { email, password: HESLO },
    asResponse: true,
  });
  const body = (await response.json()) as { twoFactorRedirect?: boolean };
  expect(body.twoFactorRedirect).toBe(true);
  return cookiesFrom(response);
}

describe('2FA TOTP flow přes Better Auth API (in-memory PGlite)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it('zapnutí → ověření → přihlášení vyžaduje kód', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const { secret } = await userWithTwoFactor(auth, '2fa@test.cz');

    // nové přihlášení: heslo už nestačí — server vrací twoFactorRedirect
    const twoFactorCookies = await startSignIn(auth, '2fa@test.cz');

    // session se před druhým faktorem nevydá
    expect(await auth.api.getSession({ headers: new Headers({ cookie: twoFactorCookies }) })).toBe(
      null,
    );

    // špatný kód neprojde
    await expect(
      auth.api.verifyTOTP({
        body: { code: '000000' },
        headers: new Headers({ cookie: twoFactorCookies }),
      }),
    ).rejects.toThrow();

    // správný kód dokončí přihlášení a vydá session
    const verifyRes = await auth.api.verifyTOTP({
      body: { code: codeForStep(secret, currentStep() + 1) },
      headers: new Headers({ cookie: twoFactorCookies }),
      asResponse: true,
    });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookiesFrom(verifyRes) }),
    });
    expect(session?.user.email).toBe('2fa@test.cz');
    expect(session?.user.twoFactorEnabled).toBe(true);
  });

  /**
   * D-01: Better Auth kód po použití nezneplatní, takže v rámci svého ~90s okna
   * projde znovu — a projde i pro úplně jinou přihlašovací výzvu. Kdo kód
   * odchytí (podvržená stránka, MITM), otevře si během minuty a půl vlastní
   * relaci, i když ho oběť už použila. OWASP ASVS 2.8.1.
   */
  it('použitý kód neprojde podruhé ani v nové výzvě (D-01)', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const { secret } = await userWithTwoFactor(auth, 'replay@test.cz');

    const prvniVyzva = await startSignIn(auth, 'replay@test.cz');
    const kod = codeForStep(secret, currentStep() + 1);
    const prvniOvereni = await auth.api.verifyTOTP({
      body: { code: kod },
      headers: new Headers({ cookie: prvniVyzva }),
      asResponse: true,
    });
    expect(prvniOvereni.status).toBe(200);

    // druhá, na první nezávislá výzva — týž kód je pořád v platném okně
    const druhaVyzva = await startSignIn(auth, 'replay@test.cz');
    expect(druhaVyzva).not.toBe(prvniVyzva);
    await expect(
      auth.api.verifyTOTP({
        body: { code: kod },
        headers: new Headers({ cookie: druhaVyzva }),
      }),
    ).rejects.toMatchObject({ body: { code: 'TOTP_CODE_ALREADY_USED' } });

    // odmítnutí nesmí vydat session
    expect(await auth.api.getSession({ headers: new Headers({ cookie: druhaVyzva }) })).toBe(null);
  });

  /**
   * Použité kódy se musí držet per uživatel. Kdyby stačil samotný kód, měl by
   * kdokoli páku na cizí účty: šestimístných kódů je jen milion, takže by je
   * šlo cizím účtům plošně „spalovat" dřív, než je majitel stihne opsat.
   */
  it('kód použitý jedním účtem neblokuje týž kód u jiného', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const { secret } = await userWithTwoFactor(auth, 'sdileny-a@test.cz');
    await userWithTwoFactor(auth, 'sdileny-b@test.cz');

    // ať oběma vychází TÝŽ kód: B dostane do 2FA řádku tajemství účtu A
    // (v DB je šifrované, tak se přenese jak leží)
    const { getDb } = await import('@/db');
    const { twoFactor: twoFactorTable, user: userTable } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    const idFor = async (email: string) =>
      (await db.select().from(userTable).where(eq(userTable.email, email)))[0]!.id;
    const secretOfA = (
      await db
        .select()
        .from(twoFactorTable)
        .where(eq(twoFactorTable.userId, await idFor('sdileny-a@test.cz')))
    )[0]!.secret;
    await db
      .update(twoFactorTable)
      .set({ secret: secretOfA })
      .where(eq(twoFactorTable.userId, await idFor('sdileny-b@test.cz')));

    const krok = currentStep() + 1;
    const kod = codeForStep(secret, krok);
    const aVyzva = await startSignIn(auth, 'sdileny-a@test.cz');
    const aOvereni = await auth.api.verifyTOTP({
      body: { code: kod },
      headers: new Headers({ cookie: aVyzva }),
      asResponse: true,
    });
    expect(aOvereni.status).toBe(200);

    const bVyzva = await startSignIn(auth, 'sdileny-b@test.cz');
    const bOvereni = await auth.api.verifyTOTP({
      body: { code: kod },
      headers: new Headers({ cookie: bVyzva }),
      asResponse: true,
    });
    expect(bOvereni.status).toBe(200);
  });
});
