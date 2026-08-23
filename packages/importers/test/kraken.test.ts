import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src';
import {
  KRAKEN_BROKER,
  normalizeKrakenAsset,
  parseKrakenCsv,
  sniffKrakenCsv,
} from '../src/kraken/csv';
import { COINBASE_V4 } from './fixtures/coinbase';
import {
  KRAKEN_BAD_DATE,
  KRAKEN_CRYPTO_CRYPTO,
  KRAKEN_CRYPTO_FEE,
  KRAKEN_FIAT_FIAT,
  KRAKEN_LEDGERS_NEW,
  KRAKEN_LEDGERS_OLD,
  KRAKEN_MARGIN,
  KRAKEN_MISC_TYPES,
  KRAKEN_TRADES_CSV,
  KRAKEN_UNPAIRED,
  T212_HEADER_SAMPLE,
} from './fixtures/kraken';

describe('Kraken ledgers.csv parser', () => {
  it('happy path (nová hlavička s wallet): BUY + SELL + karta, vklad/výběr skipped, staking warning', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    expect(result.broker).toBe(KRAKEN_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(3);
    expect(result.transactions.map((t) => t.type)).toEqual(['BUY', 'SELL', 'BUY']);
    // vklad + výběr = převody, vědomě přeskočeno
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]!.line).toBe(2);
    expect(result.skipped[1]!.line).toBe(10);
    // staking odměna = warning (zatím daňově nezařazujeme)
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(9);
    expect(result.warnings[0]!.message).toContain('staking');
  });

  it('BUY z páru trade řádků: kusy z krypto nohy, cena |fiat|/qty Decimalem, fee z fiat nohy', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('kraken-LS4N2A-5DK5R-DRB7ZL'); // txid krypto nohy
    expect(buy.isin).toBe('BTC'); // XXBT → BTC
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.002');
    expect(buy.pricePerShare.toString()).toBe('50000'); // 100 EUR / 0.002 BTC
    expect(buy.currency).toBe('EUR'); // ZEUR → EUR
    expect(buy.fee?.amount.toString()).toBe('0.18');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2024-03-19');
  });

  it('SELL z páru trade řádků: krypto −, fiat + → prodej oceněný fiat protihodnotou', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.id).toBe('kraken-LWXHDF-MB4N7-DPQXVJ');
    expect(sell.isin).toBe('LTC'); // XLTC → LTC
    expect(sell.quantity.toString()).toBe('1');
    expect(sell.pricePerShare.toString()).toBe('80');
    expect(sell.currency).toBe('EUR');
    expect(sell.fee?.amount.toString()).toBe('0.2'); // fee z fiat nohy
    expect(sell.tradeDate).toBe('2024-04-02');
  });

  it('pár spend+receive (nákup kartou) se zpracuje jako BUY', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const cardBuy = result.transactions[2]!;
    if (cardBuy.type !== 'BUY') throw new Error('unreachable');
    expect(cardBuy.id).toBe('kraken-LPO9I8-ASDFG-HJKLM2');
    expect(cardBuy.isin).toBe('BTC');
    expect(cardBuy.quantity.toString()).toBe('0.001');
    expect(cardBuy.pricePerShare.toString()).toBe('50000');
    expect(cardBuy.fee).toBeUndefined();
  });

  it('stará hlavička bez wallet, assety bez prefixů, čas se zlomky sekund', () => {
    const result = parseKrakenCsv(KRAKEN_LEDGERS_OLD);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('BTC');
    expect(buy.currency).toBe('EUR');
    expect(buy.quantity.toString()).toBe('0.01');
    expect(buy.pricePerShare.toString()).toBe('20000');
    expect(buy.fee?.amount.toString()).toBe('0.32');
    expect(buy.tradeDate).toBe('2023-01-15');
  });

  it('normalizace assetů: X/Z prefixy, XXBT→BTC, XXDG→DOGE, sufix .S, neznámé kódy beze změny', () => {
    expect(normalizeKrakenAsset('XXBT')).toBe('BTC');
    expect(normalizeKrakenAsset('XBT')).toBe('BTC');
    expect(normalizeKrakenAsset('XETH')).toBe('ETH');
    expect(normalizeKrakenAsset('XXDG')).toBe('DOGE');
    expect(normalizeKrakenAsset('ZEUR')).toBe('EUR');
    expect(normalizeKrakenAsset('ZCZK')).toBe('CZK');
    expect(normalizeKrakenAsset('ADA.S')).toBe('ADA');
    expect(normalizeKrakenAsset('XXBT.S')).toBe('BTC'); // sufix + alias zároveň
    expect(normalizeKrakenAsset('SOL')).toBe('SOL');
    expect(normalizeKrakenAsset('EUR')).toBe('EUR');
  });

  it('směna krypto–krypto → warning + skip obou řádků (bez transakce)', () => {
    const result = parseKrakenCsv(KRAKEN_CRYPTO_CRYPTO);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('krypto–krypto');
    expect(result.warnings[0]!.message).toContain('BTC → ETH');
    expect(result.warnings[0]!.message).toContain('univerzální šablonu');
  });

  it('poplatek v kryptoměně → warning, obchod se zpracuje bez poplatku', () => {
    const result = parseKrakenCsv(KRAKEN_CRYPTO_FEE);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.type).toBe('BUY');
    if (result.transactions[0]!.type !== 'BUY') throw new Error('unreachable');
    expect(result.transactions[0]!.fee).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('kryptoměně');
    expect(result.warnings[0]!.message).toContain('nebyl odečten');
  });

  it('fiat–fiat pár (FX konverze) → skipped, ne obchod', () => {
    const result = parseKrakenCsv(KRAKEN_FIAT_FIAT);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.message).toContain('EUR');
    expect(result.skipped[0]!.message).toContain('USD');
  });

  it('nespárovaný trade řádek → error s číslem řádku', () => {
    const result = parseKrakenCsv(KRAKEN_UNPAIRED);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('párový řádek');
  });

  it('margin trade a rollover → warning + skip (zatím nepodporujeme)', () => {
    const result = parseKrakenCsv(KRAKEN_MARGIN);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.every((w) => w.message.includes('margin'))).toBe(true);
  });

  it('earn reward → warning; earn allocation a transfer → skipped bez varování; neznámý typ → warning', () => {
    const result = parseKrakenCsv(KRAKEN_MISC_TYPES);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    // earn/reward + adjustment = warningy
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]!.line).toBe(2);
    expect(result.warnings[0]!.message).toContain('nezařazujeme');
    expect(result.warnings[1]!.line).toBe(5);
    expect(result.warnings[1]!.message).toContain('adjustment');
    // allocation + transfer = tiché přesuny
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4]);
  });

  it('nesmyslné kalendářní datum → error na obou nohách páru', () => {
    const result = parseKrakenCsv(KRAKEN_BAD_DATE);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.message).toContain('Neplatný čas');
    expect(result.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('trades.csv se odmítne s vysvětlením (dvojí započtení)', () => {
    const result = parseKrakenCsv(KRAKEN_TRADES_CSV);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toBe(
      'Nahraj prosím export Ledgers (ledgers.csv) — obsahuje kompletní historii včetně vkladů; trades.csv by vedl ke dvojímu započtení.',
    );
  });

  it('prázdný soubor = prázdný výsledek, ne chyba', () => {
    const result = parseKrakenCsv('');

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('cizí formát bez ledger sloupců → error na hlavičce', () => {
    const result = parseKrakenCsv(`${T212_HEADER_SAMPLE}\nMarket buy,2024-01-02 10:00:00`);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako Kraken ledgers.csv');
  });

  it('sniff: true na obě generace ledgers i na trades.csv (to parser odmítne s návodem), false na T212 a Coinbase', () => {
    expect(sniffKrakenCsv(KRAKEN_LEDGERS_NEW)).toBe(true);
    expect(sniffKrakenCsv(KRAKEN_LEDGERS_OLD)).toBe(true);
    expect(sniffKrakenCsv(KRAKEN_TRADES_CSV)).toBe(true);
    expect(sniffKrakenCsv(T212_HEADER_SAMPLE)).toBe(false);
    expect(sniffKrakenCsv(COINBASE_V4)).toBe(false);
    expect(sniffKrakenCsv('')).toBe(false);
  });

  it('dedupe-stabilita: dva parse téhož souboru → stejná id, opakovaný import = samé duplicity', () => {
    const first = parseKrakenCsv(KRAKEN_LEDGERS_NEW);
    const second = parseKrakenCsv(KRAKEN_LEDGERS_NEW);

    const firstIds = first.transactions.map((t) => t.id);
    expect(firstIds.every((id) => id.startsWith('kraken-'))).toBe(true);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(KRAKEN_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(3);
    expect(combined.duplicates).toBe(3);
  });
});

describe('sniff pozná i trades.csv (routing na vysvětlující odmítnutí)', () => {
  it('trades.csv → sniff true a parse vrátí návod na ledgers.csv', async () => {
    const { sniffKrakenCsv, parseKrakenCsv } = await import('../src/kraken/csv');
    const { KRAKEN_TRADES_CSV } = await import('./fixtures/kraken');
    expect(sniffKrakenCsv(KRAKEN_TRADES_CSV)).toBe(true);
    const result = parseKrakenCsv(KRAKEN_TRADES_CSV);
    expect(result.transactions).toHaveLength(0);
    expect(result.errors[0]?.message).toContain('ledgers.csv');
  });
});

/**
 * K7b-01: sniffer musí být PODMNOŽINOU toho, co vyžaduje parser.
 *
 * `sniffKrakenCsv` chtěl `aclass` a `balance`, která parser NIKDY nečte —
 * všechny tři výskyty byly ve snifferu. Export bez nich se dal přečíst, ale
 * sniffer ho odmítl; a protože Kraken má sloupec doslova `type`, propadl až
 * na univerzální šablonu a uživatel četl hlášku cizího parseru o sloupci,
 * který jeho broker nikdy nemá.
 */
describe('sniffer nesmí být přísnější než parser (K7b-01)', () => {
  const bezAclassABalance = [
    '"txid","refid","time","type","subtype","asset","amount","fee"',
    '"L1","R1","2024-03-01 10:00:00","trade","","ZEUR","-1001.60","1.60"',
    '"L2","R1","2024-03-01 10:00:00","trade","","XXBT","0.02","0"',
  ].join('\n');

  it('ledgers bez aclass a balance sniffer pozná a parser přečte', async () => {
    const { sniffKrakenCsv, parseKrakenCsv } = await import('../src/kraken/csv');
    expect(sniffKrakenCsv(bezAclassABalance)).toBe(true);

    const result = parseKrakenCsv(bezAclassABalance);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });

  it('soubor, kterému chybí sloupec vyžadovaný parserem, sniffer nepozná', async () => {
    const { sniffKrakenCsv } = await import('../src/kraken/csv');
    // bez `amount` parser skončí chybou → propustit ho k němu nemá smysl
    const bezAmount = bezAclassABalance
      .split('\n')
      .map((line) => line.replace(',"amount"', '').replace(/,"-?[\d.]+","[\d.]+"$/, ',"0"'))
      .join('\n');
    expect(sniffKrakenCsv(bezAmount)).toBe(false);
  });
});
