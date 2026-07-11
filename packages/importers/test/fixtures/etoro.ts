/**
 * Fixture eToro „Account Statement" XLSX — binárka se do repa necommituje,
 * workbook se staví za běhu testu přes exceljs (vzor test/fixtures/xtb.ts).
 *
 * Struktura kopíruje reálný výpis: listy Account Summary, Closed Positions,
 * Account Activity, Dividends a Financial Summary; hlavičky doslova podle
 * reálných exportů (US i EU locale, staré i nové varianty sloupců).
 */
import ExcelJS from 'exceljs';

export type EtoroCellValue = string | number | Date | null;

/** Account Activity — starší varianta se sloupcem „Units". */
export const ETORO_ACTIVITY_HEADERS = [
  'Date',
  'Type',
  'Details',
  'Amount',
  'Units',
  'Realized Equity Change',
  'Realized Equity',
  'Balance',
  'Position ID',
  'Asset type',
  'NWA',
];

/** Account Activity — novější varianta: „Units / Contracts" + „Amount in EUR". */
export const ETORO_ACTIVITY_HEADERS_V2 = [
  'Date',
  'Type',
  'Details',
  'Amount',
  'Amount in EUR',
  'Units / Contracts',
  'Realized Equity Change',
  'Realized Equity',
  'Balance',
  'Position ID',
  'Asset type',
  'NWA',
];

/** Closed Positions — novější varianta s „(USD)" sufixy a ISIN. */
export const ETORO_CLOSED_HEADERS = [
  'Position ID',
  'Action',
  'Long / Short',
  'Amount',
  'Units / Contracts',
  'Open Date',
  'Close Date',
  'Leverage',
  'Spread Fees (USD)',
  'Market Spread (USD)',
  'Profit(USD)',
  'Profit(EUR)',
  'FX rate at open (USD)',
  'FX rate at close (USD)',
  'Open Rate',
  'Close Rate',
  'Take profit rate',
  'Stop loss rate',
  'Overnight Fees and Dividends',
  'Copied From',
  'Type',
  'ISIN',
  'Notes',
];

/** Closed Positions — starší varianta („FX rate at open" bez sufixu, „Units"). */
export const ETORO_CLOSED_HEADERS_OLD = [
  'Position ID',
  'Action',
  'Long / Short',
  'Amount',
  'Units',
  'Open Date',
  'Close Date',
  'Leverage',
  'Spread Fees (USD)',
  'Market Spread (USD)',
  'Profit(USD)',
  'FX rate at open',
  'FX rate at close',
  'Open Rate',
  'Close Rate',
  'Take profit rate',
  'Stop loss rate',
  'Overnight Fees and Dividends',
  'Copied From',
  'Type',
  'ISIN',
  'Notes',
];

export const ETORO_DIVIDEND_HEADERS = [
  'Date of Payment',
  'Instrument Name',
  'Net Dividend Received (USD)',
  'Withholding Tax Rate (%)',
  'Withholding Tax Amount (USD)',
  'Position ID',
  'Type',
  'ISIN',
];

/** Dividends — EU varianta („Net dividends", „(EUR)" sufixy). */
export const ETORO_DIVIDEND_HEADERS_EU = [
  'Date of Payment',
  'Instrument Name',
  'Net dividends (EUR)',
  'Withholding Tax Rate (%)',
  'Withholding Tax Amount (EUR)',
  'Position ID',
  'Type',
  'ISIN',
];

/** Řádek podle názvů sloupců — nevyplněné buňky zůstanou prázdné (jako v reálu). */
const rowFor = (headers: string[], values: Record<string, EtoroCellValue>): EtoroCellValue[] =>
  headers.map((header) => values[header] ?? '');

/** Mapování symbolů otevřených pozic na ISIN (eToro ho v Account Activity neuvádí). */
export const ETORO_INSTRUMENT_MAP = {
  AMD: { isin: 'US0079031078' },
  ADBE: { isin: 'US00724F1012' },
};

/**
 * Uzavřené pozice (US locale): akcie long, CFD short s pákou, krypto, ETF.
 * Čísla záměrně mix stringů a JS number (ExcelJS je ukládá různě).
 */
