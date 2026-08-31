import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { analyzeTaxYear } from '@danero/engine';
import { parseTransactions } from '@danero/shared';
import type { Db } from '@/db';
import { user } from '@/db/schema';
import type { ProfileRow } from '@/lib/portfolio';

/**
 * R-13b: přepínač okamžiku příjmu z prodeje nakrátko byl 23. 8. 2026 ZRUŠEN.
 *
 * Do té doby si tenhle soubor hlídal, že volba jde nastavit z aplikace. Dnes
 * hlídá opak: mírnější varianta („příjem až uzavřením pozice“) nesmí vzniknout
 * z ničeho — ani z formuláře, ani ze staré hodnoty uložené v profilu. Sám
 * R-13b o opačném výkladu říká, že „jako oporu ho brát nelze“, takže bezpečná
 * varianta je jediné chování a volba mizí z produktu i z modelu.
 */
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

/** Formulář nastavení BEZ pole „short-prijem“ — přesně jak ho posílá stránka. */
const form = (): FormData => {
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
  })) {
    data.append(key, value);
  }
  return data;
};

/** Vrátí cíl přesměrování, kterým server action skončila. */
const uloz = async (): Promise<string> => {
  const { saveProfileAction } = await import('@/app/(app)/nastaveni/actions');
  try {
    await saveProfileAction(form());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  return '';
};

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  timeTestBasis: 'settlement',
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Short otevřený v listopadu 2025, pokrytý až v lednu 2026 (R-13j). */
const prescasovyShort = parseTransactions([
  {
    type: 'SELL',
    id: 'so',
    isin: 'US0378331005',
    ticker: 'AAPL',
    positionEffect: 'OPEN',
    quantity: '100',
    pricePerShare: '3000',
    currency: 'CZK',
    tradeDate: '2025-11-20',
    settlementDate: '2025-11-21',
  },
  {
    type: 'BUY',
    id: 'sc',
    isin: 'US0378331005',
    ticker: 'AAPL',
    positionEffect: 'CLOSE',
    quantity: '100',
    pricePerShare: '2000',
    currency: 'CZK',
    tradeDate: '2026-01-15',
    settlementDate: '2026-01-16',
  },
]);

describe('prodej nakrátko: okamžik příjmu už není volba (R-13b)', () => {
  beforeAll(async () => {
    const { createPgliteDb } = await vi.importActual<typeof import('@/db')>('@/db');
    stav.db = await createPgliteDb();
    await stav.db.insert(user).values({ id: 'u1', name: 'Test', email: 'short@danero.cz' });
  }, 30_000);

  it('sloupec pro mírnější variantu v databázi po migraci není', { timeout: 30_000 }, async () => {
    const found = await stav.db.execute(
      sql`select column_name from information_schema.columns where table_name = 'taxpayer_profiles' and column_name = 'short_sale_income_on_sale'`,
    );
    // postgres.js vrací pole řádků, PGlite objekt s `rows` — driver se tu liší
    const rows = Array.isArray(found) ? found : ((found as { rows?: unknown[] }).rows ?? []);
    expect(rows).toHaveLength(0);
  });

  it('profil se uloží i bez pole „short-prijem“ a volba do enginu nejde', { timeout: 30_000 }, async () => {
    // formulář to pole neposílá; kdyby ho schéma pořád vyžadovalo, skončil by
    // uživatel na /nastaveni?chyba=formular a profil by se vůbec neuložil
    expect(await uloz()).not.toContain('chyba=');

    const { getProfile, profileToEngine } = await import('@/lib/portfolio');
    const profile = await getProfile(stav.db, 'u1');
    expect(profile).not.toBeNull();
    expect(Object.keys(profileToEngine(profile!).options)).not.toContain('shortSaleIncomeOnSale');
  });

  it('formulář v nastavení volbu už nenabízí', () => {
    const page = readFileSync(
      join(process.cwd(), 'app/(app)/nastaveni/page.tsx'),
      'utf8',
    );
    expect(page).not.toContain('name="short-prijem"');
    expect(page).not.toContain('shortSaleIncomeOnSale');
  });

  it('stará uložená hodnota „false“ se do výpočtu nepropíše', async () => {
    const { engineInputForUser } = await import('@/lib/portfolio');
    // profil z databáze, která přepínač ještě pamatuje (obnova ze zálohy)
    const legacy: ProfileRow & { shortSaleIncomeOnSale?: boolean } = {
      ...PROFILE,
      shortSaleIncomeOnSale: false,
    };

    const result = analyzeTaxYear(engineInputForUser(prescasovyShort, legacy, 2025));
    // mírnější varianta by za rok 2025 nezdanila nic
    expect(result.securities.taxableIncomeCzk.toString()).toBe('300000');
    expect(result.securities.base10Czk.toString()).toBe('300000');
  });
});
