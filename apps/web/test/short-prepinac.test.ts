import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { taxpayerProfiles, user } from '@/db/schema';

/**
 * R-13b: přepínač okamžiku příjmu z prodeje nakrátko musí jít nastavit
 * z aplikace, ne jen z kódu.
 *
 * Pravidlo 2 v CLAUDE.md žádá u sporných výkladů bezpečný default A možnost
 * vidět, co by znamenal ten výhodnější — přepínač zadrátovaný v enginu tuhle
 * podmínku nesplňuje, i když je v docs/02 popsaný.
 */

// mock factory se hoistuje nad modul, takže odkaz na db musí jít přes vi.hoisted
const stav = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u1' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});

const form = (short: 'safe' | 'lenient'): FormData => {
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
    'vratka-kapitalu': 'safe',
    'short-prijem': short,
  })) {
    data.append(key, value);
  }
  return data;
};

const uloz = async (short: 'safe' | 'lenient'): Promise<void> => {
  const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
  try {
    await saveProfileAction(form(short));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('REDIRECT:')) throw error;
  }
};

describe('přepínač okamžiku příjmu u shortu (R-13b)', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await import('@/db');
    stav.db = await createPgliteDb();
    await stav.db.insert(user).values({ id: 'u1', name: 'Test', email: 'short@danero.cz' });
  }, 30_000);

  it('výchozí je bezpečný výklad a volba se uloží i propíše do options', { timeout: 30_000 }, async () => {
    await uloz('safe');
    const bezpecny = await stav.db
      .select()
      .from(taxpayerProfiles)
      .where(eq(taxpayerProfiles.userId, 'u1'));
    expect(bezpecny[0]!.shortSaleIncomeOnSale).toBe(true);

    await uloz('lenient');
    const mirnejsi = await stav.db
      .select()
      .from(taxpayerProfiles)
      .where(eq(taxpayerProfiles.userId, 'u1'));
    expect(mirnejsi[0]!.shortSaleIncomeOnSale).toBe(false);

    // a hlavně: volba se propíše do options, se kterými počítá engine
    const { getProfile, profileToEngine } = await import('@/lib/portfolio');
    const profile = await getProfile(stav.db, 'u1');
    expect(profileToEngine(profile!).options.shortSaleIncomeOnSale).toBe(false);
  });
});
