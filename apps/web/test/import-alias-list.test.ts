import { and, eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidIsin } from '@danero/shared';
import type { Db } from '@/db';
import { importBatches, instrumentAliases, user } from '@/db/schema';
import { batchIssueView, type BatchForIssues } from '@/lib/import-resolved';
import { importFileIsolated } from '@/lib/import-service';
import { undoImportBatch } from '@/lib/import-undo';
import { aliasCovers, saveAliases } from '@/lib/instrument-aliases';
import { loadTransactions } from '@/lib/portfolio';
import {
  encodeCp1250,
  FIO_FIXTURE,
  FIO_SYMBOL_MAP,
} from '../../../packages/importers/test/fixtures/fio';
import { REVOLUT_INVEST_UNMAPPED_CSV } from '../../../packages/importers/test/fixtures/revolut';
import {
  buildXtbNewReportXlsx,
  XTB_NEW_FILENAME,
  XTB_NEW_INSTRUMENT_MAP,
} from '../../../packages/importers/test/fixtures/xtb';

/**
 * Seznam „Doplněné údaje instrumentů“ na /import: změna a smazání uloženého
 * záznamu číselníku a hlášky „doplň ISIN“ u starých dávek historie.
 *
 * Do 15. 10. 2026 uložený záznam nešel zobrazit, změnit ani smazat. Rada
 * u zablokovaného přepisu („vrať import, údaj ulož a nahraj znovu“) přitom
 * nefungovala: po vrácení importu se použil zase uložený ISIN a symbol se
 * k doplnění už nenabídl — platný, ale špatný ISIN (GOOGL místo GOOG) tak
 * nešlo opravit vůbec.
 */
const stav = vi.hoisted(() => ({
  db: null as unknown as Db,
  userId: 'u1',
  // adresa, kterou vidí klientské komponenty při vykreslení na serveru
  searchParams: new URLSearchParams(),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined }),
  useSearchParams: () => stav.searchParams,
}));
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: stav.userId }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => stav.db };
});

const GOOG = 'US02079K1079';
const GOOGL = 'US02079K3059';
const NVDA = 'US67066G1040';
const REVOLUT_FILE = 'revolut-2024.csv';

