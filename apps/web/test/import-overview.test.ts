import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '@/db';
import { importBatches, transactions, user } from '@/db/schema';
import {
  batchHistoryHref,
  buildPlatformGroups,
  loadPlatformBatches,
  loadPlatformStats,
  nextPlatformLimit,
  PLATFORM_PAGE,
  platformRequest,
  platformStatus,
  rangeText,
  UNKNOWN_FORMAT_BROKER,
  UNKNOWN_GROUP_NAME,
  type ImportBatchRow,
  type PlatformAccount,
  type PlatformStats,
} from '@/lib/import-overview';

/**
 * Historie importů po platformách (`lib/import-overview.ts`): řádek na
 * platformu se stavem, obdobím a počtem transakcí, dávky až po rozbalení.
 * Denní synchronizace Trading 212 dřív zahrabaly ruční výpisy jiných
 * platforem pod desítky řádků „0 nových · N duplicit“.
 */

const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 1, 12);

function batch(overrides: Partial<ImportBatchRow> & Pick<ImportBatchRow, 'id'>): ImportBatchRow {
  return {
    userId: 'u1',
    broker: 'trading212',
    filename: 'vypis.csv',
    added: 0,
    duplicates: 0,
    errorCount: 0,
    skippedCount: 0,
    warningCount: 0,
    issues: {},
    createdAt: new Date(START),
    ...overrides,
  };
}

function stats(overrides: Partial<PlatformStats> & Pick<PlatformStats, 'broker'>): PlatformStats {
  return {
    batchCount: 1,
    lastImportAt: new Date(START),
    txCount: 0,
    firstTxDate: null,
    lastTxDate: null,
    ...overrides,
  };
}

const account = (overrides: Partial<PlatformAccount> = {}): PlatformAccount => ({
  broker: 'trading212',
  lastSyncedAt: null,
  lastSyncError: null,
  createdAt: new Date(START),
  ...overrides,
});

describe('parametry adresy: platforma a délka jejího seznamu', () => {
  it('bez platformy nic nechce', () => {
    expect(platformRequest({})).toBeNull();
    // starý odkaz plochého seznamu (`?historie=40`) nic neotevře
    expect(platformRequest({ historie: '40' })).toBeNull();
  });

  it('platforma bez délky ukáže první stránku, s délkou tolik, kolik chce', () => {
    expect(platformRequest({ platforma: 'xtb' })).toEqual({
      key: 'xtb',
      broker: 'xtb',
      limit: PLATFORM_PAGE,
    });
    expect(platformRequest({ platforma: 'trading212', historie: '240' })?.limit).toBe(240);
    // míň než stránka se nezkracuje
    expect(platformRequest({ platforma: 'xtb', historie: '3' })?.limit).toBe(PLATFORM_PAGE);
  });

  it('nepoznané soubory mají v adrese vlastní klíč bez mezery a diakritiky', () => {
    expect(platformRequest({ platforma: 'nepoznane' })?.broker).toBe(UNKNOWN_FORMAT_BROKER);
  });

  it('cizí text z adresy se zahodí', () => {
    for (const value of [
      'neznámý formát',
      '../import',
      'XTB',
      '<script>',
      'a'.repeat(41),
      '',
      '-xtb',
    ]) {
      expect(platformRequest({ platforma: value })).toBeNull();
    }
    for (const value of ['abc', '1e3', '-5', '12345678', '']) {
      expect(platformRequest({ platforma: 'xtb', historie: value })?.limit).toBe(PLATFORM_PAGE);
    }
    // opakovaný parametr: platí první hodnota
    expect(platformRequest({ platforma: ['xtb', 'degiro'], historie: ['30', '90'] })).toEqual({
      key: 'xtb',
      broker: 'xtb',
      limit: 30,
    });
  });

  it('krok roste po deseti do stovky, pak po stovce — a adresa ho vždy přijme', () => {
    expect(nextPlatformLimit(10)).toBe(20);
    expect(nextPlatformLimit(90)).toBe(100);
    expect(nextPlatformLimit(100)).toBe(200);
    // přechod přes řád (šest číslic → sedm) nesmí spadnout zpátky na první stránku
    const far = nextPlatformLimit(999_900);
    expect(far).toBe(1_000_000);
    expect(platformRequest({ platforma: 'xtb', historie: String(far) })?.limit).toBe(far);
  });
});

