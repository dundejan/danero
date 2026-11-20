import ExcelJS from 'exceljs';

/**
 * Sešit „Export transakcí“ z portálu Moje Amundi a přehled pozic. Drží jen
 * ROZLOŽENÍ skutečných sešitů (nepřečtené výpisy z 20. 11. 2026): názvy listů,
 * hlavičky, všechny buňky jako text, desetinnou čárku, pevnou mezeru mezi
 * tisíci a před měnou a datum „dd. mm. rrrr“. Fondy, částky, ceny, kusy
 * i data jsou smyšlené.
 */
export const AMUNDI_ORDERS_SHEET = 'Transakce';
export const AMUNDI_TRADES_SHEET = 'Detail transakce';
export const AMUNDI_FILENAME = 'transactions-export.xlsx';

export const AMUNDI_ORDERS_HEADER = [
  'Datum přijetí',
  'Datum vypořádání',
  'Typ',
  'Produkt',
  'Hodnota pokynu',
  'Vstupní poplatek',
  'Hodnota investice',
  'Stav',
];

export const AMUNDI_TRADES_HEADER = [
  'Zobchodování',
  'Typ',
  'Fond',
  'ISIN',
  'Datum ceny',
  'Množství',
  'Cena',
  'Částka',
  'Měna',
];

const CZK_FUND = 'Vzorový akciový fond - A CZK (C)';
const USD_FUND = 'Vzorový globální fond USD AU (C)';
const CZK_ISIN = 'LU0000000018';
const USD_ISIN = 'LU0000000026';

/** Pokyny: částky s měnou v buňce, poplatek smí vyjít i záporný. */
export const AMUNDI_ORDER_ROWS: string[][] = [
  ['10. 03. 2025', '14. 03. 2025', 'Investice', CZK_FUND, '1\u00a0500,00\u00a0Kč', '14,25\u00a0Kč', '1\u00a0485,75\u00a0Kč', 'Dokončená'],
  ['10. 03. 2025', '17. 03. 2025', 'Investice', USD_FUND, '2\u00a0500,00\u00a0Kč', '-3,10\u00a0Kč', '86,40\u00a0$', 'Dokončená'],
  ['10. 02. 2025', '14. 02. 2025', 'Investice', CZK_FUND, '1\u00a0500,00\u00a0Kč', '14,25\u00a0Kč', '1\u00a0485,75\u00a0Kč', 'Dokončená'],
];

/**
 * Obchody: množství zaokrouhlené na tři místa. U prvního řádku je cena
 * v desítkách tisíc, takže zobrazené množství × cena se od částky liší
 * o desítky korun — právě proto se kusy dopočítávají z částky a ceny.
 */
export const AMUNDI_TRADE_ROWS: string[][] = [
  ['11. 03. 2025', 'Primární prodej', CZK_FUND, CZK_ISIN, '11. 03. 2025', '0,119', '12\u00a0500,00', '1\u00a0485,75', 'CZK'],
  ['12. 03. 2025', 'Primární prodej', USD_FUND, USD_ISIN, '12. 03. 2025', '0,36', '240,00', '86,40', 'USD'],
  ['11. 02. 2025', 'Primární prodej', CZK_FUND, CZK_ISIN, '11. 02. 2025', '0,121', '12\u00a0250,00', '1\u00a0485,75', 'CZK'],
];

export interface AmundiWorkbookSpec {
  orders?: string[][] | null;
  tradesHeader?: string[];
  trades?: Array<Array<string | number | Date>>;
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

export async function buildAmundiXlsx(spec: AmundiWorkbookSpec = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (spec.orders !== null) {
    const orders = workbook.addWorksheet(AMUNDI_ORDERS_SHEET);
    orders.addRow(AMUNDI_ORDERS_HEADER);
    for (const row of spec.orders ?? AMUNDI_ORDER_ROWS) orders.addRow(row);
  }
  const trades = workbook.addWorksheet(AMUNDI_TRADES_SHEET);
  trades.addRow(spec.tradesHeader ?? AMUNDI_TRADES_HEADER);
  for (const row of spec.trades ?? AMUNDI_TRADE_ROWS) trades.addRow(row);
  return toBuffer(workbook);
}

export const POSITIONS_FILENAME = '1234567801_account.xlsx';

/** Přehled pozic: list „data“, čísla jako čísla, poslední řádek je hotovost. */
export const POSITIONS_HEADER = [
  'Investiční nástroj',
  'ISIN',
  'Počet',
  'Cena',
  'Měna',
  'Směnný kurz',
  'Tržní hodnota',
  'Měna',
];

export async function buildPositionsStatementXlsx(
  header: string[] = POSITIONS_HEADER,
  extraSheet?: { name: string; rows: Array<Array<string | number>> },
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (extraSheet) {
    const extra = workbook.addWorksheet(extraSheet.name);
    for (const row of extraSheet.rows) extra.addRow(row);
  }
  const sheet = workbook.addWorksheet('data');
  sheet.addRow(header);
  sheet.addRow(['Vzorový dluhopisový fond A', 'CZ0000000013', 1500, 6.25, 'CZK', 1, 9375, 'CZK']);
  sheet.addRow(['Vzorový smíšený fond', 'CZ0000000021', 8000, 1.75, 'CZK', 1, 14000, 'CZK']);
  sheet.addRow(['CZK', '', 12.4, 1, 'CZK', 1, 12.4, 'CZK']);
  return toBuffer(workbook);
}

export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}