const toArrayBuffer = (text: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
const revolutFile = (): ArrayBuffer => toArrayBuffer(REVOLUT_INVEST_UNMAPPED_CSV);
const fioFile = (): ArrayBuffer => {
  const bytes = encodeCp1250(FIO_FIXTURE);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/** Vrátí cíl přesměrování, kterým server action skončila. */
async function run(action: (data: FormData) => Promise<void>, fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  try {
    await action(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  return '';
}

async function update(fields: Record<string, string>): Promise<string> {
  const { updateAliasAction } = await import('@/app/(app)/import/actions');
  return run(updateAliasAction, fields);
}

async function remove(fields: Record<string, string>): Promise<string> {
  const { deleteAliasAction } = await import('@/app/(app)/import/actions');
  return run(deleteAliasAction, fields);
}

const storedAlias = async (userId: string, broker: string, symbol: string) => {
  const [row] = await stav.db
    .select()
    .from(instrumentAliases)
    .where(
      and(
        eq(instrumentAliases.userId, userId),
        eq(instrumentAliases.broker, broker),
        eq(instrumentAliases.symbol, symbol),
      ),
    );
  return row ? { isin: row.isin, currency: row.currency } : undefined;
};

async function renderImportPage(params: Record<string, string> = {}): Promise<string> {
  const { default: ImportPage } = await import('@/app/(app)/import/page');
  stav.searchParams = new URLSearchParams(params);
  return renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(params) }))
    .replaceAll('\u00a0', ' ')
    .replaceAll('<!-- -->', '');
}

const batchesOf = async (userId = 'u1') =>
  stav.db.select().from(importBatches).where(eq(importBatches.userId, userId));

beforeEach(async () => {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values([
    { id: 'u1', name: 'Test', email: 'test@danero.cz' },
    { id: 'u2', name: 'Cizí', email: 'cizi@danero.cz' },
  ]);
  stav.db = db;
  stav.userId = 'u1';
}, 30_000);

describe('seznam doplněných údajů: změna záznamu', () => {
  it('ISINy z testů jsou platné', () => {
    expect([GOOG, GOOGL, NVDA].every(isValidIsin)).toBe(true);
  });

  it('záznam bez transakcí jde změnit (GOOGL → GOOG)', { timeout: 30_000 }, async () => {
    await saveAliases(stav.db, 'u1', [{ broker: 'schwab', symbol: 'GOOG', isin: GOOGL }]);

    const target = await update({
      broker: 'schwab',
      symbol: 'GOOG',
      isin: ` ${GOOG.toLowerCase()} `,
    });

    expect(target).toBe('/import?ulozeno=zaznam-upraven&zaznam=schwab%2FGOOG#ciselnik');
    expect(await storedAlias('u1', 'schwab', 'GOOG')).toEqual({ isin: GOOG, currency: null });
  });

  it(
    'kontroly jsou tytéž jako při uložení: tvar, kontrolní číslice, měna u XTB',
    { timeout: 30_000 },
    async () => {
      await saveAliases(stav.db, 'u1', [
        { broker: 'schwab', symbol: 'GOOG', isin: GOOGL },
        { broker: 'xtb', symbol: 'AAPL.US', isin: 'US0378331005', currency: 'USD' },
      ]);

      expect(await update({ broker: 'schwab', symbol: 'GOOG', isin: 'US02079K10' })).toBe(
        '/import?chyba=zaznam-isin&zaznam=schwab%2FGOOG&zadany-isin=US02079K10#ciselnik',
      );
      // přehozené číslice — tvar sedí, kontrolní číslice ne
      expect(await update({ broker: 'schwab', symbol: 'GOOG', isin: 'US02079K1709' })).toBe(
        '/import?chyba=zaznam-kontrola&zaznam=schwab%2FGOOG&zadany-isin=US02079K1709#ciselnik',
      );
      expect(
        await update({ broker: 'xtb', symbol: 'AAPL.US', isin: 'US0378331005', mena: '' }),
      ).toBe('/import?chyba=zaznam-mena&zaznam=xtb%2FAAPL.US&zadany-isin=US0378331005#ciselnik');

      expect(await storedAlias('u1', 'schwab', 'GOOG')).toEqual({ isin: GOOGL, currency: null });
      expect(await storedAlias('u1', 'xtb', 'AAPL.US')).toEqual({
        isin: 'US0378331005',
        currency: 'USD',
      });
    },
  );

  it('cizí ani neexistující záznam akce nezmění', { timeout: 30_000 }, async () => {
    await saveAliases(stav.db, 'u2', [{ broker: 'schwab', symbol: 'GOOG', isin: GOOGL }]);

    expect(await update({ broker: 'schwab', symbol: 'GOOG', isin: GOOG })).toBe(
      '/import?chyba=zaznam-neexistuje',
    );
    expect(await remove({ broker: 'schwab', symbol: 'GOOG' })).toBe(
      '/import?chyba=zaznam-neexistuje',
    );
    // broker mimo číselník (nebo podvržený) se nehledá vůbec
    expect(await update({ broker: 'trading212', symbol: 'GOOG', isin: GOOG })).toBe(
      '/import?chyba=zaznam-neexistuje',
    );
    expect(await storedAlias('u2', 'schwab', 'GOOG')).toEqual({ isin: GOOGL, currency: null });
  });
});

describe('seznam doplněných údajů: pojistka L23-02 u změny i smazání', () => {
  const xtbReport = async (): Promise<ArrayBuffer> => {
    const buffer = await buildXtbNewReportXlsx();
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  };
  const AAPL = XTB_NEW_INSTRUMENT_MAP['AAPL.US'];

  it(
    'změna ISIN u titulu s transakcemi se odmítne, hláška jmenuje import a nic se nezdvojí',
    { timeout: 60_000 },
    async () => {
      await saveAliases(stav.db, 'u1', [{ broker: 'xtb', symbol: 'AAPL.US', ...AAPL }]);
      await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await xtbReport());
      const stored = await loadTransactions(stav.db, 'u1');
      expect(stored.length).toBeGreaterThan(0);

      const target = await update({ broker: 'xtb', symbol: 'AAPL.US', isin: GOOG, mena: 'usd' });
      expect(target).toBe(
        `/import?chyba=zaznam-pouzity&zaznam=xtb%2FAAPL.US&zadany-isin=${GOOG}&zadana-mena=USD#ciselnik`,
      );
      expect(await storedAlias('u1', 'xtb', 'AAPL.US')).toEqual(AAPL);

      await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await xtbReport());
      expect(await loadTransactions(stav.db, 'u1')).toHaveLength(stored.length);

      // hláška u řádku jmenuje import, který je potřeba vrátit (s odkazem do historie)
      const [first] = (await batchesOf()).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
      const html = await renderImportPage({
        chyba: 'zaznam-pouzity',
        zaznam: 'xtb/AAPL.US',
        'zadany-isin': GOOG,
      });
      expect(html).toContain('Doplněné údaje instrumentů');
      expect(html).toContain('Záznam teď nejde změnit');
      expect(html).toContain(`href="#import-${first!.id}"`);
      expect(html).toContain(XTB_NEW_FILENAME);
      // to, co uživatel napsal, se vrátí do pole
      expect(html).toContain(`value="${GOOG}"`);
      // chyba u řádku není zároveň v toastu
      expect(html).not.toContain('Tenhle záznam už neexistuje');
    },
  );

  it(
    'po vrácení importu změna projde a nové nahrání použije opravený ISIN',
    { timeout: 60_000 },
    async () => {
      await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: GOOGL }]);
      await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());
      const before = await loadTransactions(stav.db, 'u1');
      expect(before.length).toBe(2);

      expect(await update({ broker: 'revolut', symbol: 'NVDA', isin: NVDA })).toContain(
        'chyba=zaznam-pouzity',
      );
      const [batch] = await batchesOf();
      await undoImportBatch(stav.db, 'u1', batch!.id);

      expect(await update({ broker: 'revolut', symbol: 'NVDA', isin: NVDA })).toContain(
        'ulozeno=zaznam-upraven',
      );
      await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());
      const after = await loadTransactions(stav.db, 'u1');
      expect(after).toHaveLength(2);
      expect(after.every((tx) => 'isin' in tx && tx.isin === NVDA)).toBe(true);
    },
  );

  it(
    'smazání bez pojistky by dividendu zdvojilo — proto je blokované stejně',
    { timeout: 60_000 },
    async () => {
      // Fio: jediný broker číselníku, kde dvojnici nechytí ani síť id od
      // brokera (Revolut, Schwab, Tastytrade, XTB a eToro ji mají).
      await saveAliases(stav.db, 'u1', [{ broker: 'fio', symbol: 'AAPL', ...FIO_SYMBOL_MAP.AAPL }]);
      await importFileIsolated(stav.db, 'u1', 'fio.csv', fioFile());
      const dividends = async () =>
        (await loadTransactions(stav.db, 'u1')).filter((tx) => tx.type === 'DIVIDEND');
      expect(await dividends()).toHaveLength(1);

      // Akce smazání odmítne a záznam zůstane.
      expect(await remove({ broker: 'fio', symbol: 'AAPL' })).toBe(
        '/import?chyba=smazani-pouzite&zaznam=fio%2FAAPL#ciselnik',
      );
      expect(await storedAlias('u1', 'fio', 'AAPL')).toEqual({
        isin: FIO_SYMBOL_MAP.AAPL.isin,
        currency: null,
      });

      // Důkaz, proč: záznam smazaný mimo akci a nové nahrání téhož výpisu
      // uloží tutéž dividendu podruhé, tentokrát bez ISIN (jiný otisk).
      await stav.db.delete(instrumentAliases).where(eq(instrumentAliases.userId, 'u1'));
      await importFileIsolated(stav.db, 'u1', 'fio.csv', fioFile());
      expect(await dividends()).toHaveLength(2);
    },
  );

  it('smazání blokuje i dividenda uložená s ISIN u Revolutu', { timeout: 60_000 }, async () => {
    await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
    await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());

    expect(await remove({ broker: 'revolut', symbol: 'NVDA' })).toBe(
      '/import?chyba=smazani-pouzite&zaznam=revolut%2FNVDA#ciselnik',
    );
    const html = await renderImportPage({ chyba: 'smazani-pouzite', zaznam: 'revolut/NVDA' });
    expect(html).toContain('Záznam teď nejde smazat');
    expect(html).toContain(REVOLUT_FILE);
  });

  it('záznam bez transakcí jde smazat', { timeout: 30_000 }, async () => {
    await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
    // transakce JINÉHO brokera pod týmž ISIN smazání neblokují
    await saveAliases(stav.db, 'u1', [{ broker: 'schwab', symbol: 'NVDA', isin: NVDA }]);
    await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());

    expect(await remove({ broker: 'schwab', symbol: 'NVDA' })).toBe(
      '/import?ulozeno=zaznam-smazan&zaznam=schwab%2FNVDA#ciselnik',
    );
    expect(await storedAlias('u1', 'schwab', 'NVDA')).toBeUndefined();
    expect(await storedAlias('u1', 'revolut', 'NVDA')).toBeDefined();
  });

  it(
    'hláška u zablokovaného uložení z formuláře radí upravit záznam v seznamu',
    { timeout: 30_000 },
    async () => {
      const html = await renderImportPage({ chyba: 'isin-pouzity' });
      expect(html).toContain('rozbal ten import a vrať ho zpět');
      expect(html).toContain('záznam uprav v seznamu „Doplněné údaje instrumentů“');
    },
  );
});

