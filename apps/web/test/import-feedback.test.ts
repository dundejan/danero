import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { urlWithoutFeedback } from '@/components/toast';
import type { Db } from '@/db';
import { brokerAccounts, importBatches, jobs, transactions, user } from '@/db/schema';
import {
  IMPORT_FEEDBACK_PARAMS,
  importFeedback,
  importFeedbackUrl,
} from '@/lib/import-feedback';
import { importFileIsolated } from '@/lib/import-service';

/**
 * Odezva po akcích na /import (L6a-02, L6b-01, L7d-01, L7d-04, L6a-04).
 *
 * Do páté revize končilo nahrání, uložení klíče, odpojení i spuštění
 * synchronizace holým `redirect('/import')` a vrácení importu jen
 * `revalidatePath` — tedy na adrese, která je právě otevřená, a bez jediné
 * hlášky. V produkčním buildu se taková akce v prohlížeči často nedokončila
 * (tlačítko viselo na „Nahrávám a počítám…“), a i když doběhla, výsledek ležel
 * na mobilu tři a půl obrazovky pod formulářem.
 *
 * Každá akce proto končí na `/import?ulozeno=<kód>&…` s údajem, který se
 * neopakuje, a stránka z těch parametrů složí plovoucí hlášku.
 */
const state = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
// `after()` mimo požadavek spadne; samotný běh jobu tady nikoho nezajímá
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: () => undefined };
});
vi.mock('@/lib/session', () => ({ requireUser: async () => ({ id: 'u1' }) }));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => state.db };
});

const T212_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,FB1',
  'Market sell,2026-03-05 15:01:10,US0378331005,AAPL,Apple Inc,50,210.00,USD,,,,,,,,,FB2',
].join('\n');

const bytes = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Cíl přesměrování, kterým server action skončila (prázdný řetězec = žádné). */
async function target(action: (data: FormData) => Promise<void>, data: FormData): Promise<URL | null> {
  try {
    await action(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) {
      return new URL(message.slice('REDIRECT:'.length), 'http://danero.test');
    }
    throw error;
  }
  return null;
}

async function freshDb(): Promise<Db> {
  const { createPgliteDb } = await import('@/db');
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  state.db = db;
  return db;
}

