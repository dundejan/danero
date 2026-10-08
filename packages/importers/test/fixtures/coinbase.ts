/**
 * Fixtures Coinbase „transaction history“ CSV — všechny čtyři generace hlaviček
 * doslova podle reálných exportů. Ukázkové řádky zachovávají tvary z důkazů:
 * ISO timestamp se `Z` i `YYYY-MM-DD HH:MM:SS UTC`, symboly měn (€) a tisícové
 * čárky v částkách, Notes s lidským popisem.
 */

/** V4 (2024+): sloupec ID, `Price Currency`, částky se symbolem € a tisícovými čárkami. */
export const COINBASE_V4 = [
  'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
  '67645f1f8e8ebf2624a29d83,2024-12-19 17:59:59 UTC,Advanced Trade Buy,SOL,0.035,EUR,€190.00,€6.65,€6.68990,€0.0399,Bought 0.035 SOL for 6.6899 EUR on SOL-EUR at 190 EUR/SOL',
  '67645f1f8e8ebf2624a29d84,2025-01-10 09:15:00 UTC,Advanced Trade Sell,SOL,-0.5,EUR,€200.00,€100.00,€99.40,€0.60,Sold 0.5 SOL for 99.40 EUR on SOL-EUR at 200 EUR/SOL',
  '67645f1f8e8ebf2624a29d85,2025-02-01 12:00:00 UTC,Card Spend,BTC,0.001,EUR,€90000.00,€90.00,€90.00,€0,Spent 0.001 BTC on Coinbase Card',
  '67645f1f8e8ebf2624a29d86,2025-03-05 10:00:00 UTC,Advanced Trade Buy,BTC,0.015,EUR,"€82,304.00","€1,234.56","€1,240.73",€6.17,Bought 0.015 BTC for 1240.73 EUR on BTC-EUR at 82304 EUR/BTC',
].join('\n');

/** V3: bez ID, `Spot Price Currency`; Convert, Send, Receive (UTC timestamp), Staking Income. */
export const COINBASE_V3 = [
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
  '2019-09-25T14:37:00Z,Convert,BTC,0.05413984,USD,194436.11,10415.01,10526.74,111.73,Converted 0.05413984 BTC to 451.212148 USDC',
  '2023-01-20T07:09:23Z,Send,BTC,0.01031941,CZK,19339.02,199.57,199.57,0,Sent 0.01031941 BTC to bc1ql83d5c4dwwj4k6z8km5v8chff7688xxxxxxxxx',
  '2022-01-07 22:41:54 UTC,Receive,BTC,0.00013634,EUR,895782.60,122.13,122.13,0,Received 0.00013634 BTC from Coinbase',
  '2023-04-27 03:28:05 UTC,Staking Income,XTZ,0.000004,CZK,21.71,0.00,0.00,0,',
].join('\n');

/** V2: `Total (inclusive of fees)` + `Fees` (bez „and/or Spread“). */
export const COINBASE_V2 = [
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees),Fees,Notes',
  '2021-04-14T09:00:00Z,Buy,ETH,0.5,EUR,1800.00,900.00,912.50,12.50,Bought 0.5 ETH for €912.50 EUR',
].join('\n');

/** V1: měnový prefix ve jménech sloupců (EUR …) + preambule před hlavičkou. */
export const COINBASE_V1_EUR = [
  'Transactions',
  'User,Jan Novák,3f2e9a7c-0000-0000-0000-000000000000',
  '',
  'Timestamp,Transaction Type,Asset,Quantity Transacted,EUR Spot Price at Transaction,EUR Subtotal,EUR Total (inclusive of fees),EUR Fees,Notes',
  '2020-09-27T18:36:58Z,Buy,BTC,0.03182812,9287.38,295.60,300.00,4.40,Bought 0.03182812 BTC for € 300.00 EUR',
  '2020-03-09T05:17:11Z,Sell,BTC,0.03517833,6831.48,240.32,236.74,3.58,Sold 0.03517833 BTC for €236.74 EUR',
].join('\n');

/** Convert s poznámkou, která neodpovídá vzoru → error řádku. */
export const COINBASE_CONVERT_BAD_NOTES = [
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
  '2021-05-05T10:00:00Z,Convert,BTC,0.01,EUR,50000.00,500.00,505.00,5.00,Converted stuff',
].join('\n');

/** Neznámý typ transakce → error. */
export const COINBASE_UNKNOWN_TYPE = [
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
  '2024-06-01T10:00:00Z,Mystery Payout,BTC,0.001,EUR,60000.00,60.00,60.00,0,',
].join('\n');

/** Dva IDENTICKÉ řádky bez sloupce ID — id musí zůstat unikátní a stabilní. */
export const COINBASE_DUPLICATE_ROWS = [
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees),Fees,Notes',
  '2021-04-14T09:00:00Z,Buy,ETH,0.5,EUR,1800.00,900.00,912.50,12.50,Bought 0.5 ETH for €912.50 EUR',
  '2021-04-14T09:00:00Z,Buy,ETH,0.5,EUR,1800.00,900.00,912.50,12.50,Bought 0.5 ETH for €912.50 EUR',
].join('\n');

const V4_HEADER =
  'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes';
