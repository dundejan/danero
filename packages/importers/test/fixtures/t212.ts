/** Sdílená T212 fixture — sloupce dle reálného exportu (kategorie Orders/Dividends/Transactions/Interest). */
export const T212_HEADER =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)';

export const T212_FIXTURE = [
  T212_HEADER,
  'Deposit,2024-01-05 08:00:00,,,,,,,,,,10000.00,CZK,,,,,,',
  'Currency conversion,2024-01-06 08:00:00,,,,,,,,,,5000.00,CZK,,,,,,',
  'Market buy,2024-01-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,0.0435,,,428000.00,CZK,,,,EOF1001,2.10,CZK',
  'Market sell,2025-03-05 15:01:10,US0378331005,AAPL,Apple Inc,100,210.00,USD,0.0448,1000.00,CZK,468000.00,CZK,,,,EOF1002,3.00,CZK',
  // „Price / share“ je u dividendy ČISTÁ částka na kus (0,25 vyhlášeno, po 15% srážce 0,2125)
  'Dividend (Dividends paid by us corporations),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,100,0.2125,USD,,,,500.00,CZK,3.75,USD,,,,',
  'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
  'Withdrawal,2025-06-01 08:00:00,,,,,,,,,,2000.00,CZK,,,,,,',
].join('\n');

/**
 * Export z léta 2026 podle SKUTEČNÉHO souboru Janova účtu.
 *
 * Oproti `T212_HEADER` se liší třemi věcmi naráz a každá je past:
 *  - sloupec „Time“ se jmenuje **„Time (UTC)“** (kvůli tomu se 9. 8. 2026
 *    přestal export poznávat úplně — viz `TRADING212_TIME_COLUMNS`),
 *  - čas nese offset (`+00:00`), takže z něj datum jde vzít jen useknutím,
 *  - přibyly sloupce „Merchant name“/„Merchant category“ a pořadí je jiné
 *    (Notes a ID hned za Name) — proto se mapuje podle NÁZVŮ, ne pozic.
 */
export const T212_HEADER_2026 =
  'Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Currency conversion from amount,Currency (Currency conversion from amount),Currency conversion to amount,Currency (Currency conversion to amount),Currency conversion fee,Currency (Currency conversion fee),Merchant name,Merchant category';

export const T212_FIXTURE_2026 = [
  T212_HEADER_2026,
  'Interest on cash,2026-08-01 01:12:23+00:00,,,,"Interest on cash",019fbae1-1cf5-75db-977b-66aa550d021f,,,,,,,0.32,"CZK",,,,,,,,,,',
  'Card debit,2026-08-01 08:10:22+00:00,,,,,019fc06a-9f89-7b55-8fc3-c2e29d0b5934,,,,,,,-22.39,"EUR",,,,,,,0.00,"CHF","Swiss Federal Railways","TRANSPORT"',
  'Spending cashback,2026-08-02 01:02:39+00:00,,,,,019fbffe-91ba-7da1-9203-4ddd1b5013ac,,,,,,,0.06,"EUR",,,,,,,,,,',
  'Market buy,2026-02-10 14:30:02+00:00,US0378331005,AAPL,Apple Inc,,019fbae1-0000-7000-8000-000000000001,10,185.50,USD,0.0435,,,42800.00,CZK,,,,,,,2.10,CZK,,',
  'Market sell,2026-03-05 15:01:10+00:00,US0378331005,AAPL,Apple Inc,,019fbae1-0000-7000-8000-000000000002,10,210.00,USD,0.0448,1000.00,CZK,46800.00,CZK,,,,,,,3.00,CZK,,',
  'Dividend (Dividends paid by us corporations),2026-04-01 09:00:00+00:00,US0378331005,AAPL,Apple Inc,,019fbae1-0000-7000-8000-000000000003,10,0.212,USD,,,,50.00,CZK,0.38,USD,,,,,,,,',
].join('\n');

/**
 * Hodnoty sloupce Action, které v Janově exportu nejsou, ale dokládají je cizí
 * parsery exportu T212: vratka platby kartou, připsání a převody kusů,
 * jednořádkový split a oprava dividendy. Rozložení je z léta 2026, **tituly,
 * částky i časy jsou smyšlené**.
 *
 * Tři řádky (Stop limit buy, Dividend (Interest), Lending interest) jsou tu
 * jako kontrola, že se o ně nová pravidla neotřou.
 */
export const T212_FIXTURE_ACTIONS_2026 = [
  T212_HEADER_2026,
  'Market buy,2026-02-10 14:30:02+00:00,US0000000001,AAA,Alfa Inc,,id-1,10,20.00,USD,0.045,,,4400.00,CZK,,,,,,,1.10,CZK,,',
  'Stop limit buy,2026-02-11 14:30:02+00:00,US0000000001,AAA,Alfa Inc,,id-2,5,21.00,USD,0.045,,,2300.00,CZK,,,,,,,0.60,CZK,,',
  'Card refund,2026-03-01 10:00:00+00:00,,,,,id-3,,,,,,,150.00,CZK,,,,,,,,,Obchod Test,SHOPPING',
  'Stock distribution,2026-03-05 10:00:00+00:00,US0000000001,AAA,Alfa Inc,,id-4,1.5,0.00,USD,,,,0.00,CZK,,,,,,,,,,',
  'Custom stock distribution,2026-03-06 10:00:00+00:00,US0000000002,BBB,Beta Inc,,id-5,2,0.00,USD,,,,0.00,CZK,,,,,,,,,,',
  'Transfer in,2026-03-07 10:00:00+00:00,US0000000003,CCC,Gama Inc,,id-6,3,30.00,USD,0.045,,,2000.00,CZK,,,,,,,,,,',
  'Transfer out,2026-03-08 10:00:00+00:00,US0000000003,CCC,Gama Inc,,id-7,3,31.00,USD,0.045,,,2050.00,CZK,,,,,,,,,,',
  'Stock Split,2026-03-09 10:00:00+00:00,US0000000001,AAA,Alfa Inc,,id-8,33,10.00,USD,,,,0.00,CZK,,,,,,,,,,',
  'Dividend adjustment,2026-04-01 09:00:00+00:00,US0000000001,AAA,Alfa Inc,,id-9,,,,,,,-12.00,CZK,,,,,,,,,,',
  'Dividend (Interest),2026-04-02 09:00:00+00:00,US0000000001,AAA,Alfa Inc,,id-10,10,0.085,USD,,,,20.00,CZK,0.15,USD,,,,,,,,',
  'Lending interest,2026-04-03 09:00:00+00:00,,,,,id-11,,,,,,,0.40,CZK,,,,,,,,,,',
].join('\n');
