/**
 * Fixtures MetaTrader reportů. MT4 HTML statement je TS string se strukturou
 * PŘESNĚ podle reálného „Save as Report“ vzorku (title, hlavička s Account/
 * Currency, sekce Closed Transactions / Open Trades / Working Orders /
 * Summary, čísla s mezerou v tisících). MT5 XLSX se staví za běhu přes
 * exceljs (binárky se necommitují), MT5 HTML je TS string.
 *
 * Datové řádky drž na JEDNOM řádku stringu — testy dohledávají čísla řádků
 * chybových hlášek pozicí v souboru.
 */
import ExcelJS from 'exceljs';

/* ── MT4 „Save as Report“ (.htm) ─────────────────────────────────────────── */

export const MT4_TABLE_HEADER =
  '<tr align="center" bgcolor="#C0C0C0"><td>Ticket</td><td nowrap="">Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td nowrap="">Close Time</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>';

/**
 * Výchozí řádky Closed Transactions: vklad (balance, částka s mezerou),
 * ziskový obchod ze zadání (15.51 + (-1.17) = 14.34), ztrátový s komisí,
 * nulový výsledek a zisk s mezerou v tisících.
 */
export const MT4_CLOSED_ROWS: string[] = [
  '<tr align="right"><td title="TEST-REF-001">126991050</td><td class="msdate" nowrap="">2023.09.01 12:57:25</td><td>balance</td><td colspan="10" align="left">Deposit TEST-REF-001</td><td class="mspt">1 700.00</td></tr>',
  '<tr align="right"><td>127763685</td><td class="msdate">2023.09.11 20:55:26</td><td>buy</td><td class="mspt">0.01</td><td>gbpusd</td><td>1.25121</td><td>0.00000</td><td>0.00000</td><td class="msdate">2023.11.28 19:09:01</td><td>1.27092</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">-1.17</td><td class="mspt">15.51</td></tr>',
  '<tr bgcolor="#E0E0E0" align="right"><td title="#2147483646 so: 49.0%">126991071</td><td class="msdate" nowrap="">2023.09.01 12:57:45</td><td>sell</td><td class="mspt">0.01</td><td>xauusd</td><td style="mso-number-format: 0\\.00">1944.02</td><td>0.00</td><td>0.00</td><td class="msdate" nowrap="">2023.09.01 15:31:50</td><td>1952.61</td><td class="mspt">-0.50</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">-6.76</td></tr>',
  '<tr align="right"><td>128000001</td><td class="msdate">2023.10.02 09:00:00</td><td>buy</td><td class="mspt">0.02</td><td>eurusd</td><td>1.06500</td><td>0.00000</td><td>0.00000</td><td class="msdate">2023.10.02 15:00:00</td><td>1.06505</td><td class="mspt">-0.10</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">0.10</td></tr>',
  '<tr align="right"><td>128100002</td><td class="msdate">2023.11.01 08:30:00</td><td>sell</td><td class="mspt">0.50</td><td>usdjpy</td><td>151.200</td><td>0.000</td><td>0.000</td><td class="msdate">2023.11.20 21:45:10</td><td>149.100</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">-0.44</td><td class="mspt">1 234.56</td></tr>',
];

/** Otevřená pozice v sekci Open Trades (Close Time je &nbsp;). */
export const MT4_OPEN_TRADE_ROW =
  '<tr align="right"><td title="#2147483646">144165417</td><td class="msdate" nowrap="">2025.11.28 15:00:02</td><td>buy</td><td class="mspt">0.04</td><td>audcad</td><td>0.91487</td><td>0.00000</td><td>0.00000</td><td class="msdate" nowrap="">&nbsp;</td><td>0.91419</td><td class="mspt">0.00</td><td class="mspt">0.00</td><td class="mspt">0.06</td><td class="mspt">-1.47</td></tr>';

export interface Mt4StatementSpec {
  /** null = řádek s měnou v hlavičce úplně chybí (test chybějící měny). */
  currency?: string | null;
  closedRows?: string[];
  openRows?: string[];
}

