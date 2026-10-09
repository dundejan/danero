import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { signUpVerified, verificationTokenFrom } from './auth-helpers';

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

/**
 * Server action z Nastavení běží mimo Next: `redirect` se promění ve výjimku
 * s cílovou adresou a session se místo z `next/headers` bere z hlaviček, které
 * si test uloží po přihlášení. Ověřuje ji ale opravdový Better Auth, takže
 * akce pracuje se skutečným účtem v databázi.
 */
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

/** Formulář „Změna e-mailu“ z Nastavení (`name` atributy jsou česky). */
function emailChangeForm(newEmail: string, currentPassword: string): FormData {
  const data = new FormData();
  data.append('novy-email', newEmail);
  data.append('stavajici-heslo', currentPassword);
  return data;
}

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

  /**
   * L21-01: e-mail se mění i proto, že starou schránku už uživatel neovládá.
   * Odkaz na obnovu vydaný na starou adresu pak nesmí zůstat cestou k účtu —
   * jinak ho kdokoli se starou schránkou do hodiny použije, přepíše heslo
   * a vlastníka odhlásí ze všech zařízení.
   */
  it(
    'změna e-mailu v nastavení sundá odkaz vydaný na starou adresu',
    { timeout: 30_000 },
    async () => {
      const { getAuth } = await import('@/lib/auth');
      const auth = await getAuth();
      const oldEmail = 'stara-schranka@test.cz';
      const newEmail = 'nova-schranka@test.cz';
      await signUpVerified(auth, { email: oldEmail, password: HESLO, name: 'Stěhování' });

      // odkaz na obnovu dorazí do staré schránky (žádost nevyžaduje přihlášení)
      const log = logPath();
      process.env.DANERO_EMAIL_LOG = log;
      await auth.api.requestPasswordReset({ body: { email: oldEmail } });
      const token = resetTokenFrom(log);

      const signIn = await auth.api.signInEmail({
        body: { email: oldEmail, password: HESLO },
        asResponse: true,
      });
      request.headers = new Headers({
        cookie: signIn.headers
          .getSetCookie()
          .map((cookie) => cookie.split(';')[0]!)
          .join('; '),
      });
      const { changeEmailAction } = await import('@/app/(app)/nastaveni/actions');
      expect(await redirectTarget(() => changeEmailAction(emailChangeForm(newEmail, HESLO)))).toBe(
        '/nastaveni/ucet?ok=email',
      );
      // vlastník novou adresu potvrdí odkazem, který na ni akce poslala
      await auth.api.verifyEmail({ query: { token: verificationTokenFrom(log) } });
      delete process.env.DANERO_EMAIL_LOG;

      // odkaz ze staré schránky už heslo nepřepíše…
      await expect(
        auth.api.resetPassword({ body: { newPassword: 'utocnikovo-heslo-2026', token } }),
      ).rejects.toMatchObject({ body: { code: 'INVALID_TOKEN' } });
      // …a vlastník se novou adresou přihlásí svým původním heslem
      await expect(
        auth.api.signInEmail({ body: { email: newEmail, password: HESLO } }),
      ).resolves.toBeTruthy();
      await expect(
        auth.api.signInEmail({ body: { email: newEmail, password: 'utocnikovo-heslo-2026' } }),
      ).rejects.toThrow();
    },
  );

  it('neúspěšná změna e-mailu čekající odkaz nechá být', { timeout: 30_000 }, async () => {
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const email = 'zustava@test.cz';
    await signUpVerified(auth, { email, password: HESLO, name: 'Zůstává' });

    const log = logPath();
    process.env.DANERO_EMAIL_LOG = log;
    await auth.api.requestPasswordReset({ body: { email } });
    const token = resetTokenFrom(log);
    delete process.env.DANERO_EMAIL_LOG;

    const signIn = await auth.api.signInEmail({
      body: { email, password: HESLO },
      asResponse: true,
    });
    request.headers = new Headers({
      cookie: signIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0]!)
        .join('; '),
    });
    // překlep ve stávajícím hesle adresu nezmění — odkaz na obnovu je pak
    // pořád řádná záchranná cesta a musí zůstat živý
    const { changeEmailAction } = await import('@/app/(app)/nastaveni/actions');
    expect(
      await redirectTarget(() =>
        changeEmailAction(emailChangeForm('jinam@test.cz', 'uplne-jine-heslo')),
      ),
    ).toBe('/nastaveni/ucet?chyba=email-heslo');

    await expect(
      auth.api.resetPassword({ body: { newPassword: 'obnovene-heslo-2026', token } }),
    ).resolves.toBeTruthy();
  });
});
