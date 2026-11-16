import { describe, expect, it } from 'vitest';
import { parseIbkrActivityCsv, sniffIbkrActivityCsv } from '../src';
import {
  ACTIVITY_ACCOUNT,
  ACTIVITY_STATEMENT_CSV,
  activityStatement,
} from './fixtures/ibkr-activity';

/**
 * IBKR / Lynx: CSV výpis „Activity Statement“. Rozložení je opsané ze
 * skutečného výpisu Lynxu (listopad 2026); sekce, které v něm nebyly, mají
 * tvar z veřejných vzorků a zdroj je u testu. Čísla, tituly, časy a účet jsou
 * smyšlené.
 */
const byType = (text: string, type: string) =>
  parseIbkrActivityCsv(text).transactions.filter((tx) => tx.type === type);

describe('IBKR Activity Statement CSV: roční výpis', () => {
  it('pozná se podle prvního řádku, i s BOM a koncem řádku CRLF', () => {
    expect(sniffIbkrActivityCsv(ACTIVITY_STATEMENT_CSV)).toBe(true);
    expect(sniffIbkrActivityCsv(`${String.fromCharCode(0xfeff)}${ACTIVITY_STATEMENT_CSV.replaceAll('\n', '\r\n')}`)).toBe(true);
    expect(sniffIbkrActivityCsv('Date,Action,Symbol\n2024-01-01,Buy,KO')).toBe(false);
    // co pozná sniffer, to parser přečte — a naopak cizí soubor odmítne hláškou
    expect(parseIbkrActivityCsv('Date,Action,Symbol\n2024-01-01,Buy,KO').errors[0]?.message).toContain(
      'Activity Statement',
    );
  });

  it('přečte výpis bez chyb a nic nezapíše dvakrát', () => {
    const parsed = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV);
    expect(parsed.broker).toBe('ibkr');
    expect(parsed.errors).toEqual([]);
    const counts: Record<string, number> = {};
    for (const tx of parsed.transactions) counts[tx.type] = (counts[tx.type] ?? 0) + 1;
    // součtové řádky (SubTotal, Total, „Total in CZK“) transakcemi nejsou
    expect(counts).toEqual({ BUY: 4, SELL: 2, DIVIDEND: 4, DEPOSIT: 2, WITHDRAWAL: 1 });
    expect(new Set(parsed.transactions.map((tx) => tx.id)).size).toBe(parsed.transactions.length);
    expect(parsed.transactions.every((tx) => tx.account === ACTIVITY_ACCOUNT)).toBe(true);
  });

  it('obchod: směr ze znaménka kusů, ISIN z číselníku titulů, komise jako poplatek', () => {
    const [buy] = byType(ACTIVITY_STATEMENT_CSV, 'BUY');
    expect(buy).toMatchObject({
      isin: 'IE00BK5BQT80',
      ticker: 'VWCE',
      assetClass: 'ETF',
      tradeDate: '2024-02-12',
      currency: 'EUR',
    });
    if (buy?.type !== 'BUY') throw new Error('čekal se nákup');
    expect(buy.quantity.toString()).toBe('15');
    expect(buy.pricePerShare.toString()).toBe('102');
    expect(buy.fee?.amount.toString()).toBe('4');
    expect(buy.fee?.currency).toBe('EUR');

    // symbol s mezerou („BF B“) se dohledá stejně jako ostatní
    const sell = byType(ACTIVITY_STATEMENT_CSV, 'SELL')[0];
    expect(sell).toMatchObject({ isin: 'US1156372096', ticker: 'BF B', assetClass: 'STOCK' });
    if (sell?.type !== 'SELL') throw new Error('čekal se prodej');
    expect(sell.quantity.toString()).toBe('12');
    // běžný prodej držených kusů není prodej nakrátko
    expect(sell.positionEffect).toBeUndefined();
  });

  it('měnové konverze se přeskočí s důvodem, tisíce v uvozovkách nerozbijí řádek', () => {
    const parsed = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV);
    expect(parsed.skipped.map((issue) => issue.message)).toEqual([
      'Měnová konverze EUR.CZK — pro daň z prodeje CP není potřeba.',
      'Měnová konverze USD.CZK — pro daň z prodeje CP není potřeba.',
    ]);
  });

  it('dividenda se spáruje se srážkou podle titulu, dne a měny (R-07)', () => {
    const dividends = byType(ACTIVITY_STATEMENT_CSV, 'DIVIDEND');
    const summary = dividends.map((tx) =>
      tx.type === 'DIVIDEND'
        ? [tx.ticker, tx.isin, tx.date, tx.gross.toString(), tx.withholdingTax.toString(), tx.currency]
        : [],
    );
    expect(summary).toEqual([
      ['KO', 'US1912161007', '2024-04-02', '19.4', '2.91', 'USD'],
      // popis s mezerou před závorkou („RY (CA…)“) a kanadská srážka
      ['RY', 'CA7800871021', '2024-05-24', '10.12', '1.52', 'USD'],
      ['MSFT', 'US5949181045', '2024-06-13', '4.05', '0.61', 'USD'],
      ['KO', 'US1912161007', '2024-07-01', '19.4', '2.91', 'USD'],
    ]);
  });

  it('vklad a výběr podle znaménka částky', () => {
    const parsed = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV);
    const cash = parsed.transactions.flatMap((tx) =>
      tx.type === 'DEPOSIT' || tx.type === 'WITHDRAWAL'
        ? [[tx.type, tx.date, tx.amount.toString(), tx.currency]]
        : [],
    );
    expect(cash).toEqual([
      ['DEPOSIT', '2024-01-19', '75000', 'CZK'],
      ['DEPOSIT', '2024-02-09', '70000', 'CZK'],
      ['WITHDRAWAL', '2024-12-02', '5000', 'CZK'],
    ]);
  });

  it('řekne, u kterých titulů chybí starší historie', () => {
    const parsed = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV);
    // BF B se prodává bez nákupu, RY se drží bez nákupu; ostatní sedí na pozice
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]!.message).toContain('jen rok 2024');
    expect(parsed.warnings[0]!.message).toContain('titulů RY, BF B držíš');
    expect(parsed.warnings[0]!.message).not.toMatch(/KO|MSFT|VWCE/);
  });

  it('opakované čtení dá tatáž id (dedupe při druhém nahrání)', () => {
    const first = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV).transactions.map((tx) => tx.id);
    const second = parseIbkrActivityCsv(ACTIVITY_STATEMENT_CSV).transactions.map((tx) => tx.id);
    expect(second).toEqual(first);
  });
});

