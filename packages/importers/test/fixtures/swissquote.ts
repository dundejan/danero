/**
 * Sdílené Swissquote fixtures — středníkové CSV, EN 13 sloupců a DE 15 sloupců.
 * Datové řádky EN kopírují doslova doložené vzorky (vč. částečných exekucí
 * téže objednávky — každý řádek je samostatná transakce).
 */

export const SWISSQUOTE_HEADER_EN =
  'Date;Order #;Transaction;Symbol;Name;ISIN;Quantity;Unit price;Costs;Accrued Interest;Net Amount;Balance;Currency';

export const SWISSQUOTE_EN = [
  SWISSQUOTE_HEADER_EN,
  '10-08-2022 15:30:02;113947121;Buy;ORFN;CONSTRAINED CAPITAL ESG ORPHAN;US8863645383;200.0;19.85;5.96;0.00;-3975.96;168660.08;USD',
  '09-08-2022 10:37:37;113880776;Sell;VDEM;VANGUARD FTSE EMERG MARKET UCI;IE00B3VVMM84;537.0;55.945;180.91;0.00;29861.56;304217.01;USD',
  // dividenda bez srážky: Costs 0 → withholding 0
  '30-06-2022 16:35:13;00000000;Dividend;VEUD;VANGUARD FTSE EUROPE UCITS ETF;IE00B945VV12;1.0;486.58;0.00;0.00;486.58;941.93;EUR',
  // dividenda se srážkou v Costs: |85| = 100 − 15 → withholding 15
  '15-03-2023 10:00:00;00000000;Dividend;AAPL;APPLE INC;US0378331005;1.0;100.00;15.00;0.00;85.00;1026.93;USD',
  '30-06-2022 18:01:13;00000000;Custody Fees;;;;1.0;50.00;3.85;0.00;-53.85;28197.90;CHF',
  '23-08-2022 12:00:25;114723639;Forex credit;;;;1.0;1995.39;0.00;0.00;1995.39;2937.32;EUR',
  // částečné exekuce téže objednávky 106824458 — dvě samostatné transakce
  '10-05-2022 14:31:42;106824458;Sell;WDSC;MSCI WS CAP ETF;IE00BCBJG560;367.0;86.08;157.39;0.00;31433.97;88372.66;USD',
  '10-05-2022 14:31:42;106824458;Sell;WDSC;MSCI WS CAP ETF;IE00BCBJG560;6.0;86.09;26.62;0.00;489.92;56938.69;USD',
  '31-12-2022 23:59:59;00000000;Interests;;;;1.0;12.34;0.00;0.00;12.34;500.00;CHF',
  // GBX kotace: pence → GBP, cena/100, fee 7.00/100 = 0.07 GBP
  "05-01-2023 09:00:00;120000001;Buy;HSBA;HSBC HOLDINGS;GB0005405286;10.0;700.5;7.00;0.00;-7'012.00;999.00;GBX",
  // švýcarské tisícové apostrofy v počtu kusů i částce
  "20-02-2023 10:15:00;120000002;Buy;CSGN;CS GROUP;CH0012138530;1'000.0;2.85;12.50;0.00;-2'862.50;5000.00;CHF",
].join('\n');

export const SWISSQUOTE_HEADER_DE =
  'Datum;Auftrag #;Transaktionen;Symbol;Name;ISIN;Anzahl;Stückpreis;Kosten;Aufgelaufene Zinsen;Nettobetrag;Währung Nettobetrag;Nettobetrag in der Währung des Kontos;Saldo;Währung';

/** Varianta 13. sloupce „Nettobetrag in Kontowährung“ (mapuje se podle názvů, ne pozičně). */
export const SWISSQUOTE_HEADER_DE_ALT =
  'Datum;Auftrag #;Transaktionen;Symbol;Name;ISIN;Anzahl;Stückpreis;Kosten;Aufgelaufene Zinsen;Nettobetrag;Währung Nettobetrag;Nettobetrag in Kontowährung;Saldo;Währung';

/**
 * DE 15 sloupců: měna transakce je „Währung Nettobetrag“ (12. sloupec),
 * poslední „Währung“ je měna subúčtu — nákup v EUR na CHF subúčtu to prověří.
 */
