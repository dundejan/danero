import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import {
  auditLog,
  brokerAccounts,
  importBatches,
  notifications,
  transactions,
  user,
} from '@/db/schema';
import { isSyncBatchFilename } from '@/lib/broker-sync';
import { importFileIsolated } from '@/lib/import-service';
import { undoImportBatch } from '@/lib/import-undo';

/**
 * Vrácení importu (`undoImportAction`).
 *
 * Do 13. 8. 2026 se v historii mazal jen ZÁZNAM o importu — transakce
 * zůstávaly a smazat je nešlo vůbec. Hlášky přitom uživateli radily „smaž
 * dávku importu“, aby se zbavil duplicity, takže radily postup, který
 * nefungoval. Tady se testuje samotný mechanismus (server action ho jen
 * obaluje autentizací): jde přes tytéž dotazy nad PGlite.
 */

const T212_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOF1',
  'Market sell,2026-03-05 15:01:10,US0378331005,AAPL,Apple Inc,50,210.00,USD,,,,,,,,,EOF2',
].join('\n');

const bytes = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

/**
 * Server action `undoImportAction` je jen autentizační obal nad
 * `undoImportBatch` — test volá TUTÉŽ funkci. Vlastní kopii logiky tu mít
 * nesmí: do 23. 8. 2026 ji tu měl a sám si u ní psal, že změnu v akci nechytí.
 */
async function undo(db: Db, userId: string, batchId: string): Promise<number> {
  return (await undoImportBatch(db, userId, batchId))?.count ?? 0;
}

async function freshDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  await db.insert(user).values({ id: 'u2', name: 'Jiný', email: 'jiny@danero.cz' });
  return db;
}

describe('vrácení importu', () => {
  it('smaže transakce dávky i záznam o ní', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));
    expect(summary.added).toBe(2);

    expect(await undo(db, 'u1', summary.batchId)).toBe(2);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(importBatches)).toHaveLength(0);
  });

  it('po vrácení jde tentýž výpis nahrát znovu (dedupe už nebrání)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const first = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));
    await undo(db, 'u1', first.batchId);

    const second = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));
    expect(second.added).toBe(2);
    expect(second.duplicates).toBe(0);
  });

  it('cizí dávku vrátit nejde a nesmaže nikomu nic', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));

    expect(await undo(db, 'u2', summary.batchId)).toBe(0);
    expect(await db.select().from(transactions)).toHaveLength(2);
    expect(await db.select().from(importBatches)).toHaveLength(1);
  });

  it('vrácení nesahá na transakce jiné dávky', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const prvni = await importFileIsolated(db, 'u1', 't212-2024.csv', bytes(T212_CSV));
    const druha = await importFileIsolated(
      db,
      'u1',
      't212-2025.csv',
      bytes(T212_CSV.replace('EOF1', 'EOF3').replace('2024-06-10', '2025-06-10')),
    );
    expect(druha.added).toBe(1);

    await undo(db, 'u1', druha.batchId);
    expect(await db.select().from(transactions)).toHaveLength(2);
    const zbytek = await db.select().from(importBatches);
    expect(zbytek).toHaveLength(1);
    expect(zbytek[0]!.id).toBe(prvni.batchId);
  });

  const napojenyUcet = async (db: Db): Promise<void> => {
    await db.insert(brokerAccounts).values({
      id: 'acc1',
      userId: 'u1',
      broker: 'trading212',
      label: 'Trading 212',
      credentialsEncrypted: 'x',
      lastSyncedAt: new Date('2026-08-01T10:00:00Z'),
    });
  };

  const lastSyncedAt = async (db: Db): Promise<Date | null> => {
    const [ucet] = await db.select().from(brokerAccounts).where(eq(brokerAccounts.id, 'acc1'));
    return ucet!.lastSyncedAt;
  };

  it(
    'vrácení dávky od napojeného brokera odemkne stažení plné historie',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      // účet po dřívějším syncu: inkrementální režim by se ptal jen na roky
      // od lastSyncedAt, takže vrácený rok by se už nikdy nestáhl
      await napojenyUcet(db);
      const summary = await importFileIsolated(db, 'u1', 't212-api-2024.csv', bytes(T212_CSV));

      await undo(db, 'u1', summary.batchId);

      expect(await lastSyncedAt(db)).toBeNull();
    },
  );

  it(
    'vrácení RUČNĚ nahraného výpisu na synchronizaci nesahá',
    { timeout: 30_000 },
    async () => {
      const db = await freshDb();
      await napojenyUcet(db);
      // tentýž broker, ale soubor nahrál uživatel — zahodit lastSyncedAt by
      // znamenalo stahovat celou historii při limitu ~1 dotaz/min a účet by
      // v UI vypadal jako nikdy nesynchronizovaný
      const summary = await importFileIsolated(db, 'u1', 'muj-export.csv', bytes(T212_CSV));

      await undo(db, 'u1', summary.batchId);

      expect(await lastSyncedAt(db)).not.toBeNull();
    },
  );

  it('vrácení smaže upozornění hlídače za dotčené roky', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_CSV));
    // hlídač už stihl založit událost za rok prodeje i za jiný rok
    await db.insert(notifications).values([
      { userId: 'u1', dedupeKey: 'limit|100k|EXCEEDED|2026', type: 'LIMIT', title: 'x', body: 'y' },
      { userId: 'u1', dedupeKey: 'limit|100k|EXCEEDED|2019', type: 'LIMIT', title: 'x', body: 'y' },
    ]);

    await undo(db, 'u1', summary.batchId);

    // 2024 (nákup) a 2026 (prodej) jsou dotčené, 2019 zůstává
    const zbylo = await db.select().from(notifications).where(eq(notifications.userId, 'u1'));
    expect(zbylo.map((row) => row.dedupeKey)).toEqual(['limit|100k|EXCEEDED|2019']);
  });

  it('audit log zná typ IMPORT_UNDONE', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const { logAudit } = await import('@/lib/audit');
    await logAudit(db, 'u1', 'IMPORT_UNDONE', 't212.csv: 2 transakcí');
    const rows = await db.select().from(auditLog).where(eq(auditLog.userId, 'u1'));
    expect(rows[0]!.type).toBe('IMPORT_UNDONE');
  });
});
