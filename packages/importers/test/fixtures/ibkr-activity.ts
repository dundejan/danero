/**
 * Activity Statement z IBKR / Lynxu (CSV). ROZLOŽENÍ je opsané ze skutečného
 * výpisu Lynxu z listopadu 2026 (názvy sekcí, hlavičky, druhy řádků, tvar
 * popisů dividend a srážek, tisíce v uvozovkách u forexu); účet, tituly,
 * kusy, ceny, částky, časy i období jsou smyšlené.
 */
export const ACTIVITY_ACCOUNT = 'U7000001';

const HEAD = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,
Statement,Data,BrokerAddress,
Statement,Data,Title,Activity Statement
Statement,Data,Period,"January 1, 2024 - December 31, 2024"
Statement,Data,WhenGenerated,"2026-10-02, 05:10:00 EST"
Account Information,Header,Field Name,Field Value
Account Information,Data,Name,Jan Novak
Account Information,Data,Account,${ACTIVITY_ACCOUNT}
Account Information,Data,Account Type,Broker Client
Account Information,Data,Customer Type,Individual
Account Information,Data,Account Capabilities,Cash
Account Information,Data,Base Currency,CZK
Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change
Net Asset Value,Data,Cash ,1000,2000,0,2000,1000
Net Asset Value,Data,Stock,50000,60000,0,60000,10000
Net Asset Value,Data,Total,51000,62000,0,62000,11000
Net Asset Value,Header,Time Weighted Rate of Return
Net Asset Value,Data,1.25%
Change in NAV,Header,Field Name,Field Value
Change in NAV,Data,Starting Value,51000
Change in NAV,Data,Ending Value,62000
Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures,
Cash Report,Data,Starting Cash,Base Currency Summary,1000,1000,0,
Cash Report,Data,Ending Cash,Base Currency Summary,2000,2000,0,
`;

const TAIL = `Change in Dividend Accruals,Header,Asset Category,Currency,Symbol,Date,Ex Date,Pay Date,Quantity,Tax,Fee,Gross Rate,Gross Amount,Net Amount,Code
Change in Dividend Accruals,Data,Starting Dividend Accruals in CZK,,,,,,,,,,,0,
Change in Dividend Accruals,Data,Stocks,USD,KO,2024-03-14,2024-03-15,2024-04-02,40,2.91,0,0.485,19.4,16.49,Po
Change in Dividend Accruals,Data,Stocks,USD,KO,2024-04-02,2024-03-15,2024-04-02,40,-2.91,0,0.485,-19.4,-16.49,Re
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,BF B,BROWN-FORMAN CORP-CLASS B,700000001,US1156372096,BF B,NYSE,1,COMMON,
Financial Instrument Information,Data,Stocks,KO,COCA-COLA CO/THE,700000002,US1912161007,KO,NYSE,1,COMMON,
Financial Instrument Information,Data,Stocks,MSFT,MICROSOFT CORP,700000003,US5949181045,MSFT,NASDAQ,1,COMMON,
Financial Instrument Information,Data,Stocks,RY,ROYAL BANK OF CANADA,700000004,CA7800871021,RY,NYSE,1,COMMON,
Financial Instrument Information,Data,Stocks,VWCE,VANGUARD FTSE ALL-WORLD UCITS,700000005,IE00BK5BQT80,VWCE,IBIS2,1,ETF,
Codes,Header,Code,Meaning,Code (Cont.),Meaning (Cont.)
Codes,Data,A,Assignment,LI,Last In First Out (LIFO) tax basis election
Codes,Data,C,Closing Trade,O,Opening Trade
Notes/Legal Notes,Header,Type,Note
Notes/Legal Notes,Data,Notes,Trade execution times are displayed in Eastern Time.
Notes/Legal Notes,Data,Legal Notes,"Please promptly report any inaccuracy or discrepancy in this statement, or in your account."
`;

const OPEN_POSITIONS = `Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,EUR,VWCE,25,1,104.2,2605,118,2950,345,
Open Positions,Total,,Stocks,EUR,,,,,2605,,2950,345,
Open Positions,Total,,Stocks,CZK,,,,,65125,,73750,8625,
Open Positions,Data,Summary,Stocks,USD,KO,40,1,58.125,2325,62,2480,155,
Open Positions,Data,Summary,Stocks,USD,MSFT,3,1,401.6666667,1205,430,1290,85,
Open Positions,Data,Summary,Stocks,USD,RY,10,1,101.5,1015,120,1200,185,
Open Positions,Total,,Stocks,USD,,,,,4545,,4970,425,
Open Positions,Total,,Stocks,CZK,,,,,104535,,114310,9775,
Forex Balances,Header,Asset Category,Currency,Description,Quantity,Cost Price,Cost Basis in CZK,Close Price,Value in CZK,Unrealized P/L in CZK,Code
Forex Balances,Data,Forex,CZK,CZK,150.5,0,-150.5,1,150.5,0,
Forex Balances,Data,Forex,CZK,USD,80,23.1,-1848,23,1840,-8,
Forex Balances,Data,Total,,,,,-1998.5,,1990.5,-8,
`;

const TRADES = `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,EUR,VWCE,"2024-02-12, 09:15:40",15,102,102.4,-1530,-4,1534,0,6,O
Trades,Data,Order,Stocks,EUR,VWCE,"2024-06-18, 04:02:11",10,106.7,106.9,-1067,-4,1071,0,2,O
Trades,SubTotal,,Stocks,EUR,VWCE,,25,,,-2597,-8,2605,0,8,
Trades,Total,,Stocks,EUR,,,,,,-2597,-8,2605,0,8,
Trades,Total,,Stocks,CZK,,,,,,-64925,-200,65125,0,200,
Trades,Data,Order,Stocks,USD,BF B,"2024-09-03, 11:20:05",-12,45.5,45.3,546,-3,-600,-57,2.4,C
Trades,SubTotal,,Stocks,USD,BF B,,-12,,,546,-3,-600,-57,2.4,
Trades,Data,Order,Stocks,USD,KO,"2024-01-22, 10:05:00",40,58,58.2,-2320,-5,2325,0,8,O
Trades,SubTotal,,Stocks,USD,KO,,40,,,-2320,-5,2325,0,8,
Trades,Data,Order,Stocks,USD,MSFT,"2024-03-05, 12:30:45",5,400,401,-2000,-5,2005,0,5,O
Trades,Data,Order,Stocks,USD,MSFT,"2024-11-14, 10:11:12",-2,425.5,424,851,-5,-802,44,-3,C
Trades,SubTotal,,Stocks,USD,MSFT,,3,,,-1149,-10,1203,44,2,
Trades,Total,,Stocks,USD,,,,,,-2923,-18,2928,-13,12.4,
Trades,Total,,Stocks,CZK,,,,,,-67229,-414,67344,-299,285.2,
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,,Proceeds,Comm in CZK,,,MTM in CZK,Code
Trades,Data,Order,Forex,CZK,EUR.CZK,"2024-02-12, 03:40:10","2,650",25.2,,-66780,-50,,,20,
Trades,SubTotal,,Forex,CZK,EUR.CZK,,2650,,,-66780,-50,,,20,
Trades,Data,Order,Forex,CZK,USD.CZK,"2024-01-22, 04:01:00",200,23.05,,-4610,-50,,,-10,
Trades,SubTotal,,Forex,CZK,USD.CZK,,200,,,-4610,-50,,,-10,
Trades,Total,,Forex,CZK,,,,,,-71390,-100,,,10,
`;

const CASH = `Deposits & Withdrawals,Header,Currency,Settle Date,Description,Amount
Deposits & Withdrawals,Data,CZK,2024-01-19,Electronic Fund Transfer,75000
Deposits & Withdrawals,Data,CZK,2024-02-09,Electronic Fund Transfer,70000
Deposits & Withdrawals,Data,CZK,2024-12-02,Disbursement Initiated by Jan Novak,-5000
Deposits & Withdrawals,Data,Total,,,140000
Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share (Ordinary Dividend),19.4
Dividends,Data,USD,2024-05-24,RY (CA7800871021) Cash Dividend USD 1.012345 (Ordinary Dividend),10.12
Dividends,Data,USD,2024-06-13,MSFT(US5949181045) Cash Dividend USD 0.81 per Share (Ordinary Dividend),4.05
Dividends,Data,USD,2024-07-01,KO(US1912161007) Cash Dividend USD 0.485 per Share (Ordinary Dividend),19.4
Dividends,Data,Total,,,52.97
Dividends,Data,Total in CZK,,,1218.31
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share - US Tax,-2.91,
Withholding Tax,Data,USD,2024-05-24,RY (CA7800871021) Cash Dividend USD 1.012345 - CA Tax,-1.52,
Withholding Tax,Data,USD,2024-06-13,MSFT(US5949181045) Cash Dividend USD 0.81 per Share - US Tax,-0.61,
Withholding Tax,Data,USD,2024-07-01,KO(US1912161007) Cash Dividend USD 0.485 per Share - US Tax,-2.91,
Withholding Tax,Data,Total,,,-7.95,
Withholding Tax,Data,Total in CZK,,,-182.85,
`;

/** Celý roční výpis: akcie a ETF, forex, vklady, dividendy se srážkou. */
export const ACTIVITY_STATEMENT_CSV = HEAD + OPEN_POSITIONS + TRADES + CASH + TAIL;

/** Stejný výpis s vlastními sekcemi místo výchozích (pro testy okrajů). */
export const activityStatement = (sections: string, positions = ''): string =>
  HEAD + positions + sections + TAIL;
