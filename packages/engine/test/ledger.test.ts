import { describe, expect, it } from 'vitest';
import { buildLedger, resolveOptions, WarningCollector } from '../src';
import { buy, corpAction, hasWarning, run, sell } from './helpers';
import { TransactionSchema } from '@danero/shared';

describe('R-04 korporátní akce', () => {
  it('R-04a: split transformuje lot (množství × poměr, cena / poměr) bez resetu data nabytí', () => {
    const txs = [
      buy({ quantity: '10', pricePerShare: '3000', tradeDate: '2022-05-10', settlementDate: '2022-05-10' }),
      corpAction({ subtype: 'SPLIT', date: '2024-06-01', ratio: { from: '1', to: '2' } }),
    ];
    const ledger = buildLedger(txs, resolveOptions(), new WarningCollector());
    const lot = ledger.lots[0]!;
    expect(lot.remaining.toString()).toBe('20');
    expect(lot.costPerShare.toString()).toBe('1500');
    expect(lot.acquisitionDate).toBe('2022-05-10');

    // prodej po 3 letech od PŮVODNÍHO nabytí je osvobozený
    const result = run([
      ...txs,
      sell({ quantity: '20', pricePerShare: '6000', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('120000');
  });

  it('R-04e: změna ISIN nepřerušuje test — prodej pod novým ISIN najde původní loty', () => {
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2022-01-10', settlementDate: '2022-01-10' }),
      corpAction({ subtype: 'ISIN_CHANGE', isin: 'CZ0000000001', newIsin: 'CZ0000000099', date: '2024-03-01' }),
      sell({ isin: 'CZ0000000099', quantity: '100', pricePerShare: '1200', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('0'); // osvobozeno od 2025-01-11
    expect(result.securities.timeTestExemptProceedsCzk.toString()).toBe('120000');
  });

  it('R-04b: fúze bez explicitního příznaku test zachová a přidá výkladové varování', () => {
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2022-01-10', settlementDate: '2022-01-10' }),
      corpAction({ subtype: 'MERGER', isin: 'CZ0000000001', newIsin: 'CZ0000000088', date: '2024-06-01' }),
      sell({ isin: 'CZ0000000088', quantity: '100', pricePerShare: '1200', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(hasWarning(result, 'MERGER_INTERPRETIVE')).toBe(true);
  });

  it('R-04c: výměna se změnou jmenovité hodnoty (preservesAcquisitionDate=false) test přeruší', () => {
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2022-01-10', settlementDate: '2022-01-10' }),
      corpAction({
        subtype: 'MERGER',
        isin: 'CZ0000000001',
        newIsin: 'CZ0000000088',
        date: '2024-06-01',
        preservesAcquisitionDate: false,
      }),
      sell({ isin: 'CZ0000000088', quantity: '100', pricePerShare: '1200', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('20000'); // nabytí resetováno na 2024-06-01
    expect(hasWarning(result, 'MERGER_INTERPRETIVE')).toBe(false);
  });

  it('R-04f: spin-off — novým kusům běží nová lhůta, cost basis dle přepínače', () => {
    const txs = [
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2020-02-01', settlementDate: '2020-02-01' }),
      corpAction({
        subtype: 'SPINOFF',
        isin: 'CZ0000000001',
        newIsin: 'CZ0000000077',
        date: '2025-01-15',
        ratio: { from: '2', to: '1' },
        costFraction: '0.1',
      }),
      sell({ isin: 'CZ0000000077', quantity: '50', pricePerShare: '2500', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ];

    // default 'zero': nabývací cena spin-offu 0 → zdanitelných celých 125 000
    const zero = run(txs);
    expect(zero.securities.base10Czk.toString()).toBe('125000');
    expect(hasWarning(zero, 'SPINOFF_COST_BASIS')).toBe(true);

    // 'proportional' s costFraction 0.1: dítě 50 ks à 200 Kč, rodiči cena klesne na 900
    const proportional = run(txs, { options: { spinoffCostBasisAllocation: 'proportional' } });
    expect(proportional.securities.base10Czk.toString()).toBe('115000');
    const parentLot = proportional.ledger.lots.find((l) => l.isin === 'CZ0000000001')!;
    expect(parentLot.costPerShare.toString()).toBe('900');
  });

  it('R-04i: převod mezi brokery s doloženým nabytím test nepřerušuje; bez něj cost 0 + ERROR', () => {
    const withAcquisition = run([
      TransactionSchema.parse({
        type: 'TRANSFER_IN',
        id: 'tr-1',
        isin: 'CZ0000000001',
        quantity: '100',
        date: '2025-01-10',
        acquisition: { date: '2021-05-05', costPerShare: '500', currency: 'CZK' },
      }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(withAcquisition.securities.base10Czk.toString()).toBe('0'); // osvobozeno od 2024-05-06

    const withoutAcquisition = run([
      TransactionSchema.parse({
        type: 'TRANSFER_IN',
        id: 'tr-2',
        isin: 'CZ0000000001',
        quantity: '100',
        date: '2025-01-10',
      }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(withoutAcquisition.securities.base10Czk.toString()).toBe('120000');
    expect(hasWarning(withoutAcquisition, 'TRANSFER_WITHOUT_ACQUISITION')).toBe(true);
  });
});

describe('R-05 párování a dílčí základ § 10', () => {
  const twoLotsAndSale = [
    buy({ quantity: '10', pricePerShare: '10000', tradeDate: '2023-01-10', settlementDate: '2023-01-10' }),
    buy({ quantity: '10', pricePerShare: '20000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
    sell({ quantity: '10', pricePerShare: '15000', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
  ];

  it('R-05c: metoda párování mění základ — FIFO zisk, LIFO ztráta', () => {
    expect(run(twoLotsAndSale, { options: { matchingMethod: 'FIFO' } }).securities.base10Czk.toString()).toBe('50000');
    expect(run(twoLotsAndSale, { options: { matchingMethod: 'MAX_PROFIT' } }).securities.base10Czk.toString()).toBe('50000');
    expect(run(twoLotsAndSale, { options: { matchingMethod: 'LIFO' } }).securities.base10Czk.toString()).toBe('0');
    expect(run(twoLotsAndSale, { options: { matchingMethod: 'MAX_LOSS' } }).securities.base10Czk.toString()).toBe('0');
  });

  it('R-05d: ztráta z jednoho titulu se započte proti zisku jiného; celková ztráta → základ 0', () => {
    const gainAndLoss = run([
      buy({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '10000', tradeDate: '2024-03-01', settlementDate: '2024-03-01' }),
      sell({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '13000', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
      buy({ isin: 'CZ0000000002', quantity: '10', pricePerShare: '10000', tradeDate: '2024-03-01', settlementDate: '2024-03-01' }),
      sell({ isin: 'CZ0000000002', quantity: '10', pricePerShare: '9000', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
    ]);
    expect(gainAndLoss.securities.base10Czk.toString()).toBe('20000'); // +30k −10k

    const overallLoss = run(twoLotsAndSale, { options: { matchingMethod: 'LIFO' } });
    expect(overallLoss.securities.rawGainLossCzk.toString()).toBe('-50000');
    expect(overallLoss.securities.base10Czk.toString()).toBe('0');
    expect(hasWarning(overallLoss, 'LOSS_NOT_DEDUCTIBLE')).toBe(true);
  });

  it('R-05b: poplatky nákupu i prodeje snižují základ (jen u zdanitelných alokací)', () => {
    const result = run([
      buy({
        quantity: '100', pricePerShare: '1150', tradeDate: '2024-01-10', settlementDate: '2024-01-10',
        fee: { amount: '100', currency: 'CZK' },
      }),
      sell({
        quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05',
        fee: { amount: '50', currency: 'CZK' },
      }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('4850'); // 120 000 − 115 000 − 100 − 50
  });

  it('prodej bez evidovaného nákupu → syntetický lot s cenou 0 a ERROR (neúplná historie)', () => {
    const result = run([
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);
    expect(hasWarning(result, 'NEGATIVE_POSITION')).toBe(true);
    expect(result.securities.base10Czk.toString()).toBe('120000'); // výdaj 0, bez časového testu
  });

  it('R-04j: prodej frakcí CP dostane informační vlajku, celé kusy a krypto ne', () => {
    const fractional = run([
      buy({ quantity: '2.5', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '2.5', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);
    expect(hasWarning(fractional, 'FRACTIONAL_SHARES')).toBe(true);

    const whole = run([
      buy({ quantity: '10', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '10', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      // krypto je frakční z podstaty — vlajka mu nepatří
      buy({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '0.5', pricePerShare: '100000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      sell({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '0.5', pricePerShare: '120000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(hasWarning(whole, 'FRACTIONAL_SHARES')).toBe(false);
  });
});
