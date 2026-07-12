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
