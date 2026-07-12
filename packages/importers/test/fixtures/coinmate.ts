/**
 * Coinmate fixtures — řádky doslova podle důkazů (WhaleBooks/everytrade).
 * CSV se středníkem; tři varianty transakční historie (EN krátká, EN dlouhá
 * se zůstatky, CZ s BOM a českým datem) + „account statement“ V2, kde je
 * měna PŘED hodnotou (Currency amount;Amount) a směr nese Type detail.
 */

export const COINMATE_HEADER_EN_LONG =
  'ID;Date;Account;Type;Amount;Amount Currency;Price;Price Currency;Fee;Fee Currency;Total;Total Currency;Description;Status;First balance after;First balance after Currency;Second balance after;Second balance after Currency';

/** EN dlouhá varianta — ukázkové řádky doslova z výzkumu. */
export const COINMATE_EN_LONG = [
  COINMATE_HEADER_EN_LONG,
  '1;2020-07-31 06:39:40;M;WITHDRAWAL;-2.47984252;LTC; ; ;0.0004;LTC;-2.48024252;LTC;b3;COMPLETED;0;LTC; ;',
  '2;2020-07-30 12:31:41;M;QUICK_BUY;0.98398872;LTC;46.49;EUR;0.11436408;EUR;-45.85999967;EUR;;OK;2.48024252;LTC;0.00580748;EUR',
  '3;2020-07-30 12:31:14;M;QUICK_SELL;-1;LTC;45.98;EUR;0.11495;EUR;45.86505;EUR;;OK;1.4962538;LTC;45.86580715;EUR',
  '7722246;2021-03-21 18:54:15;M;QUICK_BUY;0.01574751;BTC;1265612.25778996;CZK;69.75584587;CZK;-19999.99753154;CZK;;OK;0.01574751;BTC;0.00591488;CZK',
].join('\n');

/** EN krátká varianta (bez Account a zůstatků) + REFERRAL odměna. */
export const COINMATE_EN_SHORT = [
  'ID;Date;Type;Amount;Amount Currency;Price;Price Currency;Fee;Fee Currency;Total;Total Currency;Description;Status',
  '55501;2021-08-16 09:42:11;BUY;0.005;BTC;982000.5;CZK;12.25;CZK;-4922.25;CZK;;OK',
  '55502;2021-08-17 10:00:00;SELL;-0.002;BTC;1000000;CZK;5;CZK;1995;CZK;;OK',
  '55503;2021-08-18 10:00:00;REFERRAL;0.0001;BTC; ; ; ; ;0.0001;BTC;odměna;OK',
].join('\n');

/**
 * CZ hlavička s BOM, české datum `16.08.2021 9:42` (čísla i tady s desetinnou
 * TEČKOU!), MARKET_* typy, DEPOSIT, affiliate s prázdným Typem a Popiskem
 * „User: …“, interní přesun zůstatku.
 */
export const COINMATE_CZ =
  '\uFEFF' +
  [
    'ID;Datum;Účet;Typ;Částka;Částka měny;Cena;Cena měny;Poplatek;Poplatek měny;Celkem;Celkem měny;Popisek;Status;První zůstatek po;První zůstatek po měně;Druhý zůstatek po;Druhý zůstatek po měně',
    '9001;16.08.2021 9:42;M;MARKET_BUY;0.5;LTC;3500.25;CZK;4.2;CZK;-1754.33;CZK;;OK;0.5;LTC;100;CZK',
    '9002;17.08.2021 14:05;M;MARKET_SELL;-0.5;LTC;3600;CZK;4.5;CZK;1795.5;CZK;;OK;0;LTC;1895.5;CZK',
    '9003;18.08.2021 8:00;M;DEPOSIT;10000;CZK; ; ; ; ;10000;CZK;bankovní převod;OK;0;LTC;11895.5;CZK',
    '9004;19.08.2021 8:00;M;;5.5;CZK; ; ; ; ;5.5;CZK;User: novak123;OK;0;LTC;11901;CZK',
    '9005;20.08.2021 8:00;M;BALANCE_MOVE_CREDIT;100;CZK; ; ; ; ;100;CZK;;OK;0;LTC;12001;CZK',
  ].join('\n');

/**
 * V2 „account statement“: měna v „Currency …“ sloupcích PŘED hodnotou,
 * Type = Trade/Quick trade + Type detail (CANCEL = zrušený obchod).
 * První řádek doslova z výzkumu.
 */
export const COINMATE_V2 = [
  'Transaction id;Date;Email;Name;Type;Type detail;Currency amount;Amount;Currency price;Price;Currency fee;Fee;Currency total;Total;Description;Status;First balance after currency;First balance after;Second balance after currency;Second balance after',
  '1;2020-02-10 17:03:48;mail;N;Trade;BUY;BTC;0.02579386;EUR;9010.2;EUR;0.46481567;EUR;-232.87265304;;OK;BTC;2.07004432;EUR;82435.503831',
  '2;2020-03-05 10:15:00;mail;N;Quick trade;QUICK_SELL;BTC;-0.01;EUR;8500;EUR;0.425;EUR;84.575;;OK;BTC;2.06004432;EUR;82520.078831',
  '3;2020-03-06 11:00:00;mail;N;Trade;CANCEL;BTC;0.01;EUR;8600;EUR;0;EUR;-86;;OK;BTC;2.06004432;EUR;82520.078831',
  '4;2020-03-07 12:00:00;mail;N;Affiliate; ;CZK;25.5; ; ; ; ;CZK;25.5;;OK;CZK;25.5;EUR;82520.078831',
].join('\n');

/** Chybové a přeskakované řádky: cizí stav, neznámý typ, rozbité datum a částka. */
export const COINMATE_BAD_ROWS = [
  'ID;Date;Type;Amount;Amount Currency;Price;Price Currency;Fee;Fee Currency;Total;Total Currency;Description;Status',
  '77001;2021-01-01 10:00:00;BUY;0.1;BTC;500000;CZK;0;CZK;-50000;CZK;;PENDING',
  '77002;2021-01-02 10:00:00;LOAN;0.1;BTC;500000;CZK;0;CZK;-50000;CZK;;OK',
  '77003;nesmysl;BUY;0.1;BTC;500000;CZK;0;CZK;-50000;CZK;;OK',
  '77004;2021-01-04 10:00:00;BUY;abc;BTC;500000;CZK;0;CZK;-50000;CZK;;OK',
].join('\n');
