import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import { importBatches, instrumentAliases, user } from '@/db/schema';
import { batchesToOpen } from '@/lib/import-feedback';
import { importFileIsolated, type ImportSummary } from '@/lib/import-service';
import { originOf, saveAliases } from '@/lib/instrument-aliases';
import { loadTransactions } from '@/lib/portfolio';
import {
  buildEtoroHappyPath,
  buildEtoroXlsx,
  ETORO_ACTIVITY_HEADERS_2026,
  ETORO_CLOSED_HEADERS_2026,
} from '../../../packages/importers/test/fixtures/etoro';
import { encodeCp1250, FIO_FIXTURE } from '../../../packages/importers/test/fixtures/fio';
import {
  REVOLUT_INVEST_HEADER,
  REVOLUT_INVEST_UNMAPPED_CSV,
} from '../../../packages/importers/test/fixtures/revolut';
import { TASTY_V2_DIVIDEND_THEN_BUY } from '../../../packages/importers/test/fixtures/tastytrade';
import {
  buildXtbNewReportXlsx,
  buildXtbXlsx,
  XTB_NEW_FILENAME,
  XTB_ROWS_EN,
} from '../../../packages/importers/test/fixtures/xtb';

/**
 * Vestavěný číselník ISIN při importu (`@danero/importers/isin-directory`).
 *
 * Broker bez ISIN ve výpisu chtěl po uživateli opsat ISIN i u úplně běžných
 * titulů. Import ho teď doplní sám tam, kde je shoda jednoznačná, uloží
 * dvojici do uživatelova číselníku (vidí ji a může ji opravit) a řekne to
 * jednou větou. Uživatelův záznam má přednost.
 */
const stav = vi.hoisted(() => ({
  db: null as unknown as Db,
  builtin: true,
  searchParams: new URLSearchParams(),
}));

// Vestavěný číselník jde v testu vypnout — tak vznikne stav „výpis nahraný
// dřív, než číselník existoval“ (dividenda uložená bez ISIN).
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

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const text = (value: string): ArrayBuffer => bufferOf(new TextEncoder().encode(value));

const upload = (filename: string, data: ArrayBuffer): Promise<ImportSummary> =>
  importFileIsolated(stav.db, 'u1', filename, data);

const aliasesOf = async (): Promise<Record<string, { isin: string; currency: string | null }>> => {
  const rows = await stav.db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, 'u1'));
  return Object.fromEntries(
    rows.map((row) => [`${row.broker}|${row.symbol}`, { isin: row.isin, currency: row.currency }]),
  );
};

async function renderImportPage(params: Record<string, string | string[]>): Promise<string> {
  const { default: ImportPage } = await import('@/app/(app)/import/page');
  stav.searchParams = new URLSearchParams(
    Object.entries(params).flatMap(([name, value]) =>
      [value].flat().map((item) => [name, item] as [string, string]),
    ),
  );
  return renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(params) }))
    .replaceAll(' ', ' ')
    .replaceAll('<!-- -->', '');
}

const SCHWAB_KO = [
  '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"',
  '"05/02/2025","Qualified Dividend","KO","COCA COLA CO","","","","$20.00"',
  '"03/03/2025","Buy","KO","COCA COLA CO","40","$70.00","","-$2800.00"',
].join('\n');

beforeEach(async () => {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  stav.db = db;
  stav.builtin = true;
}, 30_000);

