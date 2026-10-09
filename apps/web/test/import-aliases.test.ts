import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidIsin } from '@danero/shared';
import type { Db } from '@/db';
import { instrumentAliases, user } from '@/db/schema';
import { importFileIsolated } from '@/lib/import-service';
import { loadTransactions } from '@/lib/portfolio';
import { ETORO_INSTRUMENT_MAP } from '../../../packages/importers/test/fixtures/etoro';
import { FIO_SYMBOL_MAP } from '../../../packages/importers/test/fixtures/fio';
import { REVOLUT_INSTRUMENT_MAP } from '../../../packages/importers/test/fixtures/revolut';
import {
  SCHWAB_FICTIONAL_MAP,
  SCHWAB_INSTRUMENT_MAP,
} from '../../../packages/importers/test/fixtures/schwab';
import { TASTY_INSTRUMENT_MAP } from '../../../packages/importers/test/fixtures/tastytrade';
import {
  buildXtbNewReportXlsx,
  XTB_INSTRUMENT_MAP,
  XTB_NEW_CASH_ROWS,
  XTB_NEW_FILENAME,
  XTB_NEW_INSTRUMENT_MAP,
} from '../../../packages/importers/test/fixtures/xtb';

/**
 * Číselník titulů na /import (L14-05, L14-06).
 *
 * Broker bez ISIN ve výpisu chce po uživateli, aby ho ke každému symbolu
 * opsal ručně. Do páté revize server hlídal jen tvar, takže přehozené číslice
 * prošly bez slova — a ISIN je součást dedupe klíče i identity pozice, takže
 * se překlep bez vrácení importu opravit nedá. U XTB se navíc ručně psala
 * i měna, kterou u přípony `.US` z tickeru poznat jde.
 */
const stav = vi.hoisted(() => ({ db: null as unknown as Db }));

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
  return { ...actual, getDb: async () => stav.db };
});

interface AliasRow {
  broker: string;
  symbol: string;
  isin: string;
  currency?: string;
}

function form(rows: AliasRow[]): FormData {
  const data = new FormData();
  data.set('pocet', String(rows.length));
  rows.forEach((row, index) => {
    data.set(`broker-${index}`, row.broker);
    data.set(`symbol-${index}`, row.symbol);
    data.set(`isin-${index}`, row.isin);
    if (row.currency !== undefined) data.set(`currency-${index}`, row.currency);
  });
  return data;
}

/** Vrátí cíl přesměrování, kterým server action skončila. */
async function save(rows: AliasRow[]): Promise<string> {
  const { saveAliasesAction } = await import('@/app/(app)/import/actions');
  try {
    await saveAliasesAction(form(rows));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  return '';
}

const savedAliases = async (): Promise<Record<string, string>> => {
  const rows = await stav.db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, 'u1'));
  return Object.fromEntries(rows.map((row) => [`${row.broker}|${row.symbol}`, row.isin]));
};

/** Stránka /import jako HTML — tak, jak ji dostane prohlížeč bez JavaScriptu. */
async function renderImportPage(params: Record<string, string | string[]> = {}): Promise<string> {
  const { default: ImportPage } = await import('@/app/(app)/import/page');
  return renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve(params) }));
}

/** Atributy všech `<input>` na stránce (pořadí atributů v HTML není zaručené). */
function inputs(html: string): Array<Record<string, string>> {
  return [...html.matchAll(/<input\b([^>]*)>/g)].map((match) =>
    Object.fromEntries(
      [...match[1]!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!]),
    ),
  );
}

/** Předvyplněná měna u symbolu ve formuláři číselníku; `undefined` = pole je prázdné. */
function prefilledCurrency(html: string, symbol: string): string | undefined {
  const all = inputs(html);
  const hidden = all.find((input) => input.name?.startsWith('symbol-') && input.value === symbol);
  if (!hidden) throw new Error(`symbol ${symbol} ve formuláři číselníku není`);
  const index = hidden.name!.slice('symbol-'.length);
  const field = all.find((input) => input.name === `currency-${index}`);
  if (!field) throw new Error(`symbol ${symbol} nemá pole pro měnu`);
  return field.value;
}

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

/** Smyšlené tickery; z fixtury se bere jen tvar řádku nákupu. */
const US_TICKERS = Array.from(
  { length: 12 },
  (_, index) => `T${String(index + 1).padStart(2, '0')}.US`,
);

/** Report XTB s nákupy 12 titulů `.US` a jednoho `IWDA.UK`. */
async function xtbReport(): Promise<ArrayBuffer> {
  const template = XTB_NEW_CASH_ROWS.find((row) => row.includes('Stock purchase'));
  if (!template) throw new Error('fixtura nemá řádek Stock purchase');
  const cashRows = [...US_TICKERS, 'IWDA.UK'].map((ticker, index) =>
    template.map((cell) => (cell === 'AAPL.US' ? ticker : cell === 700003 ? 710001 + index : cell)),
  );
  return toArrayBuffer(await buildXtbNewReportXlsx({ cashRows, closedRows: [] }));
}

