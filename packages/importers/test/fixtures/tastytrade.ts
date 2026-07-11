/**
 * Fixtures Tastytrade — CSV s čárkou, řádky řazené od NEJNOVĚJŠÍHO.
 * Tři generace hlaviček: nová 20sloupcová, 21sloupcová (navíc „Total")
 * a legacy 15sloupcová (tastyworks). Hodnoty doslova podle reálných exportů
 * (offset bez dvojtečky, literál „--", kvótované tisíce).
 */

export const TASTY_V2_HEADER =
  'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Currency';

export const TASTY_V2_TOTAL_HEADER =
  'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Total,Currency';

export const TASTY_LEGACY_HEADER =
  'Date/Time,Transaction Code,Transaction Subcode,Symbol,Buy/Sell,Open/Close,Quantity,Expiration Date,Strike,Call/Put,Price,Fees,Amount,Description,Account Reference';

/** Mapování symbolů na ISIN (Tastytrade ISIN neexportuje); ICSH záměrně chybí. */
export const TASTY_INSTRUMENT_MAP = {
  SCHG: { isin: 'US8085247976' },
  AAPL: { isin: 'US0378331005' },
};

/**
 * Nový formát: short call, assignment short putu (zánik opce + akciová noha),
 * expirace short callu (tracker!), dividenda + záporná srážka, úrok, poplatek,
 * vklad. Kvótované tisíce i literál „--".
 */
export const TASTY_V2 = [
  TASTY_V2_HEADER,
  '2024-08-16T15:57:13+0200,Trade,Sell to Open,SELL_TO_OPEN,SCHG  240920C00099000,Equity Option,Sold 1 SCHG 09/20/24 Call 99.00 @ 3.70,370.00,1,370.00,-1.00,-0.15,100,SCHG,SCHG,9/20/24,99,CALL,337454037,USD',
  '2024-08-05T23:00:00+0200,Receive Deliver,Assignment,,SCHG  240816P00103000,Equity Option,Removal of option due to assignment,0.00,1,0.00,--,0.00,100,SCHG,SCHG,8/16/24,103,PUT,,USD',
  '2024-08-05T23:00:00+0200,Receive Deliver,Buy to Open,BUY_TO_OPEN,SCHG,Equity,Buy to Open 100 SCHG @ 103.00,"-10,300.00",100,-103.00,--,-5.00,,,,,,,,USD',
  '2024-07-19T16:30:00+0200,Trade,Sell to Open,SELL_TO_OPEN,SCHG  240816P00103000,Equity Option,Sold 1 SCHG 08/16/24 Put 103.00 @ 2.05,205.00,1,205.00,-1.00,-0.14,100,SCHG,SCHG,8/16/24,103,PUT,336999001,USD',
  '2024-01-03T14:00:00+0200,Money Movement,Deposit,,,,Wire Funds Received,"1,000.00",0,,--,0.00,,,,,,,,USD',
  '2023-12-01T08:00:00+0100,Money Movement,Fee,,,,MONTHLY WIRE FEE,-1.00,0,,--,0.00,,,,,,,,USD',
  '2023-11-01T08:00:00+0100,Money Movement,Credit Interest,,,,INTEREST ON CREDIT BALANCE,0.91,0,,--,0.00,,,,,,,,USD',
  '2023-10-06T23:00:00+0200,Money Movement,Dividend,,ICSH,Equity,ISHARES TRUST,-3.02,0,,--,0.00,,,,,,,,USD',
  '2023-10-04T23:00:00+0200,Money Movement,Dividend,,ICSH,Equity,ISHARES TRUST,20.15,0,,--,0.00,,,,,,,,USD',
  '2021-06-18T23:00:00+0200,Receive Deliver,Expiration,,CLNE  210618C00014000,Equity Option,Removal of 1.0 CLNE 06/18/21 Call 14.00 due to expiration.,0.00,1,0.00,--,0.00,100,CLNE,CLNE,6/18/21,14,CALL,,USD',
  '2021-05-20T17:10:00+0200,Trade,Sell to Open,SELL_TO_OPEN,CLNE  210618C00014000,Equity Option,Sold 1 CLNE 06/18/21 Call 14.00 @ 0.95,95.00,1,95.00,-1.00,-0.14,100,CLNE,CLNE,6/18/21,14,CALL,335000001,USD',
].join('\n');

