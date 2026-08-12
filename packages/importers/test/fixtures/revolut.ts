/**
 * Sdílené Revolut fixtures — akciový „Account statement“ CSV a krypto výpisy
 * v obou historických formátech. Ukázkové řádky odpovídají reálným vzorkům
 * (datum ISO 8601 s proměnným počtem desetinných sekund, symboly měn uvnitř
 * peněžních hodnot, ojedinělá desetinná čárka v Quantity).
 */

/* ── Akcie (Account statement) ───────────────────────────────────────────── */

export const REVOLUT_INVEST_HEADER =
  'Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate';

export const REVOLUT_INVEST_CSV = [
  REVOLUT_INVEST_HEADER,
  '2023-09-22T13:30:10.514Z,O,BUY - MARKET,1.63453043,$52.07,$85.11,USD,1.0665',
  '2023-07-14T13:30:00.797Z,MA,SELL - MARKET,0.1998348,$402.13,$80.34,USD,1.1241',
  '2019-12-13T08:40:00.835101Z,MSFT,DIVIDEND,,,$0.08,USD,1.1179',
  '2019-11-15T23:15:55.878985Z,,CASH TOP-UP,,,$5.22,USD,1.1055',
  '2021-09-01T07:40:54.539038Z,,CUSTODY FEE,,,-$0.01,USD,1.18',
  '2022-08-25T08:27:46.419568Z,TSLA,STOCK SPLIT,0.16431924,,$0,USD,0.0947',
  '2023-08-06T09:06:58.899860Z,WBD,TRANSFER FROM REVOLUT TRADING LTD TO REVOLUT SECURITIES EUROPE UAB,0.0004562,,$0,USD,1.1018',
  '2025-06-05T07:26:04.809Z,TSLA,BUY - MARKET,0.56217674,€88.94,€50,EUR,1.0000',
  // desetinná ČÁRKA v Quantity (v uvozovkách) + celé euro bez desetin
  '2025-09-08T07:29:03.333Z,MSFT,BUY - MARKET,"0,76672417",€26.09,€20,EUR,1',
].join('\n');

/** Rozšíření: LIMIT/STOP, fallback ceny z Total, „USD 0.51“ zápis, starší CUSTODY_FEE, reversal, výběr. */
export const REVOLUT_INVEST_EXTRAS_CSV = [
  REVOLUT_INVEST_HEADER,
  // SELL - LIMIT bez Price per share → cena = Total/Quantity (110.50 / 2 = 55.25)
  '2024-03-01T10:00:00.123Z,O,SELL - LIMIT,2,,$110.50,USD,1.0900',
  '2024-04-02T11:00:00.456Z,MA,BUY - STOP,0.5,$401.00,$200.50,USD,1.0800',
  // peněžní hodnota s ISO kódem místo symbolu
  '2020-05-10T09:00:00.000Z,MSFT,DIVIDEND,,,USD 0.51,USD,1.1000',
  '2019-03-01T08:00:00.000Z,,CUSTODY_FEE,,,-$0.02,USD,1.1300',
  '2021-10-01T08:00:00.000Z,,CUSTODY FEE REVERSAL,,,$0.01,USD,1.1600',
  '2022-01-15T12:00:00.000Z,,CASH WITHDRAWAL,,,-$100.00,USD,1.1400',
].join('\n');

/** Nezmapovaný ticker: BUY se neimportuje (unmappedSymbols), dividenda projde bez ISIN. */
export const REVOLUT_INVEST_UNMAPPED_CSV = [
  REVOLUT_INVEST_HEADER,
  '2024-06-03T13:30:00.000Z,NVDA,BUY - MARKET,0.25,$1200.00,$300.00,USD,1.0800',
  '2024-06-28T13:30:00.000Z,NVDA,DIVIDEND,,,$0.04,USD,1.0700',
].join('\n');

export const REVOLUT_INVEST_UNKNOWN_TYPE_CSV = [
  REVOLUT_INVEST_HEADER,
  '2024-01-02T10:00:00.000Z,AAPL,LENDING INCOME,,,$0.55,USD,1.1000',
].join('\n');

export const REVOLUT_INSTRUMENT_MAP = {
  O: { isin: 'US7561091049' },
  MA: { isin: 'US57636Q1040' },
  MSFT: { isin: 'US5949181045' },
  TSLA: { isin: 'US88160R1014' },
} as const;

/* ── Krypto: nový formát (2023+) ─────────────────────────────────────────── */

export const REVOLUT_CRYPTO_NEW_HEADER = 'Symbol,Type,Quantity,Price,Value,Fees,Date';

