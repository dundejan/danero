/**
 * Fixture XTB xStation „Full report“ XLSX — binárka se do repa necommituje,
 * workbook se staví za běhu testu přes exceljs (stejná knihovna jako parser,
 * ale opačný směr: write místo load).
 *
 * Struktura kopíruje reálný report: preambule s metadaty (vč. měny účtu),
 * tabulka CASH OPERATION HISTORY začíná hlavičkou až pod ní.
 */
import ExcelJS from 'exceljs';

export type XtbCellValue = string | number | Date | null;

export const XTB_SHEET_EN = 'CASH OPERATION HISTORY';
export const XTB_SHEET_CZ = 'HISTORIE PENĚŽNÍCH OPERACÍ';

export const XTB_HEADERS_EN = ['ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount'];
export const XTB_HEADERS_CZ = ['ID', 'Typ', 'Čas', 'Komentář', 'Symbol', 'Částka'];

/** Metadata nad tabulkou — hlavička tabulky NENÍ na prvním řádku (jako v reálu). */
export const XTB_PREAMBLE_EN: XtbCellValue[][] = [
  ['XTB S.A. — Full report'],
  ['Account currency', 'EUR'],
  [],
];

export const XTB_PREAMBLE_CZ: XtbCellValue[][] = [
  ['XTB S.A. — Kompletní report'],
  ['Měna účtu', 'CZK'],
  [],
];

/** Mapování symbolů na ISIN a měnu instrumentu (XTB je neexportuje). */
export const XTB_INSTRUMENT_MAP = {
  'AAPL.US': { isin: 'US0378331005', currency: 'USD' },
  'IWDA.UK': { isin: 'IE00B4L5Y983', currency: 'USD' },
};

/**
 * Happy-path řádky EN reportu. Amount = dopad na hotovost v měně ÚČTU (EUR);
 * kusy a cena instrumentu jsou v Comment za „@“. Záměrně mix formátů:
 * čísla jako number, datumy DD.MM.YYYY, ISO string i JS Date.
 */
export const XTB_ROWS_EN: XtbCellValue[][] = [
  [100001, 'Stocks/ETF purchase', '02.01.2025 14:30:15', 'OPEN BUY 5 @ 458.65', 'AAPL.US', -2293.25],
  [100002, 'Stocks/ETF sale', '10.03.2025 10:00:00', 'CLOSE BUY 5/10 @ 460.00', 'AAPL.US', 2300],
  [100003, 'Dividend', '15.04.2025 08:00:00', 'AAPL.US USD 0.25/ SHR', 'AAPL.US', 1.19],
  [100004, 'Withholding tax', '15.04.2025 08:00:00', 'AAPL.US USD 15%', 'AAPL.US', -0.18],
  [100005, 'Free funds interest', new Date(Date.UTC(2025, 3, 30)), 'Interest 04/2025', null, 0.42],
  [100006, 'Free funds interest tax', new Date(Date.UTC(2025, 3, 30)), 'Interest tax 04/2025', null, -0.08],
  [100007, 'Deposit', '01.01.2025 09:00:00', 'PayU deposit', null, 10000],
  [100008, 'Withdrawal', '2025-06-01 09:00:00', 'Withdrawal to bank account', null, -500],
  [100009, 'Commission', '02.01.2025 14:30:15', 'Order commission AAPL.US', 'AAPL.US', -1.5],
];

/** CZ varianta reportu (lokalizované typy operací i hlavičky, účet v CZK). */
export const XTB_ROWS_CZ: XtbCellValue[][] = [
  [200001, 'Nákup akcií/ETF', '05.02.2025 11:00:00', 'OPEN BUY 10 @ 92.10', 'IWDA.UK', -921],
  [200002, 'Prodej akcií/ETF', '10.06.2025 09:30:00', 'CLOSE BUY 4/10 @ 95.00', 'IWDA.UK', 380],
  [200003, 'Dividenda', '20.05.2025 08:00:00', 'IWDA.UK dividenda', 'IWDA.UK', 3.2],
  [200004, 'Srážková daň', '20.05.2025 08:00:00', 'IWDA.UK 15%', 'IWDA.UK', -0.48],
  [200005, 'Úroky z volných prostředků', '30.06.2025 00:00:00', 'Úroky 06/2025', null, 1.1],
  [200006, 'Vklad', '02.01.2025 08:00:00', 'Bankovní převod', null, 25000],
  [200007, 'Výběr', '30.06.2025 12:00:00', 'Výběr na účet', null, -1000],
];