describe('stav platformy', () => {
  const latest = { filename: 'xtb-2025.xlsx', createdAt: new Date('2026-11-03T10:00:00Z') };

  it('napojená a synchronizovaná: zeleně, s datem poslední synchronizace', () => {
    expect(
      platformStatus(account({ lastSyncedAt: new Date('2026-11-10T05:00:00Z') }), latest),
    ).toEqual({ tone: 'success', text: 'Synchronizuje se automaticky', when: 'naposledy 10. 11. 2026' });
  });

  it('poslední synchronizace selhala: stejný tón jako na kartě účtu', () => {
    expect(
      platformStatus(
        account({ lastSyncedAt: new Date('2026-11-01T05:00:00Z'), lastSyncError: 'Klíč neplatí.' }),
        latest,
      ),
    ).toEqual({ tone: 'danger', text: 'Poslední synchronizace selhala' });
  });

  it('napojená, ale ještě nestažená', () => {
    expect(platformStatus(account(), undefined)).toEqual({
      tone: 'neutral',
      text: 'Připojeno, zbývá stáhnout historii',
    });
  });

  it('ruční výpisy: neutrálně, s datem posledního nahrání', () => {
    expect(platformStatus(undefined, latest)).toEqual({
      tone: 'neutral',
      text: 'Ruční výpisy',
      when: 'naposledy 3. 11. 2026',
    });
  });

  it('bez napojení, ale poslední dávka je ze synchronizace: účet byl odpojený', () => {
    expect(
      platformStatus(undefined, { filename: 't212-api-2026.csv', createdAt: latest.createdAt })
        ?.text,
    ).toBe('Odpojeno');
  });
});

describe('rozsah dat', () => {
  it('období a počet transakcí', () => {
    expect(rangeText({ txCount: 312, firstTxDate: '2024-01-03', lastTxDate: '2026-11-07' })).toBe(
      'Transakce od 3. 1. 2024 do 7. 11. 2026 · 312 transakcí',
    );
    expect(rangeText({ txCount: 2, firstTxDate: '2024-01-03', lastTxDate: '2024-01-04' })).toBe(
      'Transakce od 3. 1. 2024 do 4. 1. 2024 · 2 transakce',
    );
  });

  it('jediný den a žádné transakce', () => {
    expect(rangeText({ txCount: 1, firstTxDate: '2025-06-30', lastTxDate: '2025-06-30' })).toBe(
      'Transakce z 30. 6. 2025 · 1 transakce',
    );
    expect(rangeText({ txCount: 0, firstTxDate: null, lastTxDate: null })).toBe(
      'Zatím žádné transakce',
    );
  });
});