beforeEach(async () => {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  stav.db = db;
}, 30_000);

describe('číselník: kontrolní číslice ISIN při ukládání (L14-06)', () => {
  it('platný ISIN se uloží', { timeout: 30_000 }, async () => {
    const cil = await save([{ broker: 'schwab', symbol: 'AAPL', isin: 'US0378331005' }]);

    expect(cil).toBe('/import?ulozeno=ciselnik');
    expect(await savedAliases()).toEqual({ 'schwab|AAPL': 'US0378331005' });
  });

  it('špatná kontrolní číslice: neuloží se a hláška jmenuje symbol', { timeout: 30_000 }, async () => {
    const cil = await save([{ broker: 'schwab', symbol: 'AAPL', isin: 'US0378331006' }]);

    expect(cil).toBe('/import?chyba=isin-kontrola&symbol=AAPL');
    expect(await savedAliases()).toEqual({});
  });

  it('přehozené číslice: neuloží se a hláška jmenuje symbol', { timeout: 30_000 }, async () => {
    const cil = await save([{ broker: 'schwab', symbol: 'AAPL', isin: 'US0378313005' }]);

    expect(cil).toBe('/import?chyba=isin-kontrola&symbol=AAPL');
    expect(await savedAliases()).toEqual({});
  });

  it('malá písmena a mezery kolem se srovnají dřív, než se počítá číslice', { timeout: 30_000 }, async () => {
    const cil = await save([{ broker: 'fio', symbol: 'AAPL', isin: ' us0378331005 ' }]);

    expect(cil).toBe('/import?ulozeno=ciselnik');
    expect(await savedAliases()).toEqual({ 'fio|AAPL': 'US0378331005' });
  });

  it(
    'překlep v jednom řádku nesebere ostatní: správné se uloží, vadné se vyjmenují',
    { timeout: 30_000 },
    async () => {
      const cil = await save([
        { broker: 'schwab', symbol: 'AAPL', isin: 'US0378331005' },
        { broker: 'schwab', symbol: 'KO', isin: 'US1912161070' },
        { broker: 'xtb', symbol: 'MSFT.US', isin: 'US5949181045', currency: 'USD' },
        { broker: 'xtb', symbol: 'T01.US', isin: 'US0378331006', currency: 'USD' },
      ]);

      expect(cil).toBe('/import?chyba=isin-kontrola&symbol=KO&symbol=T01.US');
      expect(await savedAliases()).toEqual({
        'schwab|AAPL': 'US0378331005',
        'xtb|MSFT.US': 'US5949181045',
      });
    },
  );

  it('špatný tvar dál odmítne celý formulář původní hláškou', { timeout: 30_000 }, async () => {
    const cil = await save([
      { broker: 'schwab', symbol: 'AAPL', isin: 'US0378331005' },
      { broker: 'schwab', symbol: 'KO', isin: 'US19121610' },
    ]);

    expect(cil).toBe('/import?chyba=isin');
    expect(await savedAliases()).toEqual({});
  });

  it('nic, co číselníkem prochází v testech importerů, validace nezablokuje', () => {
    const maps: Record<string, Record<string, { isin: string }>> = {
      etoro: ETORO_INSTRUMENT_MAP,
      fio: FIO_SYMBOL_MAP,
      revolut: REVOLUT_INSTRUMENT_MAP,
      schwab: SCHWAB_INSTRUMENT_MAP,
      tastytrade: TASTY_INSTRUMENT_MAP,
      xtb: XTB_INSTRUMENT_MAP,
      xtbNew: XTB_NEW_INSTRUMENT_MAP,
    };
    const rejected = Object.entries(maps).flatMap(([broker, map]) =>
      Object.entries(map)
        .filter(([, instrument]) => !isValidIsin(instrument.isin))
        .map(([symbol, instrument]) => `${broker}|${symbol}|${instrument.isin}`),
    );

    expect(rejected).toEqual([]);
    // protipříklad: zjevně vymyšlený ISIN z fixtury Schwabu číslici nemá a číselníkem
    // by neprošel — parser ho dostává přímo, formulářem nejde
    expect(isValidIsin(SCHWAB_FICTIONAL_MAP.QXLT.isin)).toBe(false);
  });
});