/*
 * ── Nový report z tlačítka „Export (new)“ ────────────────────────────────────
 *
 * Z reálného reportu je opsané jen ROZLOŽENÍ (listy, preambule, hlavičky,
 * tvar komentářů). Účet, tituly, částky, kusy i časy jsou vymyšlené — repozitář
 * je veřejný a cizí výpis do něj nepatří ani zčásti (CONTRIBUTING.md).
 *
 * Tři listy, každý začíná stejnou preambulí; měna účtu je JEN v souhrnu na
 * listu otevřených pozic a časy jsou opravdové excelové datumy, ne text.
 */
export const XTB_NEW_SHEET_CLOSED = 'Closed Positions';
export const XTB_NEW_SHEET_CASH = 'Cash Operations';
export const XTB_NEW_SHEET_OPEN = 'Open Positions';

/** Název, jaký reportu dává XTB: měna účtu, číslo účtu, období. */
export const XTB_NEW_FILENAME = 'CZK_1234567_2025-01-01_2025-12-31.xlsx';
const XTB_NEW_ACCOUNT = 1234567;

export const XTB_NEW_CASH_HEADERS = [
  'Type',
  'Instrument',
  'Ticker',
  'Category',
  'Time',
  'Amount',
  'ID',
  'Comment',
  'Product',
  'Position ID',
];

export const XTB_NEW_CLOSED_HEADERS = [
  'Instrument',
  'Ticker',
  'Category',
  'Type',
  'Volume',
  'Open Price',
  'Open Time (UTC)',
  'Close Price',
  'Close Time (UTC)',
  'Product',
  'Profit/Loss',
  'Gross Profit',
  'Purchase Value',
  'Sale Value',
  'Stop Loss',
  'Take Profit',
  'Commission',
  'Margin',
  'Swap',
  'Rollover',
  'Open Conversion Rate',
  'Close Conversion Rate',
  'Close Origin',
  'Position ID',
  'Comment',
];