/** Postaví MT4 statement doslova podle reálného vzorku „Save as Report“. */
export function buildMt4Html(spec: Mt4StatementSpec = {}): string {
  const currencyCell =
    spec.currency === null
      ? '<td colspan="2"><b>Leverage: 1:30</b></td>'
      : `<td colspan="2"><b>Currency: ${spec.currency ?? 'GBP'}</b></td>`;
  const closedRows = spec.closedRows ?? MT4_CLOSED_ROWS;
  const openRows = spec.openRows ?? [MT4_OPEN_TRADE_ROW];
  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">',
    '<html>',
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252" />',
    '<title>Statement: 12345678</title>',
    '</head>',
    '<body topmargin="1" marginheight="1">',
    '<div align="center">',
    '<div style="font: 20pt Times New Roman"><b>Test Trading Ltd</b></div>',
    '<table cellspacing="1" cellpadding="3" border="0">',
    '<tbody>',
    `<tr align="left"><td colspan="2"><b>Account: 12345678</b></td><td colspan="5"><b>Name: Test User</b></td>${currencyCell}<td colspan="3" align="right"><b>2025 November 30, 15:06</b></td></tr>`,
    '<tr align="left"><td colspan="13"><b>Closed Transactions:</b></td></tr>',
    MT4_TABLE_HEADER,
    ...closedRows,
    '<tr align="right"><td colspan="10">&nbsp;</td><td class="mspt">-0.60</td><td class="mspt">0.00</td><td class="mspt">-1.61</td><td class="mspt">1 243.41</td></tr>',
    '<tr align="right"><td colspan="12" align="right"><b>Closed P/L:</b></td><td colspan="2" align="right" title="Commission + Swap + Profit + Taxes" class="mspt"><b>1 241.20</b></td></tr>',
    '<tr align="left"><td colspan="14"><b>Open Trades:</b></td></tr>',
    '<tr align="center" bgcolor="#C0C0C0"><td>Ticket</td><td nowrap="">Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td>&nbsp;</td><td>Price</td><td>Commission</td><td>Taxes</td><td>Swap</td><td>Profit</td></tr>',
    ...openRows,
    '<tr align="right"><td colspan="10">&nbsp;</td><td colspan="2" align="right"><b>Floating P/L:</b></td><td colspan="2" class="mspt"><b>-1.47</b></td></tr>',
    '<tr align="left"><td colspan="14"><b>Working Orders:</b></td></tr>',
    '<tr align="center" bgcolor="#C0C0C0"><td>Ticket</td><td nowrap="">Open Time</td><td>Type</td><td>Size</td><td>Item</td><td>Price</td><td>S / L</td><td>T / P</td><td colspan="2" nowrap="">Market Price</td><td colspan="4">&nbsp;</td></tr>',
    '<tr align="right"><td colspan="13" align="center">No transactions</td></tr>',
    '<tr align="left"><td colspan="14"><b>Summary:</b></td></tr>',
    '<tr align="right"><td colspan="2"><b>Deposit/Withdrawal:</b></td><td colspan="2" class="mspt"><b>1 700.00</b></td><td colspan="4"><b>Credit Facility:</b></td><td class="mspt"><b>0.00</b></td><td colspan="5">&nbsp;</td></tr>',
    '</tbody>',
    '</table>',
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}

export const MT4_HTML = buildMt4Html();

/* ── MT5 report (HTML i XLSX) ────────────────────────────────────────────── */

/** Deal tabulky Deals — peníze jako stringy (zachová „1 234.56“ s mezerou). */
export interface Mt5Deal {
  time: string;
  deal: number;
  symbol: string;
  type: string;
  direction: string;
  volume?: string;
  price?: string;
  order?: number | '';
  commission: string;
  fee?: string;
  swap: string;
  profit: string;
  balance?: string;
  comment?: string;
}

/**
 * Výchozí dealy: balance vklad, EURUSD in+out (komise na obou, fee na out),
 * GBPUSD in+out (ztráta), USDJPY in/out (otočení pozice, zisk s mezerou
 * v tisících), AUDUSD in bez uzavření (test nepřiřazené komise).
 */
