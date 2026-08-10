import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';

/**
 * D-2/D-3: server actions v nastavení volají `auth.api.*` napřímo, takže
 * rate limity Better Authu (visí na `/api/auth/*`) je neomezují — bez limitu
 * per účet je z unesené session neomezený password oracle a z formuláře
 * změny e-mailu rozesílač na cizí adresy.
 */
const stav = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({
    id: 'u-limit',
    email: 'jan@danero.cz',
    name: 'Jan',
    twoFactorEnabled: false,
  }),
  authApi: async () => ({
    api: { changePassword: async () => ({}), sendVerificationEmail: async () => ({}) },
    requestHeaders: new Headers(),
  }),
}));

/** Vrátí cílovou URL redirectu, kterým server action skončila. */
async function cilRedirectu(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('server action neskončila redirectem');
}

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
};

describe('limity účtových server actions (D-2/D-3)', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-limit', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  it('změna hesla: 6. pokus v okně narazí na limit (5/5 min)', { timeout: 30_000 }, async () => {
    const { changePasswordAction } = await import('@/app/(app)/nastaveni/actions');
    const data = () => form({ 'stavajici-heslo': 'stareheslo123', 'nove-heslo': 'noveheslo123' });

    for (let i = 0; i < 5; i += 1) {
      expect(await cilRedirectu(() => changePasswordAction(data()))).toBe('/nastaveni/ucet?ok=heslo');
    }
    expect(await cilRedirectu(() => changePasswordAction(data()))).toBe(
      '/nastaveni/ucet?chyba=heslo-limit',
    );
  });

  it('změna e-mailu: 4. pokus v okně narazí na limit (3/5 min)', { timeout: 30_000 }, async () => {
    const { changeEmailAction } = await import('@/app/(app)/nastaveni/actions');
    const data = () => form({ 'novy-email': 'jiny@danero.cz', 'stavajici-heslo': 'stareheslo123' });

    // účet nemá heslo v credential accountu → prvních 2 pokusy končí na hesle,
    // ale limit spotřebují (tj. e-mail se z formuláře neodešle donekonečna)
    for (let i = 0; i < 3; i += 1) {
      expect(await cilRedirectu(() => changeEmailAction(data()))).toBe(
        '/nastaveni/ucet?chyba=email-heslo',
      );
    }
    expect(await cilRedirectu(() => changeEmailAction(data()))).toBe(
      '/nastaveni/ucet?chyba=email-limit',
    );
  });
});
