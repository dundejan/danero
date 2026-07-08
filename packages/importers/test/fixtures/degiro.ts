/**
 * Sdílené Degiro fixtures — CZ hlavičky se středníkem, EN hlavičky s čárkou,
 * NL popisy. Transactions.csv má částku v pojmenovaném sloupci a měnu
 * v bezejmenném za ní; reálné Account.csv naopak MĚNU v pojmenovaném sloupci
 * (Změna/Saldo) a částku v bezejmenném za ním.
 */

export const DEGIRO_TRANSACTIONS_HEADER_CZ =
  'Datum;Čas;Produkt;ISIN;Reference;Venue;Počet;Kurz;;Hodnota v místní měně;;Hodnota;;Směnný kurz;Transakční poplatek a/nebo poplatky třetích stran;;Celkem;;ID objednávky';

export const DEGIRO_TRANSACTIONS_CZ = [
  DEGIRO_TRANSACTIONS_HEADER_CZ,
  '10-01-2024;14:30;APPLE INC;US0378331005;NSY;XNAS;10;185,50;USD;-1855,00;USD;-1721,63;EUR;1,0775;-2,50;EUR;-1724,13;EUR;abc-123-def',
  // partial fills: dva řádky sdílejí ID objednávky ord-shared-1
  '05-03-2025;15:01;APPLE INC;US0378331005;NSY;XNAS;-6;210,00;USD;1260,00;USD;1170,00;EUR;1,0769;-1,50;EUR;1168,50;EUR;ord-shared-1',
  '05-03-2025;15:01;APPLE INC;US0378331005;NSY;XNAS;-4;210,00;USD;840,00;USD;780,00;EUR;1,0769;;;780,00;EUR;ord-shared-1',
  // prázdné ID objednávky + tisícová tečka s desetinnou čárkou
  '12-06-2025;09:00;VANGUARD FTSE AW;IE00B3RBWM25;EAM;XAMS;3;1.234,56;EUR;-3703,68;EUR;-3703,68;EUR;;-1,00;EUR;-3704,68;EUR;',
].join('\n');

export const DEGIRO_TRANSACTIONS_EN = [
  'Date,Time,Product,ISIN,Reference exchange,Venue,Quantity,Price,,Local value,,Value,,Exchange rate,Transaction and/or third party fees,,Total,,Order ID',
  '10-01-2024,14:30,APPLE INC,US0378331005,NSY,XNAS,10,185.50,USD,"-1,855.00",USD,"-1,721.63",EUR,1.0775,-2.50,EUR,"-1,724.13",EUR,en-order-1',
].join('\n');

export const DEGIRO_ACCOUNT_HEADER_CZ =
  'Datum;Čas;Datum valuty;Produkt;ISIN;Popis;Kurz;Změna;;Saldo;;ID objednávky';

export const DEGIRO_ACCOUNT_CZ = [
  DEGIRO_ACCOUNT_HEADER_CZ,
  '02-01-2024;10:00;02-01-2024;;;Vklad;;CZK;10000,00;CZK;10000,00;',
  // echo obchodu — bere se z Transactions.csv, jinak dvojí import
  '10-01-2024;14:30;12-01-2024;APPLE INC;US0378331005;Nákup 10 Apple Inc@185,5 USD (NSY);1,0775;EUR;-1721,63;EUR;8278,37;abc-123-def',
  '10-01-2024;14:30;12-01-2024;APPLE INC;US0378331005;Konverze měny;1,0775;USD;-1855,00;USD;0,00;',
  '01-02-2024;08:00;01-02-2024;;;Poplatek za připojení na burzu 2024 (Euronext Amsterdam - EAM);;EUR;-2,50;EUR;8275,87;',
  '15-03-2024;09:12;15-03-2024;APPLE INC;US0378331005;Dividenda;;USD;24,00;USD;24,00;',
  '15-03-2024;09:12;15-03-2024;APPLE INC;US0378331005;Daň z dividendy;;USD;-3,60;USD;20,40;',
  '01-04-2024;00:05;01-04-2024;;;Úrok;;EUR;1,25;EUR;8277,12;',
  // změna ISIN: párové řádky odpis+připis; odpis má víceřádkový popis v uvozovkách
  '20-05-2024;12:00;20-05-2024;VANGUARD FTSE AW;IE00B3RBWM25;"Změna ISIN: Odpis 3 ks\nnový ISIN IE00BK5BQT80";;;;EUR;8277,12;',
  '20-05-2024;12:00;20-05-2024;VANGUARD FTSE AW;IE00BK5BQT80;Změna ISIN: Připis 3 ks;;;;EUR;8277,12;',
  '01-06-2024;10:00;01-06-2024;;;Výběr;;EUR;-500,00;EUR;7777,12;',
  '03-06-2024;01:00;03-06-2024;;;Degiro Cash Sweep;;EUR;100,00;EUR;7877,12;',
  // informativní řádek s prázdnou Změnou → žádný záznam
  '04-06-2024;09:00;04-06-2024;;;Dividenda;;;;EUR;7877,12;',
].join('\n');

/** NL popisy + čárkový oddělovač (čísla s desetinnou čárkou proto v uvozovkách). */
export const DEGIRO_ACCOUNT_NL = [
  'Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id',
  '02-01-2024,09:00,02-01-2024,,,iDEAL storting,,EUR,"1.000,00",EUR,"1.000,00",',
  '05-01-2024,10:00,05-01-2024,ASML HOLDING,NL0010273215,Dividend,,EUR,"10,00",EUR,"1.010,00",',
  '05-01-2024,10:00,05-01-2024,ASML HOLDING,NL0010273215,Dividendbelasting,,EUR,"-1,50",EUR,"1.008,50",',
  '06-01-2024,02:00,06-01-2024,,,Flatex Interest Income,,EUR,"0,10",EUR,"1.008,60",',
  '07-01-2024,11:00,07-01-2024,ASML HOLDING,NL0010273215,"Koop 2 ASML Holding@600,00 EUR (XEAM)",,EUR,"-1.200,00",EUR,"-191,40",order-nl-1',
  '08-01-2024,12:00,08-01-2024,,,Terugstorting,,EUR,"-200,00",EUR,"-391,40",',
  '09-01-2024,13:00,09-01-2024,,,Rente,,EUR,"-0,75",EUR,"-392,15",',
  // fúze: párové řádky s počty kusů v popisu → ratio 10:5
  '10-02-2024,12:00,10-02-2024,OLD CORP,US1111111117,FUSIE: Uitboeking 10 aandelen OLD CORP,,,,EUR,"-392,15",',
  '10-02-2024,12:00,10-02-2024,NEW CORP,US2222222226,FUSIE: Inboeking 5 aandelen NEW CORP,,,,EUR,"-392,15",',
].join('\n');