describe('seskupení dávek', () => {
  const base = {
    accounts: [] as PlatformAccount[],
    request: null,
    highlighted: new Set<string>(),
  };

  it('nejnovější import nahoře, nepoznané soubory vždy poslední', () => {
    const groups = buildPlatformGroups({
      ...base,
      stats: [
        stats({ broker: 'xtb', lastImportAt: new Date(START + 2 * DAY) }),
        stats({ broker: UNKNOWN_FORMAT_BROKER, lastImportAt: new Date(START + 9 * DAY) }),
        stats({ broker: 'trading212', lastImportAt: new Date(START + 5 * DAY) }),
      ],
      batches: [
        batch({ id: 'x', broker: 'xtb', createdAt: new Date(START + 2 * DAY) }),
        batch({ id: 'n', broker: UNKNOWN_FORMAT_BROKER, createdAt: new Date(START + 9 * DAY) }),
        batch({ id: 't', broker: 'trading212', createdAt: new Date(START + 5 * DAY) }),
      ],
    });
    expect(groups.map((group) => group.name)).toEqual(['Trading 212', 'XTB', UNKNOWN_GROUP_NAME]);
    const unknown = groups.at(-1)!;
    expect(unknown.key).toBe('nepoznane');
    expect(unknown.status).toBeNull();
    expect(unknown.summary).toBe('1 soubor');
    // víc skupin: žádná se sama neotevře
    expect(groups.every((group) => !group.open)).toBe(true);
  });

  it('jediná platforma je otevřená', () => {
    const [only] = buildPlatformGroups({
      ...base,
      stats: [stats({ broker: 'xtb' })],
      batches: [batch({ id: 'x', broker: 'xtb' })],
    });
    expect(only!.open).toBe(true);
  });

  it('skupina s právě nahranou dávkou se otevře a nese signál k otevření', () => {
    const groups = buildPlatformGroups({
      ...base,
      highlighted: new Set(['x2']),
      stats: [stats({ broker: 'xtb', batchCount: 2 }), stats({ broker: 'degiro' })],
      batches: [
        batch({ id: 'x1', broker: 'xtb' }),
        batch({ id: 'x2', broker: 'xtb', createdAt: new Date(START + DAY) }),
        batch({ id: 'd', broker: 'degiro' }),
      ],
    });
    const xtb = groups.find((group) => group.broker === 'xtb')!;
    const degiro = groups.find((group) => group.broker === 'degiro')!;
    expect(xtb.open).toBe(true);
    expect(xtb.openSignal).toBe('x2');
    expect(degiro.open).toBe(false);
    expect(degiro.openSignal).toBe('');
    // dávky od nejnovější
    expect(xtb.batches.map((item) => item.id)).toEqual(['x2', 'x1']);
  });

  it('stránkování po platformách: první stránka, odkaz na starší a platforma z adresy', () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      batch({ id: `t${index}`, createdAt: new Date(START + index * DAY) }),
    );
    const stat = [stats({ broker: 'trading212', batchCount: 25 }), stats({ broker: 'xtb' })];
    const xtbBatch = batch({ id: 'x', broker: 'xtb' });

    const first = buildPlatformGroups({ ...base, stats: stat, batches: [...many, xtbBatch] });
    const t212 = first.find((group) => group.broker === 'trading212')!;
    expect(t212.batches).toHaveLength(PLATFORM_PAGE);
    expect(t212.batches[0]!.id).toBe('t24');
    expect(t212.olderHref).toBe('/import?platforma=trading212&historie=20#starsi-trading212');
    expect(first.find((group) => group.broker === 'xtb')!.olderHref).toBeUndefined();

    const longer = buildPlatformGroups({
      ...base,
      stats: stat,
      batches: [...many, xtbBatch],
      request: { key: 'trading212', broker: 'trading212', limit: 30 },
    });
    const opened = longer.find((group) => group.broker === 'trading212')!;
    expect(opened.batches).toHaveLength(25);
    expect(opened.olderHref).toBeUndefined();
    // po „Zobrazit starší“ zůstane skupina otevřená, ostatní ne
    expect(opened.open).toBe(true);
    expect(longer.find((group) => group.broker === 'xtb')!.open).toBe(false);
  });

  it('platforma z adresy, kterou uživatel nemá, nic neotevře ani nepřidá', () => {
    const groups = buildPlatformGroups({
      ...base,
      stats: [stats({ broker: 'xtb' }), stats({ broker: 'degiro' })],
      batches: [batch({ id: 'x', broker: 'xtb' }), batch({ id: 'd', broker: 'degiro' })],
      request: { key: 'ibkr', broker: 'ibkr', limit: 500 },
    });
    expect(groups.map((group) => group.broker).sort()).toEqual(['degiro', 'xtb']);
    expect(groups.every((group) => !group.open)).toBe(true);
  });

  it('napojený účet bez dávek má řádek se stavem a bez rozbalení', () => {
    const groups = buildPlatformGroups({
      ...base,
      accounts: [account({ broker: 'ibkr', createdAt: new Date(START + 3 * DAY) })],
      stats: [stats({ broker: 'xtb', lastImportAt: new Date(START + DAY) })],
      batches: [batch({ id: 'x', broker: 'xtb', createdAt: new Date(START + DAY) })],
    });
    // připojený později než poslední import XTB → nahoře
    expect(groups.map((group) => group.broker)).toEqual(['ibkr', 'xtb']);
    const ibkr = groups[0]!;
    expect(ibkr.name).toBe('Interactive Brokers');
    expect(ibkr.batches).toEqual([]);
    expect(ibkr.open).toBe(false);
    expect(ibkr.status?.text).toBe('Připojeno, zbývá stáhnout historii');
    expect(ibkr.summary).toBe('Zatím žádné transakce');
  });

  it('stav napojené platformy jde z účtu, i když má i ruční výpisy', () => {
    const [t212] = buildPlatformGroups({
      ...base,
      accounts: [account({ lastSyncedAt: new Date('2026-11-10T05:00:00Z') })],
      stats: [stats({ broker: 'trading212', txCount: 3, firstTxDate: '2025-01-02', lastTxDate: '2026-11-07' })],
      batches: [batch({ id: 't', filename: 'rucni.csv' })],
    });
    expect(t212!.status).toEqual({
      tone: 'success',
      text: 'Synchronizuje se automaticky',
      when: 'naposledy 10. 11. 2026',
    });
    expect(t212!.summary).toBe('Transakce od 2. 1. 2025 do 7. 11. 2026 · 3 transakce');
  });
});

