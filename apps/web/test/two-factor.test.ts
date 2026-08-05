import { describe, expect, it } from 'vitest';
import { signUpVerified } from './auth-helpers';
import { totp } from './totp-util';

const cookiesFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');

describe('2FA TOTP flow přes Better Auth API (in-memory PGlite)', () => {
  it('zapnutí → ověření → přihlášení vyžaduje kód', { timeout: 30_000 }, async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();

    // registrace + potvrzení e-mailu (bez něj se nedá přihlásit) + session cookies
    await signUpVerified(auth, {
      email: '2fa@test.cz',
      password: 'superbezpecneheslo',
      name: 'Dvoufaktor',
    });
    const firstSignIn = await auth.api.signInEmail({
      body: { email: '2fa@test.cz', password: 'superbezpecneheslo' },
      asResponse: true,
    });
    const sessionCookies = cookiesFrom(firstSignIn);
    expect(sessionCookies).toContain('session_token');

    // zapnutí 2FA (vyžaduje heslo) → totpURI + záložní kódy
    const enable = await auth.api.enableTwoFactor({
      body: { password: 'superbezpecneheslo' },
      headers: new Headers({ cookie: sessionCookies }),
    });
    expect(enable.totpURI).toContain('otpauth://totp/');
    expect(enable.backupCodes.length).toBeGreaterThan(0);
    const secret = /[?&]secret=([^&]+)/.exec(enable.totpURI)?.[1];
    expect(secret).toBeTruthy();

    // aktivace prvním kódem
    await auth.api.verifyTOTP({
      body: { code: totp(secret!) },
      headers: new Headers({ cookie: sessionCookies }),
    });

    // nové přihlášení: heslo už nestačí — server vrací twoFactorRedirect
    const signInRes = await auth.api.signInEmail({
      body: { email: '2fa@test.cz', password: 'superbezpecneheslo' },
      asResponse: true,
    });
    const signInBody = (await signInRes.json()) as { twoFactorRedirect?: boolean };
    expect(signInBody.twoFactorRedirect).toBe(true);
    const twoFactorCookies = cookiesFrom(signInRes);

    // špatný kód neprojde
    await expect(
      auth.api.verifyTOTP({
        body: { code: '000000' },
        headers: new Headers({ cookie: twoFactorCookies }),
      }),
    ).rejects.toThrow();

    // správný kód dokončí přihlášení a vydá session
    const verifyRes = await auth.api.verifyTOTP({
      body: { code: totp(secret!) },
      headers: new Headers({ cookie: twoFactorCookies }),
      asResponse: true,
    });
    const finalCookies = cookiesFrom(verifyRes);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: finalCookies }),
    });
    expect(session?.user.email).toBe('2fa@test.cz');
    expect(session?.user.twoFactorEnabled).toBe(true);
  });
});