export const MT5_DEALS: Mt5Deal[] = [
  { time: '2025.01.02 09:00:00', deal: 1001, symbol: '', type: 'balance', direction: '', commission: '0.00', fee: '0.00', swap: '0.00', profit: '10 000.00', balance: '10 000.00', comment: 'Deposit' },
  { time: '2025.02.03 10:15:00', deal: 1002, symbol: 'EURUSD', type: 'buy', direction: 'in', volume: '1', price: '1.03450', order: 2002, commission: '-0.70', fee: '0.00', swap: '0.00', profit: '0.00', balance: '9 999.30' },
  { time: '2025.02.10 16:40:00', deal: 1003, symbol: 'EURUSD', type: 'sell', direction: 'out', volume: '1', price: '1.04700', order: 2003, commission: '-0.70', fee: '-0.10', swap: '-0.25', profit: '125.50', balance: '10 123.75' },
  { time: '2025.03.01 09:00:00', deal: 1004, symbol: 'GBPUSD', type: 'sell', direction: 'in', volume: '0.5', price: '1.26000', order: 2004, commission: '-0.50', fee: '0.00', swap: '0.00', profit: '0.00', balance: '10 123.25' },
  { time: '2025.03.05 14:20:00', deal: 1005, symbol: 'GBPUSD', type: 'buy', direction: 'out', volume: '0.5', price: '1.26800', order: 2005, commission: '-0.50', fee: '0.00', swap: '-1.00', profit: '-40.00', balance: '10 081.75' },
  { time: '2025.04.01 11:00:00', deal: 1006, symbol: 'USDJPY', type: 'buy', direction: 'in/out', volume: '2', price: '154.300', order: 2006, commission: '0.00', fee: '0.00', swap: '0.00', profit: '1 234.56', balance: '11 316.31' },
  { time: '2025.05.02 10:00:00', deal: 1007, symbol: 'AUDUSD', type: 'buy', direction: 'in', volume: '1', price: '0.65500', order: 2007, commission: '-0.30', fee: '0.00', swap: '0.00', profit: '0.00', balance: '11 316.01' },
];

export const mt5DealHtmlRow = (deal: Mt5Deal): string =>
  '<tr align="right">' +
  [
    deal.time,
    String(deal.deal),
    deal.symbol,
    deal.type,
    deal.direction,
    deal.volume ?? '',
    deal.price ?? '',
    String(deal.order ?? ''),
    deal.commission,
    deal.fee ?? '0.00',
    deal.swap,
    deal.profit,
    deal.balance ?? '',
    deal.comment ?? '',
  ]
    .map((cell) => `<td>${cell}</td>`)
    .join('') +
  '</tr>';

export interface Mt5HtmlSpec {
  /** null = řádek s měnou v hlavičce úplně chybí. */
  currency?: string | null;
  /** null = sekce Deals v reportu úplně chybí; stringy = hotové <tr> řádky. */
  deals?: string[] | null;
}