/** 21sloupcová varianta (navíc „Total") — 2 kontrakty, prémie za kontrakt = |Value| / 2. */
export const TASTY_V2_TOTAL = [
  TASTY_V2_TOTAL_HEADER,
  '2024-08-16T15:57:13+0200,Trade,Sell to Open,SELL_TO_OPEN,SCHG  240920C00099000,Equity Option,Sold 2 SCHG 09/20/24 Call 99.00 @ 3.70,740.00,2,370.00,-2.00,-0.30,100,SCHG,SCHG,9/20/24,99,CALL,337454037,737.70,USD',
].join('\n');

/** Legacy formát (tastyworks): trade akcie i opce, expirace přes tracker, úrok, vklad. */
export const TASTY_LEGACY = [
  TASTY_LEGACY_HEADER,
  '06/18/2021 11:00 PM,Receive Deliver,Expiration,CLNE,,,1,06/18/2021,14,C,,0.00,0.00,Removal of 1 CLNE 06/18/21 Call 14.00 due to expiration.,Individual XXX39',
  '05/20/2021 5:10 PM,Trade,Sell to Open,CLNE,Sell,Open,1,06/18/2021,14,C,0.95,1.14,95.00,Sold 1 CLNE 06/18/21 Call 14.00 @ 0.95,Individual XXX39',
  '03/02/2021 10:30 AM,Trade,Buy to Open,AAPL,Buy,Open,10,,,,120.50,0.08,-1205.00,Bought 10 AAPL @ 120.50,Individual XXX39',
  '02/01/2021 9:00 AM,Money Movement,Credit Interest,,,,0,,,,,0.00,0.42,INTEREST ON CREDIT BALANCE,Individual XXX39',
  '01/02/2021 9:00 AM,Money Movement,Deposit,,,,0,,,,,0.00,"1,200.00",ACH DEPOSIT,Individual XXX39',
].join('\n');

/** Expirace bez otevření pozice ve výpisu → směr nejde určit → warning + skip. */
export const TASTY_V2_ORPHAN_EXPIRATION = [
  TASTY_V2_HEADER,
  '2021-06-18T23:00:00+0200,Receive Deliver,Expiration,,CLNE  210618C00014000,Equity Option,Removal of 1.0 CLNE 06/18/21 Call 14.00 due to expiration.,0.00,1,0.00,--,0.00,100,CLNE,CLNE,6/18/21,14,CALL,,USD',
].join('\n');

/** Nepodporovaný instrument (Future) → warning + skip. */
export const TASTY_V2_FUTURE = [
  TASTY_V2_HEADER,
  '2024-03-01T10:00:00+0100,Trade,Buy to Open,BUY_TO_OPEN,/ESM4,Future,Bought 1 /ESM4,-100.00,1,-100.00,--,-1.25,50,/ES,/ES,6/21/24,,,123456,USD',
].join('\n');

/** Neznámý podtyp peněžního pohybu → error s doslovným zněním. */
export const TASTY_V2_UNKNOWN_MOVEMENT = [
  TASTY_V2_HEADER,
  '2024-02-01T10:00:00+0100,Money Movement,Crypto Reward,,,,REWARD,1.00,0,,--,0.00,,,,,,,,USD',
].join('\n');

/** Záporná dividenda (srážka) bez párové kladné dividendy → warning. */
export const TASTY_V2_UNMATCHED_TAX = [
  TASTY_V2_HEADER,
  '2023-10-06T23:00:00+0200,Money Movement,Dividend,,XOM,Equity,EXXON MOBIL CORP,-1.50,0,,--,0.00,,,,,,,,USD',
].join('\n');

/** BUY akcie bez mapování symbolu → error + unmappedSymbols. */
export const TASTY_V2_UNMAPPED = [
  TASTY_V2_HEADER,
  '2024-05-02T15:00:00+0200,Trade,Buy to Open,BUY_TO_OPEN,TSLA,Equity,Buy to Open 2 TSLA @ 180.00,-360.00,2,-180.00,--,-0.16,,,,,,,,USD',
].join('\n');

/** YTD daňový export z Tax Center — jiný soubor, odmítá se s návodem. */
export const TASTY_YTD = [
  'ACCOUNT_NR,SEC_TYPE,SEC_SUBTYPE,SYMBOL,SEC_DESCRIPTION,8949_CODE,OPEN_DATE,CLOSE_DATE,QUANTITY,COST,PROCEEDS,GAIN_LOSS',
  'XXX123,EQUITY,COMMON,AAPL,APPLE INC,A,01/02/2024,03/04/2024,10,1000.00,1200.00,200.00',
].join('\n');