describe('vestavěný číselník ISIN při importu', () => {
  it('běžný titul se doplní sám, uloží se do číselníku a import to řekne', { timeout: 30_000 }, async () => {
    const summary = await upload('schwab.csv', text(SCHWAB_KO));

    expect(summary.unmapped).toEqual([]);
    expect(summary.added).toBe(2);
    expect(summary.filled).toEqual([
      {
        broker: 'schwab',
        symbol: 'KO',
        isin: 'US1912161007',
        name: 'The Coca-Cola Company',
        source: 'builtin',
      },
    ]);
    expect(await aliasesOf()).toEqual({ 'schwab|KO': { isin: 'US1912161007', currency: null } });
    const transactions = await loadTransactions(stav.db, 'u1');
    expect(transactions.every((tx) => 'isin' in tx && tx.isin === 'US1912161007')).toBe(true);

    // hláška po nahrání i řádek historie to řeknou jednou větou s odkazem na seznam
    const html = await renderImportPage({
      ulozeno: 'nahrano',
      soubory: '1',
      pridano: '2',
      davka: summary.batchId,
    });
    const sentence = 'Doplnili jsme ISIN: KO → The Coca-Cola Company (US1912161007).';
    expect(html.split(sentence).length - 1).toBe(2);
    expect(html).toContain('href="#ciselnik"');
    expect(html).toContain('Doplněné údaje instrumentů');
    // dávka bez chyb a varování se po nahrání otevře i kvůli doplněnému ISIN
    expect(
      batchesToOpen([
        { batchId: 'a', errors: [], warnings: [], crossBroker: [], filled: summary.filled },
        { batchId: 'b', errors: [], warnings: [], crossBroker: [], filled: [] },
      ]),
    ).toEqual(['a', 'b']);
    expect(
      batchesToOpen([
        { batchId: 'a', errors: [], warnings: [], crossBroker: [] },
        { batchId: 'c', errors: [], warnings: [], crossBroker: [] },
      ]),
    ).toEqual(['c']);
  });

  it('uživatelův záznam má přednost a vestavěný ho nepřepíše', { timeout: 30_000 }, async () => {
    // smyšlený, ale platný ISIN — uživatel si to tak uložil
    await saveAliases(stav.db, 'u1', [{ broker: 'schwab', symbol: 'KO', isin: 'US0378331005' }]);

    const summary = await upload('schwab.csv', text(SCHWAB_KO));

    expect(summary.filled).toEqual([]);
    expect((await aliasesOf())['schwab|KO']!.isin).toBe('US0378331005');
    const transactions = await loadTransactions(stav.db, 'u1');
    expect(transactions.every((tx) => 'isin' in tx && tx.isin === 'US0378331005')).toBe(true);
  });

  it('eToro: titul z evropské burzy se doplní podle přípony, londýnský bez přípony podle měny', { timeout: 30_000 }, async () => {
    // BA je v Londýně BAE Systems, v USA Boeing: holý ticker
    // vedený v pencích (eToro tak píše londýnské tituly) nesmí dostat ISIN
    // americké firmy
    const open = (pid: string, details: string) =>
      ETORO_ACTIVITY_HEADERS_2026.map(
        (header) =>
          ({
            Date: '12/05/2026 16:20:00',
            Type: 'Open Position',
            Details: details,
            Amount: '90.00',
            'Units / Contracts': '3',
            'Position ID': pid,
            'Asset type': 'Stocks',
          })[header] ?? '',
      );
    const statement = await buildEtoroXlsx({
      activity: {
        headers: ETORO_ACTIVITY_HEADERS_2026,
        rows: [open('2000000060', 'ADS.DE/EUR'), open('2000000061', 'BA/GBX'), open('2000000062', '1925.T/JPY')],
      },
    });

    const summary = await upload('etoro-account-statement.xlsx', bufferOf(statement));

    expect(summary.unmapped).toEqual([]);
    expect(Object.fromEntries(summary.filled.map((item) => [item.symbol, item.isin]))).toEqual({
      'ADS.DE': 'DE000A1EWWW0',
      BA: 'GB0002634946',
      '1925.T': 'JP3505000004',
    });
  });

  const etoroRow = (headers: string[], values: Record<string, string>) =>
    headers.map((header) => values[header] ?? '');
  const etoroActivity = (type: string, pid: string, details: string) =>
    etoroRow(ETORO_ACTIVITY_HEADERS_2026, {
      Date: '12/05/2026 16:20:00',
      Type: type,
      Details: details,
      Amount: '90.00',
      'Units / Contracts': '3',
      'Position ID': pid,
      'Asset type': 'Stocks',
    });

  it('eToro: prodaný londýnský titul bez přípony dostane londýnský ISIN (měna z uzavření)', { timeout: 30_000 }, async () => {
    // Closed Positions zná jen holý ticker; měnu nese řádek uzavření v Account Activity
    const statement = await buildEtoroXlsx({
      closed: {
        headers: ETORO_CLOSED_HEADERS_2026,
        rows: [
          etoroRow(ETORO_CLOSED_HEADERS_2026, {
            'Position ID': '2000000070',
            Action: 'BAE Systems (BA)',
            'Long / Short': 'Long',
            Amount: '40.00',
            'Units / Contracts': '2',
            'Open Date': '03/02/2026 10:15:00',
            'Close Date': '17/03/2026 14:40:00',
            Leverage: '1',
            'Profit(USD)': '5.00',
            'Open Rate': '1200',
            'Close Rate': '1350',
            Type: 'Stocks',
          }),
        ],
      },
      activity: {
        headers: ETORO_ACTIVITY_HEADERS_2026,
        rows: [etoroActivity('Position closed', '2000000070', 'BA/GBX')],
      },
    });

    const summary = await upload('etoro-account-statement.xlsx', bufferOf(statement));

    expect(summary.unmapped).toEqual([]);
    expect(summary.filled.map((item) => `${item.symbol}=${item.isin}`)).toEqual(['BA=GB0002634946']);
  });

  it('eToro: týž holý ticker v jiné měně dalšího výpisu se uloží pod záznamem, ale s varováním', { timeout: 30_000 }, async () => {
    const london = await buildEtoroXlsx({
      activity: { headers: ETORO_ACTIVITY_HEADERS_2026, rows: [etoroActivity('Open Position', '2000000071', 'BA/GBX')] },
    });
    const first = await upload('etoro-1.xlsx', bufferOf(london));
    expect(first.filled.map((item) => item.isin)).toEqual(['GB0002634946']);
    // štítek „doplněno z veřejných dat“ pozná londýnský výklad, i když záznam měnu nenese
    expect(
      originOf(new Map(), { broker: 'etoro', symbol: 'BA', isin: 'GB0002634946' }),
    ).toEqual({ source: 'builtin' });

    const newYork = await buildEtoroXlsx({
      activity: {
        headers: ETORO_ACTIVITY_HEADERS_2026,
        // jiný den a částka — obsahový dedupe by jinak řádek vzal za tentýž
        rows: [
          etoroActivity('Open Position', '2000000072', 'BA/USD').map((cell, index) =>
            ETORO_ACTIVITY_HEADERS_2026[index] === 'Date'
              ? '14/07/2026 15:00:00'
              : ETORO_ACTIVITY_HEADERS_2026[index] === 'Amount'
                ? '12.00'
                : cell,
          ),
        ],
      },
    });
    const second = await upload('etoro-2.xlsx', bufferOf(newYork));

    expect(second.added).toBe(1);
    expect(second.warnings.map((item) => item.message)).toContainEqual(
      expect.stringMatching(/^Symbol BA: výpis ho vede v USD, ale tvůj záznam v číselníku má ISIN GB0002634946/),
    );
    const transactions = await loadTransactions(stav.db, 'u1');
    expect(transactions.every((tx) => 'isin' in tx && tx.isin === 'GB0002634946')).toBe(true);
  });

  it('Revolut: ticker obchodovaný i v eurech se nedoplní (může to být evropský trh)', { timeout: 30_000 }, async () => {
    const statement = [
      REVOLUT_INVEST_HEADER,
      '2025-06-05T07:26:04.809Z,KO,BUY - MARKET,1,€60.00,€60,EUR,1.0000',
      '2025-07-05T07:26:04.809Z,KO,BUY - MARKET,1,$70.00,$70,USD,1.0000',
      '2025-07-05T07:26:04.809Z,PEP,BUY - MARKET,1,$140.00,$140,USD,1.0000',
    ].join('\n');

    const summary = await upload('revolut.csv', text(statement));

    expect(summary.unmapped.map((item) => item.symbol)).toEqual(['KO']);
    expect(summary.filled.map((item) => item.symbol)).toEqual(['PEP']);
  });

  it('XTB: titul s příponou .US dostane i měnu, ETF z Londýna čeká na uživatele', { timeout: 30_000 }, async () => {
    const report = await buildXtbXlsx({
      rows: [
        ...XTB_ROWS_EN,
        [100010, 'Stocks/ETF purchase', '05.02.2025 11:00:00', 'OPEN BUY 10 @ 92.10', 'IWDA.UK', -921],
      ],
    });
    const summary = await upload('xtb.xlsx', bufferOf(report));

    expect(summary.filled).toEqual([
      {
        broker: 'xtb',
        symbol: 'AAPL.US',
        isin: 'US0378331005',
        name: 'Apple Inc.',
        currency: 'USD',
        source: 'builtin',
      },
    ]);
    expect(summary.unmapped.map((item) => item.symbol)).toEqual(['IWDA.UK']);
    expect(await aliasesOf()).toEqual({ 'xtb|AAPL.US': { isin: 'US0378331005', currency: 'USD' } });
  });

  it('XTB: záznamu se shodným ISIN bez měny měnu doplní, jinému ISIN nic', { timeout: 30_000 }, async () => {
    // starší záznam jen s ISIN (dividendám stačí) — obchody na měnu čekaly
    await stav.db.insert(instrumentAliases).values({
      userId: 'u1',
      broker: 'xtb',
      symbol: 'AAPL.US',
      isin: 'US0378331005',
    });
    const summary = await upload('xtb.xlsx', bufferOf(await buildXtbXlsx({ rows: XTB_ROWS_EN })));

    expect(summary.unmapped).toEqual([]);
    expect(summary.filled.map((item) => item.symbol)).toEqual(['AAPL.US']);
    expect(await aliasesOf()).toEqual({ 'xtb|AAPL.US': { isin: 'US0378331005', currency: 'USD' } });
  });

  it('XTB: záznam bez měny s JINÝM ISIN zůstane, jak ho uživatel zadal', { timeout: 30_000 }, async () => {
    await stav.db.insert(instrumentAliases).values({
      userId: 'u1',
      broker: 'xtb',
      symbol: 'AAPL.US',
      isin: 'US5949181045',
    });
    const summary = await upload('xtb.xlsx', bufferOf(await buildXtbXlsx({ rows: XTB_ROWS_EN })));

    expect(summary.filled).toEqual([]);
    expect(summary.unmapped.map((item) => item.symbol)).toEqual(['AAPL.US']);
    expect(await aliasesOf()).toEqual({ 'xtb|AAPL.US': { isin: 'US5949181045', currency: null } });
  });
});

