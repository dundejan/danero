import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';

/**
 * Cesta nového uživatele (R1B-05): uvítání slibuje dva kroky — profil a data.
 * Po uložení prvního profilu ale člověk končil na prázdném přehledu a k nahrání
 * výpisu se šlo přes dvě mezistránky, které jen říkaly „pokračuj“. První
 * uložení účtu bez dat proto vede rovnou ke kroku 2; všechna ostatní uložení
 * se chovají jako dřív.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db, userId: 'u-novy' }));

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
  requireUser: async () => ({ id: state.userId, email: 'nikdo@priklad.test', name: 'Nikdo' }),
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

const profileForm = (): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    rezim: 'PAUSAL',
    'ostatni-prijmy': '0',
    parovani: 'FIFO',
    kurzy: 'UNIFIED',
    'limit-100k': 'strict',
    'zaklad-casoveho-testu': 'settlement',
    'derivaty-vydaje': 'restrictive',
    'emt-casovy-test': 'safe',
    'vratka-kapitalu': 'safe',
  })) {
    data.append(name, value);
  }
  return data;
};

const T212_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,PFS1',
].join('\n');

describe('kam vede uložení daňového profilu', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    state.db = await createPgliteDb();
    const { user } = await import('@/db/schema');
    await state.db.insert(user).values([
      { id: 'u-novy', name: 'Nový', email: 'novy@priklad.test' },
      { id: 'u-s-daty', name: 'S daty', email: 'data@priklad.test' },
    ]);
  }, 30_000);

  it(
    'první profil účtu bez dat pokračuje rovnou ke kroku 2 (Zdroje dat)',
    { timeout: 30_000 },
    async () => {
      const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
      state.userId = 'u-novy';
      const target = await redirectTarget(() => saveProfileAction(profileForm()));
      expect(target).toBe('/import?ulozeno=profil');
      // cíl se musí lišit od holého /import — jinak by se akce v prohlížeči
      // nemusela dokončit (L6a-02) a stránka by neměla z čeho složit potvrzení
      expect(target).not.toBe('/import');
    },
  );

  it('další uložení zůstává u formuláře s potvrzením', { timeout: 30_000 }, async () => {
    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    state.userId = 'u-novy';
    expect(await redirectTarget(() => saveProfileAction(profileForm()))).toBe(
      '/nastaveni?ok=profil#dan',
    );
  });

  it('první profil účtu, který už data má, vede na přehled', { timeout: 30_000 }, async () => {
    const { importFileIsolated } = await import('@/lib/import-service');
    const summary = await importFileIsolated(
      state.db,
      'u-s-daty',
      'vypis.csv',
      new TextEncoder().encode(T212_CSV).buffer as ArrayBuffer,
    );
    expect(summary.added).toBe(1);

    const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
    state.userId = 'u-s-daty';
    expect(await redirectTarget(() => saveProfileAction(profileForm()))).toBe('/prehled');
  });

  it('data cizího účtu se nepočítají', { timeout: 30_000 }, async () => {
    const { hasAnyTransaction } = await import('@/lib/onboarding');
    expect(await hasAnyTransaction(state.db, 'u-s-daty')).toBe(true);
    expect(await hasAnyTransaction(state.db, 'u-novy')).toBe(false);
  });
});

describe('pravidlo cíle bez databáze', () => {
  it('rozhoduje první uložení a přítomnost dat', async () => {
    const { afterProfileSaveUrl } = await import('@/lib/onboarding');
    expect(afterProfileSaveUrl({ firstSave: true, hasData: false })).toBe('/import?ulozeno=profil');
    expect(afterProfileSaveUrl({ firstSave: true, hasData: true })).toBe('/prehled');
    expect(afterProfileSaveUrl({ firstSave: false, hasData: false })).toBe(
      '/nastaveni?ok=profil#dan',
    );
    expect(afterProfileSaveUrl({ firstSave: false, hasData: true })).toBe(
      '/nastaveni?ok=profil#dan',
    );
  });
});