/** Postaví MT5 HTML report: hlavička, sekce Orders (přeskakuje se) a Deals. */
export function buildMt5Html(spec: Mt5HtmlSpec = {}): string {
  const currencyRow =
    spec.currency === null
      ? ''
      : `<tr align="left"><td colspan="3"><b>Currency:</b></td><td colspan="11">${spec.currency ?? 'USD'}</td></tr>`;
  const dealRows = spec.deals ?? MT5_DEALS.map(mt5DealHtmlRow);
  const dealsSection =
    spec.deals === null
      ? []
      : [
          '<tr align="left"><td colspan="14"><b>Deals</b></td></tr>',
          '<tr align="center" bgcolor="#E5F0FC"><td>Time</td><td>Deal</td><td>Symbol</td><td>Type</td><td>Direction</td><td>Volume</td><td>Price</td><td>Order</td><td>Commission</td><td>Fee</td><td>Swap</td><td>Profit</td><td>Balance</td><td>Comment</td></tr>',
          ...dealRows,
          '<tr align="right"><td colspan="8"><b>Total</b></td><td><b>-2.70</b></td><td><b>-0.10</b></td><td><b>-1.25</b></td><td><b>1 320.06</b></td><td></td><td></td></tr>',
        ];
  return [
    '<html>',
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />',
    '<title>Trade History Report: 555001</title>',
    '</head>',
    '<body>',
    '<table>',
    '<tr><td colspan="14"><div><b>Trade History Report</b></div></td></tr>',
    '<tr align="left"><td colspan="3"><b>Name:</b></td><td colspan="11">Test User</td></tr>',
    '<tr align="left"><td colspan="3"><b>Account:</b></td><td colspan="11">555001 (MetaQuotes-Demo)</td></tr>',
    currencyRow,
    '<tr align="left"><td colspan="3"><b>Date:</b></td><td colspan="11">2026.01.05 12:00:00</td></tr>',
    '<tr align="left"><td colspan="14"><b>Orders</b></td></tr>',
    '<tr align="center"><td>Open Time</td><td>Order</td><td>Symbol</td><td>Type</td><td>Volume</td><td>Price</td><td>S / L</td><td>T / P</td><td>Time</td><td>State</td><td>Comment</td></tr>',
    '<tr align="right"><td>2025.02.03 10:15:00</td><td>2002</td><td>EURUSD</td><td>buy</td><td>1 / 1</td><td>1.03450</td><td></td><td></td><td>2025.02.03 10:15:00</td><td>filled</td><td></td></tr>',
    ...dealsSection,
    '</table>',
    '</body>',
    '</html>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export const MT5_HTML = buildMt5Html();

export interface Mt5XlsxSpec {
  /** false = starší build bez sloupce Fee. */
  withFee?: boolean;
  /** null = řádek s měnou v hlavičce úplně chybí. */
  currency?: string | null;
  /** null = sekce Deals v listu úplně chybí. */
  deals?: Mt5Deal[] | null;
  sheetName?: string;
}

/** Postaví MT5 XLSX „Open XML“ report: hlavička, Orders (přeskakuje se), Deals. */
export async function buildMt5Xlsx(spec: Mt5XlsxSpec = {}): Promise<Buffer> {
  const withFee = spec.withFee ?? true;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(spec.sheetName ?? 'Sheet1');
  sheet.addRow(['Trade History Report']);
  sheet.addRow(['Name:', 'Test User']);
  sheet.addRow(['Account:', '555001 (MetaQuotes-Demo)']);
  if (spec.currency !== null) sheet.addRow(['Currency:', spec.currency ?? 'USD']);
  sheet.addRow(['Orders']);
  sheet.addRow(['Open Time', 'Order', 'Symbol', 'Type', 'Volume', 'Price', 'S / L', 'T / P', 'Time', 'State', 'Comment']);
  sheet.addRow(['2025.02.03 10:15:00', 2002, 'EURUSD', 'buy', '1 / 1', '1.03450', '', '', '2025.02.03 10:15:00', 'filled', '']);
  if (spec.deals !== null) {
    sheet.addRow(['Deals']);
    sheet.addRow([
      'Time', 'Deal', 'Symbol', 'Type', 'Direction', 'Volume', 'Price', 'Order',
      'Commission', ...(withFee ? ['Fee'] : []), 'Swap', 'Profit', 'Balance', 'Comment',
    ]);
    for (const deal of spec.deals ?? MT5_DEALS) {
      sheet.addRow([
        deal.time, deal.deal, deal.symbol, deal.type, deal.direction,
        deal.volume ?? '', deal.price ?? '', deal.order ?? '',
        deal.commission, ...(withFee ? [deal.fee ?? '0.00'] : []),
        deal.swap, deal.profit, deal.balance ?? '', deal.comment ?? '',
      ]);
    }
    sheet.addRow(['', '', '', '', '', '', '', '', '-2.70', ...(withFee ? ['-0.10'] : []), '-1.25', '1 320.06', '', '']);
  }
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}

/** Cizí XLSX (à la XTB) — sniffMt5Xlsx na něm musí vrátit false. */
export async function buildForeignXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('CASH OPERATION HISTORY');
  sheet.addRow(['ID', 'Type', 'Time', 'Comment', 'Symbol', 'Amount']);
  sheet.addRow([1, 'Deposit', '02.01.2025 10:00:00', 'Bank transfer', '', 1000]);
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}
