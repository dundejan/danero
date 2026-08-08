import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { signUpVerified } from './auth-helpers';

/**
 * D-02: dokončená obnova hesla spotřebuje jen ten token, kterým se provedla —
 * ostatní vydané odkazy žijí dál do svého vypršení (hodina). Starý odkaz ve
 * schránce tak ještě hodinu po změně hesla znovu přepíše heslo, takže kdo se
 * do schránky dostal, přebije i to, že si uživatel heslo mezitím sám změnil.
 */
const HESLO = 'superbezpecneheslo';

/** Token z odkazu na obnovu hesla v posledním testovacím e-mailu. */
function resetTokenFrom(logPath: string): string {
  const messages = readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { text: string });
  const token = messages.at(-1)?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
  if (!token) throw new Error('E-mail neobsahuje odkaz na obnovu hesla');
  return token;
}

const logPath = () => join(mkdtempSync(join(tmpdir(), 'danero-test-')), 'emails.log');

describe('obnova hesla — platnost vydaných tokenů (D-02)', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  it('dokončený reset zneplatní i ostatní vydané odkazy', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'reset@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Reset' });

    const log = logPath();
    process.env.DANERO_EMAIL_LOG = log;
    await auth.api.requestPasswordReset({ body: { email } });
    const starsiToken = resetTokenFrom(log);
    await auth.api.requestPasswordReset({ body: { email } });
    const novejsiToken = resetTokenFrom(log);
    delete process.env.DANERO_EMAIL_LOG;
    expect(starsiToken).not.toBe(novejsiToken);

    await auth.api.resetPassword({
      body: { newPassword: 'moje-nove-heslo-2026', token: novejsiToken },
    });

    // starší, nikdy nepoužitý odkaz už nesmí heslo přepsat
    await expect(
      auth.api.resetPassword({
        body: { newPassword: 'utocnikovo-heslo-2026', token: starsiToken },
      }),
    ).rejects.toThrow();

    // a heslo zůstalo to z dokončené obnovy
    await expect(
      auth.api.signInEmail({ body: { email, password: 'moje-nove-heslo-2026' } }),
    ).resolves.toBeTruthy();
    await expect(
      auth.api.signInEmail({ body: { email, password: 'utocnikovo-heslo-2026' } }),
    ).rejects.toThrow();
  });

  it('změna hesla v nastavení sundá čekající odkaz na obnovu', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'zmena@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Změna' });

    // útočník si nechá poslat odkaz na obnovu, uživatel si mezitím sám změní heslo
    const log = logPath();
    process.env.DANERO_EMAIL_LOG = log;
    await auth.api.requestPasswordReset({ body: { email } });
    const token = resetTokenFrom(log);
    delete process.env.DANERO_EMAIL_LOG;

    const signIn = await auth.api.signInEmail({
      body: { email, password: HESLO },
      asResponse: true,
    });
    const cookies = signIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0]!)
      .join('; ');
    await auth.api.changePassword({
      headers: new Headers({ cookie: cookies }),
      body: { currentPassword: HESLO, newPassword: 'zvolene-nove-heslo-2026' },
    });

    await expect(
      auth.api.resetPassword({ body: { newPassword: 'utocnikovo-heslo-2026', token } }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({ body: { email, password: 'zvolene-nove-heslo-2026' } }),
    ).resolves.toBeTruthy();
  });

  it('neúspěšná změna hesla čekající odkaz nechá být', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'spatne-heslo@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Překlep' });

    const log = logPath();
    process.env.DANERO_EMAIL_LOG = log;
    await auth.api.requestPasswordReset({ body: { email } });
    const token = resetTokenFrom(log);
    delete process.env.DANERO_EMAIL_LOG;

    const signIn = await auth.api.signInEmail({
      body: { email, password: HESLO },
      asResponse: true,
    });
    const cookies = signIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0]!)
      .join('; ');
    // překlep ve stávajícím hesle heslo nezmění — odkaz na obnovu musí zůstat
    // živý, jinak by si uživatel překlepem zavřel i záchrannou cestu
    await expect(
      auth.api.changePassword({
        headers: new Headers({ cookie: cookies }),
        body: { currentPassword: 'uplne-jine-heslo', newPassword: 'zvolene-nove-heslo-2026' },
      }),
    ).rejects.toThrow();

    await expect(
      auth.api.resetPassword({ body: { newPassword: 'obnovene-heslo-2026', token } }),
    ).resolves.toBeTruthy();
  });
});
