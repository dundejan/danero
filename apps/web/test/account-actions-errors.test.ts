import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { signUpVerified } from './auth-helpers';

/**
 * Smazání účtu a změna hesla musí říct, PROČ se nepovedly.
 *
 * Obě akce svedly každé selhání Better Authu na „heslo nesedí“. Jenže limit
 * pokusů hlídala akce i háček Better Authu nad TÝMŽ čítačem
 * (`limitSensitiveAccountOperations`), takže jeden pokus stál dva zápisy:
 * správné heslo hned po jednom překlepu skončilo na limitu — a formulář
 * tvrdil, že heslo nesedí (změřeno 10. 10. 2026 při úklidu testovacího účtu:
 * správné heslo dvě vteřiny po špatném). Člověk pak zkouší jiná hesla nebo si
 * ho jde obnovovat, a přitom stačilo počkat.
 *
 * Testy běží proti opravdovému Better Authu — s podvrženým `authApi` by háček
 * neběžel a dvojí počítání by vidět nebylo (tak mu unikl test limitů).
 */
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

/** Cíl přesměrování, kterým akce skončila. */
async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('server action neskončila přesměrováním');
}

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.append(name, value);
  return data;
};

/** Založí účet, přihlásí ho a jeho relaci podstrčí server actions. */
async function signedIn(email: string): Promise<void> {
  const { getAuth } = await import('@/lib/auth');
  const auth = await getAuth();
  await signUpVerified(auth, { email, password: HESLO, name: 'Test' });
  const signIn = await auth.api.signInEmail({ body: { email, password: HESLO }, asResponse: true });
  request.headers = new Headers({
    cookie: signIn.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0]!)
      .join('; '),
  });
}

async function userExists(email: string): Promise<boolean> {
  const { getDb } = await import('@/db');
  const { user } = await import('@/db/schema');
  return (await (await getDb()).select().from(user).where(eq(user.email, email))).length > 0;
}

describe('smazání účtu: hláška podle příčiny', () => {
  beforeAll(() => {
    process.env.PGLITE_DATA_DIR = ':memory:';
  });

  const deleteForm = (password: string) => form({ heslo: password, potvrzeni: 'SMAZAT' });

  it('správné heslo hned po překlepu účet smaže', { timeout: 60_000 }, async () => {
    await signedIn('preklep@test.cz');
    const { deleteAccountAction } = await import('@/app/(app)/nastaveni/actions');

    expect(await redirectTarget(() => deleteAccountAction(deleteForm('spatne-heslo')))).toBe(
      '/nastaveni/ucet?chyba=smazani-heslo',
    );
    expect(await userExists('preklep@test.cz')).toBe(true);

    expect(await redirectTarget(() => deleteAccountAction(deleteForm(HESLO)))).toBe('/?smazano=1');
    expect(await userExists('preklep@test.cz')).toBe(false);
  });

  it('po třech pokusech řekne, že je jich moc — ne že heslo nesedí', { timeout: 60_000 }, async () => {
    await signedIn('moc-pokusu@test.cz');
    const { deleteAccountAction } = await import('@/app/(app)/nastaveni/actions');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await redirectTarget(() => deleteAccountAction(deleteForm('spatne-heslo')))).toBe(
        '/nastaveni/ucet?chyba=smazani-heslo',
      );
    }
    // čtvrtý pokus je přes limit, i se správným heslem
    expect(await redirectTarget(() => deleteAccountAction(deleteForm(HESLO)))).toBe(
      '/nastaveni/ucet?chyba=smazani-limit',
    );
    expect(await userExists('moc-pokusu@test.cz')).toBe(true);
  });

  it('jiné selhání nesvádí na heslo', { timeout: 60_000 }, async () => {
    await signedIn('vypadek@test.cz');
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const spy = vi.spyOn(auth.api, 'deleteUser').mockRejectedValueOnce(new Error('connection lost'));
    const { deleteAccountAction } = await import('@/app/(app)/nastaveni/actions');

    expect(await redirectTarget(() => deleteAccountAction(deleteForm(HESLO)))).toBe(
      '/nastaveni/ucet?chyba=smazani-selhalo',
    );
    spy.mockRestore();
    expect(await userExists('vypadek@test.cz')).toBe(true);
  });
});

describe('změna hesla: hláška podle příčiny', () => {
  const passwordForm = (current: string) =>
    form({ 'stavajici-heslo': current, 'nove-heslo': 'uplne-nove-heslo-2026' });

  it('po pěti pokusech řekne, že je jich moc — ne že heslo nesedí', { timeout: 60_000 }, async () => {
    await signedIn('heslo-limit@test.cz');
    const { changePasswordAction } = await import('@/app/(app)/nastaveni/actions');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await redirectTarget(() => changePasswordAction(passwordForm('spatne-heslo')))).toBe(
        '/nastaveni/ucet?chyba=heslo-spatne',
      );
    }
    expect(await redirectTarget(() => changePasswordAction(passwordForm(HESLO)))).toBe(
      '/nastaveni/ucet?chyba=heslo-limit',
    );
  });

  it('jiné selhání nesvádí na heslo', { timeout: 60_000 }, async () => {
    await signedIn('heslo-vypadek@test.cz');
    const { getAuth } = await import('@/lib/auth');
    const auth = await getAuth();
    const spy = vi
      .spyOn(auth.api, 'changePassword')
      .mockRejectedValueOnce(new Error('connection lost'));
    const { changePasswordAction } = await import('@/app/(app)/nastaveni/actions');

    expect(await redirectTarget(() => changePasswordAction(passwordForm(HESLO)))).toBe(
      '/nastaveni/ucet?chyba=heslo-selhalo',
    );
    spy.mockRestore();
  });
});

describe('texty chyb účtu', () => {
  it('limit i jiné selhání mají vlastní větu', async () => {
    const { settingsErrorText } = await import('@/app/(app)/nastaveni/settings-toast');
    for (const code of ['smazani-limit', 'heslo-limit']) {
      expect(settingsErrorText(code)).toMatch(/Moc pokusů/);
      expect(settingsErrorText(code)).not.toMatch(/nesedí/);
    }
    for (const code of ['smazani-selhalo', 'heslo-selhalo']) {
      expect(settingsErrorText(code)).not.toMatch(/nesedí/);
      expect(settingsErrorText(code)).toMatch(/za chvíli/);
    }
  });
});
