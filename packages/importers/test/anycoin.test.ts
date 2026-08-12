import { d } from '@danero/shared';
import { describe, expect, it } from 'vitest';
import { dedupeTransactions, UNIVERSAL_TEMPLATE_CSV } from '../src';
import { ANYCOIN_BROKER, parseAnycoinCsv, sniffAnycoinCsv } from '../src/anycoin/csv';
import {
  ANYCOIN_BASIC,
  ANYCOIN_CRYPTO_SWAP,
  ANYCOIN_HEADER,
  ANYCOIN_MISC,
  ANYCOIN_UNPAIRED,
} from './fixtures/anycoin';
import { COINMATE_EN_LONG } from './fixtures/coinmate';

describe('Anycoin CSV parser', () => {
  it('happy path: pár payment+fill přes Order ID → BUY a SELL, převody a staking skipped', () => {
    const result = parseAnycoinCsv(ANYCOIN_BASIC);

    expect(result.broker).toBe(ANYCOIN_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(2);

    // payment -1000 CZK + fill 0.00075667 BTC = nákup BTC za 1000 CZK
    const buy = result.transactions[0]!;
    if (buy.type !== 'BUY') throw new Error('unreachable');
    expect(buy.id).toBe('anycoin-113180-buy');
    expect(buy.isin).toBe('BTC'); // krypto: isin = symbol
    expect(buy.assetClass).toBe('CRYPTO');
    expect(buy.quantity.toString()).toBe('0.00075667');
    expect(buy.currency).toBe('CZK');
    // cena za kus = |payment| / qty Decimalem (poplatek neexistuje — je ve spreadu)
    expect(buy.pricePerShare.eq(d('1000').div(d('0.00075667')))).toBe(true);
    expect(buy.fee).toBeUndefined();
    expect(buy.tradeDate).toBe('2021-04-10'); // datum z fill řádku

    // payment -52 ADA + fill 2676 CZK = prodej ADA za 2676 CZK
    const sell = result.transactions[1]!;
    if (sell.type !== 'SELL') throw new Error('unreachable');
    expect(sell.id).toBe('anycoin-258362-sell');
    expect(sell.isin).toBe('ADA');
    expect(sell.quantity.toString()).toBe('52');
    expect(sell.currency).toBe('CZK');
    expect(sell.pricePerShare.eq(d('2676').div(d('52')))).toBe(true);
    expect(sell.tradeDate).toBe('2021-09-10');

    // vklad, výběr a stake pár (ATOM → ATOM.S) = převody bez daňového dopadu
    expect(result.skipped).toHaveLength(4);
    expect(result.skipped.map((s) => s.line)).toEqual([6, 7, 8, 9]);

    // odměna ze stakingu → warning se srozumitelným vysvětlením, symbol bez .S
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.line).toBe(10);
    expect(result.warnings[0]!.message).toContain('stakingu');
    expect(result.warnings[0]!.message).toContain('SOL');
  });

  it('směna krypto–krypto (ETH → BTC) → warning + skip, žádná transakce', () => {
    const result = parseAnycoinCsv(ANYCOIN_CRYPTO_SWAP);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('krypto–krypto');
    expect(result.warnings[0]!.message).toContain('ETH');
    expect(result.warnings[0]!.message).toContain('BTC');
    expect(result.warnings[0]!.message).toContain('univerzální šablon');
  });

  it('nespárované obchodní řádky → error s číslem řádku', () => {
    const result = parseAnycoinCsv(ANYCOIN_UNPAIRED);

    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(2);

    // fill bez Order ID nejde spárovat
    const noOrderId = result.errors.find((e) => e.line === 3);
    expect(noOrderId?.message).toContain('bez Order ID');

    // payment bez protistrany (fill chybí)
    const unpaired = result.errors.find((e) => e.line === 2);
    expect(unpaired?.message).toContain('400001');
    expect(unpaired?.message).toContain('pár');
  });

  it('trade refund → warning; blokace výběru a unstake → skipped; neznámý typ → error', () => {
    const result = parseAnycoinCsv(ANYCOIN_MISC);

    expect(result.transactions).toEqual([]);

    const refund = result.warnings.find((w) => w.line === 2);
    expect(refund?.message).toContain('Vrácený obchod');
    expect(refund?.message).toContain('500001');

    // withdrawal_block/unblock + unstake pár (ATOM.S → ATOM)
    expect(result.skipped.map((s) => s.line)).toEqual([3, 4, 5, 6]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(7);
    expect(result.errors[0]!.message).toContain('Neznámý typ');
    expect(result.errors[0]!.message).toContain('airdrop');
  });

  it('rozbité datum nebo částka na obchodním řádku → error, ne tichý posun', () => {
    const badDate = parseAnycoinCsv(
      [ANYCOIN_HEADER, 'nesmysl,trade payment,-1000,CZK,600001'].join('\n'),
    );
    expect(badDate.transactions).toEqual([]);
    expect(badDate.errors).toHaveLength(1);
    expect(badDate.errors[0]!.line).toBe(2);
    expect(badDate.errors[0]!.message).toContain('Neplatné datum');

    const badAmount = parseAnycoinCsv(
      [ANYCOIN_HEADER, '2022-06-01T10:00:00.000Z,trade payment,abc,CZK,600002'].join('\n'),
    );
    expect(badAmount.errors).toHaveLength(1);
    expect(badAmount.errors[0]!.message).toContain('částka');
  });

  it('soubor s cizí hlavičkou → error na řádku 1, prázdný soubor → prázdný výsledek', () => {
    const foreign = parseAnycoinCsv('foo,bar\n1,2');
    expect(foreign.transactions).toEqual([]);
    expect(foreign.errors).toHaveLength(1);
    expect(foreign.errors[0]!.line).toBe(1);
    expect(foreign.errors[0]!.message).toContain('nevypadá jako výpis Anycoin');

    const empty = parseAnycoinCsv('');
    expect(empty.transactions).toEqual([]);
    expect(empty.errors).toEqual([]);
    expect(empty.skipped).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });

  it('idempotentní ID: dva parse téhož souboru → stejná id, dedupe vše chytí', () => {
    const first = parseAnycoinCsv(ANYCOIN_BASIC);
    const second = parseAnycoinCsv(ANYCOIN_BASIC);

    const firstIds = first.transactions.map((t) => t.id);
    expect(new Set(firstIds).size).toBe(firstIds.length);
    expect(second.transactions.map((t) => t.id)).toEqual(firstIds);

    const combined = dedupeTransactions(ANYCOIN_BROKER, [
      ...first.transactions,
      ...second.transactions,
    ]);
    expect(combined.fresh).toHaveLength(2);
    expect(combined.duplicates).toBe(2);
  });

  describe('sniffAnycoinCsv (autodetekce)', () => {
    it('rozpozná přesnou hlavičku (i s BOM a CRLF)', () => {
      expect(sniffAnycoinCsv(ANYCOIN_BASIC)).toBe(true);
      expect(sniffAnycoinCsv(ANYCOIN_HEADER)).toBe(true);
      expect(sniffAnycoinCsv(`\uFEFF${ANYCOIN_HEADER}\r\n2021-04-23T10:28:16.196Z,deposit,500,CZK`)).toBe(
        true,
      );
    });

    it('vezme i variantu se sloupcem navíc („anycoin TX ID“)', () => {
      // Anycoin exportuje obě podoby; parser sloupce mapuje podle názvů, takže
      // rozdíl je mu jedno — do 12. 8. 2026 ho ale odmítala autodetekce.
      const withTxId = [
        'Date,Type,Amount,Currency,Order ID,anycoin TX ID',
        '2026-01-02T10:00:00.000Z,trade payment,-1000.00,CZK,ORD1,TX1',
        '2026-01-02T10:00:00.000Z,trade fill,0.00100000,BTC,ORD1,TX2',
      ].join('\n');
      expect(sniffAnycoinCsv(withTxId)).toBe(true);
      const parsed = parseAnycoinCsv(withTxId);
      expect(parsed.errors).toEqual([]);
      expect(parsed.transactions).toHaveLength(1);
    });

    it('cizí formáty nechytá: T212, univerzální šablona, Coinmate, prázdno', () => {
      const t212 =
        'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Total\nMarket buy,2024-01-10 14:30:02,US0378331005,AAPL,Apple,10,185.50,USD,1855.00';
      expect(sniffAnycoinCsv(t212)).toBe(false);
      expect(sniffAnycoinCsv(UNIVERSAL_TEMPLATE_CSV)).toBe(false);
      expect(sniffAnycoinCsv(COINMATE_EN_LONG)).toBe(false);
      expect(sniffAnycoinCsv('')).toBe(false);
      // chybějící povinný sloupec = ne Anycoin
      expect(sniffAnycoinCsv('Date,Type,Amount,Currency')).toBe(false);
    });
  });
});
