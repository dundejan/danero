import { describe, expect, it } from 'vitest';
import {
  parseAnycoinCsv,
  parseCoinbaseCsv,
  parseKrakenCsv,
  parseRevolutInvestCsv,
  parseTrading212Csv,
} from '../src';
import { utcYearBoundaryNote } from '../src/year-boundary';
import { ANYCOIN_BASIC } from './fixtures/anycoin';
import { COINBASE_V4 } from './fixtures/coinbase';
import { KRAKEN_LEDGERS_NEW } from './fixtures/kraken';
import { REVOLUT_INSTRUMENT_MAP, REVOLUT_INVEST_CSV } from './fixtures/revolut';
import { T212_FIXTURE } from './fixtures/t212';

/**
 * docs/02 R-05d: den transakce je den z výpisu. U brokerů, kteří píšou světový
 * čas, je 31. 12. ve 23:30 UTC v Česku už 1. 1. — rok se nemění, ale uživatel
 * se to dozví varováním (nález L26-01, rozhodnutí R2).
 *
 * Fixtury se neopisují znovu: všem řádkům se jen posune čas na hranici roku.
 */
const BOUNDARY = '2025-12-31 23:30:00';
const atBoundary = (csv: string): string =>
  csv.replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/g, BOUNDARY);

const boundaryWarnings = (result: { warnings: { line: number; message: string }[] }) =>
  result.warnings.filter((warning) => warning.message.includes('světového času'));

describe('věta o hranici roku (R-05d)', () => {
  it.each([
    ['2025-12-31 23:00:00', '23:00'],
    ['2025-12-31 23:59:59', '23:59'],
    ['2025-12-31T23:30:15Z', '23:30'],
    ['2025-12-31 23:30:15 UTC', '23:30'],
  ])('%s je v Česku už další rok', (timestamp, time) => {
    const note = utcYearBoundaryNote(timestamp);
    expect(note).toContain(`ve ${time} světového času`);
    expect(note).toContain('1. 1. 2026');
    expect(note).toContain('do roku 2025');
  });

  it.each([
    '2025-12-31 22:59:59', // v Česku 23:59 téhož dne
    '2025-12-30 23:30:00',
    '2026-01-01 00:00:00',
    '2025-06-30 23:30:00', // jiný den, rok se nemění
    '31/12/2025 23:30', // jiný tvar: zónu z něj neznáme
    '',
  ])('%s varování nedostane', (timestamp) => {
    expect(utcYearBoundaryNote(timestamp)).toBeNull();
  });
});

describe('parsery se světovým časem varují na hranici roku (L26-01)', () => {
  it('Trading 212: varuje u dividendy a úroku, ne u obchodu s akciemi, vkladu a přeskočeného řádku', () => {
    const result = parseTrading212Csv(atBoundary(T212_FIXTURE));
    expect(result.errors).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    const types = result.transactions.map((tx) => tx.type);
    expect(types).toEqual(['DEPOSIT', 'BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'WITHDRAWAL']);

    // Jen tam, kde den rozhoduje o roce příjmu: prodej akcií patří do roku
    // VYPOŘÁDÁNÍ (R-05a), takže věta „řadí ji do roku 2025“ by u něj lhala;
    // vklad a výběr do přiznání nevstupují vůbec.
    const warned = boundaryWarnings(result);
    expect(warned).toHaveLength(2);
    // den i rok zůstávají podle výpisu
    expect(JSON.stringify(result.transactions)).not.toContain('2026-01-01');
  });

  it('varování o hranici roku stojí v seznamu první — historie importů jich ukáže jen pár', () => {
    const result = parseTrading212Csv(atBoundary(T212_FIXTURE));
    const first = result.warnings.slice(0, 2).map((warning) => warning.message);
    expect(first.every((message) => message.includes('světového času'))).toBe(true);
    // mezi sebou v pořadí řádků souboru
    expect(result.warnings[0]!.line).toBeLessThan(result.warnings[1]!.line);
  });

  it('Anycoin: krypto se připisuje hned, varování má každý obchod z poslední hodiny roku', () => {
    const result = parseAnycoinCsv(atBoundary(ANYCOIN_BASIC));
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(boundaryWarnings(result)).toHaveLength(result.transactions.length);
    expect(boundaryWarnings(parseAnycoinCsv(ANYCOIN_BASIC))).toEqual([]);
  });

  it('Revolut (akcie): varuje jen u dividend, obchody s akciemi rozhoduje vypořádání', () => {
    const result = parseRevolutInvestCsv(atBoundary(REVOLUT_INVEST_CSV), REVOLUT_INSTRUMENT_MAP);
    const dividends = result.transactions.filter((tx) => tx.type === 'DIVIDEND');
    expect(dividends.length).toBeGreaterThan(0);
    expect(result.transactions.length).toBeGreaterThan(dividends.length);
    expect(boundaryWarnings(result)).toHaveLength(dividends.length);
  });

  it('Trading 212: běžný export žádné takové varování nemá', () => {
    expect(boundaryWarnings(parseTrading212Csv(T212_FIXTURE))).toEqual([]);
  });

  it('Coinbase: varuje u obchodů z poslední hodiny roku', () => {
    const result = parseCoinbaseCsv(atBoundary(COINBASE_V4));
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(boundaryWarnings(result).length).toBeGreaterThan(0);
    expect(boundaryWarnings(parseCoinbaseCsv(COINBASE_V4))).toEqual([]);
  });

  it('Kraken: varuje jednou za obchod, ne za každou nohu', () => {
    const result = parseKrakenCsv(atBoundary(KRAKEN_LEDGERS_NEW));
    expect(result.transactions.length).toBeGreaterThan(0);
    const warned = boundaryWarnings(result);
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.length).toBeLessThanOrEqual(result.transactions.length);
    expect(boundaryWarnings(parseKrakenCsv(KRAKEN_LEDGERS_NEW))).toEqual([]);
  });
});
