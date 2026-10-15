import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import { instrumentAliases, user } from '@/db/schema';
import { batchIssueView, type BatchForIssues } from '@/lib/import-resolved';
import { capStoredIssues } from '@/lib/import-issues';
import { importFileIsolated } from '@/lib/import-service';
import { undoImportBatch } from '@/lib/import-undo';
import { saveAliases } from '@/lib/instrument-aliases';
import { loadTransactions } from '@/lib/portfolio';
import {
  REVOLUT_INVEST_HEADER,
  REVOLUT_INVEST_UNMAPPED_CSV,
} from '../../../packages/importers/test/fixtures/revolut';
import { T212_HEADER } from '../../../packages/importers/test/fixtures/t212';
import { buildXtbXlsx, XTB_ROWS_EN } from '../../../packages/importers/test/fixtures/xtb';

/**
 * Nálezy dvou nezávislých revizí číselníku instrumentů (15. 10. 2026).
 * Každý test nejdřív padal na tom, co revize popsala.
 */
const stav = vi.hoisted(() => ({
  db: null as unknown as Db,
  builtin: false,
  searchParams: new URLSearchParams(),
}));

vi.mock('@danero/importers/isin-directory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@danero/importers/isin-directory')>();
  return {
    ...actual,
    builtinInstrument: (...args: Parameters<typeof actual.builtinInstrument>) =>
      stav.builtin ? actual.builtinInstrument(...args) : undefined,
  };
});
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
  useSearchParams: () => stav.searchParams,
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u1' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});

const NVDA = 'US67066G1040';
const GOOG = 'US02079K1079';
const buf = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const upload = (filename: string, data: ArrayBuffer) =>
  importFileIsolated(stav.db, 'u1', filename, data);

async function renderImportPage(params: Record<string, string> = {}): Promise<string> {
  const { default: ImportPage } = await import('@/app/(app)/import/page');
  stav.searchParams = new URLSearchParams(params);
  return renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(params) }))
    .replaceAll(' ', ' ')
    .replaceAll('<!-- -->', '');
}

