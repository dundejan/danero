import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import { taxpayerProfiles, user } from '@/db/schema';
import { importFileIsolated } from '@/lib/import-service';
import { listPinnedTaxYears } from '@/lib/portfolio';

/**
 * Fixace roku (R-05c) patří k podkladům, ne k pouhému otevření adresy.
 *
 * Skončený rok se zafixuje, když si za něj uživatel „skutečně vygeneruje
 * podklady k přiznání“ (docs/02). Stránka reportu ale fixovala dřív, než
 * věděla, co ukáže — i rok bez jediné transakce, kde je místo podkladů jen
 * prázdný stav. Přepínač roků takové roky nabízí, takže stačilo se překlikat
 * a v Nastavení přibyly „Zafixované roky“, za které uživatel nic nemá. Kdyby
 * za ně později nahrál starší výpis, počítaly by se mlčky tehdejším nastavením
 * — a prázdný stav o fixaci neříká nic. Našlo se při živém ověření.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u1' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
});

const HEADER =
  'type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,position_effect,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,return_of_capital,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note';
/** Nákup 2022, prodej 2024 — rok 2023 a 2025 jsou bez transakce. */
const STATEMENT = [
  HEADER,
  'BUY,2022-05-10,,CZ0008019106,KOMB,Komercni banka,,,,10,700.00,CZK,,,,,,,,,,,,,,',
  'SELL,2024-06-12,,CZ0008019106,KOMB,Komercni banka,,,,4,820.00,CZK,,,,,,,,,,,,,,',
].join('\n');

async function renderReport(year: number): Promise<string> {
  const { default: ReportPage } = await import('@/app/(app)/report/page');
  return renderToStaticMarkup(
    await ReportPage({ searchParams: Promise.resolve({ rok: String(year) }) }),
  ).replace(/\s/g, ' ');
}

const pinnedYears = async (): Promise<number[]> =>
  (await listPinnedTaxYears(state.db, 'u1')).map((row) => row.taxYear).sort();

beforeEach(async () => {
  process.env.DANERO_NOW = '2026-10-11T10:00:00.000Z';
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'ZAMESTNANEC' });
  const summary = await importFileIsolated(
    db,
    'u1',
    'vypis.csv',
    new TextEncoder().encode(STATEMENT).buffer as ArrayBuffer,
  );
  expect(summary.added).toBe(2);
  state.db = db;
}, 30_000);

afterEach(() => {
  delete process.env.DANERO_NOW;
});

describe('fixace skončeného roku otevřením reportu (R-05c)', () => {
  it('rok s prázdným stavem se nezafixuje', { timeout: 30_000 }, async () => {
    const html = await renderReport(2023);

    expect(html).toContain('V roce 2023 nemáš žádné obchody ani dividendy');
    expect(await pinnedYears()).toEqual([]);
  });

  it('rok s podklady se zafixuje jako dřív', { timeout: 30_000 }, async () => {
    const html = await renderReport(2024);

    expect(html).toContain('Co zapsat do přiznání');
    expect(html).toContain('Rok 2024 je zafixovaný');
    expect(await pinnedYears()).toEqual([2024]);
  });

  it(
    'rok bez transakce, pro který engine něco má, podklady dostane — a fixaci taky',
    { timeout: 30_000 },
    async () => {
      // příjmy z profilu nad limitem pro podání: report ukáže verdikt, ne prázdný stav
      await state.db
        .update(taxpayerProfiles)
        .set({ otherIncomeCzk: '30000' })
        .where(eq(taxpayerProfiles.userId, 'u1'));

      const html = await renderReport(2025);

      expect(html).not.toContain('nemáš žádné obchody ani dividendy');
      expect(html).toContain('Co zapsat do přiznání');
      expect(await pinnedYears()).toEqual([2025]);
    },
  );
});
