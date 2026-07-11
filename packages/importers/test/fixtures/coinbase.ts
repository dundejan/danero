/**
 * Fixtures Coinbase „transaction history" CSV — všechny čtyři generace hlaviček
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

/** V2: `Total (inclusive of fees)` + `Fees` (bez „and/or Spread"). */
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

/** Hlavička Trading212 exportu — protipříklad pro sniff (nesmí být false positive). */
export const T212_HEADER_SAMPLE =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)';