export const ETORO_CLOSED_ROWS: EtoroCellValue[][] = [
  rowFor(ETORO_CLOSED_HEADERS, {
    'Position ID': '2355395242',
    Action: 'Buy Universal Display (OLED)',
    'Long / Short': 'Long',
    Amount: 17.5,
    'Units / Contracts': 0.102626,
    'Open Date': '12/06/2023 15:30:00',
    'Close Date': '09/01/2024 15:30:40',
    Leverage: 1,
    'Profit(USD)': 0.93,
    'FX rate at open (USD)': 1,
    'FX rate at close (USD)': 1,
    'Open Rate': 170.55,
    'Close Rate': 179.6,
    Type: 'Stocks',
    ISIN: 'US91347P1057',
  }),
  rowFor(ETORO_CLOSED_HEADERS, {
    'Position ID': '2400000001',
    Action: 'Sell Tesla Motors, Inc. (TSLA)',
    'Long / Short': 'Short',
    Amount: 100,
    'Units / Contracts': 0.5,
    'Open Date': '01/02/2024 10:00:00',
    'Close Date': '15/02/2024 16:30:00',
    Leverage: 2,
    'Profit(USD)': 10,
    'Open Rate': 200,
    'Close Rate': 180,
    Type: 'CFD',
    ISIN: '',
  }),
  rowFor(ETORO_CLOSED_HEADERS, {
    'Position ID': '2500000002',
    Action: 'Buy Bitcoin (BTC)',
    'Long / Short': 'Long',
    Amount: 1500,
    'Units / Contracts': 0.05,
    'Open Date': '03/03/2024 12:00:00',
    'Close Date': '10/04/2024 12:00:00',
    Leverage: 1,
    'Profit(USD)': 1500,
    'Open Rate': 30000,
    'Close Rate': 60000,
    Type: 'Crypto',
    ISIN: '',
  }),
  rowFor(ETORO_CLOSED_HEADERS, {
    'Position ID': '2600000003',
    Action: 'Buy iShares Core MSCI World UCITS ETF (IWDA)',
    'Long / Short': 'Long',
    Amount: 500,
    'Units / Contracts': 5,
    'Open Date': '05/01/2024 09:00:00',
    'Close Date': '20/06/2024 09:00:00',
    Leverage: 1,
    'Profit(USD)': 27.5,
    'Open Rate': 100,
    'Close Rate': 105.5,
    Type: 'ETF',
    ISIN: 'IE00B4L5Y983',
  }),
];

/**
 * Account Activity (US locale) — hlavičky se sloupcem „Units". Obsahuje řádky
 * pozic pokrytých listem Closed Positions (musí se přeskočit bez hlášky),
 * otevřené pozice, dividendu (duplikát listu Dividends), poplatky se zápory
 * v závorkách i s minusem, vklady/výběry/převody a staking + split.
 */
export const ETORO_ACTIVITY_ROWS: EtoroCellValue[][] = [
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '02/01/2024 09:00:00',
    Type: 'Deposit',
    Details: '-',
    Amount: 1000,
    Units: '-',
    'Realized Equity Change': 1000,
    'Realized Equity': '1,000.00',
    Balance: '1,000.00',
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '12/06/2023 15:30:00',
    Type: 'Open Position',
    Details: 'OLED/USD',
    Amount: 17.5,
    Units: 0.102626,
    'Realized Equity Change': 0,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '2355395242',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '09/01/2024 15:30:40',
    Type: 'Position closed',
    Details: 'OLED/USD',
    Amount: 18.43,
    Units: 0.102626,
    'Realized Equity Change': 7.37,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '2355395242',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '09/01/2024 15:37:16',
    Type: 'Open Position',
    Details: 'AMD/USD',
    Amount: 49.88,
    Units: 0.337209,
    'Realized Equity Change': 0,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '2596572937',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '02/01/2024 00:10:33',
    Type: 'Dividend',
    Details: 'NKE/USD',
    Amount: 0.17,
    Units: '-',
    'Realized Equity Change': 0.17,
    'Realized Equity': '4,581.91',
    Balance: 99.6,
    'Position ID': '2272508626',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '01/01/2024 05:50:54',
    Type: 'Interest Payment',
    Details: '',
    Amount: 0.08,
    Units: '-',
    'Realized Equity Change': 0.08,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '10/07/2025 15:15:01',
    Type: 'SDRT',
    Details: 'HNKE/USD',
    Amount: '(6.97)',
    Units: '-',
    'Realized Equity Change': '(6.97)',
    'Realized Equity': '11,316.06 ',
    Balance: '0.00 ',
    'Position ID': '3069370143',
    'Asset type': 'Stocks',
    NWA: '0.00',
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '16/02/2024 00:00:00',
    Type: 'Overnight fee',
    Details: 'Daily',
    Amount: '(0.35)',
    Units: '-',
    'Realized Equity Change': '(0.35)',
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '2400000001',
    'Asset type': 'CFD',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '17/02/2024 00:00:00',
    Type: 'Overnight refund',
    Details: 'Daily',
    Amount: 0.05,
    Units: '-',
    'Realized Equity Change': 0.05,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '2400000001',
    'Asset type': 'CFD',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '03/01/2024 13:09:09',
    Type: 'Withdraw Request',
    Details: '-',
    Amount: -100.11,
    Units: '-',
    'Realized Equity Change': -100.11,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '03/01/2024 13:09:10',
    Type: 'Withdrawal Fee',
    Details: '-',
    Amount: -5,
    Units: '-',
    'Realized Equity Change': -5,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '04/01/2024 10:00:00',
    Type: 'Conversion Fee',
    Details: '-',
    Amount: -1.2,
    Units: '-',
    'Realized Equity Change': -1.2,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '05/01/2024 10:00:00',
    Type: 'Transfer: EUR > USD',
    Details: '-',
    Amount: 500,
    Units: '-',
    'Realized Equity Change': 500,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '06/01/2024 10:00:00',
    Type: 'Transfer to Crypto Wallet',
    Details: 'BTC',
    Amount: -250,
    Units: '-',
    'Realized Equity Change': -250,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    'Asset type': 'Crypto',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '07/01/2024 10:00:00',
    Type: 'Staking',
    Details: 'ADA',
    Amount: 1.23,
    Units: '-',
    'Realized Equity Change': 1.23,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '-',
    'Asset type': 'Crypto',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '08/01/2024 10:00:00',
    Type: 'corp action: Split',
    Details: 'AMZN/USD',
    Amount: '-',
    Units: '-',
    'Realized Equity Change': '-',
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '3111111111',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '09/01/2024 10:05:00',
    Type: 'Commission',
    Details: 'ZIM/USD',
    Amount: -1,
    Units: '-',
    'Realized Equity Change': -1,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '3200000001',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '10/01/2024 11:00:00',
    Type: 'Open Position',
    Details: 'ZZZ/USD',
    Amount: 10,
    Units: 1,
    'Realized Equity Change': 0,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '9999999999',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '11/01/2024 11:00:00',
    Type: 'Open Position',
    Details: 'ETH/USD',
    Amount: 200,
    Units: 0.1,
    'Realized Equity Change': 0,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '9999999998',
    'Asset type': 'Crypto',
    NWA: 0,
  }),
  rowFor(ETORO_ACTIVITY_HEADERS, {
    Date: '12/01/2024 11:00:00',
    Type: 'Position closed',
    Details: 'XYZ/USD',
    Amount: 50,
    Units: 1,
    'Realized Equity Change': -2,
    'Realized Equity': '4,581.91',
    Balance: 0,
    'Position ID': '8888888888',
    'Asset type': 'Stocks',
    NWA: 0,
  }),
];

