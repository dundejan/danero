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

/**
 * B-3-3: dedupe klíč je jmenný prostor per broker, takže tentýž obchod zadaný
 * ručně přes univerzální šablonu (dokumentovaný postup) a později stažený
 * z brokera se uložil dvakrát — engine mlčel a rekonciliace pak nabídla „split
 * 6:1“, tedy pozvánku ke třetí chybě. Slučovat je ale nesmíme (dva účty mohou
 * mít týž obchod legitimně), takže se to hlásí.
 */
describe('shoda transakcí napříč brokery (B-3-3)', () => {
  it('týž obchod ručně a od brokera se uloží dvakrát, ale import to řekne', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { user } = await import('@/db/schema');
    const { importCsvText } = await import('@/lib/import-service');
    const { loadTransactions } = await import('@/lib/portfolio');

    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'ux', name: 'Kříž', email: 'kriz@danero.cz' });

    // 1) ručně přes univerzální šablonu
    const rucne = await importCsvText(
      db,
      'ux',
      'rucne.csv',
      'type,date,isin,quantity,price,currency\nBUY,2025-07-30,US05606L1008,5.8565544,15.61,USD',
    );
    expect(rucne.added).toBe(1);
    expect(rucne.crossBroker).toEqual([]);

    // 2) týž obchod později stažený z Trading212
    const zBrokera = await importCsvText(
      db,
      'ux',
      't212.csv',
      [
        'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
        'Market buy,2025-07-30 06:42:25,US05606L1008,BYDDY,BYD,5.8565544,15.61,USD,,,,,,,,,EOF-X1',
      ].join('\n'),
    );

    // uloží se obojí — slučovat cizí zdroje nesmíme
    expect(zBrokera.added).toBe(1);
    expect(await loadTransactions(db, 'ux')).toHaveLength(2);
    // ale uživatel se to musí dozvědět
    expect(zBrokera.crossBroker).toHaveLength(1);
    expect(zBrokera.crossBroker[0]).toContain('universal');
    expect(zBrokera.crossBroker[0]).toContain('1 transakce vypadá');
  });

  it('shodný vklad u dvou brokerů v jeden den se za duplicitu nevydává', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { user } = await import('@/db/schema');
    const { importCsvText } = await import('@/lib/import-service');

    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'uc', name: 'Cash', email: 'cash@danero.cz' });

    // hotovostní řádek nese jen typ, datum, částku a měnu — shoda náhodou je
    // u vkladů běžná a rada „smaž jednu dávku“ by brala poctivá data
    const vklad = 'type,date,currency,amount,note\nDEPOSIT,2025-03-01,CZK,5000,vklad';
    await importCsvText(db, 'uc', 'rucne.csv', vklad);
    const t212 = await importCsvText(
      db,
      'uc',
      't212.csv',
      [
        'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
        'Deposit,2025-03-01 09:00:00,,,,,,,,,,5000,CZK,,,,EOF-D1',
      ].join('\n'),
    );

    expect(t212.added).toBe(1);
    expect(t212.crossBroker).toEqual([]);
  });
});

/**
 * F-3-7: nahrání víc souborů jelo bez try/catch, takže poškozený druhý soubor
 * zabil celou akci — první zůstal uložený, třetí se nezpracoval a uživatel
 * dostal generický error boundary. Reprodukce z auditu skončila na
 * `{"zpracovanoPredPadem":1,"transakciVDb":1}`.
 */