/**
 * Výpis nahraný DŘÍV, než číselník symbol znal: dividenda je uložená bez ISIN
 * (obchod se neuložil vůbec). Nové nahrání s doplněným ISIN ji nesmí uložit
 * podruhé — povýší se na klíč s ISIN (L14-02) — a třetí nahrání nepřidá nic.
 */
describe('vestavěný číselník a dřív nahrané výpisy: nic se nezdvojí', () => {
  const cases: Array<{ broker: string; filename: string; file: () => Promise<ArrayBuffer> }> = [
    { broker: 'schwab', filename: 'schwab.csv', file: async () => text(SCHWAB_KO) },
    { broker: 'tastytrade', filename: 'tasty.csv', file: async () => text(TASTY_V2_DIVIDEND_THEN_BUY) },
    { broker: 'revolut', filename: 'revolut.csv', file: async () => text(REVOLUT_INVEST_UNMAPPED_CSV) },
    { broker: 'fio', filename: 'fio.csv', file: async () => bufferOf(encodeCp1250(FIO_FIXTURE)) },
    { broker: 'etoro', filename: 'etoro.xlsx', file: async () => bufferOf(await buildEtoroHappyPath()) },
    {
      broker: 'xtb',
      filename: XTB_NEW_FILENAME,
      file: async () => bufferOf(await buildXtbNewReportXlsx()),
    },
  ];

  for (const { broker, filename, file } of cases) {
    it(`${broker}`, { timeout: 60_000 }, async () => {
      stav.builtin = false;
      const before = await upload(filename, await file());
      expect(before.broker).toBe(broker);
      expect(before.unmapped.length).toBeGreaterThan(0);
      const storedBefore = await loadTransactions(stav.db, 'u1');
      const dividendsBefore = storedBefore.filter((tx) => tx.type === 'DIVIDEND');

      stav.builtin = true;
      const after = await upload(filename, await file());
      expect(after.filled.length).toBeGreaterThan(0);
      const filledSymbols = new Set(after.filled.map((item) => item.symbol));
      // co zůstalo k doplnění, je jen to, co vestavěný číselník nezná
      expect(after.unmapped.filter((item) => filledSymbols.has(item.symbol))).toEqual([]);
      const stored = await loadTransactions(stav.db, 'u1');
      const dividends = stored.filter((tx) => tx.type === 'DIVIDEND');
      // dividenda uložená bez ISIN se nezdvojila, jen dostala ISIN
      const bareBefore = dividendsBefore.filter((tx) => !('isin' in tx) || !tx.isin);
      // eToro nese ISIN dividend ve výpisu a XTB dividendu bez ISIN neuloží;
      // u ostatních je dvojnice bez ISIN přesně ten případ, o který jde
      if (['schwab', 'tastytrade', 'revolut', 'fio'].includes(broker)) {
        expect(bareBefore.length).toBeGreaterThan(0);
      }
      if (bareBefore.length > 0) {
        expect(dividends).toHaveLength(dividendsBefore.length);
        expect(after.duplicates).toBeGreaterThanOrEqual(bareBefore.length);
      }
      const filledIsins = new Set(after.filled.map((item) => item.isin));
      expect(
        dividends.filter((tx) => 'ticker' in tx && tx.ticker && filledSymbols.has(tx.ticker)),
      ).toSatisfy((list: typeof dividends) =>
        list.every((tx) => 'isin' in tx && tx.isin !== undefined && filledIsins.has(tx.isin)),
      );

      // třetí nahrání téhož výpisu už nepřidá nic
      const again = await upload(filename, await file());
      expect(again.added).toBe(0);
      expect(again.filled).toEqual([]);
      expect(await loadTransactions(stav.db, 'u1')).toHaveLength(stored.length);

      const batches = await stav.db.select().from(importBatches).where(eq(importBatches.userId, 'u1'));
      expect(batches).toHaveLength(3);
    });
  }
});