export const REVOLUT_CRYPTO_NEW_CSV = [
  REVOLUT_CRYPTO_NEW_HEADER,
  'BTC,Buy,0.01713112,"€5,837.33",€100.00,€0.00,"Jun 12, 2018, 4:16:32 PM"',
  'BTC,Sell,0.00819571,"€5,504.07",€45.10,€0.00,"Aug 19, 2018, 10:43:55 PM"',
  'BTC,Payment,0.00893541,"$7,252.05",$64.80,$0.00,"Jul 20, 2018, 7:28:14 AM"',
  'BTC,Send,0.00056077,"137,211.36 SEK",76.94 SEK,0.00 SEK,"Nov 9, 2020, 3:50:00 AM"',
  'ETH,Stake,0.18580349,"24,185.66 SEK","4,493.77 SEK",0.00 SEK,"Feb 2, 2024, 11:03:12 AM"',
  'ETH,Staking reward,0.00002061,,,,"Jan 15, 2025, 12:23:31 AM"',
  // GBP s nenulovým poplatkem + SEK nákup (měna z kódu za hodnotou)
  'LTC,Buy,1.5,£48.00,£72.00,£0.99,"Mar 3, 2021, 9:15:00 AM"',
  'DOGE,Buy,100,0.50 SEK,50.00 SEK,0.00 SEK,"May 5, 2021, 1:00:00 PM"',
].join('\n');

/** Krypto↔krypto směna: pár Sell+Buy se stejným časem, oba oceněné fiat hodnotou. */
export const REVOLUT_CRYPTO_EXCHANGE_PAIR_CSV = [
  REVOLUT_CRYPTO_NEW_HEADER,
  'BTC,Sell,0.005,"€60,000.00",€300.00,€0.00,"Feb 2, 2024, 11:03:12 AM"',
  'ETH,Buy,0.12,"€2,500.00",€300.00,€0.00,"Feb 2, 2024, 11:03:12 AM"',
].join('\n');

export const REVOLUT_CRYPTO_NEW_UNKNOWN_TYPE_CSV = [
  REVOLUT_CRYPTO_NEW_HEADER,
  'BTC,Airdrop,0.001,"€5,000.00",€5.00,€0.00,"Apr 1, 2022, 8:00:00 AM"',
].join('\n');

/** Peněžní hodnoty bez symbolu i kódu měny → měnu nejde určit → error řádku. */
export const REVOLUT_CRYPTO_NEW_NO_CURRENCY_CSV = [
  REVOLUT_CRYPTO_NEW_HEADER,
  'BTC,Buy,0.1,5000.00,500.00,0.00,"Jan 5, 2021, 1:00:00 PM"',
].join('\n');

/* ── Krypto: starý formát (do ~2022/23) ──────────────────────────────────── */

export const REVOLUT_CRYPTO_OLD_HEADER =
  'Type,Product,Started Date,Completed Date,Description,Amount,Currency,Fiat amount,Fiat amount (inc. fees),Fee,Base currency,State,Balance';

export const REVOLUT_CRYPTO_OLD_CSV = [
  REVOLUT_CRYPTO_OLD_HEADER,
  'EXCHANGE,Current,2021-06-04 7:27:08,2021-06-04 7:27:08,Exchanged to MATIC,0.310358,MATIC,0.41,0.42,0.02,EUR,COMPLETED,0.310358',
  // záporný Amount = prodej
  'EXCHANGE,Current,2022-01-10 12:00:00,2022-01-10 12:00:00,Exchanged to EUR,-0.150000,MATIC,-0.35,-0.34,0.01,EUR,COMPLETED,0.160358',
  'CARD_PAYMENT,Current,2023-05-06 10:00:00,2023-05-06 10:00:00,Payment to Amazon,-25.0000,EOS,-500.00,-495.75,4.25,SEK,COMPLETED,45.0000',
  'TRANSFER,Current,2023-08-01 08:00:00,2023-08-01 08:00:00,Balance migration to another region or legal entity,-45.0000,EOS,,,0.00,SEK,COMPLETED,0.0000',
  'EXCHANGE,Current,2023-09-01 08:00:00,2023-09-01 08:00:00,Closing transaction,-0.010358,MATIC,-0.02,-0.02,0.00,EUR,COMPLETED,0.1500',
  // nedokončená transakce → skip
  'EXCHANGE,Current,2021-07-01 09:00:00,2021-07-01 09:00:00,Exchanged to BTC,0.00100000,BTC,25.00,25.50,0.50,EUR,REVERTED,0.311358',
].join('\n');

/** Nepodporovaný Type starého formátu → warning + skip. */
export const REVOLUT_CRYPTO_OLD_UNSUPPORTED_TYPE_CSV = [
  REVOLUT_CRYPTO_OLD_HEADER,
  'REWARD,Current,2022-03-01 10:00:00,2022-03-01 10:00:00,Learn reward,1.0000,DOT,20.00,20.00,0.00,EUR,COMPLETED,1.0000',
].join('\n');

/**
 * Výpis Revolutu jako XLSX — v aplikaci se volí formát „Excel“ a podle účtu
 * z něj chodí jednou CSV a jindy opravdový sešit.
 */
export async function buildRevolutXlsx(headers: string[], rows: string[][]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  const raw = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
}