const utc = (year: number, month: number, day: number, hour = 12, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

/** Peněžní operace účtu v CZK; Amount je dopad na hotovost v měně účtu. */
export const XTB_NEW_CASH_ROWS: XtbCellValue[][] = [
  ['Free funds interest', null, null, null, utc(2025, 7, 2, 6, 10), 3.4, 700009, 'Free-funds Interest 2025-06', 'My Trades', null],
  ['SEC fee', 'Apple', 'AAPL.US', 'STOCK', utc(2025, 6, 13, 9, 5), -0.35, 700008, 'Sec Fee adj AAPL.US 20250612', 'My Trades', 4001],
  ['Withdrawal', null, null, null, utc(2025, 6, 12, 17, 2), -5000, 700007, 'Withdrawal from 1234567', 'My Trades', null],
  ['Stock sell', 'Apple', 'AAPL.US', 'STOCK', utc(2025, 6, 12, 17, 0), 17500.4, 700006, 'CLOSE BUY 4/10 @ 201.50', 'My Trades', 4001],
  ['Withholding tax', 'Apple', 'AAPL.US', 'STOCK', utc(2025, 5, 15, 7, 30), -1.5, 700005, 'AAPL.US USD WHT 15%', 'My Trades', 4001],
  ['Dividend', 'Apple', 'AAPL.US', 'STOCK', utc(2025, 5, 15, 7, 30), 10, 700004, 'AAPL.US USD 0.2600/ SHR', 'My Trades', 4001],
  ['Stock purchase', 'Apple', 'AAPL.US', 'STOCK', utc(2025, 3, 4, 15, 45), -41250, 700003, 'OPEN BUY 10 @ 180.25', 'My Trades', 4001],
  ['Deposit', null, null, null, utc(2025, 3, 3, 9, 0), 60000, 700002, 'Deposit', 'My Trades', null],
];

/** Součet pod tabulkou — nemá čas ani ID a nesmí skončit jako chyba. */
export const XTB_NEW_CASH_TOTAL: XtbCellValue[] = ['Total', null, null, null, null, 31261.95];

const closedRow = (
  instrument: string,
  ticker: string,
  closed: Date,
  origin: string,
  comment: string | null,
): XtbCellValue[] => [
  instrument, ticker, 'STOCK', 'BUY', 4, 180.25, utc(2025, 3, 4, 15, 45), 201.5, closed, 'My Trades',
  1850, 1850, 15650, 17500, null, null, 0, null, null, null, 21.7, 21.7, origin, 4001, comment,
];

export const XTB_NEW_CLOSED_ROWS: XtbCellValue[][] = [
  closedRow('Apple', 'AAPL.US', utc(2025, 6, 12, 17, 0), 'Android', null),
];

/**
 * Pozice, kterou XTB uzavřel sám (tady odpis bezcenného titulu): co lot, to
 * řádek — a v peněžních operacích o tom není nic.
 */
export const XTB_NEW_CLOSED_CORRECTION: XtbCellValue[][] = [
  closedRow('Dead Corp', 'DEAD.US', utc(2025, 4, 9, 10, 0), 'Correction', 'DEAD.US Worthless'),
  closedRow('Dead Corp', 'DEAD.US', utc(2025, 4, 9, 10, 0), 'Correction', 'DEAD.US Worthless'),
];

export const XTB_NEW_INSTRUMENT_MAP = {
  'AAPL.US': { isin: 'US0378331005', currency: 'USD' },
};

export interface XtbNewReportSpec {
  cashRows?: XtbCellValue[][];
  closedRows?: XtbCellValue[][];
  /** Měna v souhrnu otevřených pozic; null = souhrn bez měny (zbývá jen název souboru). */
  accountCurrency?: string | null;
  /** Kategorie v tabulce pozic — leží ve stejném sloupci jako měna souhrnu. */
  positionCategory?: string;
}

/** Postaví nový report: tři listy s preambulí, hlavičkou a součtem jako v reálu. */
export async function buildXtbNewReportXlsx(spec: XtbNewReportSpec = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const preamble = (sheet: ExcelJS.Worksheet, title: string): void => {
    sheet.addRow(['Account number', XTB_NEW_ACCOUNT]);
    sheet.addRow([title]);
    sheet.addRow(['Date from (UTC)', utc(2024, 12, 31, 23, 0)]);
    sheet.addRow(['Date to (UTC)', utc(2025, 12, 31, 22, 59)]);
  };

  const closed = workbook.addWorksheet(XTB_NEW_SHEET_CLOSED);
  preamble(closed, 'Closed Positions');
  closed.addRow(XTB_NEW_CLOSED_HEADERS);
  for (const row of spec.closedRows ?? XTB_NEW_CLOSED_ROWS) closed.addRow(row);
  closed.addRow(['Profit/loss', null, null, null, null, null, null, null, null, null, 1850, 1850]);

  const cash = workbook.addWorksheet(XTB_NEW_SHEET_CASH);
  preamble(cash, 'Cash Operations');
  cash.addRow(XTB_NEW_CASH_HEADERS);
  for (const row of spec.cashRows ?? XTB_NEW_CASH_ROWS) cash.addRow(row);
  cash.addRow(XTB_NEW_CASH_TOTAL);

  const open = workbook.addWorksheet(XTB_NEW_SHEET_OPEN);
  open.addRow(['Account number', XTB_NEW_ACCOUNT]);
  open.addRow(['Open Positions']);
  open.addRow(['Data as of report generated', utc(2025, 12, 31, 22, 59)]);
  const currency = spec.accountCurrency === undefined ? 'CZK' : spec.accountCurrency;
  open.addRow(['Product', 'Metric', 'Amount', 'Currency']);
  open.addRow(['My Trades', 'Open position value', 26000, currency]);
  open.addRow(['My Trades', 'Open position profit', 2500, currency]);
  open.addRow([]);
  open.addRow(['Product', 'Instrument/Position', 'Ticker', 'Category', 'Type', 'Volume', 'Value']);
  open.addRow(['My Trades', 'Apple', 'AAPL.US', spec.positionCategory ?? 'STOCK', null, 6, 26000]);

  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

export interface XtbWorkbookSpec {
  sheetName?: string;
  preamble?: XtbCellValue[][];
  /** null = list úplně bez hlavičky (test prázdného listu). */
  headers?: string[] | null;
  rows?: XtbCellValue[][];
}

/** Postaví XLSX buffer: preambule → hlavička → datové řádky. */
export async function buildXtbXlsx(spec: XtbWorkbookSpec = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName ?? XTB_SHEET_EN);
  for (const row of spec.preamble ?? []) sheet.addRow(row);
  if (spec.headers !== null) sheet.addRow(spec.headers ?? XTB_HEADERS_EN);
  for (const row of spec.rows ?? []) sheet.addRow(row);
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}
