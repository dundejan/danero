import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';

/**
 * R-07h: přepínač „Vratka kapitálu" musí dojít z formuláře až do enginu.
 * Sporný výklad, který se uloží, ale nepropíše do výpočtu, je horší než žádný:
 * uživatel vidí zvolenou variantu v nastavení i v reportu, a přitom se počítá
 * ta druhá.
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
  requireUser: async () => ({ id: 'u-roc', email: 'jan@danero.cz', name: 'Jan' }),
}));

const form = (vratka: 'safe' | 'lenient'): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    rezim: 'PAUSAL',
    'ostatni-prijmy': '0',
    parovani: 'FIFO',
    kurzy: 'UNIFIED',
    'limit-100k': 'strict',
    'zaklad-casoveho-testu': 'settlement',
    'derivaty-vydaje': 'restrictive',
    'emt-casovy-test': 'safe',
    'vratka-kapitalu': vratka,
    'short-prijem': 'safe',
  })) {
    data.append(key, value);
  }
  return data;
};

const uloz = async (vratka: 'safe' | 'lenient'): Promise<void> => {
  const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
  try {
    await saveProfileAction(form(vratka));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('REDIRECT:')) throw error;
  }
};

describe('přepínač vratky kapitálu (R-07h)', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await stav.db.insert(user).values({ id: 'u-roc', name: 'Jan', email: 'jan@danero.cz' });
  }, 30_000);

  it('výchozí je bezpečný výklad a engine ho tak dostane', { timeout: 30_000 }, async () => {
    await uloz('safe');
    const { getProfile, engineInputForUser } = await import('@/lib/portfolio');
    const profile = await getProfile(stav.db, 'u-roc');
    expect(profile?.returnOfCapitalReducesBasis).toBe(false);
    expect(engineInputForUser([], profile!, 2025).options?.returnOfCapitalReducesBasis).toBe(false);
  });

  it('mírnější výklad se uloží a propíše do vstupu enginu', { timeout: 30_000 }, async () => {
    await uloz('lenient');
    const { getProfile, engineInputForUser } = await import('@/lib/portfolio');
    const profile = await getProfile(stav.db, 'u-roc');
    expect(profile?.returnOfCapitalReducesBasis).toBe(true);
    expect(engineInputForUser([], profile!, 2025).options?.returnOfCapitalReducesBasis).toBe(true);
  });
});