const V3_HEADER =
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes';
const V2_HEADER =
  'Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees),Fees,Notes';

/**
 * Advanced Trade na párech MIMO měnu účtu (L2d-01). `Price Currency` i `Subtotal`
 * nesou měnu účtu (EUR), kotovací aktivum a jeho množství jsou jen v Notes —
 * třetí obchod má novější tvar poznámky bez „at …“, čtvrtý je běžný pár s měnou
 * účtu. Čísla smyšlená.
 */
export const COINBASE_V4_CRYPTO_PAIRS = [
  V4_HEADER,
  '6790aa000000000000000001,2025-06-03 10:00:00 UTC,Advanced Trade Sell,BTC,-0.02,EUR,"€60,000.00","€1,200.00","€1,195.20",€4.80,Sold 0.02 BTC for 1300.00 USDC on BTC-USDC at 65000 USDC/BTC',
  '6790aa000000000000000002,2025-06-04 11:30:00 UTC,Advanced Trade Buy,ETH,0.5,EUR,"€2,000.00","€1,000.00","€1,004.00",€4.00,Bought 0.5 ETH for 0.0201 BTC on ETH-BTC at 0.04 BTC/ETH',
  '6790aa000000000000000003,2025-06-05 08:45:00 UTC,Advanced Trade Sell,BTC,-0.01,EUR,"€61,000.00",€610.00,€607.56,€2.44,Sold 0.01 BTC for 650.00 USDC on BTC-USDC',
  '6790aa000000000000000004,2025-06-06 14:00:00 UTC,Advanced Trade Sell,SOL,-2,EUR,€150.00,€300.00,€298.20,€1.80,Sold 2 SOL for 298.20 EUR on SOL-EUR at 150 EUR/SOL',
].join('\n');

/**
 * Účet vedený v CZK, obchod na páru s JINOU fiat měnou (BTC-EUR): kotovací
 * strana jsou peníze, ne kryptoaktivum — žádná druhá noha nevzniká.
 */
export const COINBASE_V4_FOREIGN_FIAT_PAIR = [
  V4_HEADER,
  '6790bb000000000000000001,2025-07-01 09:00:00 UTC,Advanced Trade Sell,BTC,-0.01,CZK,"1,500,000.00","15,000.00","14,940.00",60.00,Sold 0.01 BTC for 597.60 EUR on BTC-EUR at 60000 EUR/BTC',
].join('\n');

/** Advanced Trade s poznámkou, ze které se protistrana přečíst nedá (prázdná, jiný tvar). */
export const COINBASE_V4_TRADE_BAD_NOTES = [
  V4_HEADER,
  '6790cc000000000000000001,2025-08-01 09:00:00 UTC,Advanced Trade Sell,BTC,-0.01,EUR,"€62,000.00",€620.00,€617.52,€2.48,',
  '6790cc000000000000000002,2025-08-02 09:00:00 UTC,Advanced Trade Buy,ETH,0.2,EUR,"€2,100.00",€420.00,€421.68,€1.68,Filled order on ETH-BTC',
].join('\n');

/** Výměna aktiva za nový symbol (L2d-03): úbytek starého a přírůstek nového v týž okamžik. */
export const COINBASE_V4_ASSET_MIGRATION = [
  V4_HEADER,
  '6790dd000000000000000001,2024-10-15 09:00:00 UTC,Asset Migration,MATIC,-800,EUR,€0.35,€280.00,€280.00,€0.00,',
  '6790dd000000000000000002,2024-10-15 09:00:00 UTC,Asset Migration,POL,800,EUR,€0.35,€280.00,€280.00,€0.00,',
].join('\n');

/**
 * Odměny doručené jako „Receive“ (L2d-08): tři odměny (Earn, Rewards, Referral)
 * a jeden obyčejný příjem z cizí peněženky, který zůstává tichým převodem.
 */
const receiveRows = (withId: boolean): string[] =>
  [
    '2023-04-01 09:00:00 UTC,Receive,GRT,12.5,EUR,0.10,1.25,1.25,0.00,Received 12.5 GRT from Coinbase Earn',
    '2023-05-01 09:00:00 UTC,Receive,ALGO,0.4,EUR,0.20,0.08,0.08,0.00,Received 0.4 ALGO from Coinbase Rewards',
    '2023-06-01 09:00:00 UTC,Receive,BTC,0.0002,EUR,25000.00,5.00,5.00,0.00,Received 0.0002 BTC from Coinbase Referral',
    '2023-07-01 09:00:00 UTC,Receive,BTC,0.003,EUR,27000.00,81.00,81.00,0.00,Received 0.003 BTC from an external account',
  ].map((row, index) => (withId ? `6790ee00000000000000000${index + 1},${row}` : row));

/** Tytéž řádky ve třech generacích hlavičky — chování nesmí záviset na generaci exportu. */
export const COINBASE_RECEIVE_REWARDS = {
  V4: [V4_HEADER, ...receiveRows(true)].join('\n'),
  V3: [V3_HEADER, ...receiveRows(false)].join('\n'),
  V2: [V2_HEADER, ...receiveRows(false)].join('\n'),
} as const;

/** Hlavička Trading212 exportu — protipříklad pro sniff (nesmí být false positive). */
export const T212_HEADER_SAMPLE =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)';
