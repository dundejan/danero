/** Sdílená T212 fixture — sloupce dle reálného exportu (kategorie Orders/Dividends/Transactions/Interest). */
export const T212_HEADER =
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID,Currency conversion fee,Currency (Currency conversion fee)';

export const T212_FIXTURE = [
  T212_HEADER,
  'Deposit,2024-01-05 08:00:00,,,,,,,,,,10000.00,CZK,,,,,,',
  'Currency conversion,2024-01-06 08:00:00,,,,,,,,,,5000.00,CZK,,,,,,',
  'Market buy,2024-01-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,0.0435,,,428000.00,CZK,,,,EOF1001,2.10,CZK',
  'Market sell,2025-03-05 15:01:10,US0378331005,AAPL,Apple Inc,100,210.00,USD,0.0448,1000.00,CZK,468000.00,CZK,,,,EOF1002,3.00,CZK',
  'Dividend (Dividends paid by us corporations),2025-04-01 09:00:00,US0378331005,AAPL,Apple Inc,100,0.25,USD,,,,500.00,CZK,3.75,USD,,,,',
  'Interest on cash,2025-05-01 00:00:00,,,,,,,,,,12.34,CZK,,,,,,',
  'Withdrawal,2025-06-01 08:00:00,,,,,,,,,,2000.00,CZK,,,,,,',
].join('\n');
