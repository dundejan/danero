import { describe, expect, it } from 'vitest';
import { UNIVERSAL_TEMPLATE_CSV } from '@danero/importers';
import { ANYCOIN_BASIC } from '../../../packages/importers/test/fixtures/anycoin';
import { COINBASE_V1_EUR, COINBASE_V4 } from '../../../packages/importers/test/fixtures/coinbase';
import { COINMATE_CZ } from '../../../packages/importers/test/fixtures/coinmate';
import { DEGIRO_TRANSACTIONS_CZ } from '../../../packages/importers/test/fixtures/degiro';
import {
  KRAKEN_LEDGERS_NEW,
  KRAKEN_TRADES_CSV,
} from '../../../packages/importers/test/fixtures/kraken';
import { MT4_HTML, MT5_HTML } from '../../../packages/importers/test/fixtures/metatrader';
import { PORTU_FIXTURE } from '../../../packages/importers/test/fixtures/portu';
import {
  REVOLUT_CRYPTO_NEW_CSV,
  REVOLUT_CRYPTO_OLD_CSV,
  REVOLUT_INVEST_CSV,
} from '../../../packages/importers/test/fixtures/revolut';
import {
  SWISSQUOTE_DE,
  SWISSQUOTE_EN,
} from '../../../packages/importers/test/fixtures/swissquote';
import {
  T212_FIXTURE,
  T212_FIXTURE_2026,
} from '../../../packages/importers/test/fixtures/t212';
import { detectAndParse } from '@/lib/import-service';

/**
 * Routing autodetekce: pořadí snifferů v detectAndParseText je závazné —
 * každá fixture musí skončit u SVÉHO parseru (broker v ImportResult), žádný
 * obecnější sniff ji nesmí ukrást. Nové formáty přidávej sem.
 */
const CASES: Array<[label: string, text: string, broker: string]> = [
  ['Coinmate CZ (středník + BOM)', COINMATE_CZ, 'coinmate'],
  ['Kraken ledgers.csv', KRAKEN_LEDGERS_NEW, 'kraken'],
  ['Kraken trades.csv (odmítnutí s návodem, ne univerzální šablona)', KRAKEN_TRADES_CSV, 'kraken'],
  ['MT4 HTML statement', MT4_HTML, 'mt4'],
  ['MT5 HTML report', MT5_HTML, 'mt5'],
  ['Revolut akcie', REVOLUT_INVEST_CSV, 'revolut'],
  ['Revolut krypto (nový formát)', REVOLUT_CRYPTO_NEW_CSV, 'revolut'],
  ['Revolut krypto (starý formát)', REVOLUT_CRYPTO_OLD_CSV, 'revolut'],
  ['Swissquote EN (13 sloupců)', SWISSQUOTE_EN, 'swissquote'],
  ['Swissquote DE (15 sloupců)', SWISSQUOTE_DE, 'swissquote'],
  ['Portu', PORTU_FIXTURE, 'portu'],
  ['Anycoin orders.csv', ANYCOIN_BASIC, 'anycoin'],
  ['Coinbase V4', COINBASE_V4, 'coinbase'],
  ['Coinbase V1 (EUR prefix)', COINBASE_V1_EUR, 'coinbase'],
  ['Degiro CZ Transactions (regrese)', DEGIRO_TRANSACTIONS_CZ, 'degiro'],
  ['Trading212 (sloupec „Time“)', T212_FIXTURE, 'trading212'],
  // regrese ze srpna 2026: přejmenovaný sloupec poslal celý export do
  // univerzální šablony a import se rozbil naostro, přestože testy svítily
  ['Trading212 2026 (sloupec „Time (UTC)“)', T212_FIXTURE_2026, 'trading212'],
  ['univerzální šablona (poslední záchrana)', UNIVERSAL_TEMPLATE_CSV, 'universal'],
];

