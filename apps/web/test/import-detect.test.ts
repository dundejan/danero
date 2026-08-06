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
