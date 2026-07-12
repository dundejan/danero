/**
 * Fixtures Charles Schwab — CSV s čárkou, všechna pole v uvozovkách (starší
 * exporty mají titulní řádek, koncovou čárku a footer; ojediněle i neuvozené
 * řádky). Hlavičky a tvary hodnot doslova podle reálných exportů.
 */

export const SCHWAB_HEADER =
  '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"';

/** Mapování symbolů na ISIN (Schwab ISIN neexportuje). */
export const SCHWAB_INSTRUMENT_MAP = {
  BND: { isin: 'US9219378356' },
  FB: { isin: 'US30303M1027' },
  GEV: { isin: 'US36828A1016' },
};

/** Moderní export: obchody, reinvestice, dividendy + srážky, úrok, poplatky, převody. */
export const SCHWAB_MODERN = [
  SCHWAB_HEADER,
  '"04/03/2024","Spin-off","GEV","GE VERNOVA INC","25","","",""',
  '"09/01/2023","Foreign Tax Paid","NOVN","NOVARTIS AG","","","","-$1.20"',
  '"05/01/2023","Cash Dividend","GIS","GENERAL MILLS INC","","","","$0.55"',
  '"04/27/2023","Buy","BND","VANGUARD TOTAL BOND MARKET ETF","45","$73.7789","","-$3320.05"',
  '"04/10/2023","Reinvest Shares","BND","VANGUARD TOTAL BOND MARKET ETF","0.0249","$73.8993","","-$1.84"',
  '"04/10/2023","Qual Div Reinvest","BND","VANGUARD TOTAL BOND MARKET ETF","","","","$1.84"',
  '"02/05/2023","NRA Tax Adj","GIS","GENERAL MILLS INC","","","","-$0.08"',
  '"02/01/2023","Qualified Dividend","GIS","GENERAL MILLS INC","","","","$0.54"',
  '"06/30/2021","Service Fee","","ACCOUNT SERVICE FEE","","","","-$25.00"',
  '"03/15/2021","Margin Interest","","MARGIN INTEREST","","","","-$3.21"',
  '"01/04/2021","Journal","","TDA TO CS&CO TRANSFER","","","","$1000.00"',
  '"12/31/2020","Bank Interest","","SCHWAB1 INT 12/01-12/31","","","","$0.11"',
  '"11/05/2020","Sell","FB","FACEBOOK INC CLASS A","100","$261.50","$6.06","$26143.94"',
].join('\n');

/**
 * Starší export: titulní řádek před hlavičkou, koncová čárka (prázdný
 * 9. sloupec), neuvozený řádek, „as of“ datum, Expired opce, split, footer.
 */
export const SCHWAB_LEGACY = [
  '"Transactions  for account Individual XXXX-1234 as of 07/20/2024 22:00:00 ET"',
  '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount",',
  '07/15/2024 as of 07/12/2024,Stock Split,AVGO,BROADCOM INC,9,$170.067,,',
  '"12/31/2020","Non-Qualified Div","ARKK","ARK INNOVATION ETF","","","","$0.09"',
  '"11/05/2020","Sell","FB","FACEBOOK INC CLASS A","100","$261.50","$6.06","$26143.94",',
  '"04/01/2020 as of 03/31/2020","Expired","SPY 03/31/2020 284.00 P","PUT SPDR S&P 500 $284 EXP 03/31/21","-1","","","",',
  '"03/02/2020","Buy to Open","SPY 03/31/2020 284.00 P","PUT SPDR S&P 500 $284 EXP 03/31/21","1","$5.30","$0.65","-$530.65",',
  '"Transactions Total","","","","","","","$25612.33"',
].join('\n');

/** Opce: otevření/uzavření short pozic a expirace short call (kladná Quantity → BUY @ 0). */
export const SCHWAB_OPTIONS = [
  SCHWAB_HEADER,
  '"04/01/2020 as of 03/31/2020","Expired","QQQ 03/31/2020 300.00 C","CALL INVESCO QQQ $300 EXP 03/31/20","1","","",""',
  '"03/25/2020","Buy to Close","SPY 03/31/2020 284.00 P","PUT SPDR S&P 500 $284 EXP 03/31/21","2","$2.10","$1.30","-$421.30"',
  '"03/20/2020","Sell to Open","SPY 03/31/2020 284.00 P","PUT SPDR S&P 500 $284 EXP 03/31/21","2","$5.30","$1.30","$1058.70"',
  '"03/10/2020","Sell to Open","QQQ 03/31/2020 300.00 C","CALL INVESCO QQQ $300 EXP 03/31/20","1","$3.00","$0.65","$299.35"',
].join('\n');

/** Jiné pořadí sloupců — mapování musí jít podle názvů, ne indexů. */
export const SCHWAB_REORDERED = [
  '"Action","Date","Amount","Symbol","Description","Quantity","Price","Fees & Comm"',
  '"Buy","01/10/2024","-$500.00","BND","VANGUARD TOTAL BOND MARKET ETF","10","$50.00",""',
].join('\n');

/** BUY/SELL nezmapovaného symbolu → error + unmappedSymbols; dividenda projde bez ISIN. */
export const SCHWAB_UNMAPPED = [
  SCHWAB_HEADER,
  '"03/15/2023","Cash Dividend","XYZ","XYZ CORP","","","","$1.00"',
  '"03/02/2023","Buy","XYZ","XYZ CORP","5","$5.10","","-$25.50"',
  '"03/01/2023","Buy","XYZ","XYZ CORP","10","$5.00","","-$50.00"',
].join('\n');

/** Prázdný export: titulní řádek + hlavička + řádek `""`. */
export const SCHWAB_EMPTY_EXPORT = [
  '"Transactions  for account Individual XXXX-1234 as of 01/05/2021 10:00:00 ET"',
  SCHWAB_HEADER,
  '""',
].join('\n');

/** Export z bankovního (šekového) účtu Schwab — jiný produkt, odmítá se s vysvětlením. */
export const SCHWAB_BANK = [
  '"Date","Type","Check #","Description","Withdrawal (-)","Deposit (+)","RunningBalance"',
  '"01/02/2024","ACH","","XYZ PAYMENT","","$100.00","$100.00"',
].join('\n');