describe('historie importů: hlášky „doplň ISIN“ vyřízené číselníkem', () => {
  it(
    'po doplnění ISIN je chyba vyřízená, po novém nahrání téhož souboru zmizí úplně',
    { timeout: 60_000 },
    async () => {
      await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());
      let html = await renderImportPage();
      expect(html).toContain('Symbol NVDA: doplň ISIN instrumentu');
      expect(html).toMatch(/1 chyba/);
      expect(html).toContain('1 varování');

      await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
      html = await renderImportPage();
      expect(html).not.toContain('Symbol NVDA: doplň ISIN');
      expect(html).toContain('ISIN doplněn — nahraj výpis znovu a obchody se doimportují.');
      // počítadla dávky vyřízené hlášky nepočítají
      expect(html).not.toMatch(/\d+ chyb/);
      // varování o dividendě netto se ISIN netýká a zůstává
      expect(html).toContain('1 varování');

      await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());
      html = await renderImportPage();
      expect(html).not.toContain('ISIN doplněn');
      expect(html).not.toContain('Symbol NVDA');
      // nákup se doimportoval, dividenda dostala ISIN (žádná nová)
      expect(await loadTransactions(stav.db, 'u1')).toHaveLength(2);
    },
  );

  it(
    'jiný soubor téhož brokera hlášku neschová — nahrání to nedokazuje',
    { timeout: 60_000 },
    async () => {
      await importFileIsolated(stav.db, 'u1', REVOLUT_FILE, revolutFile());
      await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
      await importFileIsolated(
        stav.db,
        'u1',
        'revolut-jiny.csv',
        toArrayBuffer(`${REVOLUT_INVEST_UNMAPPED_CSV}\n`),
      );

      const html = await renderImportPage();
      expect(html).toContain('ISIN doplněn — nahraj výpis znovu a obchody se doimportují.');
    },
  );

  it('starou dávku bez strukturovaného údaje ukazuje beze změny', { timeout: 30_000 }, async () => {
    await saveAliases(stav.db, 'u1', [{ broker: 'revolut', symbol: 'NVDA', isin: NVDA }]);
    await stav.db.insert(importBatches).values({
      id: 'stara',
      userId: 'u1',
      broker: 'revolut',
      filename: 'stary.csv',
      added: 1,
      duplicates: 0,
      errorCount: 1,
      skippedCount: 0,
      warningCount: 0,
      issues: {
        errors: [
          { line: 2, message: 'Symbol NVDA: doplň ISIN instrumentu (Revolut ho neexportuje).' },
        ],
        skipped: [],
        warnings: [],
        unmapped: [{ broker: 'revolut', symbol: 'NVDA', needsCurrency: false }],
      },
    });

    const html = await renderImportPage();
    expect(html).toContain('Symbol NVDA: doplň ISIN instrumentu');
    expect(html).toMatch(/1 chyba/);
    expect(html).not.toContain('ISIN doplněn');
  });
});

