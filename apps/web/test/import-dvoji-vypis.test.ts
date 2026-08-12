import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { instrumentAliases, user } from '@/db/schema';
import { importFileIsolated } from '@/lib/import-service';
import { loadTransactions } from '@/lib/portfolio';
import {
  buildEtoroXlsx,
  ETORO_ACTIVITY_ROWS,
  ETORO_CLOSED_ROWS,
  ETORO_DIVIDEND_ROWS,
} from '../../../packages/importers/test/fixtures/etoro';

/**
 * Táž událost ve dvou po sobě jdoucích výpisech.
 *
 * eToro popisuje jeden nákup dvakrát a pokaždé jinak přesně: dokud je pozice
 * otevřená, je jen v Account Activity a cena se počítá `Amount / Units`
 * (147,9201326…); po uzavření přijde v Closed Positions s `Open Rate` 147,92.
 * Dedupe je vědomě obsahový (B-3-2), takže jiná cena = jiný klíč a nákup se
 * uložil PODRUHÉ: zdvojená držba, zdvojená nabývací cena a pozdější prodej
 * spárovaný s lotem, který nikdy neexistoval.
 */

const withUser = async (): Promise<Db> => {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  // eToro ISIN u části pozic neuvádí — číselník uživatele ho dodává
  await db.insert(instrumentAliases).values([
    { userId: 'u1', broker: 'etoro', symbol: 'AMD', isin: 'US0079031078' },
    { userId: 'u1', broker: 'etoro', symbol: 'OLED', isin: 'US91347P1057' },
    { userId: 'u1', broker: 'etoro', symbol: 'TSLA', isin: 'US88160R1014' },
    { userId: 'u1', broker: 'etoro', symbol: 'AAPL', isin: 'US0378331005' },
    { userId: 'u1', broker: 'etoro', symbol: 'MSFT', isin: 'US5949181045' },
    { userId: 'u1', broker: 'etoro', symbol: 'NVDA', isin: 'US67066G1040' },
    { userId: 'u1', broker: 'etoro', symbol: 'ZZZ', isin: 'US0000000000' },
  ]);
  return db;
};

const upload = async (db: Db, filename: string, buffer: Buffer) =>
  importFileIsolated(
    db,
    'u1',
    filename,
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );

describe('eToro: pozice otevřená v prvním výpisu a uzavřená ve druhém', () => {
  it('nákup se neuloží dvakrát a uživatel se o rozdílu dozví', { timeout: 60_000 }, async () => {
    const db = await withUser();

    // 1. výpis: pozice AMD je otevřená → BUY jen z Account Activity
    const otevrena = await buildEtoroXlsx({
      closed: { rows: [] },
      activity: { rows: ETORO_ACTIVITY_ROWS },
      dividends: { rows: ETORO_DIVIDEND_ROWS },
    });
    const prvni = await upload(db, 'etoro-2025.xlsx', otevrena);
    expect(prvni.errors).toEqual([]);
    const poPrvnim = await loadTransactions(db, 'u1');
    const nakupy = poPrvnim.filter((tx) => tx.type === 'BUY');
    expect(nakupy.length).toBeGreaterThan(0);

    // 2. výpis: tatáž pozice už uzavřená → pár BUY/SELL z Closed Positions
    const uzavrena = await buildEtoroXlsx({
      closed: { rows: ETORO_CLOSED_ROWS },
      activity: { rows: ETORO_ACTIVITY_ROWS },
      dividends: { rows: ETORO_DIVIDEND_ROWS },
    });
    const druhy = await upload(db, 'etoro-2026.xlsx', uzavrena);
    expect(druhy.errors).toEqual([]);

    const poDruhem = await loadTransactions(db, 'u1');
    // každý nákup smí být v databázi jen jednou (klíč = id, ne obsah)
    const idsPoDruhem = poDruhem.map((tx) => tx.id);
    expect(new Set(idsPoDruhem).size).toBe(idsPoDruhem.length);

    // rozdíl se nesmí spolknout: řádek se neuloží, ale uživatel se to dozví
    const hlaseno = druhy.warnings.filter((w) => w.message.includes('už máš uloženou'));
    expect(hlaseno.length).toBeGreaterThan(0);
    expect(hlaseno[0]!.message).toContain('zaokrouhlení');
  });
});
