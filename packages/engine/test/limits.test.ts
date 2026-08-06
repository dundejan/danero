import { describe, expect, it } from 'vitest';
import { buy, CFG_2025, dividend, hasWarning, run, sell } from './helpers';

describe('R-02 hodnotový test 100 000 Kč', () => {
  it('R-02a: cliff — do 100k včetně vše osvobozeno, nad 100k padá osvobození celé', () => {
    const scenario = (price: string) => [
      buy({ quantity: '100', pricePerShare: '900', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ quantity: '100', pricePerShare: price, tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ];

    const under = run(scenario('999.99')); // tržba 99 999
    expect(under.securities.exemptUnder100k).toBe(true);
    expect(under.securities.base10Czk.toString()).toBe('0');

    const exactly = run(scenario('1000')); // tržba přesně 100 000 → stále osvobozeno
    expect(exactly.securities.exemptUnder100k).toBe(true);
    expect(exactly.limits.limit100k.exceeded).toBe(false);

    const over = run(scenario('1000.01')); // tržba 100 001 → celé zdanitelné
    expect(over.securities.exemptUnder100k).toBe(false);
    expect(over.securities.base10Czk.toString()).toBe('10001');
    expect(over.limits.limit100k.exceeded).toBe(true);
  });

  it('R-02f: CP v obchodním majetku — bez osvobození 100k, tržby pool nečerpají', () => {
    const txs = [
      buy({ quantity: '100', pricePerShare: '400', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ quantity: '100', pricePerShare: '500', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ];

    // bez flagu: tržba 50k ≤ 100k → osvobozeno
    const privateAssets = run(txs);
    expect(privateAssets.securities.base10Czk.toString()).toBe('0');

    // s flagem: § 4/1 t) se nepoužije → zdanitelné (zisk 10k) a pool 100k = 0
    const business = run(txs, { profile: { hasSecuritiesInBusinessAssets: true } });
    expect(business.securities.base10Czk.toString()).toBe('10000');
    expect(business.securities.pool100kCzk.toString()).toBe('0');
    expect(business.limits.limit100k.usedCzk.toString()).toBe('0');
    // neosvobozená tržba čerpá limit 50k paušální daně (R-08d)
    expect(business.limits.flatTax50k.status.usedCzk.toString()).toBe('50000');
  });

  it('R-02f: flag obchodního majetku CP nevypíná krypto osvobození (zj/zk mají vlastní vyloučení)', () => {
    const txs = [
      // krypto: nákup 2020, prodej 5/2025 → časový test zk) splněn
      buy({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '500000', tradeDate: '2020-06-01', settlementDate: '2020-06-01' }),
      sell({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '900000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ];
    const result = run(txs, { profile: { hasSecuritiesInBusinessAssets: true } });
    // flag CP krypto test nevypíná — příjem zůstává osvobozen dle zk)
    expect(result.crypto.base10Czk.toString()).toBe('0');
    expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('900000');
  });

  it('R-02c: přepínač — počítají se do úhrnu i prodeje osvobozené časovým testem?', () => {
    const txs = [
      // A: drženo 6 let → osvobozeno testem, tržba 80 000
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '700', tradeDate: '2019-01-10', settlementDate: '2019-01-10' }),
      sell({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '800', tradeDate: '2025-05-05', settlementDate: '2025-05-05' }),
      // B: drženo 1 rok, tržba 30 000
      buy({ isin: 'CZ0000000002', quantity: '100', pricePerShare: '250', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      sell({ isin: 'CZ0000000002', quantity: '100', pricePerShare: '300', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ];

    // striktní výklad (default): úhrn 110k > 100k → B zdanitelné
    const strict = run(txs);
    expect(strict.securities.pool100kCzk.toString()).toBe('110000');
    expect(strict.securities.exemptUnder100k).toBe(false);
    expect(strict.securities.base10Czk.toString()).toBe('5000');
    expect(strict.limits.flatTax50k.status.usedCzk.toString()).toBe('30000');

    // mírnější výklad: do úhrnu jen testem NEosvobozené (30k ≤ 100k) → vše osvobozeno
    const lenient = run(txs, { options: { limit100kIncludesTimeTestExempt: false } });
    expect(lenient.securities.pool100kCzk.toString()).toBe('30000');
    expect(lenient.securities.exemptUnder100k).toBe(true);
    expect(lenient.securities.base10Czk.toString()).toBe('0');
    expect(lenient.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
  });
});

describe('R-08 paušální daň — limit 50 000 Kč (§ 7a)', () => {
  it('R-08d GOLDEN: prodej za 120k se ziskem 5k prolomí limit — počítá se tržba, ne zisk', () => {
    const result = run([
      buy({ quantity: '100', pricePerShare: '1150', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '1200', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);

    expect(result.securities.base10Czk.toString()).toBe('5000'); // zisk pouhých 5 000 Kč…
    expect(result.limits.flatTax50k.applicable).toBe(true);
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('120000'); // …ale limit čerpá tržba
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(result.limits.flatTax50k.status.zone).toBe('EXCEEDED');
    expect(hasWarning(result, 'FLAT_TAX_BROKEN')).toBe(true);
    // orientační daň: základ 5 000 × 15 %
    expect(result.tax.general.taxCzk.toString()).toBe('750');
  });

  it('R-08c: prodej do 100k je osvobozený a limit 50k nečerpá', () => {
    const result = run([
      buy({ quantity: '100', pricePerShare: '800', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ quantity: '100', pricePerShare: '900', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);
    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
    expect(result.limits.flatTax50k.status.zone).toBe('OK');
  });

  it('R-08d: zahraniční dividendy se počítají brutto; české (srážkové) ne', () => {
    const result = run([
      dividend({ sourceCountry: 'US', gross: '2000', withholdingTax: '300' }),
      dividend({ sourceCountry: 'CZ', gross: '5000' }),
    ]);
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('2000');
    expect(result.dividends.czechGrossCzk.toString()).toBe('5000');
    expect(result.dividends.base8Czk.toString()).toBe('2000');
  });

  it('R-08f: prolomení vyčíslí doplatek daně proti zaplaceným paušálním zálohám', () => {
    const result = run([
      buy({ quantity: '100', pricePerShare: '1150', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '2000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);

    const impact = result.limits.flatTax50k.breachImpact!;
    // základ 200 000 − 115 000 = 85 000 → daň 12 750; zálohy na daň 12 × 100 Kč
    expect(impact.taxCzk.toString()).toBe('12750');
    expect(impact.advancesCreditCzk.toString()).toBe('1200');
    expect(impact.additionalTaxCzk.toString()).toBe('11550');
    expect(impact.monthlyAdvanceCzk!.toString()).toBe('8716');

    const warning = result.warnings.find((w) => w.code === 'FLAT_TAX_BROKEN')!;
    expect(warning.context).toMatchObject({ additionalTaxCzk: '11550.00' });
    // pojistné neumíme spočítat (chybí základ § 7) — musí zaznít aspoň slovně
    expect(warning.message).toContain('přehledy ČSSZ a ZP');

    // pod limitem se nic nevyčísluje
    const under = run([
      buy({ quantity: '100', pricePerShare: '800', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ quantity: '100', pricePerShare: '900', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);
    expect(under.limits.flatTax50k.breachImpact).toBeNull();
  });

  it('R-08f: pásma hlídače (60 % / 85 % / prolomeno) a ruční ostatní příjmy', () => {
    const zones = (gross: string, other?: string) =>
      run([dividend({ gross })], { profile: other ? { otherTaxableIncome8to10Czk: other } : {} })
        .limits.flatTax50k.status.zone;

    expect(zones('25000')).toBe('OK'); // 50 %
    expect(zones('31000')).toBe('WARNING'); // 62 %
    expect(zones('43000')).toBe('CRITICAL'); // 86 %
    expect(zones('50000')).toBe('CRITICAL'); // přesně 100 % — ještě neprolomen
    expect(zones('8000', '45000')).toBe('EXCEEDED'); // 8k dividendy + 45k nájem = 53k
  });
});

describe('R-10a/R-10b limit 100k pro kryptoaktiva', () => {
  const cryptoTrades = (year: number) => [
    buy({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '10000', tradeDate: '2020-01-10', settlementDate: '2020-01-10' }),
    sell({ isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '80000', tradeDate: `${year}-06-03`, settlementDate: `${year}-06-03` }),
  ];

  it('rok bez krypto osvobození (≤ 2024) limit nemá — hlásí se jako neaplikovatelný', () => {
    const config2024 = {
      ...CFG_2025,
      year: 2024,
      limits: { ...CFG_2025.limits, timeTestCap: null },
      cryptoRules: { exemptionsAvailable: false, effectiveFrom: null },
    };
    const result = run(cryptoTrades(2024), { config: config2024 });

    // základ je 70 000, měřák „0 / 100 000, zóna OK“ by k němu lhal
    expect(result.crypto.base10Czk.toString()).toBe('70000');
    expect(result.limits.cryptoLimit100k.applicable).toBe(false);
    expect(result.limits.cryptoLimit100k.limitCzk.toString()).toBe('0');
    expect(result.limits.cryptoLimit100k.exceeded).toBe(false);

    // v roce s osvobozením limit existuje a čerpá se
    const result2025 = run(cryptoTrades(2025));
    expect(result2025.limits.cryptoLimit100k.applicable).toBe(true);
    expect(result2025.limits.cryptoLimit100k.limitCzk.toString()).toBe('100000');
    expect(result2025.limits.cryptoLimit100k.usedCzk.toString()).toBe('80000');
  });
});

describe('R-09 povinnost přiznání a oznámení § 38v', () => {
  it('R-09b: zaměstnanec s vedlejšími příjmy nad 20k musí podat přiznání', () => {
    const result = run([dividend({ gross: '25000' })], { profile: { regime: 'ZAMESTNANEC' } });
    expect(result.limits.employee20k.applicable).toBe(true);
    expect(result.limits.employee20k.status.exceeded).toBe(true);
    expect(result.limits.flatTax50k.applicable).toBe(false);
  });

  it('R-09d: jednotlivý osvobozený příjem nad 5M → oznámení § 38v', () => {
    const result = run([
      buy({ quantity: '1000', pricePerShare: '1000', tradeDate: '2019-02-01', settlementDate: '2019-02-01' }),
      sell({ quantity: '1000', pricePerShare: '6000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('0'); // osvobozeno testem
    expect(result.limits.reporting38v).toHaveLength(1);
    expect(result.limits.reporting38v[0]!.exemptProceedsCzk.toString()).toBe('6000000');
    expect(hasWarning(result, 'REPORTING_38V')).toBe(true);
    expect(result.limits.cap40M?.exceeded).toBe(false);
  });

  it('R-09d: jednotlivý příjem = úhrn per (titul, den) — partial fill-y 2×3M se sčítají', () => {
    const result = run([
      buy({ quantity: '1000', pricePerShare: '1000', tradeDate: '2019-02-01', settlementDate: '2019-02-01' }),
      // dva fill-y téhož titulu v týž den po 3M — jednotlivý příjem 6M > 5M
      sell({ quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-02', settlementDate: '2025-06-02' }),
      sell({ quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-02', settlementDate: '2025-06-02' }),
    ]);
    expect(result.limits.reporting38v).toHaveLength(1);
    expect(result.limits.reporting38v[0]!.exemptProceedsCzk.toString()).toBe('6000000');
    expect(result.limits.reporting38v[0]!.sellTxIds).toHaveLength(2);
    expect(result.limits.reporting38v[0]!.saleDate).toBe('2025-06-02');
    expect(hasWarning(result, 'REPORTING_38V')).toBe(true);
  });

  it('R-09d: prodeje v různých dnech (či různých titulů) po 3M se nesčítají → bez oznámení', () => {
    const differentDays = run([
      buy({ quantity: '1000', pricePerShare: '1000', tradeDate: '2019-02-01', settlementDate: '2019-02-01' }),
      sell({ quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-02', settlementDate: '2025-06-02' }),
      sell({ quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-03', settlementDate: '2025-06-03' }),
    ]);
    expect(differentDays.limits.reporting38v).toHaveLength(0);
    expect(hasWarning(differentDays, 'REPORTING_38V')).toBe(false);

    const differentTitles = run([
      buy({ isin: 'CZ0000000001', quantity: '500', pricePerShare: '1000', tradeDate: '2019-02-01', settlementDate: '2019-02-01' }),
      buy({ isin: 'CZ0000000002', quantity: '500', pricePerShare: '1000', tradeDate: '2019-02-01', settlementDate: '2019-02-01' }),
      sell({ isin: 'CZ0000000001', quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-02', settlementDate: '2025-06-02' }),
      sell({ isin: 'CZ0000000002', quantity: '500', pricePerShare: '6000', tradeDate: '2025-06-02', settlementDate: '2025-06-02' }),
    ]);
    expect(differentTitles.limits.reporting38v).toHaveLength(0);
  });

  it('R-03: překročení stropu 40M (rok 2025) → poměrné krácení s varováním', () => {
    const result = run([
      buy({ quantity: '1000', pricePerShare: '30000', tradeDate: '2019-03-01', settlementDate: '2019-03-01' }),
      sell({ quantity: '1000', pricePerShare: '45000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);
    expect(result.limits.cap40M?.applicable).toBe(true);
    expect(result.limits.cap40M?.exceeded).toBe(true);
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(true);
  });
});