/** Dividendy (US locale): se srážkou 30 % a bez srážky; instrument obě podoby. */
export const ETORO_DIVIDEND_ROWS: EtoroCellValue[][] = [
  rowFor(ETORO_DIVIDEND_HEADERS, {
    'Date of Payment': '02/01/2024',
    'Instrument Name': 'NKE/USD',
    'Net Dividend Received (USD)': 0.17,
    'Withholding Tax Rate (%)': 30,
    'Withholding Tax Amount (USD)': 0.07,
    'Position ID': '2272508626',
    Type: 'Stocks',
    ISIN: 'US6541061031',
  }),
  rowFor(ETORO_DIVIDEND_HEADERS, {
    'Date of Payment': '15/03/2024',
    'Instrument Name': 'Apple Inc',
    'Net Dividend Received (USD)': 0.85,
    'Withholding Tax Rate (%)': 0,
    'Withholding Tax Amount (USD)': 0,
    'Position ID': '2350000000',
    Type: 'Stocks',
    ISIN: 'US0378331005',
  }),
];

/** Uzavřené pozice EU locale + stará hlavička: desetinné čárky, mezery, „Buy NVDA". */
export const ETORO_CLOSED_ROWS_EU: EtoroCellValue[][] = [
  rowFor(ETORO_CLOSED_HEADERS_OLD, {
    'Position ID': '1074146905',
    Action: 'Buy NVDA',
    'Long / Short': 'Long',
    Amount: ' 212,77 ',
    Units: '2,5',
    'Open Date': '15/04/2020 00:46:41',
    'Close Date': '20/05/2020 10:30:00',
    Leverage: '1',
    'Spread Fees (USD)': '0,05',
    'Profit(USD)': ' 25,98 ',
    'Open Rate': ' 85,11 ',
    'Close Rate': '95,50',
    'Overnight Fees and Dividends': '(0,10)',
    Type: 'Stocks',
    ISIN: 'US67066G1040',
  }),
];

