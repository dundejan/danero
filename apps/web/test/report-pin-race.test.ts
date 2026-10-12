import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaxYearResult } from '@danero/engine';
import type { Db } from '@/db';
import { taxpayerProfiles, taxYearSettings, user } from '@/db/schema';
import { analyzeForUserCached, invalidateUserCache } from '@/lib/engine-cache';
import { importFileIsolated } from '@/lib/import-service';
import { analyzeForUser, getProfile, loadTransactions } from '@/lib/portfolio';

/**
 * Dvě otevření reportu s různým nastavením (revize R7, P1).
 *
 * Fixace roku (R-05c) většinou zapíše to, čím se právě počítalo, a spočítaná
 * čísla platí dál. Když ale rok zafixuje požadavek, který četl profil dřív,
 * než ho uživatel změnil, platí v databázi JEHO fixace — a všechna další
 * otevření musí počítat jí. Klíč mezipaměti výsledků fixaci nenesl (jen
 * `updatedAt` profilu, a fixace vzniká mimo profil), takže report dál bral
 * čísla spočítaná nastavením, které pro ten rok už neplatilo: ukazoval
 * „zafixováno FIFO“ a k tomu výsledek LIFO, dokud se profil znovu nezměnil.
 */
const state = vi.hoisted(() => ({
  db: null as unknown as Db,
  shown: null as { result: TaxYearResult } | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u-soubeh' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
});
// stránka se nevykresluje — zajímá nás, jaký výsledek pohledu předá
vi.mock('@/components/views/report-view', async () => ({
  ...(await vi.importActual<typeof import('@/components/views/report-view')>(
    '@/components/views/report-view',
  )),
  ReportView: (props: { precomputed: { result: TaxYearResult } }) => {
    state.shown = props.precomputed;
    return null;
  },
}));

const USER = 'u-soubeh';
const YEAR = 2024;
const TODAY = '2026-10-11';
const HEADER =
  'type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,position_effect,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,return_of_capital,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note';
/** Dva nákupy za různou cenu a prodej nad limit osvobození — FIFO a LIFO dají jiný základ. */
const STATEMENT = [
  HEADER,
  'BUY,2023-01-10,,CZ0008019106,KOMB,Komercni banka,,,,200,700.00,CZK,,,,,,,,,,,,,,',
  'BUY,2023-09-12,,CZ0008019106,KOMB,Komercni banka,,,,200,900.00,CZK,,,,,,,,,,,,,,',
  'SELL,2024-06-12,,CZ0008019106,KOMB,Komercni banka,,,,200,1000.00,CZK,,,,,,,,,,,,,,',
].join('\n');

const FIFO_PIN = { matchingMethod: 'FIFO', fxMethod: 'UNIFIED', limit100kStrict: true } as const;

async function openReport(): Promise<TaxYearResult> {
  state.shown = null;
  const { default: ReportPage } = await import('@/app/(app)/report/page');
  const { renderToStaticMarkup } = await import('react-dom/server');
  renderToStaticMarkup(await ReportPage({ searchParams: Promise.resolve({ rok: String(YEAR) }) }));
  return state.shown!.result;
}

beforeEach(async () => {
  process.env.DANERO_NOW = `${TODAY}T10:00:00.000Z`;
  invalidateUserCache(USER);
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: USER, name: 'Souběh', email: 'soubeh@danero.cz' });
  // uživatel si právě přepnul párování na LIFO
  await db.insert(taxpayerProfiles).values({ userId: USER, regime: 'ZAMESTNANEC', matchingMethod: 'LIFO' });
  const summary = await importFileIsolated(
    db,
    USER,
    'vypis.csv',
    new TextEncoder().encode(STATEMENT).buffer as ArrayBuffer,
  );
  expect(summary.added).toBe(3);
  state.db = db;
}, 30_000);

afterEach(() => {
  delete process.env.DANERO_NOW;
});

describe('report po souběhu dvou otevření s různým nastavením (R-05c)', () => {
  it('FIFO a LIFO dávají nad těmi daty jiný základ — jinak by test nic nehlídal', async () => {
    const profile = (await getProfile(state.db, USER))!;
    const txs = await loadTransactions(state.db, USER);
    const lifo = analyzeForUser(txs, profile, YEAR, TODAY).result;
    const fifo = analyzeForUser(
      txs,
      {
        ...profile,
        pinnedTaxYears: {
          [YEAR]: { matchingMethod: 'FIFO', fxMethod: 'UNIFIED', limit100kIncludesTimeTestExempt: true },
        },
      },
      YEAR,
      TODAY,
    ).result;
    expect(lifo.securities.base10Czk.toFixed(0)).toBe('20000');
    expect(fifo.securities.base10Czk.toFixed(0)).toBe('60000');
  });

  it('počítá fixací, která je v databázi, i když se předtím počítalo jinak', { timeout: 30_000 }, async () => {
    // 1. panel (přehled) rok spočítal dnešním profilem — LIFO — a výsledek leží v mezipaměti
    const profile = (await getProfile(state.db, USER))!;
    const txs = await loadTransactions(state.db, USER);
    const beforePin = analyzeForUserCached(USER, txs, profile, YEAR, TODAY).result;
    expect(beforePin.options.matchingMethod).toBe('LIFO');

    // 2. panel otevřel report ještě se starým profilem (FIFO) a rok zafixoval;
    //    profil se tím nemění, jeho `updatedAt` zůstává
    await state.db.insert(taxYearSettings).values({ userId: USER, taxYear: YEAR, ...FIFO_PIN });
    const [row] = await state.db.select().from(taxpayerProfiles).where(eq(taxpayerProfiles.userId, USER));
    expect(row!.updatedAt.getTime()).toBe(profile.updatedAt.getTime());

    // každé další otevření reportu musí ukázat čísla podle fixace
    const shown = await openReport();
    expect(shown.options.matchingMethod).toBe('FIFO');
    expect(shown.securities.base10Czk.toFixed(0)).toBe('60000');
    // a stejně i podruhé, už z mezipaměti
    expect((await openReport()).securities.base10Czk.toFixed(0)).toBe('60000');
  });

  it('dvě otevření naráz skončí na jedné fixaci a obě ukážou čísla podle ní', { timeout: 30_000 }, async () => {
    const [first, second] = await Promise.all([openReport(), openReport()]);
    const pins = await state.db.select().from(taxYearSettings).where(eq(taxYearSettings.userId, USER));
    expect(pins).toHaveLength(1);
    for (const result of [first, second, await openReport()]) {
      expect(result.options.matchingMethod).toBe(pins[0]!.matchingMethod);
    }
  });
});