async function remove(fields: Record<string, string>): Promise<string> {
  const { deleteAliasAction } = await import('@/app/(app)/import/actions');
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  try {
    await deleteAliasAction(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  return '';
}

/** Výpis Trading 212 s nákupem GOOG v USD — ISIN od brokera. */
const T212_GOOG = [
  T212_HEADER,
  'Market buy,2024-01-10 14:30:02,US02079K1079,GOOG,Alphabet Inc (Class C),2,140.00,USD,0.0435,,,6500.00,CZK,,,,EOF9001,1.00,CZK',
].join('\n');

const SCHWAB_GOOG = [
  '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
  '"03/03/2025","Buy","GOOG","ALPHABET INC CLASS C","3","$170.00","","-$510.00"',
].join('\n');

beforeEach(async () => {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  stav.db = db;
  stav.builtin = false;
}, 30_000);

describe('R1: vyřízená hláška a vrácený import', () => {
  it(
    'po vrácení importu, který obchody uložil, hláška o chybějících obchodech nezmizí',
    {
      timeout: 90_000,
    },
    async () => {
      const file = buf(REVOLUT_INVEST_UNMAPPED_CSV);
      await upload('revolut.csv', file);
      await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
      const second = await upload('revolut.csv', file);
      expect(second.added).toBe(1);
      expect((await upload('revolut.csv', file)).added).toBe(0);
      await undoImportBatch(stav.db, 'u1', second.batchId);
      expect((await loadTransactions(stav.db, 'u1')).filter((tx) => tx.type === 'BUY')).toEqual([]);

      const html = await renderImportPage();
      expect(html).toContain('ISIN doplněn — nahraj výpis znovu a obchody se doimportují.');
    },
  );
});

describe('R2: Revolut — americký ISIN doplněný podle USD obchodů a obchod v jiné měně', () => {
  it(
    'obchod v EUR pod automaticky doplněným ISIN dostane varování',
    { timeout: 60_000 },
    async () => {
      stav.builtin = true;
      const usdOnly = [
        REVOLUT_INVEST_HEADER,
        '2025-07-05T07:26:04.809Z,PEP,BUY - MARKET,1,$140.00,$140,USD,1.0000',
      ].join('\n');
      expect(
        (await upload('revolut-2025.csv', buf(usdOnly))).filled.map((item) => item.symbol),
      ).toEqual(['PEP']);

      const eurFile = [
        REVOLUT_INVEST_HEADER,
        '2026-02-05T07:26:04.809Z,PEP,BUY - MARKET,1,€120.00,€120,EUR,1.0000',
      ].join('\n');
      const second = await upload('revolut-2026.csv', buf(eurFile));

      // obchod se uloží (ztracený obchod je horší), ale uživatel se to dozví
      expect(second.added).toBe(1);
      const warning = second.warnings.find((item) => item.message.includes('PEP'));
      expect(warning?.line).toBe(2);
      expect(warning?.message).toContain('v EUR');
      expect(warning?.message).toContain('US7134481081');
      expect(warning?.message).toContain('Doplněné údaje instrumentů');
    },
  );

  it('obchod v USD varování nedostane', { timeout: 60_000 }, async () => {
    stav.builtin = true;
    const usd = [
      REVOLUT_INVEST_HEADER,
      '2025-07-05T07:26:04.809Z,PEP,BUY - MARKET,1,$140.00,$140,USD,1.0000',
    ].join('\n');
    await upload('a.csv', buf(usd));
    const again = await upload('b.csv', buf(`${usd}\n`));
    expect(again.warnings.filter((item) => item.message.includes('PEP'))).toEqual([]);
  });
});

describe('R3: počítadlo chyb u oříznutých hlášek', () => {
  it('vyřízené hlášky se odečtou i za tu část, která se neuložila', () => {
    const errors = Array.from({ length: 150 }, (_, i) => ({
      line: i + 2,
      message: `Symbol S${i % 3}: doplň ISIN instrumentu (Revolut ho neexportuje).`,
      unmappedSymbol: `S${i % 3}`,
    }));
    const stored = capStoredIssues({
      errors,
      skipped: [],
      warnings: [],
      unmapped: ['S0', 'S1', 'S2'].map((symbol) => ({
        broker: 'revolut',
        symbol,
        needsCurrency: false,
      })),
      crossBroker: [],
    });
    expect(stored.errors).toHaveLength(100);
    const batch: BatchForIssues = {
      id: 'a',
      broker: 'revolut',
      errorCount: 150,
      warningCount: 0,
      createdAt: new Date('2026-01-01'),
      issues: stored,
    };
    const view = batchIssueView(batch, [batch], () => true);
    expect({ errorCount: view.errorCount, shown: view.errors.length }).toEqual({
      errorCount: 0,
      shown: 0,
    });
    // vyřízený jen jeden symbol: zbylé dva se počítají celé
    const partial = batchIssueView(batch, [batch], (_, symbol) => symbol === 'S0');
    expect(partial.errorCount).toBe(100);
  });
});

describe('R4: smazaný automaticky doplněný záznam se vrátí — a hláška to řekne', () => {
  it('toast po smazání i řádek seznamu', { timeout: 60_000 }, async () => {
    stav.builtin = true;
    const statement = [
      '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
      '"03/03/2025","Buy","KO","COCA COLA CO","40","$70.00","","-$2800.00"',
    ].join('\n');
    const first = await upload('schwab.csv', buf(statement));
    const listed = await renderImportPage();
    expect(listed).toContain('doplněno z veřejných dat');

    await undoImportBatch(stav.db, 'u1', first.batchId);
    const target = await remove({ broker: 'schwab', symbol: 'KO' });
    expect(target).toBe('/import?ulozeno=zaznam-smazan-vrati-se&zaznam=schwab%2FKO#ciselnik');
    const html = await renderImportPage({ ulozeno: 'zaznam-smazan-vrati-se', zaznam: 'schwab/KO' });
    expect(html).toContain('Při dalším nahrání výpisu ho doplníme znovu');
  });
});

describe('XTB: doplněná jen měna', () => {
  it(
    'hláška neříká „Doplnili jsme ISIN“, když ISIN zadal uživatel',
    { timeout: 60_000 },
    async () => {
      stav.builtin = true;
      await stav.db.insert(instrumentAliases).values({
        userId: 'u1',
        broker: 'xtb',
        symbol: 'AAPL.US',
        isin: 'US0378331005',
      });
      const buffer = await buildXtbXlsx({ rows: XTB_ROWS_EN });
      const summary = await upload(
        'xtb.xlsx',
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      );
      expect(summary.filled).toEqual([
        expect.objectContaining({ symbol: 'AAPL.US', currency: 'USD', currencyOnly: true }),
      ]);
      const html = await renderImportPage({
        ulozeno: 'nahrano',
        soubory: '1',
        davka: summary.batchId,
      });
      expect(html).toContain('Doplnili jsme měnu: AAPL.US → USD.');
      expect(html).not.toContain('Doplnili jsme ISIN');
    },
  );
});

describe('vlastní data: ISIN podle obchodů u brokera, který ho uvádí', () => {
  it(
    'GOOG ze Schwabu dostane ISIN podle obchodů u Trading 212 — dřív než vestavěný',
    {
      timeout: 60_000,
    },
    async () => {
      stav.builtin = true;
      await upload('t212.csv', buf(T212_GOOG));
      const summary = await upload('schwab.csv', buf(SCHWAB_GOOG));

      expect(summary.unmapped).toEqual([]);
      expect(summary.filled).toEqual([
        expect.objectContaining({
          broker: 'schwab',
          symbol: 'GOOG',
          isin: GOOG,
          source: 'own',
          sourceBroker: 'trading212',
        }),
      ]);
      const aliases = await stav.db
        .select()
        .from(instrumentAliases)
        .where(eq(instrumentAliases.userId, 'u1'));
      expect(aliases.map((row) => `${row.broker}|${row.symbol}|${row.isin}`)).toEqual([
        `schwab|GOOG|${GOOG}`,
      ]);
      const html = await renderImportPage({
        ulozeno: 'nahrano',
        soubory: '1',
        davka: summary.batchId,
      });
      expect(html).toContain(
        `Doplnili jsme ISIN podle tvých obchodů u Trading 212: GOOG (${GOOG}).`,
      );
    },
  );

  it(
    'nejednoznačný ticker (dva ISIN) ani obchod v jiné měně se nepoužije',
    { timeout: 60_000 },
    async () => {
      await upload(
        't212.csv',
        buf(
          [
            T212_HEADER,
            'Market buy,2024-01-10 14:30:02,US02079K1079,GOOG,Alphabet C,2,140.00,USD,0.0435,,,6500.00,CZK,,,,EOF9001,1.00,CZK',
            'Market buy,2024-01-11 14:30:02,US02079K3059,GOOG,Alphabet A,2,140.00,USD,0.0435,,,6500.00,CZK,,,,EOF9002,1.00,CZK',
            'Market buy,2024-01-12 14:30:02,GB00BP6MXD84,SHEL,Shell,2,27.00,GBP,0.0435,,,1500.00,CZK,,,,EOF9003,1.00,CZK',
          ].join('\n'),
        ),
      );
      const summary = await upload(
        'schwab.csv',
        buf(
          [
            SCHWAB_GOOG,
            '"03/04/2025","Buy","SHEL","SHELL PLC ADR","3","$70.00","","-$210.00"',
          ].join('\n'),
        ),
      );
      expect(summary.filled).toEqual([]);
      expect(summary.unmapped.map((item) => item.symbol).sort()).toEqual(['GOOG', 'SHEL']);
    },
  );
});
