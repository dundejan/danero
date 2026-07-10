import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { user } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
import { analyzeForUser, getProfile, loadTransactions } from '@/lib/portfolio';
import { getDb } from '@/db';
import { taxpayerProfiles } from '@/db/schema';

const T212_CSV = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOF1',
  'Market sell,2026-03-05 15:01:10,US0378331005,AAPL,Apple Inc,50,210.00,USD,,,,,,,,,EOF2',
  'Dividend (Dividend),2026-04-01 09:00:00,US0378331005,AAPL,Apple Inc,50,0.25,USD,,,,10.80,EUR,1.88,USD,,',
].join('\n');

describe('import pipeline nad PGlite (in-memory)', () => {
  it('import → uložení → rehydratace → engine, idempotentně', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });

    const first = await importCsvText(db, 'u1', 't212-2026.csv', T212_CSV);
    expect(first.errors).toEqual([]);
    expect(first.added).toBe(3);
    expect(first.duplicates).toBe(0);

    // opakovaný import téhož souboru nic nezdvojí (PK userId+dedupeKey)
    const second = await importCsvText(db, 'u1', 't212-2026-znovu.csv', T212_CSV);
    expect(second.added).toBe(0);
    expect(second.duplicates).toBe(3);

    const txs = await loadTransactions(db, 'u1');
    expect(txs).toHaveLength(3);
    const buy = txs.find((t) => t.type === 'BUY')!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.quantity.toString()).toBe('100'); // Decimal přežil round-trip přes JSONB

    // profil + engine nad rehydratovanými daty
    await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });
    const profile = await getProfile(db, 'u1');
    const analysis = analyzeForUser(txs, profile!, 2026, '2026-07-06');
    // prodej 50 × 210 USD (orientační kurz 20.80) = 218 400 Kč → limit 50k prolomen
    expect(analysis.result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(analysis.positions).toHaveLength(1);
    expect(analysis.positions[0]!.totalRemaining.toString()).toBe('50');
  });

  it('getDb vrací singleton (PGlite bez DATABASE_URL)', { timeout: 30_000 }, async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    const a = await getDb();
    const b = await getDb();
    expect(a).toBe(b);
  });
});

describe('audit log (G8b)', () => {
  it('import zapíše událost IMPORT s názvem souboru', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { user, auditLog } = await import('@/db/schema');
    const { importCsvText } = await import('@/lib/import-service');
    const { eq } = await import('drizzle-orm');

    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'ua1', name: 'Audit', email: 'audit@danero.cz' });
    await importCsvText(db, 'ua1',
      'audit.csv',
      'type,date,isin,quantity,price,currency\nBUY,2025-01-10,US0378331005,1,100,USD',
    );
    const events = await db.select().from(auditLog).where(eq(auditLog.userId, 'ua1'));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('IMPORT');
    expect(events[0]!.detail).toContain('audit.csv');
  });
});

describe('izolace uživatelů (tenancy přes userId)', () => {
  it('dva uživatelé mají oddělené transakce, profily i dedupe', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { taxpayerProfiles, user } = await import('@/db/schema');
    const { importCsvText } = await import('@/lib/import-service');
    const { loadTransactions, getProfile } = await import('@/lib/portfolio');

    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'ta', name: 'Uživatel A', email: 'tenant-a@danero.cz' },
      { id: 'tb', name: 'Uživatel B', email: 'tenant-b@danero.cz' },
    ]);
    await db.insert(taxpayerProfiles).values([
      { userId: 'ta', regime: 'PAUSAL' },
      { userId: 'tb', regime: 'ZAMESTNANEC' },
    ]);

    const CSV = 'type,date,isin,quantity,price,currency\nBUY,2025-01-10,US0378331005,1,100,USD';
    await importCsvText(db, 'ta', 'a.csv', CSV);
    // tentýž obsah u druhého uživatele NENÍ duplicita (oddělený dedupe pool)
    const second = await importCsvText(db, 'tb', 'b.csv', CSV);
    expect(second.added).toBe(1);
    expect(second.duplicates).toBe(0);

    expect(await loadTransactions(db, 'ta')).toHaveLength(1);
    expect(await loadTransactions(db, 'tb')).toHaveLength(1);
    expect((await getProfile(db, 'ta'))!.regime).toBe('PAUSAL');
    expect((await getProfile(db, 'tb'))!.regime).toBe('ZAMESTNANEC');

    // smazání uživatele B odnese jen jeho data (FK kaskády)
    const { eq } = await import('drizzle-orm');
    await db.delete(user).where(eq(user.id, 'tb'));
    expect(await loadTransactions(db, 'ta')).toHaveLength(1);
    expect(await getProfile(db, 'tb')).toBeNull();
  });
});