const STOCK_HEADER =
  'Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code\n';

describe('IBKR Activity Statement CSV: okraje', () => {
  it('objednávka a její plnění jsou tatáž událost — čte se jedna úroveň', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,KO,"2024-01-22, 10:05:00",40,58,58.2,-2320,-5,2325,0,8,O
Trades,Data,Trade,Stocks,USD,KO,"2024-01-22, 10:05:00",25,58,58.2,-1450,-3,1453,0,5,O;P
Trades,Data,Trade,Stocks,USD,KO,"2024-01-22, 10:05:00",15,58,58.2,-870,-2,872,0,3,O;P
Trades,Data,ClosedLot,Stocks,USD,KO,2023-05-02,10,50,,,,500,,,
`,
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]).toMatchObject({ type: 'BUY', isin: 'US1912161007' });
  });

  it('výpis jen s plněními (bez řádků Order) se přečte z nich', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Trade,Stocks,USD,KO,"2024-01-22, 10:05:00",25,58,58.2,-1450,-3,1453,0,5,O;P
Trades,Data,Trade,Stocks,USD,KO,"2024-01-22, 10:05:01",15,58,58.2,-870,-2,872,0,3,O;P
`,
      ),
    );
    expect(parsed.transactions).toHaveLength(2);
    expect(new Set(parsed.transactions.map((tx) => tx.id)).size).toBe(2);
  });

  it('prodej, který pozici otevírá, je prodej nakrátko (R-13)', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,KO,"2024-01-22, 10:05:00",-40,58,58.2,2320,-5,-2315,0,8,O
Trades,Data,Order,Stocks,USD,KO,"2024-02-22, 10:05:00",40,55,55.2,-2200,-5,2315,110,8,C
`,
      ),
    );
    expect(parsed.transactions.map((tx) => ('positionEffect' in tx ? [tx.type, tx.positionEffect] : []))).toEqual([
      ['SELL', 'OPEN'],
      ['BUY', 'CLOSE'],
    ]);
  });

  it('deriváty, dluhopisy a stornované obchody skončí chybou s radou, ne tichem', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Equity and Index Options,USD,KO 20DEC24 60.0 C,"2024-03-01, 10:00:00",1,1.2,1.25,-120,-1,121,0,5,O
Trades,Data,Order,Stocks,USD,KO,"2024-03-04, 10:00:00",-10,60,60.1,600,-1,-590,9,1,Ca
`,
      ),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors.every((error) => error.knownUnsupported === true)).toBe(true);
    expect(parsed.errors[0]!.message).toContain('opce');
    expect(parsed.errors[0]!.message).toContain('Flex Query');
    expect(parsed.errors[1]!.message).toContain('stornovaný');
  });

  it('titul bez ISIN v číselníku se nenačte a řekne proč', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,ZZZZ,"2024-03-04, 10:00:00",10,60,60.1,-600,-1,601,0,1,O\n`,
      ),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors[0]!.message).toContain('nemá ve výpisu ISIN');
    expect(parsed.errors[0]!.knownUnsupported).toBeUndefined();
  });

  it('nečitelné číslo shodí jen svůj řádek', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,KO,"2024-03-04, 10:00:00",1e,60,60.1,-600,-1,601,0,1,O
Trades,Data,Order,Stocks,USD,KO,"2024-03-05, 10:00:00",10,60,60.1,-600,-1,601,0,1,O
`,
      ),
    );
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]!.message).toContain('není číslo');
  });

  it('korporátní akce a převody ohlásí chybou, neznámou sekci jménem', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Corporate Actions,Header,Asset Category,Currency,Report Date,Date/Time,Description,Quantity,Proceeds,Value,Realized P/L,Code
Corporate Actions,Data,Stocks,USD,2024-06-10,"2024-06-07, 20:25:00",KO(US1912161007) Split 2 for 1 (KO, COCA-COLA CO/THE, US1912161007),40,0,0,0,
Corporate Actions,Data,Total,,,,,,0,0,0,
Nejaka Nova Sekce,Header,Sloupec
Nejaka Nova Sekce,Data,hodnota
`,
      ),
    );
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ knownUnsupported: true });
    expect(parsed.errors[0]!.message).toContain('korporátní akce');
    expect(parsed.skipped.map((issue) => issue.message)).toEqual([
      'Sekci „Nejaka Nova Sekce“ (řádků: 1) z výpisu nečteme.',
    ]);
  });

  it('srážka z jiného období, než je dividenda, se nezaúčtuje a řekne se to', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-01-05,KO(US1912161007) Cash Dividend USD 0.46 per Share - US Tax,-2.76,
Withholding Tax,Data,Total,,,-2.76,
`,
      ),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.warnings[0]!.message).toContain('Srážková daň bez párové dividendy');
  });

  it('stornovaná a znovu zaúčtovaná dividenda se sečte do jedné', () => {
    const dividends = byType(
      activityStatement(
        `Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share (Ordinary Dividend),19.4
Dividends,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share - Reversal (Ordinary Dividend),-19.4
Dividends,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.5 per Share (Ordinary Dividend),20
Dividends,Data,Total,,,20
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share - US Tax,-2.91,
Withholding Tax,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.485 per Share - US Tax,2.91,
Withholding Tax,Data,USD,2024-04-02,KO(US1912161007) Cash Dividend USD 0.5 per Share - US Tax,-3,
`,
      ),
      'DIVIDEND',
    );
    expect(dividends).toHaveLength(1);
    const [dividend] = dividends;
    if (dividend?.type !== 'DIVIDEND') throw new Error('čekala se dividenda');
    expect(dividend.gross.toString()).toBe('20');
    expect(dividend.withholdingTax.toString()).toBe('3');
  });

  it('výkaz jiného druhu bez pohybů řekne, který výpis stáhnout', () => {
    const summary = `Statement,Header,Field Name,Field Value
Statement,Data,Title,MTM Summary
Statement,Data,Period,"January 1, 2024 - December 31, 2024"
Account Information,Header,Field Name,Field Value
Account Information,Data,Account,U7000001
`;
    const parsed = parseIbkrActivityCsv(summary);
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]).toMatchObject({ knownUnsupported: true });
    expect(parsed.errors[0]!.message).toContain('MTM Summary');
  });

  it('týž symbol u dvou titulů: obchod se nenačte, místo aby dostal cizí ISIN', () => {
    const parsed = parseIbkrActivityCsv(
      `Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Statement
${STOCK_HEADER}Trades,Data,Order,Stocks,USD,KO,"2024-03-04, 10:00:00",10,60,60.1,-600,-1,601,0,1,O
Trades,Data,Order,Stocks,CAD,KO,"2024-03-05, 10:00:00",5,20,20.1,-100,-1,101,0,1,O
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,Stocks,KO,COCA-COLA CO/THE,700000002,US1912161007,KO,NYSE,1,COMMON,
Financial Instrument Information,Data,Stocks,KO,SMYSLENA KANADSKA,700000009,CA7800871021,KO,TSE,1,COMMON,
`,
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0]!.message).toContain('dvěma různým titulům');
  });

  it('úroveň objednávek se určuje pro každý druh aktiv zvlášť', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Trade,Stocks,USD,KO,"2024-01-22, 10:05:00",25,58,58.2,-1450,-3,1453,0,5,O
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,,Proceeds,Comm in CZK,,,MTM in CZK,Code
Trades,Data,Order,Forex,CZK,USD.CZK,2024-01-22,200,23.05,,-4610,-50,,,-10,
`,
      ),
    );
    // forex s objednávkami nesmí zahodit akcie, které mají jen plnění
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.skipped).toHaveLength(1);
  });

  it('výpis jen se sekcemi, které neznáme, je chyba, ne prázdné období', () => {
    // německá lokalizace: názvy sekcí podle parseru xemwebe/gibtax (src/read/mod.rs)
    const parsed = parseIbkrActivityCsv(`Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Statement
Transaktionen,Header,DataDiscriminator,Vermögenswertkategorie,Währung,Symbol,Datum/Zeit,Menge
Transaktionen,Data,Order,Aktien,USD,KO,"2024-03-04, 10:00:00",10
`);
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]!.knownUnsupported).toBeUndefined();
    expect(parsed.errors[0]!.message).toContain('Transaktionen');
  });

  it('varování o starší historii nelže u titulu, jehož obchod se nenačetl', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,ZZZZ,"2024-03-04, 10:00:00",10,60,60.1,-600,-1,601,0,1,O\n`,
        `Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,ZZZZ,10,1,60.1,601,61,610,9,
`,
      ),
    );
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.warnings).toEqual([]);
  });

  it('číslo v jiném než desítkovém zápisu ani obchod bez měny neprojdou', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `${STOCK_HEADER}Trades,Data,Order,Stocks,USD,KO,"2024-03-04, 10:00:00",0x10,60,60.1,-600,-1,601,0,1,O
Trades,Data,Order,Stocks,,KO,"2024-03-05, 10:00:00",10,60,60.1,-600,-1,601,0,1,O
`,
      ),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      expect.stringContaining('není číslo'),
      'Obchodu KO chybí datum, množství, cena nebo měna.',
    ]);
  });
});