/** Account Activity EU locale s hlavičkou „Units / Contracts" a „Amount in EUR". */
export const ETORO_ACTIVITY_ROWS_EU: EtoroCellValue[][] = [
  rowFor(ETORO_ACTIVITY_HEADERS_V2, {
    Date: '15/04/2020 00:46:41',
    Type: 'Open Position',
    Details: 'NVDA/USD',
    Amount: ' 212,77 ',
    'Amount in EUR': ' 196,00 ',
    'Units / Contracts': '2,5',
    'Realized Equity Change': '0,00',
    'Realized Equity': ' 212,77 ',
    Balance: ' 12,77 ',
    'Position ID': '1074146905',
    'Asset type': 'Stocks',
    NWA: ' 0,00 ',
  }),
  rowFor(ETORO_ACTIVITY_HEADERS_V2, {
    Date: '15/04/2020 23:59:59',
    Type: 'Overnight fee',
    Details: 'Daily',
    Amount: '(0,10)',
    'Amount in EUR': '(0,09)',
    'Units / Contracts': '-',
    'Realized Equity Change': '(0,10)',
    'Realized Equity': ' 212,77 ',
    Balance: ' 12,77 ',
    'Position ID': '1074146905',
    'Asset type': 'CFD',
    NWA: ' 0,00 ',
  }),
  rowFor(ETORO_ACTIVITY_HEADERS_V2, {
    Date: '16/04/2020 10:00:00',
    Type: 'Open Position',
    Details: 'ADBE/USD',
    Amount: ' 1 000,50 ',
    'Amount in EUR': ' 920,00 ',
    'Units / Contracts': '2,5',
    'Realized Equity Change': '0,00',
    'Realized Equity': ' 1 213,27 ',
    Balance: ' 12,77 ',
    'Position ID': '2000000001',
    'Asset type': 'Stocks',
    NWA: ' 0,00 ',
  }),
];

export const ETORO_DIVIDEND_ROWS_EU: EtoroCellValue[][] = [
  rowFor(ETORO_DIVIDEND_HEADERS_EU, {
    'Date of Payment': '20/04/2020',
    'Instrument Name': 'NVDA/USD',
    'Net dividends (EUR)': ' 3,10 ',
    'Withholding Tax Rate (%)': '15',
    'Withholding Tax Amount (EUR)': '0,55',
    'Position ID': '1074146905',
    Type: 'Stocks',
    ISIN: 'US67066G1040',
  }),
];

export interface EtoroSheetSpec {
  /** null = list bez hlavičky (test prázdného listu). */
  headers?: string[] | null;
  rows?: EtoroCellValue[][];
}

export interface EtoroWorkbookSpec {
  /** false = list ve workbooku vůbec nebude. */
  closed?: EtoroSheetSpec | false;
  activity?: EtoroSheetSpec | false;
  dividends?: EtoroSheetSpec | false;
  /** Doprovodné listy Account Summary / Financial Summary (default ano, jako v reálu). */
  summarySheets?: boolean;
}

/** Postaví XLSX buffer eToro výpisu podle specifikace (default: prázdné listy). */
export async function buildEtoroXlsx(spec: EtoroWorkbookSpec = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (spec.summarySheets !== false) {
    const summary = workbook.addWorksheet('Account Summary');
    summary.addRow(['Details', '']);
    summary.addRow(['Name', 'Jan Novák']);
    summary.addRow(['Currency', 'USD']);
  }
  const addSheet = (
    def: EtoroSheetSpec | false | undefined,
    name: string,
    defaultHeaders: string[],
  ): void => {
    if (def === false) return;
    const sheet = workbook.addWorksheet(name);
    if (def?.headers !== null) sheet.addRow(def?.headers ?? defaultHeaders);
    for (const row of def?.rows ?? []) sheet.addRow(row);
  };
  addSheet(spec.closed, 'Closed Positions', ETORO_CLOSED_HEADERS);
  addSheet(spec.activity, 'Account Activity', ETORO_ACTIVITY_HEADERS);
  addSheet(spec.dividends, 'Dividends', ETORO_DIVIDEND_HEADERS);
  if (spec.summarySheets !== false) {
    workbook.addWorksheet('Financial Summary').addRow(['Name', 'Amount', 'Tax rate']);
  }
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

/** Kompletní happy-path workbook (US locale, všechny listy). */
export const buildEtoroHappyPath = (): Promise<Buffer> =>
  buildEtoroXlsx({
    closed: { rows: ETORO_CLOSED_ROWS },
    activity: { rows: ETORO_ACTIVITY_ROWS },
    dividends: { rows: ETORO_DIVIDEND_ROWS },
  });

/** Workbook v EU locale (desetinné čárky) se staršími/novějšími hlavičkami. */
export const buildEtoroEuLocale = (): Promise<Buffer> =>
  buildEtoroXlsx({
    closed: { headers: ETORO_CLOSED_HEADERS_OLD, rows: ETORO_CLOSED_ROWS_EU },
    activity: { headers: ETORO_ACTIVITY_HEADERS_V2, rows: ETORO_ACTIVITY_ROWS_EU },
    dividends: { headers: ETORO_DIVIDEND_HEADERS_EU, rows: ETORO_DIVIDEND_ROWS_EU },
  });
