import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { COINMATE_BROKER, parseCoinmateCsv, sniffCoinmateCsv } from '../src/coinmate/csv';
import {
  COINMATE_BAD_ROWS,
  COINMATE_CZ,
  COINMATE_EN_LONG,
  COINMATE_EN_SHORT,
  COINMATE_V2,
} from './fixtures/coinmate';
import { ANYCOIN_BASIC } from './fixtures/anycoin';

describe('Coinmate CSV parser', () => {
  it('happy path EN dlouhá: QUICK_BUY/QUICK_SELL → BUY/SELL, WITHDRAWAL → skipped', () => {
    const result = parseCoinmateCsv(COINMATE_EN_LONG);

    expect(result.broker).toBe(COINMATE_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(3);

    // výběr LTC na vlastní peněženku = převod, ne zdanitelná událost
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.line).toBe(2);
    expect(result.skipped[0]!.message).toContain('převod');

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('coinmate-2');
    expect(buy.isin).toBe('LTC'); // krypto: isin = symbol
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.98398872');
    expect(buy.pricePerShare.toString()).toBe('46.49');
    expect(buy.currency).toBe('EUR');
    expect(buy.fee?.amount.toString()).toBe('0.11436408');
    expect(buy.fee?.currency).toBe('EUR');
    expect(buy.tradeDate).toBe('2020-07-30');

    // záporná Částka = SELL s kladným množstvím (směr nese type)
    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.id).toBe('coinmate-3');
    expect(sell.quantity.toString()).toBe('1');
    expect(sell.pricePerShare.toString()).toBe('45.98');
    expect(sell.fee?.amount.toString()).toBe('0.11495');

    const btcBuy = result.transactions[2]!;
    if (btcBuy.type !== 'BUY') throw new Error('unreachable');
    expect(btcBuy.id).toBe('coinmate-7722246');
    expect(btcBuy.isin).toBe('BTC');
    expect(btcBuy.quantity.toString()).toBe('0.01574751');
    expect(btcBuy.pricePerShare.toString()).toBe('1265612.25778996');
    expect(btcBuy.currency).toBe('CZK');
    expect(btcBuy.fee?.currency).toBe('CZK');
  });

  it('EN krátká varianta (bez Account a zůstatků): BUY/SELL, REFERRAL → warning + skip', () => {
    const result = parseCoinmateCsv(COINMATE_EN_SHORT);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('coinmate-55501');
    expect(buy.quantity.toString()).toBe('0.005');
    expect(buy.pricePerShare.toString()).toBe('982000.5');
    expect(buy.currency).toBe('CZK');

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.quantity.toString()).toBe('0.002');

    // odměna z affiliate programu se daňově nezařazuje → upozornění, žádná transakce
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(4);
    expect(result.warnings[0]!.message).toContain('affiliate');
  });

  it('CZ hlavička s BOM, české datum „16.08.2021 9:42", MARKET_* typy', () => {
    const result = parseCoinmateCsv(COINMATE_CZ);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('coinmate-9001');
    expect(buy.isin).toBe('LTC');
    expect(buy.quantity.toString()).toBe('0.5');
    expect(buy.pricePerShare.toString()).toBe('3500.25'); // desetinná TEČKA i v CZ exportu
    expect(buy.currency).toBe('CZK');
    expect(buy.tradeDate).toBe('2021-08-16');

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.tradeDate).toBe('2021-08-17');

    // vklad + interní přesun zůstatku = skipped
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.line)).toEqual([4, 6]);

    // prázdný Typ s Popiskem „User: …" = affiliate odměna → warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(5);
    expect(result.warnings[0]!.message).toContain('affiliate');
  });

  it('V2 statement: měna PŘED hodnotou, Type detail nese směr, CANCEL → skipped', () => {
    const result = parseCoinmateCsv(COINMATE_V2);

    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('coinmate-1');
    expect(buy.isin).toBe('BTC');
    expect(buy.quantity.toString()).toBe('0.02579386');
    expect(buy.pricePerShare.toString()).toBe('9010.2');
    expect(buy.currency).toBe('EUR');
    expect(buy.fee?.amount.toString()).toBe('0.46481567');
    expect(buy.tradeDate).toBe('2020-02-10');

    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.id).toBe('coinmate-2');
    expect(sell.quantity.toString()).toBe('0.01');
    expect(sell.pricePerShare.toString()).toBe('8500');

    // zrušený obchod (Type detail CANCEL) → skipped
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.line).toBe(4);
    expect(result.skipped[0]!.message).toContain('Zrušený');

    // Affiliate typ → warning
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(5);
  });

  it('chybové řádky: cizí stav → skipped; neznámý typ, rozbité datum a částka → errors s čísly řádků', () => {
    const result = parseCoinmateCsv(COINMATE_BAD_ROWS);

    expect(result.transactions).toEqual([]);

    // PENDING = nedokončená transakce, vědomě přeskočená
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.line).toBe(2);
    expect(result.skipped[0]!.message).toContain('PENDING');

    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(result.errors[0]!.message).toContain('Neznámý typ');
    expect(result.errors[0]!.message).toContain('LOAN');
    expect(result.errors[1]!.message).toContain('Neplatné datum');
    expect(result.errors[2]!.message).toContain('množství');
  });

  it('soubor s cizí hlavičkou → error na řádku 1, prázdný soubor → prázdný výsledek', () => {
    const foreign = parseCoinmateCsv('foo;bar;baz\n1;2;3');
    expect(foreign.transactions).toEqual([]);
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.line).toBe(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako výpis Coinmate');

    const empty = parseCoinmateCsv('');
    expect(empty.transactions).toEqual([]);
    expect(empty.errors).toEqual([]);
    expect(empty.skipped).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });

  it('idempotentní ID: dva parse téhož souboru → stejná id, dedupe vše chytí', () => {
    const first = parseCoinmateCsv(COINMATE_EN_LONG);
    const second = parseCoinmateCsv(COINMATE_EN_LONG);

    const firstIds = first.transactions.map((t) => t.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(COINMATE_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(3);
    expect(combined.duplicates).toBe(3);
  });

  describe('sniffCoinmateCsv (autodetekce)', () => {
    it('rozpozná všechny čtyři varianty hlaviček (vč. BOM u CZ)', () => {
      expect(sniffCoinmateCsv(COINMATE_EN_LONG)).toBe(true);
      expect(sniffCoinmateCsv(COINMATE_EN_SHORT)).toBe(true);
      expect(sniffCoinmateCsv(COINMATE_CZ)).toBe(true);
      expect(sniffCoinmateCsv(COINMATE_V2)).toBe(true);
    });

    it('cizí formáty nechytá: T212, univerzální šablona, Anycoin, Degiro, prázdno', () => {
      const t212 =
        'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total\nMarket buy,2024-01-10 14:30:02,US0378331005,AAPL,Apple,10,185.50,USD,1855.00';
      expect(sniffCoinmateCsv(t212)).toBe(false);
      expect(sniffCoinmateCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
      expect(sniffCoinmateCsv(ANYCOIN_BASIC)).toBe(false);
      // Degiro má taky středníky, ale ne coinmate měnové sloupce
      expect(
        sniffCoinmateCsv('Datum;Čas;Produkt;ISIN;Reference;Venue;Počet;Kurz;;Hodnota'),
      ).toBe(false);
      expect(sniffCoinmateCsv('')).toBe(false);
    });
  });
});