describe('hláška z parametrů adresy', () => {
  it('po nahrání řekne, kolik souborů a transakcí, a pošle do historie (L7d-01)', () => {
    const feedback = importFeedback({ ulozeno: 'nahrano', soubory: '2', pridano: '15', chyby: '0' });
    expect(feedback).toEqual({
      kind: 'ok',
      text: 'Nahráno: 2 soubory, přibylo 15 transakcí. Podrobnosti najdeš v historii importů.',
    });
  });

  it('skloňuje podle počtu', () => {
    const text = (pridano: string, soubory = '1'): string =>
      importFeedback({ ulozeno: 'nahrano', soubory, pridano, chyby: '0' })!.text;
    expect(text('1')).toContain('1 soubor, přibyla 1 transakce.');
    expect(text('3')).toContain('přibyly 3 transakce.');
    expect(text('5', '7')).toContain('7 souborů, přibylo 5 transakcí.');
    expect(text('0')).toContain('1 soubor, žádná nová transakce nepřibyla.');
  });

  it('neopakuje doslova souhrn karty v historii', () => {
    // E2E hledá „2 nové · 0 duplicit“ přes getByText ve strict režimu —
    // hláška se stejným textem by z jednoho nálezu udělala dva
    for (const pridano of ['0', '1', '2', '5']) {
      const { text } = importFeedback({ ulozeno: 'nahrano', soubory: '1', pridano, chyby: '0' })!;
      expect(text).not.toMatch(/nov(á|é|ých) ·/);
      expect(text).not.toMatch(/duplicit/);
    }
  });

  it('chyby v souborech neschová za zelené potvrzení', () => {
    // nic se nenačetlo a soubor má chyby: to není „hotovo“
    expect(importFeedback({ ulozeno: 'nahrano', soubory: '1', pridano: '0', chyby: '1' })).toEqual({
      kind: 'chyba',
      text: 'Nahráno: 1 soubor, žádná nová transakce nepřibyla. Soubor má chyby — jaké, je napsané v historii importů.',
    });
    // část prošla: potvrzení, ale s upozorněním
    const partial = importFeedback({ ulozeno: 'nahrano', soubory: '3', pridano: '8', chyby: '2' })!;
    expect(partial.kind).toBe('ok');
    expect(partial.text).toBe(
      'Nahráno: 3 soubory, přibylo 8 transakcí. Chyby mají 2 z nich — jaké, je napsané v historii importů.',
    );
  });

  it('po vrácení řekne, kolik transakcí zmizelo (L6a-04, L7d-04)', () => {
    const text = (smazano: string): string => importFeedback({ ulozeno: 'vraceno', smazano })!.text;
    expect(text('5')).toBe('Import vrácen, smazáno 5 transakcí.');
    expect(text('1')).toBe('Import vrácen, smazána 1 transakce.');
    expect(text('2')).toBe('Import vrácen, smazány 2 transakce.');
  });

  it('má hlášku pro připojení, odpojení i spuštění synchronizace', () => {
    for (const code of ['pripojeno', 'odpojeno', 'spusteno']) {
      const feedback = importFeedback({ ulozeno: code });
      expect(feedback?.kind).toBe('ok');
      expect(feedback?.text.length).toBeGreaterThan(20);
    }
    // sync-job.spec.ts hledá stav jobu regulárním výrazem ve strict režimu
    expect(importFeedback({ ulozeno: 'spusteno' })!.text).not.toMatch(
      /Synchronizace čeká ve frontě|Připojuji se k Trading 212|Stahuji transakce/,
    );
  });

  it('cizí text z adresy do hlášky neopíše', () => {
    const feedback = importFeedback({
      ulozeno: 'nahrano',
      soubory: '<b>99</b>',
      pridano: '-3',
      chyby: '1e9',
    });
    expect(feedback).toEqual({ kind: 'ok', text: 'Nahráno. Podrobnosti najdeš v historii importů.' });
    expect(importFeedback({ ulozeno: 'vraceno', smazano: 'vše' })!.text).toBe('Import vrácen.');
  });

  it('neznámý kód ani stránka bez parametrů hlášku nemají', () => {
    expect(importFeedback({})).toBeNull();
    expect(importFeedback({ ulozeno: 'neco-jineho' })).toBeNull();
    // číselník a hlášení platformy mají vlastní hlášku přímo na stránce
    expect(importFeedback({ ulozeno: 'ciselnik' })).toBeNull();
    expect(importFeedback({ ulozeno: 'hlaseni' })).toBeNull();
  });

  it('z opakovaného parametru bere první hodnotu', () => {
    expect(importFeedback({ ulozeno: ['vraceno', 'nahrano'], smazano: ['5', '9'] })!.text).toBe(
      'Import vrácen, smazáno 5 transakcí.',
    );
  });
});

describe('adresa s hláškou', () => {
  it('složí adresu, ze které hláška zase vznikne', () => {
    const href = importFeedbackUrl(
      'nahrano',
      { files: 2, added: 15, filesWithErrors: 0, batchId: 'b-1' },
      'historie',
    );
    expect(href).toBe('/import?ulozeno=nahrano&soubory=2&pridano=15&chyby=0&davka=b-1#historie');
    const url = new URL(href, 'http://danero.test');
    expect(importFeedback(Object.fromEntries(url.searchParams))!.text).toContain('2 soubory');
  });

  it('toast po zobrazení smaže z adresy kód i všechny údaje k němu', () => {
    const href = importFeedbackUrl(
      'nahrano',
      {
        files: 2,
        added: 15,
        filesWithErrors: 1,
        removed: 4,
        batchId: 'b-1',
        accountId: 'a-1',
        jobId: 'j-1',
      },
      'historie',
    );
    // kotva zůstává — obnovení stránky má skončit tam, kde uživatel je
    expect(urlWithoutFeedback(`http://danero.test${href}`)).toBe('http://danero.test/import#historie');
    // a parametr, který s hláškou nesouvisí, se nemaže
    expect(urlWithoutFeedback('http://danero.test/portfolio?rok=2025&ok=profil')).toBe(
      'http://danero.test/portfolio?rok=2025',
    );
    // není co mazat → adresa se nepřepisuje vůbec
    expect(urlWithoutFeedback('http://danero.test/import?rok=2025')).toBeNull();
    expect(IMPORT_FEEDBACK_PARAMS).toContain('davka');
  });
});