describe('batchIssueView', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 10, minute));
  const batch = (over: Partial<BatchForIssues> & { issues: unknown }): BatchForIssues => ({
    id: 'a',
    broker: 'schwab',
    errorCount: 0,
    warningCount: 0,
    createdAt: at(0),
    ...over,
  });
  const nvdaError = { line: 2, message: 'x', unmappedSymbol: 'NVDA' };
  const covered = () => true;

  it('novější dávka téhož souboru se zkráceným seznamem symbolů nic nedokazuje', () => {
    const old = batch({
      errorCount: 1,
      issues: { errors: [nvdaError], skipped: [], warnings: [], fileHash: 'h' },
    });
    const later = batch({
      id: 'b',
      createdAt: at(5),
      issues: { errors: [], skipped: [], warnings: [], fileHash: 'h', truncated: ['unmapped'] },
    });

    expect(batchIssueView(old, [old, later], covered).pendingTrades).toEqual(['NVDA']);
  });

  it('symbol, který novější dávka téhož souboru pořád nezná, zůstává k vyřízení', () => {
    const old = batch({
      errorCount: 1,
      issues: { errors: [nvdaError], skipped: [], warnings: [], fileHash: 'h' },
    });
    const later = batch({
      id: 'b',
      createdAt: at(5),
      issues: {
        errors: [],
        skipped: [],
        warnings: [],
        fileHash: 'h',
        unmapped: [{ symbol: 'NVDA' }],
      },
    });

    expect(batchIssueView(old, [old, later], covered).pendingTrades).toEqual(['NVDA']);
  });

  it('bez záznamu v číselníku zůstává hláška chybou', () => {
    const old = batch({
      errorCount: 3,
      issues: { errors: [nvdaError], skipped: [], warnings: [] },
    });
    const view = batchIssueView(old, [old], () => false);
    expect(view.errors).toEqual([nvdaError]);
    expect(view.errorCount).toBe(3);
  });

  it('XTB: záznam bez měny obchod nevyřídí, s měnou ano', () => {
    const empty = { fio: {}, etoro: {}, revolut: {}, schwab: {}, tastytrade: {} };
    const xtbError = { line: 2, message: 'x', unmappedSymbol: 'AAPL.US' };
    const old = batch({
      broker: 'xtb',
      errorCount: 1,
      issues: { errors: [xtbError], skipped: [], warnings: [] },
    });
    const withoutCurrency = aliasCovers({
      xtb: { 'AAPL.US': { isin: 'US0378331005' } },
      isinOnly: empty,
    });
    const withCurrency = aliasCovers({
      xtb: { 'AAPL.US': { isin: 'US0378331005', currency: 'USD' } },
      isinOnly: empty,
    });

    expect(batchIssueView(old, [old], withoutCurrency).errors).toEqual([xtbError]);
    expect(batchIssueView(old, [old], withCurrency).pendingTrades).toEqual(['AAPL.US']);
    // symbol z výpisu se nesmí trefit do vlastností objektu
    expect(withCurrency('xtb', 'constructor')).toBe(false);
    expect(withCurrency('schwab', '__proto__')).toBe(false);
  });

  it('novější dávka téhož souboru u JINÉHO brokera nebo starší dávka nic nedokazuje', () => {
    const old = batch({
      createdAt: at(5),
      errorCount: 1,
      issues: { errors: [nvdaError], skipped: [], warnings: [], fileHash: 'h' },
    });
    const otherBroker = batch({
      id: 'b',
      broker: 'tastytrade',
      createdAt: at(9),
      issues: { errors: [], skipped: [], warnings: [], fileHash: 'h' },
    });
    const earlier = batch({
      id: 'c',
      createdAt: at(1),
      issues: { errors: [], skipped: [], warnings: [], fileHash: 'h' },
    });

    expect(batchIssueView(old, [old, otherBroker, earlier], covered).pendingTrades).toEqual([
      'NVDA',
    ]);
  });
});