describe('nahrání víc souborů: poškozený soubor nesmí sebrat ostatní (F-3-7)', () => {
  it('vadný soubor skončí jako dávka s chybou a zbytek se doimportuje', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { importBatches, user } = await import('@/db/schema');
    const { importFile, importFileIsolated } = await import('@/lib/import-service');
    const { loadTransactions } = await import('@/lib/portfolio');
    const { eq } = await import('drizzle-orm');

    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'uf', name: 'Files', email: 'files@danero.cz' });

    const radek = (isin: string) =>
      `type,date,isin,quantity,price,currency\nBUY,2025-01-10,${isin},1,100,USD`;
    // uříznutý sešit: hlavička zipu s položkou OOXML, ale bez konce archivu
    const zipHead = Buffer.alloc(30);
    zipHead.writeUInt32LE(0x04034b50, 0);
    zipHead.writeUInt16LE('[Content_Types].xml'.length, 26);
    const vadnyXlsx = Buffer.concat([
      zipHead,
      Buffer.from('[Content_Types].xml', 'utf8'),
      Buffer.alloc(40, 0x41),
    ]);
    const soubory: Array<[string, ArrayBuffer]> = [
      ['prvni.csv', new TextEncoder().encode(radek('US0378331005')).buffer as ArrayBuffer],
      ['vadny.xlsx', vadnyXlsx.buffer.slice(vadnyXlsx.byteOffset, vadnyXlsx.byteOffset + vadnyXlsx.byteLength) as ArrayBuffer],
      ['treti.csv', new TextEncoder().encode(radek('US5949181045')).buffer as ArrayBuffer],
    ];

    // Poškozený sešit dnes vrací dávku s konkrétní hláškou (od 12. 8. 2026 se
    // chyby XLSX odchytávají uvnitř importFile, aby uživatel nedostal generické
    // „soubor je poškozený“ místo rady). Izolace ale platí dál — kdyby cokoli
    // jiného vyhodilo výjimku, nesmí sebrat ostatní soubory dávky.
    await expect(importFile(db, 'uf', ...soubory[1]!)).resolves.toMatchObject({ added: 0 });

    for (const [filename, data] of soubory) {
      await importFileIsolated(db, 'uf', filename, data);
    }

    // třetí soubor se musí uložit i po selhání druhého
    expect(await loadTransactions(db, 'uf')).toHaveLength(2);

    const batches = await db.select().from(importBatches).where(eq(importBatches.userId, 'uf'));
    // 3 dávky z cyklu + 1 z přímého volání importFile výš
    expect(batches).toHaveLength(4);
    const vadny = batches.filter((b) => b.filename === 'vadny.xlsx');
    expect(vadny).toHaveLength(2);
    expect(vadny[0]!.added).toBe(0);
    expect(vadny[0]!.errorCount).toBe(1);
    // uživatel se v UI dozví, co s tím — ne generický error boundary
    const issues = vadny[0]!.issues as { errors?: Array<{ message: string }> };
    expect(issues.errors?.[0]?.message).toContain('XLSX');
  });
});

// B-10: XTB alias uložený bez měny se v loadAliases tiše zahazoval — přitom
// dividendám XTB stačí ISIN (jsou v měně účtu)
describe('číselník instrumentů (loadAliases)', () => {
  it('XTB alias bez měny se nezahodí — ISIN zůstane použitelný', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { instrumentAliases, user } = await import('@/db/schema');
    const { loadAliases } = await import('@/lib/instrument-aliases');

    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'al1', name: 'Alias', email: 'alias@danero.cz' });
    await db.insert(instrumentAliases).values([
      { userId: 'al1', broker: 'xtb', symbol: 'AAPL.US', isin: 'US0378331005', currency: 'USD' },
      // starší záznam bez měny (nebo import z doby před validací)
      { userId: 'al1', broker: 'xtb', symbol: 'MSFT.US', isin: 'US5949181045', currency: null },
      { userId: 'al1', broker: 'fio', symbol: 'CEZ', isin: 'CZ0005112300', currency: null },
    ]);

    const aliases = await loadAliases(db, 'al1');
    expect(aliases.xtb['AAPL.US']).toEqual({ isin: 'US0378331005', currency: 'USD' });
    expect(aliases.xtb['MSFT.US']).toEqual({ isin: 'US5949181045' });
    expect(aliases.isinOnly.fio['CEZ']).toEqual({ isin: 'CZ0005112300' });
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
