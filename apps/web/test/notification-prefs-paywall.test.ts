import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';

/**
 * Nastavení hlídacích e-mailů je placené (docs/19) — rozesílku dělá
 * `api/cron/notify` jen předplatitelům. Stránka proto formulář bez předplatného
 * vůbec nevykreslí, ale to je jen první obrana: server action jde zavolat
 * přímo. Platí tu stejné pravidlo jako u napojení brokera (`import/actions.ts`):
 * stránka kvůli tomu, aby uživatel nedělal práci zbytečně, action jako pojistka.
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
    id: 'u-notif',
    email: 'jan@danero.cz',
    name: 'Jan',
    twoFactorEnabled: false,
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

const form = (): FormData => {
  const data = new FormData();
  data.append('emaily-zapnute', 'on');
  data.append('upozorneni-casove-testy', 'on');
  data.append('lhuta-casoveho-testu', '7');
  return data;
};

describe('nastavení hlídacích e-mailů je za předplatným', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-notif', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  afterEach(() => {
    delete process.env.DANERO_BILLING;
  });

  it('účet zdarma se nastavením neprojde, i když formulář odešle mimo UI', async () => {
    process.env.DANERO_BILLING = 'stripe';
    const { saveNotificationPrefsAction } = await import('@/app/(app)/nastaveni/actions');

    expect(await cilRedirectu(() => saveNotificationPrefsAction(form()))).toBe(
      '/nastaveni/upozorneni?chyba=hlidani-placene',
    );
    const { notificationPrefs } = await import('@/db/schema');
    expect(await stav.db.select().from(notificationPrefs)).toEqual([]);
  });

  it('vlastní instance bez plateb ukládá dál (paywall je jen v hostované verzi)', async () => {
    const { saveNotificationPrefsAction } = await import('@/app/(app)/nastaveni/actions');

    expect(await cilRedirectu(() => saveNotificationPrefsAction(form()))).toBe(
      '/nastaveni/upozorneni?ok=notifikace',
    );
    const { notificationPrefs } = await import('@/db/schema');
    const [row] = await stav.db.select().from(notificationPrefs);
    expect(row?.timeTestLeadDays).toBe('7');
  });
});