describe('autodetekce textových formátů (detectAndParse)', () => {
  it.each(CASES)('%s → správný parser', (_label, text, broker) => {
    expect(detectAndParse(text).broker).toBe(broker);
  });

  it('cizí HTML nespadne do IBKR XML parseru — srozumitelné odmítnutí', () => {
    const html = '<!DOCTYPE html><html><head><title>Moje banka</title></head><body></body></html>';
    const result = detectAndParse(html);
    expect(result.broker).toBe('neznámý formát');
    expect(result.errors[0]?.message).toContain('MetaTrader');
  });

  // B-8: fragment bez atributů (`<tr>`, `<div>`, `<table>`) se dřív do seznamu
  // značek nevešel a skončil zapsaný brokeru „ibkr“
  it.each([
    ['<tr><td>10</td></tr>'],
    ['<div>výpis</div>'],
    ['<table><tr><td>1</td></tr></table>'],
    ['<TABLE>\n<TR><TD>1</TD></TR>\n</TABLE>'],
    ['<p>Výpis z účtu</p>'],
    ['<span>nic</span>'],
  ])('HTML fragment %s se nepřipíše brokeru ibkr', (html) => {
    const result = detectAndParse(html);
    expect(result.broker).toBe('neznámý formát');
    expect(result.errors[0]?.message).toContain('MetaTrader');
  });

  it('IBKR Flex XML se pořád pozná (kontrola značek nesmí ukrást XML)', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20241231"></FlexStatement></FlexStatements></FlexQueryResponse>';
    expect(detectAndParse(xml).broker).toBe('ibkr');
    const noProlog =
      '<FlexQueryResponse><FlexStatements count="1"><FlexStatement accountId="U1" fromDate="20240101" toDate="20241231"></FlexStatement></FlexStatements></FlexQueryResponse>';
    expect(detectAndParse(noProlog).broker).toBe('ibkr');
  });

  it('Schwab a Tastytrade se poznají podle hlaviček', () => {
    const schwab =
      '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"\n"04/27/2023","Buy","BND","VANGUARD","45","$73.7789","","-$3320.05"';
    expect(detectAndParse(schwab).broker).toBe('schwab');
    const tasty =
      'Date,Type,Sub Type,Action,Symbol,Instrument Type,Description,Value,Quantity,Average Price,Commissions,Fees,Multiplier,Root Symbol,Underlying Symbol,Expiration Date,Strike Price,Call or Put,Order #,Currency\n2024-01-03T14:00:00+0200,Money Movement,Deposit,,,,Wire Funds Received,"1,000.00",0,,--,0.00,,,,,,,,USD';
    expect(detectAndParse(tasty).broker).toBe('tastytrade');
  });
});

/**
 * B-3-1: nedostažený export T212 se nesmí naimportovat z části a tvářit se
 * jako celý. Do 9. 8. 2026 na to koukal jen API sync — ruční upload ne.
 */
describe('useknutý export T212 v ručním uploadu (B-3-1)', () => {
  const HLAVICKA =
    'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total,Currency (Total)';
  const RADEK =
    'Market buy,2025-03-04 10:00:00,US0378331005,AAPL,Apple,10,180.5,USD,1805,USD';

  it('uříznutý poslední řádek skončí chybou, ne částečným importem', () => {
    const useknuty = `${HLAVICKA}\n${RADEK}\nMarket buy,2025-03-05 10:00:00,US0378331005,AAPL,Ap`;
    const vysledek = detectAndParse(useknuty);

    expect(vysledek.transactions).toEqual([]);
    expect(vysledek.errors).toHaveLength(1);
    expect(vysledek.errors[0]!.message).toContain('poškozený');
  });

  it('celý soubor se naimportuje normálně', () => {
    const vysledek = detectAndParse(`${HLAVICKA}\n${RADEK}\n${RADEK.replace('10:00:00', '11:00:00')}`);
    expect(vysledek.errors).toEqual([]);
    expect(vysledek.transactions).toHaveLength(2);
  });
});

/**
 * Nepoznaný CSV soubor nesmí skončit u hlášky univerzální šablony. Právě
 * tahle záměna udělala z přejmenovaného sloupce v T212 exportu (srpen 2026)
 * neřešitelnou hádanku: uživatel četl „Chybí povinný sloupec type“ nad
 * souborem, který žádný „type“ mít nemá.
 */