describe('akce na /import končí na adrese s hláškou, ne na té právě otevřené', () => {
  it('žádná akce nekončí holým přesměrováním na /import', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'app', '(app)', 'import', 'actions.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/redirect\('\/import'\)/);
  });

  it('vrácení importu: počet smazaných transakcí a kotva historie', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));
    const { undoImportAction } = await import('@/app/(app)/import/actions');

    const url = await target(undoImportAction, form({ davka: summary.batchId }));
    expect(url?.pathname).toBe('/import');
    expect(Object.fromEntries(url!.searchParams)).toEqual({
      ulozeno: 'vraceno',
      smazano: '2',
      davka: summary.batchId,
    });
    expect(url!.hash).toBe('#historie');
    expect(await db.select().from(transactions)).toHaveLength(0);

    // podruhé už není co vracet — a nesmí to vypadat jako úspěch
    const again = await target(undoImportAction, form({ davka: summary.batchId }));
    expect(again?.searchParams.get('chyba')).toBe('vraceni');
    expect(again?.searchParams.has('ulozeno')).toBe(false);
  });

  it('uložení klíče T212 a IBKR: id nového účtu a kotva karty brokera', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const { saveIbkrKeyAction, saveTrading212KeyAction } = await import(
      '@/app/(app)/import/actions'
    );

    const t212 = await target(
      saveTrading212KeyAction,
      form({ 'id-klice': 'smysleny-klic', 'tajny-klic': 'smysleny-tajny-klic' }),
    );
    const ibkr = await target(
      saveIbkrKeyAction,
      form({ token: 'smysleny-token-123', 'id-dotazu': '123456' }),
    );

    const accounts = await db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, 'u1'));
    const idOf = (broker: string): string => accounts.find((row) => row.broker === broker)!.id;
    expect(Object.fromEntries(t212!.searchParams)).toEqual({
      ulozeno: 'pripojeno',
      ucet: idOf('trading212'),
    });
    expect(t212!.hash).toBe('#trading212');
    expect(Object.fromEntries(ibkr!.searchParams)).toEqual({ ulozeno: 'pripojeno', ucet: idOf('ibkr') });
    expect(ibkr!.hash).toBe('#ibkr');
  });

  it('spuštění synchronizace a odpojení: id jobu, id účtu a kotva karty', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const { disconnectBrokerAction, saveTrading212KeyAction, syncBrokerAction } = await import(
      '@/app/(app)/import/actions'
    );
    await target(
      saveTrading212KeyAction,
      form({ 'id-klice': 'smysleny-klic', 'tajny-klic': 'smysleny-tajny-klic' }),
    );
    const account = (await db.select().from(brokerAccounts))[0]!;

    const started = await target(syncBrokerAction, form({ ucet: account.id }));
    const job = (await db.select().from(jobs))[0]!;
    expect(Object.fromEntries(started!.searchParams)).toEqual({ ulozeno: 'spusteno', uloha: job.id });
    expect(started!.hash).toBe('#trading212');

    const disconnected = await target(disconnectBrokerAction, form({ ucet: account.id }));
    expect(Object.fromEntries(disconnected!.searchParams)).toEqual({
      ulozeno: 'odpojeno',
      ucet: account.id,
    });
    expect(disconnected!.hash).toBe('#trading212');
    expect(await db.select().from(brokerAccounts)).toHaveLength(0);
  });

  it('nahrání: počty do hlášky, id poslední dávky a kotva historie', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const { uploadImportAction } = await import('@/app/(app)/import/actions');
    const data = new FormData();
    data.append('soubory', new File([T212_CSV], 't212.csv', { type: 'text/csv' }));
    data.append('soubory', new File(['%PDF-1.7 smyšlený obsah'], 'vypis.csv', { type: 'text/csv' }));

    const url = await target(uploadImportAction, data);
    const batches = await db.select().from(importBatches).where(eq(importBatches.userId, 'u1'));
    expect(batches).toHaveLength(2);
    expect(url?.pathname).toBe('/import');
    expect(url!.searchParams.get('ulozeno')).toBe('nahrano');
    expect(url!.searchParams.get('soubory')).toBe('2');
    expect(url!.searchParams.get('pridano')).toBe('2');
    expect(url!.searchParams.get('chyby')).toBe('1');
    expect(batches.map((batch) => batch.id)).toContain(url!.searchParams.get('davka'));
    expect(url!.hash).toBe('#historie');
  });
});
