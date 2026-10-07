import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';

/**
 * Nastavení hlídacích e-mailů se ukládá každému — Danero je od 8. 10. 2026
 * celé zdarma. Do té doby tu stál test paywallu (`notification-prefs-paywall`)
 * a spolu s ním i jediná kontrola, že server action nastavení opravdu uloží;
 * ta zůstává.
 *
 * Druhý případ hlídá přechod: účty založené před zrušením plateb dostaly
 * migrací 0043 e-maily VYPNUTÉ (nikdy neviděly nastavení a první běh hlídače
 * by jim bez varování poslal všechno najednou). Zapnout si je musí jít.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
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
async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  throw new Error('server action neskončila redirectem');
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

describe('nastavení hlídacích e-mailů', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    state.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await state.db.insert(user).values({ id: 'u-notif', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  it('uloží se komukoli, bez jakéhokoli tarifu', { timeout: 30_000 }, async () => {
    const { saveNotificationPrefsAction } = await import('@/app/(app)/nastaveni/actions');

    expect(
      await redirectTarget(() =>
        saveNotificationPrefsAction(
          form({
            'emaily-zapnute': 'on',
            'upozorneni-casove-testy': 'on',
            'lhuta-casoveho-testu': '7',
          }),
        ),
      ),
    ).toBe('/nastaveni/upozorneni?ok=notifikace');

    const { notificationPrefs } = await import('@/db/schema');
    const [row] = await state.db.select().from(notificationPrefs);
    expect(row?.emailEnabled).toBe(true);
    expect(row?.timeTestLeadDays).toBe('7');
  });

  it('účet s e-maily vypnutými migrací si je zapne', { timeout: 30_000 }, async () => {
    const { notificationPrefs } = await import('@/db/schema');
    await state.db
      .update(notificationPrefs)
      .set({ emailEnabled: false })
      .where(eq(notificationPrefs.userId, 'u-notif'));

    const { getNotificationPrefs } = await import('@/lib/notifications');
    expect((await getNotificationPrefs(state.db, 'u-notif')).emailEnabled).toBe(false);

    const { saveNotificationPrefsAction } = await import('@/app/(app)/nastaveni/actions');
    await redirectTarget(() => saveNotificationPrefsAction(form({ 'emaily-zapnute': 'on' })));
    expect((await getNotificationPrefs(state.db, 'u-notif')).emailEnabled).toBe(true);
  });
});
