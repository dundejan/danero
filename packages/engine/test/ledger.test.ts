import { describe, expect, it } from 'vitest';
import { buildLedger, inferSettlementDate, resolveOptions, WarningCollector } from '../src';
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

  it('R-11: změna ISIN může být i změna třídy fondu → lot je výkladový a engine varuje', () => {
    const result = run([
      buy({ isin: 'IE00B4L5Y983', quantity: '10', pricePerShare: '1000', tradeDate: '2021-03-01', settlementDate: '2021-03-01' }),
      corpAction({ subtype: 'ISIN_CHANGE', isin: 'IE00B4L5Y983', newIsin: 'IE00B4L5YC18', date: '2024-03-01' }),
    ]);
    // R-04e: časový test běží dál od původního nákupu, lot se ale označí k posouzení
    expect(result.ledger.lots[0]!.acquisitionDate).toBe('2021-03-01');
    expect(result.ledger.lots[0]!.isin).toBe('IE00B4L5YC18');
    expect(result.ledger.lots[0]!.interpretive).toBe(true);
    expect(hasWarning(result, 'ISIN_CHANGE_INTERPRETIVE')).toBe(true);
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

  it('R-04i: převod s datem nabytí, ale bez ceny → tichá cena 0 dostane vlastní WARNING', () => {
    const partial = run([
      TransactionSchema.parse({
        type: 'TRANSFER_IN',
        id: 'tr-3',
        isin: 'CZ0000000001',
        quantity: '100',
        date: '2025-01-10',
        acquisition: { date: '2024-05-05' }, // jen datum — cena chybí
      }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    // výpočet beze změny: výdaj 0, časový test od data nabytí (nesplněn → zdanitelné)
    expect(partial.securities.base10Czk.toString()).toBe('120000');
    expect(hasWarning(partial, 'TRANSFER_WITHOUT_COST')).toBe(true);
    expect(hasWarning(partial, 'TRANSFER_WITHOUT_ACQUISITION')).toBe(false);

    // úplné nabytí (s cenou) varování nedostane
    const complete = run([
      TransactionSchema.parse({
        type: 'TRANSFER_IN',
        id: 'tr-4',
        isin: 'CZ0000000001',
        quantity: '100',
        date: '2025-01-10',
        acquisition: { date: '2021-05-05', costPerShare: '500', currency: 'CZK' },
      }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(hasWarning(complete, 'TRANSFER_WITHOUT_COST')).toBe(false);
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

  it('R-05c: MAX_PROFIT/MAX_LOSS porovnává nabývací ceny v CZK (kurz roku nákupu, R-06a), ne nominály napříč měnami', () => {
    // lot A: 10 USD/ks × kurz 2024 (23) = 230 Kč/ks; lot B: 200 Kč/ks —
    // nominálně je A „levnější“ (10 < 200), v CZK je levnější B (200 < 230)
    const txs = [
      buy({ currency: 'USD', quantity: '10', pricePerShare: '10', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      buy({ currency: 'CZK', quantity: '10', pricePerShare: '200', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ currency: 'CZK', quantity: '10', pricePerShare: '12000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ];

    const maxProfit = run(txs, { options: { matchingMethod: 'MAX_PROFIT' } });
    expect(maxProfit.ledger.disposals[0]!.allocations[0]!.lotCurrency).toBe('CZK');
    expect(maxProfit.securities.base10Czk.toString()).toBe('118000'); // 120 000 − 10 × 200

    const maxLoss = run(txs, { options: { matchingMethod: 'MAX_LOSS' } });
    expect(maxLoss.ledger.disposals[0]!.allocations[0]!.lotCurrency).toBe('USD');
    expect(maxLoss.securities.base10Czk.toString()).toBe('117700'); // 120 000 − 10 × 10 × 23
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

  it('dopočet vypořádání: US od 28. 5. 2024 a Kanada od 27. 5. 2024 T+1, před tím T+2', () => {
    // Kanada (CIRO/CCMA): účinnost 27. 5. 2024 — o den dřív než US (Memorial Day).
    // Kanadské ISIN jedou na kalendáři US (R-01a, dokumentovaná aproximace), takže
    // 27. 5. je pro ně svátek a T+2 z pátku dopadá až na středu 29. 5.
    expect(inferSettlementDate('2024-05-24', 'CA9861913023', 'STOCK')).toBe('2024-05-29'); // pátek + T+2
    expect(inferSettlementDate('2024-05-27', 'CA9861913023', 'STOCK')).toBe('2024-05-28'); // pondělí + T+1
    // US (SEC 15c6-1): účinnost 28. 5. 2024
    expect(inferSettlementDate('2024-05-27', 'US0378331005', 'STOCK')).toBe('2024-05-29'); // ještě T+2
    expect(inferSettlementDate('2024-05-28', 'US0378331005', 'STOCK')).toBe('2024-05-29'); // už T+1
    // ostatní trhy zůstávají T+2, krypto T+0
    expect(inferSettlementDate('2024-06-03', 'DE0007164600', 'STOCK')).toBe('2024-06-05');
    expect(inferSettlementDate('2024-06-03', 'BTC', 'CRYPTO')).toBe('2024-06-03');
  });

  it('R-01a: dopočet vypořádání přeskakuje i burzovní svátky (velikonoční nákup IE ETF)', () => {
    // obchod ve středu 13. 4. 2022; Velký pátek 15. 4. a Velikonoční pondělí
    // 18. 4. Euronext Dublin neobchoduje → T+2 padá až na úterý 19. 4.
    expect(inferSettlementDate('2022-04-13', 'IE00B4L5Y983', 'ETF')).toBe('2022-04-19');

    const result = run([
      // vypořádání schválně nevyplněné — přesně tak chodí z výpisů bez settle date
      buy({ isin: 'IE00B4L5Y983', quantity: '100', pricePerShare: '2000', tradeDate: '2022-04-13', settlementDate: undefined }),
      sell({ isin: 'IE00B4L5Y983', quantity: '100', pricePerShare: '3000', tradeDate: '2025-04-16', settlementDate: '2025-04-16' }),
    ]);
    const allocation = result.ledger.disposals[0]!.allocations[0]!;
    expect(allocation.acquisitionDate).toBe('2022-04-19');
    expect(allocation.exemptFrom).toBe('2025-04-20');
    // bez svátků by vypořádání vyšlo 15. 4. 2022 a prodej 16. 4. 2025 by byl
    // (chybně) osvobozený — takhle je zdanitelný: 300 000 − 200 000
    expect(allocation.timeTestExempt).toBe(false);
    expect(result.securities.base10Czk.toString()).toBe('100000');
  });

  it('R-01a: kalendář svátků se vybírá podle prefixu ISIN', () => {
    // US: 4. 7. 2025 Independence Day → T+1 ze čtvrtka až na pondělí
    expect(inferSettlementDate('2025-07-03', 'US0378331005', 'STOCK')).toBe('2025-07-07');
    // DE: Xetra neobchoduje 24.–26. 12. → T+2 z 23. 12. 2025 až na 30. 12.
    expect(inferSettlementDate('2025-12-23', 'DE0007164600', 'STOCK')).toBe('2025-12-30');
    // UK: 5. 5. 2025 Early May bank holiday
    expect(inferSettlementDate('2025-05-02', 'GB0002374006', 'STOCK')).toBe('2025-05-07');
    // CZ: 8. 5. 2025 Den vítězství
    expect(inferSettlementDate('2025-05-06', 'CZ0008019106', 'STOCK')).toBe('2025-05-09');
    // IE: 1. 5. (Euronext) i 5. 5. 2025 (irský May Bank Holiday)
    expect(inferSettlementDate('2025-04-30', 'IE00B4L5Y983', 'ETF')).toBe('2025-05-06');
    // ostatní ISIN jedou na TARGET2 — 1. 5. ano, irské pondělí ne
    expect(inferSettlementDate('2025-04-30', 'FR0000120271', 'STOCK')).toBe('2025-05-05');
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