describe('IBKR Activity Statement CSV: tvary doložené veřejnými vzorky', () => {
  /**
   * Úrok a srážka z něj. Hlavičky a tvar popisů: movie-clip/quant-research-lab
   * (docs/IB2026.csv), Konstantin212/report_readr_fe
   * (tests/fixtures/brokers/ibkr-2025.csv), JanUlrichKlar/ibkit (data/raw).
   * Součet je řádek Data s „Total“ ve sloupci měny.
   */
  it('kreditní úrok dostane srážku bez titulu z téhož dne, debetní je poplatek (R-07f)', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Interest,Header,Currency,Date,Description,Amount
Interest,Data,USD,2024-05-03,USD Credit Interest for Apr-2024,2.5
Interest,Data,EUR,2024-02-05,EUR Debit Interest for Jan-2024,-0.3
Interest,Data,USD,2024-03-12,Bond Coupon Payment (ABC Float 06/09/27 - Alfa Corp ABC Float 06/09/27),12
Interest,Data,Total,,,14.5
Interest,Data,Total Interest in CZK,,,330
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-05-03,Withholding @ 20% on Credit Interest for Apr-2024,-0.5,
Withholding Tax,Data,Total,,,-0.5,
`,
      ),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    const rows = parsed.transactions.map((tx) =>
      tx.type === 'INTEREST'
        ? [tx.type, tx.date, tx.amount.toString(), tx.withholdingTax.toString(), tx.currency]
        : tx.type === 'FEE'
          ? [tx.type, tx.date, tx.amount.toString(), tx.currency]
          : [],
    );
    expect(rows).toEqual([
      ['INTEREST', '2024-05-03', '2.5', '0.5', 'USD'],
      ['FEE', '2024-02-05', '0.3', 'EUR'],
      ['INTEREST', '2024-03-12', '12', '0', 'USD'],
    ]);
  });

  /**
   * Poplatky. Hlavičky: splaunov/ibkr-processor (ibkr_activity_statement_1.csv
   * — i kladný řádek vratky), Konstantin212/report_readr_fe (Transaction Fees
   * se součtem ve sloupci Asset Category a pomlčkou místo množství),
   * balkanyilajos/stock-market-transaction-analyzer (Commission Adjustments
   * se sloupcem Account).
   */
  it('poplatky ze tří sekcí; vratka a součtové řádky se neukládají', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Fees,Header,Subtitle,Currency,Date,Description,Amount
Fees,Data,Other Fees,USD,2024-09-03,A*****01:US CONSOLIDATED SNAPSHOT FOR AUG 2024,-1.5
Fees,Data,Other Fees,USD,2024-09-03,A*****01:US CONSOLIDATED SNAPSHOT FOR AUG 2024,1.5
Fees,Data,Total,,,,0
Fees,Data,Total in CZK,,,,0
Transaction Fees,Header,Asset Category,Currency,Date/Time,Symbol,Description,Quantity,Trade Price,Amount,Code
Transaction Fees,Data,Stocks,GBP,"2024-10-10, 10:29:33",ABCl,UK Stamp Tax,4,2.5,-0.05,
Transaction Fees,Data,Stocks,EUR,"2024-03-04, 20:20:00",XYZ,French Transaction Tax,-,0,-6,
Transaction Fees,Data,Total,,,,,,,-6.05,
Transaction Fees,Data,Total in CZK,,,,,,,-151,
Commission Adjustments,Header,Currency,Account,Date,Description,Amount,Code
Commission Adjustments,Data,USD,U7000002,2024-01-08,Commission Computed After Trade Reported (KO),-2.25,
Commission Adjustments,Data,Total,,,,-2.25,
`,
      ),
    );
    expect(parsed.errors).toEqual([]);
    const fees = parsed.transactions.map((tx) =>
      tx.type === 'FEE' ? [tx.date, tx.amount.toString(), tx.currency, tx.account] : [],
    );
    expect(fees).toEqual([
      ['2024-09-03', '1.5', 'USD', ACTIVITY_ACCOUNT],
      ['2024-10-10', '0.05', 'GBP', ACTIVITY_ACCOUNT],
      ['2024-03-04', '6', 'EUR', ACTIVITY_ACCOUNT],
      // sloupec Account má přednost před účtem z hlavičky výpisu
      ['2024-01-08', '2.25', 'USD', 'U7000002'],
    ]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]!.message).toContain('Vratka poplatku');
  });

  /**
   * Konsolidovaný výpis víc účtů: sloupec Account hned za měnou, přípona
   * u druhu aktiv a dividenda s číslem místo ISIN v závorce. Zdroj:
   * JanUlrichKlar/ibkit (data/raw/…_2021_2021.csv),
   * balkanyilajos/stock-market-transaction-analyzer (example/ibkr.csv).
   */
  it('víc účtů v jednom výpisu: srážka se páruje v rámci účtu', () => {
    const held = 'Stocks - Held with Interactive Brokers (U.K.) Limited carried by Interactive Brokers LLC';
    const parsed = parseIbkrActivityCsv(`Statement,Header,Field Name,Field Value
Statement,Data,Title,Activity Summary
Statement,Data,Period,"January 1, 2024 - December 31, 2024"
Account Information,Header,Field Name,Field Value
Account Information,Data,Account,U7000001 (Custom Consolidated)
Trades,Header,DataDiscriminator,Asset Category,Currency,Account,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,${held},USD,U7000002,KO,"2024-01-22, 10:05:00",40,58,58.2,-2320,-5,2325,0,8,O
Trades,SubTotal,,${held},USD,KO,,,40,,,-2320,-5,2325,0,8,
Dividends,Header,Currency,Account,Date,Description,Amount
Dividends,Data,USD,U7000001,2024-04-02,KO(700000002) Cash Dividend USD 0.5 per Share (Ordinary Dividend),10
Dividends,Data,USD,U7000002,2024-04-02,KO(700000002) Cash Dividend USD 0.5 per Share (Ordinary Dividend),20
Dividends,Data,Total,,,,30
Withholding Tax,Header,Currency,Account,Date,Description,Amount,Code
Withholding Tax,Data,USD,U7000001,2024-04-02,KO(700000002) Cash Dividend USD 0.5 per Share - US Tax,-1.5,
Withholding Tax,Data,USD,U7000002,2024-04-02,KO(700000002) Cash Dividend USD 0.5 per Share - US Tax,-6,
Financial Instrument Information,Header,Asset Category,Symbol,Description,Conid,Security ID,Underlying,Listing Exch,Multiplier,Type,Code
Financial Instrument Information,Data,${held},KO,COCA-COLA CO/THE,700000002,US1912161007,KO,NYSE,1,COMMON,
`);
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions[0]).toMatchObject({ type: 'BUY', account: 'U7000002', isin: 'US1912161007' });
    const dividends = parsed.transactions.flatMap((tx) =>
      tx.type === 'DIVIDEND'
        ? [[tx.account, tx.isin, tx.gross.toString(), tx.withholdingTax.toString()]]
        : [],
    );
    expect(dividends).toEqual([
      ['U7000001', 'US1912161007', '10', '1.5'],
      ['U7000002', 'US1912161007', '20', '6'],
    ]);
  });

  /**
   * Náhradní platba a vratka kapitálu chodí v sekci Dividends, storno jako
   * záporný řádek s „- Reversal“. Zdroj: JanUlrichKlar/ibkit (data/raw).
   */
  it('náhradní platba je dividenda s upozorněním, vratka kapitálu nese značku (R-07h)', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Dividends,Header,Currency,Date,Description,Amount
Dividends,Data,USD,2024-03-15,KO(US1912161007) Payment in Lieu of Dividend (Ordinary Dividend),8
Dividends,Data,USD,2024-06-17,RY(CA7800871021) Cash Dividend USD 0.33 per Share (Return of Capital),7
Dividends,Data,Total,,,15
Withholding Tax,Header,Currency,Date,Description,Amount,Code
Withholding Tax,Data,USD,2024-03-15,KO(US1912161007) Payment in Lieu of Dividend - US Tax,-1.2,
`,
      ),
    );
    expect(parsed.errors).toEqual([]);
    const dividends = parsed.transactions.flatMap((tx) =>
      tx.type === 'DIVIDEND'
        ? [[tx.ticker, tx.gross.toString(), tx.withholdingTax.toString(), tx.returnOfCapital]]
        : [],
    );
    expect(dividends).toEqual([
      ['RY', '7', '0', true],
      ['KO', '8', '1.2', false],
    ]);
    expect(parsed.warnings.map((warning) => warning.message.slice(0, 16))).toEqual([
      'Náhradní platba ',
      'Return of Capita',
    ]);
  });

  /**
   * Korporátní akce, převody a deriváty. Zdroj: splaunov/ibkr-processor
   * (Corporate Actions — split nese jen přírůstek kusů), ferrao/profitry
   * (Transfers s „--“ místo ceny), bakapig/Commodities-F-M (futures mají
   * místo Proceeds sloupec Notional Value).
   */
  it('převod pozic a futures skončí chybou s radou; kusy se pak neporovnávají', () => {
    const parsed = parseIbkrActivityCsv(
      activityStatement(
        `Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Notional Value,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Futures,EUR,ABCJ4,"2024-03-11, 12:09:24",-5,47,47.4,170000,-25,-169975,0,-600,O
Transfers,Header,Asset Category,Currency,Symbol,Date,Type,Direction,Xfer Company,Xfer Account,Qty,Xfer Price,Market Value,Realized P/L,Cash Amount,Code
Transfers,Data,Stocks,USD,KO,2024-04-29,FOP,In,--,FOP,40,--,"2,400.00",0.00,0.00,
Transfers,Data,Total,,,,,,,,,,2400,0,0,
`,
        `Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Code
Open Positions,Data,Summary,Stocks,USD,KO,40,1,58,2320,62,2480,160,
`,
      ),
    );
    expect(parsed.transactions).toEqual([]);
    expect(parsed.errors.map((error) => [error.knownUnsupported, error.message.slice(0, 28)])).toEqual([
      [true, 'Obchod ABCJ4 (futures) z Act'],
      [true, 'Výpis obsahuje převody cenný'],
    ]);
    // kusy přišly převodem, ne nákupem — o starší historii se nedá nic tvrdit
    expect(parsed.warnings).toEqual([]);
  });
});
