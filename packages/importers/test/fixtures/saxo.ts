/**
 * Fixture Saxo Bank „Transactions" XLSX — binárka se do repa necommituje,
 * workbook se staví za běhu testu přes exceljs (vzor fixtures/xtb.ts).
 *
 * Struktura kopíruje reálný export: jeden list (název lokalizovaný),
 * hlavička na prvním řádku, 13 sloupců. Hlavičky EN a DA doslova podle
 * doložených exportů; číselné buňky záměrně mix nativních number a stringů
 * s desetinnou čárkou (parser musí umět obojí).
 */
import ExcelJS from 'exceljs';

export type SaxoCellValue = string | number | Date | null;

export const SAXO_SHEET_EN = 'Transactions';
export const SAXO_SHEET_DA = 'Transaktioner';

export const SAXO_HEADERS_EN = [
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
  'Amount',
  'Order ID',
  'Conversion Rate',
];

export const SAXO_HEADERS_DA = [
  'Kunde-id',
  'Handelsdato',
  'Valørdato',
  'Type',
  'Instrument',
  'Instrumentets ISIN',
  'Instrumentvaluta',
  'Børsbeskrivelse',
  'Instrumentsymbol',
  'Arrangement',
  'Antal/Beløb',
  'Ordre ID',
  'Omregningssats',
];

/**
 * Happy-path řádky EN exportu (první tři doslova z doloženého vzorku).
 * Buy NVDA: |−405.55| − 3×134.85 = 1.00 → fee 1.00 USD;
 * Sell VWRA: 3×139.74 − 419.22 = 0 → bez poplatku;
 * GBX obchod: pence → GBP, cena/100, fee (7010−10×700.5)/100 = 0.05 GBP;
 * frakční nákup se stringy s desetinnou čárkou → 1.5 ks, fee 0.
 */
export const SAXO_ROWS_EN: SaxoCellValue[][] = [
  ['', '02-Jan-2025', '02-Jan-2025', 'Trade', 'Vanguard FTSE All-World UCITS ETF', 'IE00BK5BQT80', 'USD', 'London Stock Exchange (ETFs)', 'VWRA:xlon', 'Sell 3 @ 139.74 USD', 419.22, '', 1],
  ['', '30-Dec-2024', '31-Dec-2024', 'Trade', 'NVIDIA Corp.', 'US67066G1040', 'USD', 'NASDAQ', 'NVDA:xnas', 'Buy 3 @ 134.85 USD', -405.55, '', 1],
  ['', '02-Apr-2025', '02-Apr-2025', 'Corporate action', 'Vanguard FTSE All-World UCITS ETF', 'IE00B3RBWM25', 'EUR', 'Euronext Amsterdam', 'VWRL:xams', 'Dividend', 1.83, '', 0.92139706],
  ['', '02-Jan-2025', '02-Jan-2025', 'Cash amount', '', '', 'USD', '', '', 'Custody Fee', -3.91, '', 1],
  ['', '30-Dec-2024', '30-Dec-2024', 'Cash Transfer', '', '', 'USD', 'Unknown', '', 'Deposit', 500, '', 1],
  ['', '15-May-2025', '16-May-2025', 'Trade', 'HSBC Holdings plc', 'GB0005405286', 'GBX', 'London Stock Exchange', 'HSBA:xlon', 'Buy 10 @ 700.5 GBX', -7010, '', 0.011],
  ['', '03-Feb-2025', '04-Feb-2025', 'Trade', 'Vanguard FTSE All-World UCITS ETF', 'IE00BK5BQT80', 'USD', 'London Stock Exchange (ETFs)', 'VWRA:xlon', 'Buy 1,5 @ 100,00 USD', '-150,00', '', 1],
  ['', '30-Apr-2025', '30-Apr-2025', 'Cash amount', '', '', 'USD', '', '', 'Interest', 1.23, '', 1],
  ['', '02-Apr-2025', '02-Apr-2025', 'Corporate action', 'Vanguard FTSE All-World UCITS ETF', 'IE00B3RBWM25', 'EUR', 'Euronext Amsterdam', 'VWRL:xams', 'Dividend reinvestment', -1.83, '', 0.92139706],
];

/**
 * DA export: lokalizované měsíce (maj/okt), slovesa Købt/Salg, desetinné čárky,
 * Kontantoverførsel + Indbetaling → skipped.
 * Købt: 1540,50 − 2,5×615,20 = 2.50 → fee 2.50 DKK; Salg: 700 − 699 = 1 DKK.
 */
export const SAXO_ROWS_DA: SaxoCellValue[][] = [
  ['', '14-maj-2025', '15-maj-2025', 'Handel', 'Novo Nordisk B A/S', 'DK0062498333', 'DKK', 'København', 'NOVOB:xcse', 'Købt 2,5 @ 615,20 DKK', '-1540,50', '', 1],
  ['', '10-okt-2025', '11-okt-2025', 'Handel', 'Novo Nordisk B A/S', 'DK0062498333', 'DKK', 'København', 'NOVOB:xcse', 'Salg 1 @ 700 DKK', 699, '', 1],
  ['', '02-jan-2025', '02-jan-2025', 'Kontantoverførsel', '', '', 'DKK', '', '', 'Indbetaling', 10000, '', 1],
];

/** Hlavička v nepodporovaném jazyce (FR) — parser musí vrátit error, sniff false. */
export const SAXO_HEADERS_UNKNOWN_LANG = [
  'ID client',
  'Date de transaction',
  'Date de valeur',
  'Type',
  'Instrument',
  'ISIN instrument',
  'Devise instrument',
  'Description bourse',
  'Symbole instrument',
  'Événement',
  'Montant',
  'ID ordre',
  'Taux de conversion',
];

export interface SaxoWorkbookSpec {
  sheetName?: string;
  /** null = list úplně bez hlavičky (test prázdného listu). */
  headers?: string[] | null;
  rows?: SaxoCellValue[][];
}

/** Postaví XLSX buffer: hlavička na prvním řádku → datové řádky. */
export async function buildSaxoXlsx(spec: SaxoWorkbookSpec = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName ?? SAXO_SHEET_EN);
  if (spec.headers !== null) sheet.addRow(spec.headers ?? SAXO_HEADERS_EN);
  for (const row of spec.rows ?? []) sheet.addRow(row);
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

/** Workbook v paměti (pro sniff, který bere ExcelJS.Workbook, ne buffer). */
export async function buildSaxoWorkbook(spec: SaxoWorkbookSpec = {}): Promise<ExcelJS.Workbook> {
  const buffer = await buildSaxoXlsx(spec);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** Cizí XLSX (formát à la XTB) — sniff musí vrátit false. */
export async function buildForeignWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CASH OPERATION HISTORY');
  sheet.addRow(['ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount']);
  sheet.addRow([1, 'Deposit', '02.01.2025 10:00:00', 'Bank transfer', null, 1000]);
  return workbook;
}
