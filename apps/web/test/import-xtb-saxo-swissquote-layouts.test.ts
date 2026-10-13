/**
 * XTB, Saxo Bank a Swissquote (audit 13. 10. 2026) — cesta ručního nahrání.
 * Komentáře popisují vadu, kterou test hlídá; zdroje rozložení jsou
 * v `packages/importers/test/xtb-saxo-swissquote-real-layouts.test.ts`.
 * Tituly, částky i časy jsou smyšlené.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildSaxoXlsx,
  SAXO_HEADERS_UNKNOWN_LANG,
  type SaxoCellValue,
} from '../../../packages/importers/test/fixtures/saxo';
import { createPgliteDb, type Db } from '@/db';
import { failedImports, user } from '@/db/schema';
import { importFileIsolated } from '@/lib/import-service';

const toArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

/**
 * Hlavička exportu Transactions od března 2026 — doslova z dickwolff/
 * Export-To-Ghostfolio issue #319 (26. 3. 2026): „Amount“ je „Booked Amount“
 * a přibyly „From Derivative“ a „Underlying asset type“.
 */
const SAXO_HEADERS_EN_2026 = [
  'Client ID',
  'Trade Date',
  'Value Date',
  'Type',
  'Instrument',
  'Instrument ISIN',
  'Instrument currency',
  'Exchange Description',
  'Instrument Symbol',
  'Event',
  'Booked Amount',
  'Order ID',
  'Conversion Rate',
  'From Derivative',
  'Underlying asset type',
];

const SAXO_ROW_2026: SaxoCellValue[] = [
  '7654321', '20-Feb-2026', '24-Feb-2026', 'Trade', 'Vanguard FTSE All-World UCITS ETF', 'IE00BK5BQT80',
  'USD', 'London Stock Exchange (ETFs)', 'VWRA:xlon', 'Buy 40 @ 51.25 USD', -2053.5, 5300000001, 1, 'No', null,
];

/**
 * Německý výpis Swissquote se třinácti sloupci — nativní soubor z března 2026
 * (fórum Portfolio Performance, vlákno 38963): bez „Währung Nettobetrag“,
 * kódování ISO-8859-1, konce řádků CRLF, název titulu v uvozovkách.
 */
const SWISSQUOTE_DE_13 = [
  'Datum;Auftrag #;Transaktionen;Symbol;Name;ISIN;Anzahl;Stückpreis;Kosten;Aufgelaufene Zinsen;Nettobetrag;Saldo;Währung',
  '14-04-2025 10:12:40;990000001;Kauf;NDWD;"NORDWIND HOLDING";CH0000000001;8.0;52.30;6.40;0.00;-424.80;1310.20;CHF',
].join('\r\n');

describe('ruční nahrání dnešních exportů Saxo a Swissquote', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'audit-xss@example.com' });
  }, 60_000);

  it('Saxo: export se sloupcem „Booked Amount“ se pozná a naimportuje', { timeout: 30_000 }, async () => {
    const file = await buildSaxoXlsx({ headers: SAXO_HEADERS_EN_2026, rows: [SAXO_ROW_2026] });
    const summary = await importFileIsolated(db, 'u1', 'Transactions_7654321_2026-01-01_2026-03-31.xlsx', toArrayBuffer(file));

    expect(summary.broker).toBe('saxo');
    expect(summary.unrecognized).toBeFalsy();
    expect(summary.errors).toEqual([]);
    expect(summary.added).toBe(1);
  });

  /**
   * Záložní sniffer podle tvaru chce přesně třináct sloupců; dnešní export jich
   * má patnáct. Názvy dvou sloupců navíc jsou smyšlené, doložený je jen počet.
   */
  it('Saxo: patnáctisloupcový export v jazyce mimo slovník dostane radu přepnout jazyk, ne „XLSX nepoznáváme“', { timeout: 30_000 }, async () => {
    const file = await buildSaxoXlsx({
      headers: [...SAXO_HEADERS_UNKNOWN_LANG, 'Depuis dérivé', "Type d'actif sous-jacent"],
      rows: [
        ['', '11-mars-2026', '13-mars-2026', 'Transaction', 'Nordwind SA', 'FR0000000001', 'EUR', 'Euronext Paris',
          'NDWD:xpar', 'Achat 7 @ 61,40 EUR', -431.8, 5300000002, 1, 'Non', null],
      ],
    });
    const summary = await importFileIsolated(db, 'u1', 'Transactions_fr.xlsx', toArrayBuffer(file));

    expect(summary.broker).toBe('saxo');
    expect(summary.errors[0]?.message).toContain('angličtinu');
    expect(summary.errors[0]?.message).not.toContain('nepoznáváme');
    // náprava je na uživateli — soubor se neschovává k rozboru
    expect(summary.unrecognized).toBeFalsy();
  });

  it('Swissquote: německý výpis se třinácti sloupci (Latin-1, CRLF) se naimportuje', { timeout: 30_000 }, async () => {
    const before = (await db.select().from(failedImports)).length;
    const file = Buffer.from(SWISSQUOTE_DE_13, 'latin1');
    const summary = await importFileIsolated(db, 'u1', 'transactions-from-01012025-to-31122025.csv', toArrayBuffer(file));

    expect(summary.broker).toBe('swissquote');
    expect(summary.errors).toEqual([]);
    expect(summary.added).toBe(1);
    expect(await db.select().from(failedImports)).toHaveLength(before);
  });
});
