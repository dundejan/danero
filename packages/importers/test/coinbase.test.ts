import { d } from '@danero/shared';
import { describe, expect, it } from 'vitest';
import { dedupeTransactions } from '../src';
import { COINBASE_BROKER, parseCoinbaseCsv, sniffCoinbaseCsv } from '../src/coinbase/csv';
import {
  COINBASE_CONVERT_BAD_NOTES,
  COINBASE_DUPLICATE_ROWS,
  COINBASE_UNKNOWN_TYPE,
  COINBASE_V1_EUR,
  COINBASE_V2,
  COINBASE_V3,
  COINBASE_V4,
  T212_HEADER_SAMPLE,
} from './fixtures/coinbase';
import { KRAKEN_LEDGERS_NEW } from './fixtures/kraken';

describe('Coinbase transaction history CSV parser', () => {
  it('V4 (s ID): Advanced Trade Buy/Sell s € symboly, Card Spend, tisícové čárky', () => {
    const result = parseCoinbaseCsv(COINBASE_V4);

    expect(result.broker).toBe(COINBASE_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(4);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('coinbase-67645f1f8e8ebf2624a29d83'); // ID sloupec
    expect(buy.isin).toBe('SOL');
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.035');
    expect(buy.pricePerShare.toString()).toBe('190'); // Subtotal 6.65 / 0.035
    expect(buy.currency).toBe('EUR');
    expect(buy.fee?.amount.toString()).toBe('0.0399'); // €0.0399 očištěno
    expect(buy.tradeDate).toBe('2024-12-19'); // `YYYY-MM-DD HH:MM:SS UTC`

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('0.5'); // záporný počet kusů → abs
    expect(sell.pricePerShare.toString()).toBe('200');
    expect(sell.fee?.amount.toString()).toBe('0.6');

    const bigBuy = result.transactions[3]!;
    if (bigBuy.type !== 'BUY') throw new Error('unreachable');
    expect(bigBuy.pricePerShare.toString()).toBe('82304'); // "€1,234.56" / 0.015
  });

  it('Card Spend → SELL s poznámkou o úplatném převodu', () => {
    const result = parseCoinbaseCsv(COINBASE_V4);

    const cardSpend = result.transactions[2]!;
    if (cardSpend.type !== 'SELL') throw new Error('unreachable');
    expect(cardSpend.isin).toBe('BTC');
    expect(cardSpend.quantity.toString()).toBe('0.001');
    expect(cardSpend.pricePerShare.toString()).toBe('90000');
    expect(cardSpend.fee).toBeUndefined(); // €0 → bez poplatku
    expect(cardSpend.note).toBe('platba kartou = úplatný převod');
  });

  it('V3: Convert = SELL + BUY z Notes; Send/Receive skipped; Staking Income warning', () => {
    const result = parseCoinbaseCsv(COINBASE_V3);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const sell = result.transactions[0]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.isin).toBe('BTC');
    expect(sell.quantity.toString()).toBe('0.05413984');
    expect(sell.pricePerShare.eq(d('10415.01').div(d('0.05413984')))).toBe(true);
    expect(sell.currency).toBe('USD');
    expect(sell.fee?.amount.toString()).toBe('111.73');
    expect(sell.tradeDate).toBe('2019-09-25');
    expect(sell.id.endsWith('-sell')).toBe(true);

    const buy = result.transactions[1]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('USDC'); // cílové aktivum z Notes
    expect(buy.quantity.toString()).toBe('451.212148');
    expect(buy.pricePerShare.eq(d('10415.01').div(d('451.212148')))).toBe(true);
    expect(buy.currency).toBe('USD');
    expect(buy.fee).toBeUndefined(); // poplatek nese jen SELL noha
    expect(buy.tradeDate).toBe('2019-09-25');
    expect(buy.id.endsWith('-buy')).toBe(true);

    // Send + Receive = převody na vlastní peněženku, vědomě přeskočeno
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4]);
    // Staking Income = odměna, zatím daňově nezařazujeme
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(5);
    expect(result.warnings[0]!.message).toContain('nezařazujeme');
  });

  it('V2 (Fees bez „and/or Spread“): Buy s měnou ze Spot Price Currency', () => {
    const result = parseCoinbaseCsv(COINBASE_V2);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('ETH');
    expect(buy.quantity.toString()).toBe('0.5');
    expect(buy.pricePerShare.toString()).toBe('1800'); // Subtotal 900 / 0.5
    expect(buy.currency).toBe('EUR');
    expect(buy.fee?.amount.toString()).toBe('12.5');
    expect(buy.tradeDate).toBe('2021-04-14'); // ISO timestamp se Z
  });

  it('V1: měna z prefixu názvů sloupců (EUR …), hlavička nalezená pod preambulí', () => {
    const result = parseCoinbaseCsv(COINBASE_V1_EUR);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.isin).toBe('BTC');
    expect(buy.quantity.toString()).toBe('0.03182812');
    expect(buy.pricePerShare.eq(d('295.60').div(d('0.03182812')))).toBe(true);
    expect(buy.currency).toBe('EUR'); // z prefixu „EUR Subtotal“
    expect(buy.fee?.amount.toString()).toBe('4.4');
    expect(buy.tradeDate).toBe('2020-09-27');

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('0.03517833');
    expect(sell.pricePerShare.eq(d('240.32').div(d('0.03517833')))).toBe(true);
    expect(sell.fee?.amount.toString()).toBe('3.58');
  });

  it('čísla řádků v chybách počítají preambuli (line = skutečný řádek souboru)', () => {
    const withBadRow = `${COINBASE_V1_EUR}\n2020-05-05T10:00:00Z,Mystery,BTC,0.1,100.00,10.00,10.00,0,`;
    const result = parseCoinbaseCsv(withBadRow);

    expect(result.transactions).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(7); // 3 řádky preambule + hlavička + 2 obchody
    expect(result.errors[0]!.message).toContain('Mystery');
  });

  it('Convert s nečitelnou poznámkou → error řádku, žádná poloviční směna', () => {
    const result = parseCoinbaseCsv(COINBASE_CONVERT_BAD_NOTES);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Convert');
    expect(result.errors[0]!.message).toContain('univerzální šablonu');
  });

  it('neznámý typ transakce → error s názvem typu', () => {
    const result = parseCoinbaseCsv(COINBASE_UNKNOWN_TYPE);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);
    expect(result.errors[0]!.message).toContain('Mystery Payout');
  });

  it('prázdný soubor = prázdný výsledek, ne chyba', () => {
    const result = parseCoinbaseCsv('');

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('soubor bez Coinbase hlavičky → srozumitelný error', () => {
    const result = parseCoinbaseCsv(`${T212_HEADER_SAMPLE}\nMarket buy,2024-01-02 10:00:00`);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);
    expect(result.errors[0]!.message).toContain('nevypadá jako Coinbase export');
  });

  it('sniff: true na všechny 4 generace (vč. hlavičky pod preambulí), false na cizí formáty', () => {
    expect(sniffCoinbaseCsv(COINBASE_V4)).toBe(true);
    expect(sniffCoinbaseCsv(COINBASE_V3)).toBe(true);
    expect(sniffCoinbaseCsv(COINBASE_V2)).toBe(true);
    expect(sniffCoinbaseCsv(COINBASE_V1_EUR)).toBe(true);
    expect(sniffCoinbaseCsv(T212_HEADER_SAMPLE)).toBe(false);
    expect(sniffCoinbaseCsv(KRAKEN_LEDGERS_NEW)).toBe(false);
    expect(sniffCoinbaseCsv('')).toBe(false);
  });

  it('dedupe-stabilita: dva parse téhož souboru → stejná id (ID sloupec i fnv fallback)', () => {
    for (const fixture of [COINBASE_V4, COINBASE_V3, COINBASE_V1_EUR]) {
      const first = parseCoinbaseCsv(fixture);
      const second = parseCoinbaseCsv(fixture);
      const firstIds = first.transactions.map((t) => t.id);
      expect(firstIds.every((id) => id.startsWith('coinbase-'))).toBe(true);
      expect(new Set(firstIds).size).toBe(firstIds.length);
      expect(second.transactions.map((t) => t.id)).toEqual(firstIds);
    }

    const first = parseCoinbaseCsv(COINBASE_V4);
    const second = parseCoinbaseCsv(COINBASE_V4);
    const combined = dedupeTransactions(COINBASE_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(4);
    expect(combined.duplicates).toBe(4);
  });

  it('identické řádky bez ID → unikátní stabilní id (suffix), ne tichá kolize', () => {
    const first = parseCoinbaseCsv(COINBASE_DUPLICATE_ROWS);
    const second = parseCoinbaseCsv(COINBASE_DUPLICATE_ROWS);

    expect(first.errors).toEqual([]);
    expect(first.transactions).toHaveLength(2);
    const ids = first.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).toBe(`${ids[0]}-2`);
    expect(second.transactions.map((t) => t.id)).toEqual(ids);

    const combined = dedupeTransactions(COINBASE_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(2);
    expect(combined.duplicates).toBe(2);
  });
});
