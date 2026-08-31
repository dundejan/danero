import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/db';
import { importBatches, user } from '@/db/schema';
import { loadTransactions } from '@/lib/portfolio';

/**
 * K5-08: pád databáze u JEDNOHO souboru nesmí sebrat zbytek dávky.
 *
 * `importFileIsolated` si sice selhání zapisuje jako dávku s chybou (F-3-7),
 * jenže při výpadku databáze padne i tenhle zotavovací zápis a výjimka z něj
 * vyleze ven. `uploadImportAction` ji nechytala, takže uživatel dostal
 * generický error boundary a další soubory se vůbec nezpracovaly — u nahrání
 * pěti výpisů tedy stačil jeden okamžik výpadku, aby se tři z nich ztratily
 * bez jediného slova.
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

const csv = (isin: string): string =>
  `type,date,isin,quantity,price,currency\nBUY,2025-01-10,${isin},1,100,USD`;

function form(names: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [filename, content] of names) {
    data.append('soubory', new File([content], filename, { type: 'text/csv' }));
  }
  return data;
}

/** Chyba, kterou pozná `isDatabaseError` — pád spojení, ne vada souboru. */
function connectionLost(): Error {
  const error = new Error('write CONNECTION_CLOSED');
  (error as { code?: string }).code = 'CONNECTION_CLOSED';
  return error;
}

/** Vrátí cíl přesměrování, kterým server action skončila. */
async function upload(data: FormData): Promise<string> {
  const { uploadImportAction } = await import('@/app/(app)/import/actions');
  try {
    await uploadImportAction(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('REDIRECT:')) return message.slice('REDIRECT:'.length);
    throw error;
  }
  return '';
}

describe('nahrání víc souborů při výpadku databáze (K5-08)', () => {
  it('zbylé soubory se doimportují a uživatel se o pádu doví', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
    stav.db = db;

    // Dávka je od 31. 8. 2026 první zápis importu, takže shodit ji znamená
    // shodit celý soubor. Padá druhý pokus i třetí (zotavovací zápis
    // `runIsolated`) — přesně tak vypadá výpadek spojení uprostřed nahrávání.
    const original = db.insert.bind(db);
    let batchInserts = 0;
    (db as unknown as { insert: typeof original }).insert = ((table: never) => {
      if (table === (importBatches as never)) {
        batchInserts += 1;
        if (batchInserts === 2 || batchInserts === 3) throw connectionLost();
      }
      return original(table);
    }) as typeof original;

    const cil = await upload(
      form([
        ['prvni.csv', csv('US0378331005')],
        ['druhy.csv', csv('US5949181045')],
        ['treti.csv', csv('US02079K3059')],
      ]),
    );
    (db as unknown as { insert: typeof original }).insert = original;

    // třetí soubor se musí uložit i po pádu druhého
    const txs = await loadTransactions(db, 'u1');
    expect(txs).toHaveLength(2);
    // a uživatel nesmí skončit na generickém error boundary
    expect(cil).toBe('/import?chyba=ulozeni');
  });
});