describe('nepoznaný CSV formát', () => {
  const foreign = 'Datum;Popis;Castka\n2026-01-01;Nákup;100';

  it('neskončí u univerzální šablony', () => {
    expect(detectAndParse(foreign).broker).toBe('neznámý formát');
  });

  it('hláška vypíše nalezené sloupce, ne chybějící „type“', () => {
    const message = detectAndParse(foreign).errors[0]!.message;
    expect(message).toContain('nepoznáváme');
    expect(message).toContain('Datum');
    expect(message).not.toContain('type');
  });

  it('rozepsaná šablona bez sloupce „date“ dostane přesnou hlášku šablony', () => {
    // Poznávacím znamením šablony je „type“ plus některý z jejích vlastních
    // snake_case sloupců — hlásit u ní obecné „nepoznáváme“ by bylo horší
    // než říct, který sloupec chybí.
    const result = detectAndParse(
      'type,isin,quantity,settlement_date\nBUY,US0378331005,10,2024-06-12',
    );
    expect(result.broker).toBe('universal');
    expect(result.errors[0]?.message).toContain('date');
  });

  /**
   * K7b-01: samotný sloupec `type` za šablonu prohlásil i cizí výpis. Sedm
   * podporovaných formátů ho má (Anycoin, Coinmate, Kraken, Revolut Invest,
   * obě generace Revolut Crypto, Schwab, Tastytrade) — a když se u nich minul
   * sniffer, uživatel četl hlášku NAŠEHO parseru o sloupci `date`, který jeho
   * broker nikdy nemá. `unrecognized: false` navíc přebilo záchrannou síť,
   * takže se originál neuložil a provozovateli nepřišlo upozornění.
   */
  it('cizí formát se sloupcem „type“ se za šablonu nevydává', () => {
    const cizi = 'Datum,Type,Popis,Castka\n2026-01-01,Nakup,x,100';
    const result = detectAndParse(cizi);
    expect(result.broker).toBe('neznámý formát');
    expect(result.errors[0]?.message).toContain('nepoznáváme');
    expect(result.errors[0]?.message).toContain('Datum');
  });

  it('Kraken bez aclass a balance jde ke svému parseru, ne na šablonu', () => {
    // přesně soubor z nálezu K7b-01: sniffer ho odmítal, `type` ho poslal na
    // šablonu a uživatel dostal hlášku o sloupci `date`
    const kraken = [
      '"txid","refid","time","type","subtype","asset","amount","fee"',
      '"L1","R1","2024-03-01 10:00:00","trade","","ZEUR","-1001.60","1.60"',
      '"L2","R1","2024-03-01 10:00:00","trade","","XXBT","0.02","0"',
    ].join('\n');
    const result = detectAndParse(kraken);
    expect(result.broker).toBe('kraken');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });

  /**
   * ⚠️ Dvojice `type` + `date`, kterou nález navrhoval, nestačí: změřeno na
   * fixturách, že `date` má vedle `type` i Revolut (obě rodiny), Schwab Bank
   * a Tastytrade. Rozhoduje proto celý slovník hlavičky.
   */
  it('ani dvojice „type“ + „date“ sama o sobě šablonu nedělá', () => {
    const cizi = 'Date,Type,Description,Withdrawal,Deposit\n03/01/2024,Deposit,x,,100';
    expect(detectAndParse(cizi).broker).not.toBe('universal');
  });

  /**
   * ⚠️ A přísnější heuristika nesmí odstřihnout ručně sestavenou šablonu jen
   * s potřebnými sloupci — dokumentovaný postup, kterým se doplňuje historie
   * k napojenému účtu. Zpřísnění na „musí mít snake_case sloupec“ ji shodilo
   * (chytily to testy B-3-3 a tenancy), proto rozhoduje CELÝ slovník hlavičky.
   */
  it('ručně sestavená šablona jen s potřebnými sloupci se pozná', () => {
    const result = detectAndParse(
      'type,date,isin,quantity,price,currency\nBUY,2025-07-30,US05606L1008,5.85,15.61,USD',
    );
    expect(result.broker).toBe('universal');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });

  it('šablona s vlastním sloupcem navíc se pozná podle značky', () => {
    const result = detectAndParse(
      'type,date,isin,quantity,price,currency,settlement_date,moje_poznamka\n' +
        'BUY,2025-07-30,US05606L1008,5.85,15.61,USD,2025-08-01,x',
    );
    expect(result.broker).toBe('universal');
    expect(result.transactions).toHaveLength(1);
  });

  it('prázdný soubor je prázdné období, ne chyba formátu', () => {
    const result = detectAndParse('');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toEqual([]);
  });

  it('univerzální šablona uložená v českém Excelu (středníky) se pozná', () => {
    const template = UNIVERSAL_TEMPLATE_CSV.split('\n')
      .slice(0, 2)
      .map((line) => line.replace(/,/g, ';'))
      .join('\n');
    const result = detectAndParse(template);
    expect(result.broker).toBe('universal');
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });
});
