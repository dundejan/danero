import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { getAuth } from '@/lib/auth';
import { signUpVerified } from './auth-helpers';
import { totp } from './totp-util';

/**
 * K4-04: audit účtu musí vidět i to, čím se dá účet převzít.
 *
 * Scénář z auditu: útočník s přístupem do e-mailu projde „zapomenuté heslo",
 * nastaví si vlastní heslo a zapne si druhý faktor. Uživatel se vrátí, vidí,
 * že je odhlášený, jde do Nastavení zjistit, co se dělo — a **nenajde nic**.
 * Naměřeno bylo `["LOGIN","LOGIN"]` po obojím.
 */
type Auth = Awaited<ReturnType<typeof getAuth>>;

const HESLO = 'superbezpecneheslo';

const cookiesFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .filter((pair) => !pair.endsWith('='))
    .join('; ');

const currentStep = () => Math.floor(Date.now() / 30_000);
const codeForStep = (secret: string, step: number) => totp(secret, step * 30_000);

const logPath = () => join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');

/** Token z odkazu na obnovu hesla v posledním testovacím e-mailu. */
function resetTokenFrom(path: string): string {
  const messages = readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { text: string });
  const token = messages.at(-1)?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
  if (!token) throw new Error('E-mail neobsahuje odkaz na obnovu hesla');
  return token;
}

async function auditTypesOf(email: string): Promise<string[]> {
  const { getDb } = await import('@/db');
  const { auditLog, user } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const db = await getDb();
  const [found] = await db.select().from(user).where(eq(user.email, email));
  const rows = await db.select().from(auditLog).where(eq(auditLog.userId, found!.id));
  return rows.map((row) => row.type);
}

/** Přihlášení heslem u účtu bez 2FA — vrací cookie relace. */
async function signIn(auth: Auth, email: string, password = HESLO): Promise<string> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return cookiesFrom(response);
}

describe('audit účtu zaznamená převzetí účtu (K4-04)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it('obnova hesla z e-mailu se zapíše jako změna hesla', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'audit-reset@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Audit' });

    const log = logPath();
    process.env.DANERO_EMAIL_LOG = log;
    await auth.api.requestPasswordReset({ body: { email } });
    const token = resetTokenFrom(log);
    delete process.env.DANERO_EMAIL_LOG;

    await auth.api.resetPassword({ body: { newPassword: 'jine-heslo-2026-ok', token } });

    expect(await auditTypesOf(email)).toContain('PASSWORD_CHANGE');
  });

  it('zapnutí i vypnutí druhého faktoru se zapíše', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'audit-2fa@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Audit 2FA' });
    const cookies = await signIn(auth, email);

    const enable = await auth.api.enableTwoFactor({
      body: { password: HESLO },
      headers: new Headers({ cookie: cookies }),
    });
    const secret = /[?&]secret=([^&]+)/.exec(enable.totpURI)?.[1]!;

    // samotné /two-factor/enable ještě nic nezapíná — jen vydá QR a záložní
    // kódy, takže se do auditu nesmí zapsat nic
    expect(await auditTypesOf(email)).not.toContain('TWO_FACTOR_ENABLED');

    const verified = await auth.api.verifyTOTP({
      body: { code: codeForStep(secret, currentStep()) },
      headers: new Headers({ cookie: cookies }),
      asResponse: true,
    });
    const afterEnable = cookiesFrom(verified);
    expect(await auditTypesOf(email)).toContain('TWO_FACTOR_ENABLED');

    await auth.api.disableTwoFactor({
      body: { password: HESLO },
      headers: new Headers({ cookie: afterEnable }),
    });
    expect(await auditTypesOf(email)).toContain('TWO_FACTOR_DISABLED');
  });

  /**
   * Přihlášení druhým faktorem jde přes TÝŽ endpoint jako potvrzení nastavení.
   * Kdyby se hook nerozlišoval, měl by uživatel v auditu „zapnutí 2FA" po
   * každém přihlášení — a záznam by přestal cokoli znamenat.
   */
  it('přihlášení druhým faktorem se jako zapnutí NEzapisuje', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'audit-2fa-login@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Audit login' });
    const cookies = await signIn(auth, email);
    const enable = await auth.api.enableTwoFactor({
      body: { password: HESLO },
      headers: new Headers({ cookie: cookies }),
    });
    const secret = /[?&]secret=([^&]+)/.exec(enable.totpURI)?.[1]!;
    await auth.api.verifyTOTP({
      body: { code: codeForStep(secret, currentStep()) },
      headers: new Headers({ cookie: cookies }),
    });
    const poZapnuti = (await auditTypesOf(email)).filter((t) => t === 'TWO_FACTOR_ENABLED').length;
    expect(poZapnuti).toBe(1);

    const challenge = cookiesFrom(
      await auth.api.signInEmail({ body: { email, password: HESLO }, asResponse: true }),
    );
    await auth.api.verifyTOTP({
      body: { code: codeForStep(secret, currentStep() + 1) },
      headers: new Headers({ cookie: challenge }),
      asResponse: true,
    });

    const poPrihlaseni = (await auditTypesOf(email)).filter(
      (t) => t === 'TWO_FACTOR_ENABLED',
    ).length;
    expect(poPrihlaseni).toBe(1);
  });
});