export const SWISSQUOTE_DE = [
  SWISSQUOTE_HEADER_DE,
  '12-01-2023 14:00:00;123456789;Kauf;VWRL;VANGUARD FTSE ALL-WORLD;IE00B3RBWM25;10.0;95.50;9.55;0.00;-964.55;EUR;-950.20;5000.00;CHF',
  '20-06-2023 11:30:00;123456790;Verkauf;VWRL;VANGUARD FTSE ALL-WORLD;IE00B3RBWM25;5.0;101.00;5.05;0.00;499.95;EUR;489.90;5500.00;CHF',
  // dividenda se srážkou 35 % v Kosten: |65| = 100 − 35 → withholding 35
  '30-06-2023 09:00:00;00000000;Dividende;NESN;NESTLE SA;CH0038863350;1.0;100.00;35.00;0.00;65.00;CHF;65.00;5600.00;CHF',
  '30-09-2023 18:00:00;00000000;Depotgebühren;;;;1.0;50.00;3.85;0.00;-53.85;CHF;-53.85;5546.15;CHF',
  '31-12-2023 23:59:00;00000000;Zinsen;;;;1.0;10.00;0.00;0.00;10.00;CHF;10.00;5556.15;CHF',
  '31-12-2023 23:59:30;00000000;Zinsen auf Belastungen;;;;1.0;2.00;0.00;0.00;-2.00;CHF;-2.00;5554.15;CHF',
  '05-05-2023 10:00:00;123456791;Forex-Gutschrift;;;;1.0;1000.00;0.00;0.00;1000.00;EUR;980.00;6000.00;CHF',
  '02-01-2023 08:00:00;00000000;Vergütung;;;;1.0;5000.00;0.00;0.00;5000.00;CHF;5000.00;5000.00;CHF',
  '10-10-2023 10:00:00;00000000;Rückzahlung;CSGN;CS GROUP;CH0012138530;20.0;2.50;0.00;0.00;50.00;CHF;50.00;5606.15;CHF',
].join('\n');

export const SWISSQUOTE_DE_ALT = [
  SWISSQUOTE_HEADER_DE_ALT,
  '12-01-2023 14:00:00;123456789;Kauf;VWRL;VANGUARD FTSE ALL-WORLD;IE00B3RBWM25;10.0;95.50;9.55;0.00;-964.55;EUR;-950.20;5000.00;CHF',
].join('\n');

/**
 * DE hlavička s rozbitými přehláskami (UTF-8 dekódované jako Latin-1 →
 * „Ã¼“/„Ã¤“): mapování musí přežít díky fuzzy shodě přes normalizeHeader.
 */
export const SWISSQUOTE_DE_BROKEN_UMLAUTS = [
  'Datum;Auftrag #;Transaktionen;Symbol;Name;ISIN;Anzahl;StÃ¼ckpreis;Kosten;Aufgelaufene Zinsen;Nettobetrag;WÃ¤hrung Nettobetrag;Nettobetrag in der WÃ¤hrung des Kontos;Saldo;WÃ¤hrung',
  '12-01-2023 14:00:00;123456789;Kauf;VWRL;VANGUARD FTSE ALL-WORLD;IE00B3RBWM25;10.0;95.50;9.55;0.00;-964.55;EUR;-950.20;5000.00;CHF',
  '30-09-2023 18:00:00;00000000;DepotgebÃ¼hren;;;;1.0;50.00;3.85;0.00;-53.85;CHF;-53.85;5546.15;CHF',
].join('\n');

/** Dividenda s Costs > 0, ale netto nesedí na brutto−costs → withholding 0 + warning. */
export const SWISSQUOTE_DIVIDEND_MISMATCH = [
  SWISSQUOTE_HEADER_EN,
  '15-03-2023 10:00:00;00000000;Dividend;AAPL;APPLE INC;US0378331005;1.0;100.00;15.00;0.00;100.00;1000.00;USD',
].join('\n');

/** Neznámý typ transakce → error s doslovným zněním. */
export const SWISSQUOTE_UNKNOWN_TYPE = [
  SWISSQUOTE_HEADER_EN,
  '01-01-2023 10:00:00;00000000;Mystery Op;;;;1.0;1.00;0.00;0.00;1.00;1.00;CHF',
].join('\n');

/** Nesmyslné kalendářní datum → error s číslem řádku. */
export const SWISSQUOTE_BAD_DATE = [
  SWISSQUOTE_HEADER_EN,
  '31-13-2022 10:00:00;113947121;Buy;ORFN;CONSTRAINED CAPITAL;US8863645383;200.0;19.85;5.96;0.00;-3975.96;168660.08;USD',
].join('\n');

/** Dva identické řádky (legitimní duplicitní operace) — id musí dostat suffix. */
export const SWISSQUOTE_IDENTICAL_ROWS = [
  SWISSQUOTE_HEADER_EN,
  '30-06-2022 18:01:13;00000000;Custody Fees;;;;1.0;50.00;3.85;0.00;-53.85;28197.90;CHF',
  '30-06-2022 18:01:13;00000000;Custody Fees;;;;1.0;50.00;3.85;0.00;-53.85;28197.90;CHF',
].join('\n');