describe('souhrny a dávky z databáze', () => {
  let db: Db;

  async function insertBatches(rows: ImportBatchRow[]): Promise<void> {
    await db.insert(importBatches).values(rows);
  }

  async function insertTransactions(
    userId: string,
    batchId: string,
    broker: string,
    dates: string[],
  ): Promise<void> {
    await db.insert(transactions).values(
      dates.map((txDate, index) => ({
        userId,
        dedupeKey: `${batchId}|${index}`,
        batchId,
        broker,
        type: 'BUY',
        txDate,
        payload: {},
      })),
    );
  }

  beforeEach(async () => {
    const { createPgliteDb } = await import('@/db');
    db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'u1', name: 'Jan', email: 'u1@danero.cz' },
      { id: 'u2', name: 'Cizí', email: 'u2@danero.cz' },
    ]);
  }, 30_000);

  it(
    'souhrn počítá období a počet přes všechny dávky platformy — a jen uživatele',
    { timeout: 30_000 },
    async () => {
      await insertBatches([
        batch({ id: 'a1', broker: 'xtb', createdAt: new Date(START) }),
        batch({ id: 'a2', broker: 'xtb', createdAt: new Date(START + DAY) }),
        batch({ id: 'a3', broker: 'universal', createdAt: new Date(START + 2 * DAY) }),
        // cizí uživatel na téže platformě
        batch({ id: 'b1', userId: 'u2', broker: 'xtb', createdAt: new Date(START + 5 * DAY) }),
      ]);
      await insertTransactions('u1', 'a1', 'xtb', ['2024-03-01', '2024-05-10']);
      await insertTransactions('u1', 'a2', 'xtb', ['2025-12-30']);
      // šablona zapisuje transakce s kódem cizí platformy — počítají se k šabloně
      await insertTransactions('u1', 'a3', 'degiro', ['2023-01-02']);
      await insertTransactions('u2', 'b1', 'xtb', ['2020-01-01', '2026-11-09']);

      const result = await loadPlatformStats(db, 'u1');
      const byBroker = new Map(result.map((item) => [item.broker, item]));
      expect([...byBroker.keys()].sort()).toEqual(['universal', 'xtb']);
      expect(byBroker.get('xtb')).toEqual({
        broker: 'xtb',
        batchCount: 2,
        lastImportAt: new Date(START + DAY),
        txCount: 3,
        firstTxDate: '2024-03-01',
        lastTxDate: '2025-12-30',
      });
      expect(byBroker.get('universal')).toMatchObject({
        batchCount: 1,
        txCount: 1,
        firstTxDate: '2023-01-02',
      });

      const foreign = await loadPlatformStats(db, 'u2');
      expect(foreign).toEqual([
        expect.objectContaining({ broker: 'xtb', batchCount: 1, txCount: 2 }),
      ]);
    },
  );

  it('platforma bez transakcí (jen duplicity) má souhrn s nulou', { timeout: 30_000 }, async () => {
    await insertBatches([batch({ id: 'a1', broker: 'revolut', duplicates: 5 })]);
    const [only] = await loadPlatformStats(db, 'u1');
    expect(only).toMatchObject({ broker: 'revolut', txCount: 0, firstTxDate: null, lastTxDate: null });
  });

  it(
    'ruční výpis starší než dvě stě denních synchronizací má vlastní skupinu se svými dávkami',
    { timeout: 30_000 },
    async () => {
      const syncs = Array.from({ length: 230 }, (_, index) =>
        batch({
          id: `s${String(index).padStart(3, '0')}`,
          filename: 't212-api-2026.csv',
          duplicates: 40,
          createdAt: new Date(START + (index + 1) * DAY),
        }),
      );
      await insertBatches([
        batch({ id: 'old', broker: 'xtb', filename: 'xtb-2024.xlsx', added: 2, createdAt: new Date(START) }),
        ...syncs,
        batch({ id: 'foreign', userId: 'u2', broker: 'xtb', createdAt: new Date(START + 500 * DAY) }),
      ]);
      await insertTransactions('u1', 'old', 'xtb', ['2024-02-01', '2024-09-15']);

      const [platformStats, batches] = await Promise.all([
        loadPlatformStats(db, 'u1'),
        loadPlatformBatches(db, 'u1', null),
      ]);
      // první stránka každé platformy, cizí dávka nikde
      expect(batches.map((item) => item.id)).not.toContain('foreign');
      expect(batches.filter((item) => item.broker === 'trading212')).toHaveLength(PLATFORM_PAGE);
      expect(batches.map((item) => item.id)).toContain('old');

      const groups = buildPlatformGroups({
        stats: platformStats,
        batches,
        accounts: [],
        request: null,
        highlighted: new Set(),
      });
      expect(groups.map((group) => group.name)).toEqual(['Trading 212', 'XTB']);
      const xtb = groups[1]!;
      expect(xtb.batches.map((item) => item.id)).toEqual(['old']);
      expect(xtb.summary).toBe('Transakce od 1. 2. 2024 do 15. 9. 2024 · 2 transakce');
      expect(xtb.status?.text).toBe('Ruční výpisy');
      const t212 = groups[0]!;
      expect(t212.batches[0]!.id).toBe('s229');
      expect(t212.olderHref).toBe('/import?platforma=trading212&historie=20#starsi-trading212');
      // bez napojeného účtu je poslední dávka ze synchronizace = odpojeno
      expect(t212.status?.text).toBe('Odpojeno');
    },
  );

  it('platforma z adresy načte víc dávek až k té nejstarší', { timeout: 30_000 }, async () => {
    await insertBatches(
      Array.from({ length: 35 }, (_, index) =>
        batch({ id: `t${String(index).padStart(2, '0')}`, createdAt: new Date(START + index * DAY) }),
      ),
    );
    await insertBatches([batch({ id: 'x', broker: 'xtb' })]);
    const request = platformRequest({ platforma: 'trading212', historie: '40' });
    const batches = await loadPlatformBatches(db, 'u1', request);
    const t212 = batches.filter((item) => item.broker === 'trading212');
    expect(t212).toHaveLength(35);
    expect(t212.at(-1)!.id).toBe('t00');
    // ostatní platformy dál jen první stránku (tady jedinou dávku)
    expect(batches.filter((item) => item.broker === 'xtb')).toHaveLength(1);
    // pořadí od nejnovější
    expect(batches[0]!.id).toBe('t34');

    // délka z adresy platí jen pro svou platformu
    const other = await loadPlatformBatches(
      db,
      'u1',
      platformRequest({ platforma: 'xtb', historie: '40' }),
    );
    expect(other.filter((item) => item.broker === 'trading212')).toHaveLength(PLATFORM_PAGE);
  });

  it(
    'odkaz na import za první stránkou platformy ji prodlouží právě po něj',
    { timeout: 30_000 },
    async () => {
      // Hláška číselníku („nejdřív vrať zpět import…“) dřív u takového importu
      // ukázala jen název souboru — denní synchronizace ho odsunula za první
      // stránku a uživatel neměl jak poznat, kde ho hledat.
      await insertBatches(
        Array.from({ length: 25 }, (_, index) =>
          batch({ id: `t${String(index).padStart(2, '0')}`, createdAt: new Date(START + index * DAY) }),
        ),
      );
      await insertBatches([batch({ id: 'cizi', userId: 'u2', createdAt: new Date(START) })]);
      const shown = new Set(['t24']);
      expect(await batchHistoryHref(db, 'u1', 't24', shown)).toBe('#import-t24');
      // t03 je od nejnovější 22. — seznam se prodlouží na 22 a OpenOnHash ho otevře
      const href = await batchHistoryHref(db, 'u1', 't03', shown);
      expect(href).toBe('/import?platforma=trading212&historie=22#import-t03');
      // a stránka s touhle adresou ten import opravdu načte
      const loaded = await loadPlatformBatches(
        db,
        'u1',
        platformRequest({ platforma: 'trading212', historie: '22' }),
      );
      expect(loaded.map((item) => item.id)).toContain('t03');
      // cizí dávka nedostane odkaz (tenancy)
      expect(await batchHistoryHref(db, 'u1', 'cizi', shown)).toBeNull();
    },
  );
});