describe('číselník XTB: měna předvyplněná z přípony tickeru (L14-05)', () => {
  it(
    '12 titulů .US má předvyplněné USD, IWDA.UK nic; ISIN zůstává na uživateli',
    { timeout: 60_000 },
    async () => {
      await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await xtbReport());

      const html = await renderImportPage();
      expect(html).toContain('Doplň chybějící údaje instrumentů');
      expect(US_TICKERS.map((ticker) => prefilledCurrency(html, ticker))).toEqual(
        US_TICKERS.map(() => 'USD'),
      );
      expect(prefilledCurrency(html, 'IWDA.UK')).toBeUndefined();
      // předvyplnění se uživateli řekne — pole zůstává k přepsání
      expect(html).toContain('Měnu jsme u tickerů s příponou .US předvyplnili (USD)');
      // ISIN se nepředvyplňuje nikomu — z reportu zjistit nejde
      const isinFields = inputs(html).filter((input) => input.name?.startsWith('isin-'));
      expect(isinFields).toHaveLength(13);
      expect(isinFields.every((input) => input.value === undefined)).toBe(true);
      // a nic se nedoplnilo potichu: bez uloženého číselníku není jediný obchod
      expect(await loadTransactions(stav.db, 'u1')).toEqual([]);
    },
  );

  it('hláška o kontrolní číslici jmenuje jen symbol, který ve formuláři opravdu je', { timeout: 60_000 }, async () => {
    await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await xtbReport());

    const html = await renderImportPage({
      chyba: 'isin-kontrola',
      symbol: ['T03.US', 'podvržený text z adresy'],
    });

    expect(html).toContain('U symbolu T03.US ISIN nesedí');
    expect(html).toContain('poslední číslice je kontrolní');
    expect(html).not.toContain('podvržený text z adresy');
  });
});

/**
 * L23-02 (rozhodnutí R13, varianta B): ISIN je součást dedupe klíče. Kdyby šel
 * v číselníku přepsat u symbolu, pod kterým už leží transakce, další nahrání
 * téhož výpisu by obchody i dividendy uložilo podruhé pod novým ISIN. Server
 * proto přepis odmítne s radou — uložené řádky se nepřepisují.
 */
describe('číselník: přepis ISIN u symbolu s uloženými transakcemi (L23-02)', () => {
  const report = async (): Promise<ArrayBuffer> => toArrayBuffer(await buildXtbNewReportXlsx());
  const ORIGINAL = XTB_NEW_INSTRUMENT_MAP['AAPL.US'];
  // jiný platný ISIN — „oprava překlepu“ na jinou třídu akcií
  const OTHER_ISIN = 'US5949181045';

  it('odmítne přepis, nic nezdvojí a poradí vrátit import', { timeout: 60_000 }, async () => {
    expect(isValidIsin(OTHER_ISIN)).toBe(true);
    expect(await save([{ broker: 'xtb', symbol: 'AAPL.US', ...ORIGINAL }])).toBe(
      '/import?ulozeno=ciselnik',
    );
    await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await report());
    const stored = await loadTransactions(stav.db, 'u1');
    expect(stored.length).toBeGreaterThan(0);

    const target = await save([
      { broker: 'xtb', symbol: 'AAPL.US', isin: OTHER_ISIN, currency: 'USD' },
    ]);
    expect(target).toBe('/import?chyba=isin-pouzity');
    expect((await savedAliases())['xtb|AAPL.US']).toBe(ORIGINAL.isin);

    // jádro nálezu: nové nahrání téhož výpisu nepřidá nic
    await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await report());
    expect(await loadTransactions(stav.db, 'u1')).toHaveLength(stored.length);

    const html = await renderImportPage({ chyba: 'isin-pouzity' });
    expect(html).toContain('vrať import zpět');
  });

  it('stejný ISIN (jen jiná měna) a symbol bez transakcí přepsat jde', { timeout: 60_000 }, async () => {
    await save([{ broker: 'xtb', symbol: 'AAPL.US', ...ORIGINAL }]);
    // bez nahraného výpisu není co zdvojit
    expect(
      await save([{ broker: 'xtb', symbol: 'AAPL.US', isin: OTHER_ISIN, currency: 'USD' }]),
    ).toBe('/import?ulozeno=ciselnik');
    expect((await savedAliases())['xtb|AAPL.US']).toBe(OTHER_ISIN);
  });

  it('ostatní řádky téhož formuláře se uloží', { timeout: 60_000 }, async () => {
    await save([{ broker: 'xtb', symbol: 'AAPL.US', ...ORIGINAL }]);
    await importFileIsolated(stav.db, 'u1', XTB_NEW_FILENAME, await report());

    const target = await save([
      { broker: 'xtb', symbol: 'AAPL.US', isin: OTHER_ISIN, currency: 'USD' },
      { broker: 'xtb', symbol: 'MSFT.US', isin: OTHER_ISIN, currency: 'USD' },
    ]);
    expect(target).toBe('/import?chyba=isin-pouzity');
    const aliases = await savedAliases();
    expect(aliases['xtb|AAPL.US']).toBe(ORIGINAL.isin);
    expect(aliases['xtb|MSFT.US']).toBe(OTHER_ISIN);
  });
});
