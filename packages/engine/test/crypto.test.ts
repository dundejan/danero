import { describe, expect, it } from 'vitest';
import { isEmtIdentifier, type TaxYearConfig } from '../src';
import { buy, CFG_2025, hasWarning, run, sell } from './helpers';

/**
 * R-10 Kryptoaktiva (docs/02) — golden testy dle zák. č. 32/2025 Sb.,
 * KOOV 625/30.04.25 (souhlas GFŘ) a GFŘ Informace 18809/22.
 * Všechny scénáře v CZK (bez FX), rok 2025 dle CFG_2025 (účinnost 15. 2. 2025).
 */

type Overrides = Record<string, unknown>;
const cryptoBuy = (over: Overrides = {}): ReturnType<typeof buy> =>
  buy({ isin: 'BTC', assetClass: 'CRYPTO', ...over });
const cryptoSell = (over: Overrides = {}): ReturnType<typeof sell> =>
  sell({ isin: 'BTC', assetClass: 'CRYPTO', ...over });

describe('R-10a hodnotový limit 100k pro krypto (§ 4/1 zj) — samostatný vedle CP', () => {
  // krypto tržba 90k + CP tržba 95k: dohromady 185k, ale limity se čerpají ZVLÁŠŤ
  const mixed = [
    cryptoBuy({ quantity: '1', pricePerShare: '60000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
    cryptoSell({ quantity: '1', pricePerShare: '90000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    buy({ quantity: '100', pricePerShare: '900', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
    sell({ quantity: '100', pricePerShare: '950', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
  ];

  it('oba úhrny pod 100k → oba druhy osvobozeny, pooly nezávislé (R-10a, R-02d)', () => {
    const result = run(mixed);

    expect(result.limits.limit100k.usedCzk.toString()).toBe('95000');
    expect(result.limits.limit100k.exceeded).toBe(false);
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('90000');
    expect(result.limits.cryptoLimit100k.exceeded).toBe(false);

    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.crypto.exemptUnder100k).toBe(true);
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(result.crypto.base10Czk.toString()).toBe('0');
    expect(result.tax.general.baseCzk.toString()).toBe('0');

    // krypto prodeje nesmí prosakovat do výsledku CP a naopak
    expect(result.securities.disposals).toHaveLength(1);
    expect(result.crypto.disposals).toHaveLength(1);
    expect(hasWarning(result, 'CRYPTO_NOT_SUPPORTED')).toBe(false);
  });

  it('krypto nad 100k je zdanitelné, CP limit tím nečerpá (a naopak)', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '150000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
      buy({ quantity: '100', pricePerShare: '900', tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ quantity: '100', pricePerShare: '950', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);

    // krypto: cliff — 150k > 100k → celé zdanitelné (zisk 50k)
    expect(result.crypto.exemptUnder100k).toBe(false);
    expect(result.crypto.base10Czk.toString()).toBe('50000');
    // CP zůstávají osvobozené (95k ≤ 100k) — krypto tržby jim pool nenavyšují
    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.securities.base10Czk.toString()).toBe('0');
    expect(result.limits.limit100k.usedCzk.toString()).toBe('95000');
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('150000');
  });
});

describe('R-10b časový test a účinnost 15. 2. 2025 (KOOV 625, závěry 2.2.1.2 a 2.2.1.5)', () => {
  it('příjem před 15. 2. 2025 je zdanitelný (i po 3 letech držby) a nečerpá pool 100k', () => {
    const result = run([
      // lednový prodej: nabytí 2020 (test 3 let dávno splněn), ale příjem PŘED účinností
      cryptoBuy({ quantity: '1', pricePerShare: '20000', tradeDate: '2020-05-10', settlementDate: '2020-05-10' }),
      cryptoSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2025-01-20', settlementDate: '2025-01-20' }),
      // dubnový prodej: nabytí 2024 (bez testu), příjem po účinnosti → osvobozen dle zj)
      cryptoBuy({ id: 'b-eth', isin: 'ETH', quantity: '1', pricePerShare: '10000', tradeDate: '2024-03-01', settlementDate: '2024-03-01' }),
      cryptoSell({ id: 's-eth', isin: 'ETH', quantity: '1', pricePerShare: '30000', tradeDate: '2025-04-10', settlementDate: '2025-04-10' }),
    ]);

    // do limitu 100k se počítá JEN dubnová tržba 30k (KOOV 625, 2.2.1.5, příklad č. 1)
    expect(result.crypto.pool100kCzk.toString()).toBe('30000');
    expect(result.crypto.exemptUnder100k).toBe(true);
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('30000');

    // lednový příjem 50k plně zdanitelný s výdaji (20k) — časový test nepomůže
    expect(result.crypto.taxableIncomeCzk.toString()).toBe('50000');
    expect(result.crypto.expensesCzk.toString()).toBe('20000');
    expect(result.crypto.base10Czk.toString()).toBe('30000');
    expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('0');

    // R-10f: zdanitelná (hrubá) lednová tržba čerpá limit 50k paušální daně
    expect(result.limits.flatTax50k.components.nonExemptCryptoProceedsCzk.toString()).toBe('50000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('50000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
  });

  it('doba držby před účinností se započítává: nákup 2020, prodej 3/2025 = osvobozen (zk)', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '1000000', tradeDate: '2020-06-01', settlementDate: '2020-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '6000000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);

    expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('6000000');
    expect(result.crypto.base10Czk.toString()).toBe('0');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');

    // R-10f/R-09d: jednotlivý osvobozený příjem > 5M → oznámení § 38v i pro krypto
    expect(result.limits.reporting38v).toHaveLength(1);
    expect(result.limits.reporting38v[0]!.assetScope).toBe('CRYPTO');
    expect(result.limits.reporting38v[0]!.exemptProceedsCzk.toString()).toBe('6000000');
    expect(hasWarning(result, 'REPORTING_38V')).toBe(true);
  });

  it('rok ≤ 2024: krypto žádné osvobození nemá (exemptionsAvailable: false)', () => {
    const config2024: TaxYearConfig = {
      ...CFG_2025,
      year: 2024,
      limits: { ...CFG_2025.limits, timeTestCap: null },
      cryptoRules: { exemptionsAvailable: false, effectiveFrom: null },
    };
    const result = run(
      [
        // drženo přes 3 roky a tržba jen 50k — přesto v 2024 plně zdanitelné
        cryptoBuy({ quantity: '1', pricePerShare: '10000', tradeDate: '2020-01-10', settlementDate: '2020-01-10' }),
        cryptoSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      ],
      { config: config2024 },
    );

    expect(result.crypto.pool100kCzk.toString()).toBe('0');
    expect(result.crypto.taxableIncomeCzk.toString()).toBe('50000');
    expect(result.crypto.base10Czk.toString()).toBe('40000');
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(false);
  });
});

describe('R-10c jiný druh příjmu § 10 — bez kompenzace s CP (D-59 k § 10/4)', () => {
  it('ztráta z krypta nesnižuje zisk z CP: základ = max(0, CP) + max(0, krypto)', () => {
    const result = run([
      // CP: zisk 50k, tržba 150k > 100k → zdanitelné
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2025-01-05', settlementDate: '2025-01-05' }),
      sell({ quantity: '100', pricePerShare: '1500', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
      // krypto: ztráta −80k, tržba 120k > 100k → zdanitelné
      cryptoBuy({ quantity: '1', pricePerShare: '200000', tradeDate: '2025-01-10', settlementDate: '2025-01-10' }),
      cryptoSell({ quantity: '1', pricePerShare: '120000', tradeDate: '2025-06-05', settlementDate: '2025-06-05' }),
    ]);

    expect(result.securities.base10Czk.toString()).toBe('50000');
    expect(result.crypto.rawGainLossCzk.toString()).toBe('-80000');
    expect(result.crypto.base10Czk.toString()).toBe('0');
    // ztráta druhu se neuplatní — celkový základ § 10 zůstává 50k
    expect(result.tax.general.baseCzk.toString()).toBe('50000');
    expect(hasWarning(result, 'LOSS_NOT_DEDUCTIBLE')).toBe(true);
  });
});

describe('R-10d sdílený strop 40M v ZO 2025 (§ 4/3: q + u + zk společně)', () => {
  it('CP 30M + krypto 20M časově osvobozené → ratio 40/50, dodanění poměrně v OBOU druzích', () => {
    const result = run([
      // CP: nákup 2021 za 15M, prodej 2025 za 30M — časový test splněn
      buy({ quantity: '15000', pricePerShare: '1000', tradeDate: '2021-01-10', settlementDate: '2021-01-10' }),
      sell({ quantity: '15000', pricePerShare: '2000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      // krypto: nákup 2021 za 10M, prodej 2025 za 20M — časový test splněn, příjem po 15. 2.
      cryptoBuy({ quantity: '10', pricePerShare: '1000000', tradeDate: '2021-02-01', settlementDate: '2021-02-01' }),
      cryptoSell({ quantity: '10', pricePerShare: '2000000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);

    // kombinovaný úhrn 50M > 40M → exemptRatio = 0.8, dodaňuje se 20 % v obou druzích
    expect(result.limits.cap40M?.applicable).toBe(true);
    expect(result.limits.cap40M?.appliesTo).toEqual(['SECURITIES', 'CRYPTO']);
    expect(result.limits.cap40M?.exemptProceedsCzk.toString()).toBe('50000000');
    expect(result.limits.cap40M?.exceeded).toBe(true);
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(true);

    // CP: dodaněno 20 % z 30M příjmů a 15M výdajů
    expect(result.securities.taxableIncomeCzk.toDecimalPlaces(2).toString()).toBe('6000000');
    expect(result.securities.expensesCzk.toDecimalPlaces(2).toString()).toBe('3000000');
    expect(result.securities.base10Czk.toDecimalPlaces(2).toString()).toBe('3000000');
    // krypto: dodaněno 20 % z 20M příjmů a 10M výdajů
    expect(result.crypto.taxableIncomeCzk.toDecimalPlaces(2).toString()).toBe('4000000');
    expect(result.crypto.expensesCzk.toDecimalPlaces(2).toString()).toBe('2000000');
    expect(result.crypto.base10Czk.toDecimalPlaces(2).toString()).toBe('2000000');

    expect(result.tax.general.baseCzk.toDecimalPlaces(2).toString()).toBe('5000000');
  });
});

describe('R-10e od 2026 strop 40M jen pro krypto (zák. č. 360/2025 Sb.)', () => {
  const CFG_2026: TaxYearConfig = {
    ...CFG_2025,
    year: 2026,
    limits: { ...CFG_2025.limits, timeTestCap: { amountCzk: '40000000', appliesTo: ['CRYPTO'] } },
    cryptoRules: { exemptionsAvailable: true, effectiveFrom: null },
  };

  it('CP nad 40M se nekrátí, krypto ano', () => {
    const result = run(
      [
        // CP: 60M časově osvobozené — od 2026 BEZ stropu
        buy({ quantity: '30000', pricePerShare: '1000', tradeDate: '2022-01-10', settlementDate: '2022-01-10' }),
        sell({ quantity: '30000', pricePerShare: '2000', tradeDate: '2026-03-05', settlementDate: '2026-03-05' }),
        // krypto: 50M časově osvobozené — strop trvá → ratio 40/50
        cryptoBuy({ quantity: '10', pricePerShare: '2500000', tradeDate: '2022-02-01', settlementDate: '2022-02-01' }),
        cryptoSell({ quantity: '10', pricePerShare: '5000000', tradeDate: '2026-04-01', settlementDate: '2026-04-01' }),
      ],
      { config: CFG_2026 },
    );

    // CP nedotčeny (60M nevstupuje do úhrnu stropu)
    expect(result.securities.taxableIncomeCzk.toString()).toBe('0');
    expect(result.securities.base10Czk.toString()).toBe('0');

    // krypto: dodaněno 20 % z 50M příjmů a 25M výdajů
    expect(result.crypto.taxableIncomeCzk.toDecimalPlaces(2).toString()).toBe('10000000');
    expect(result.crypto.expensesCzk.toDecimalPlaces(2).toString()).toBe('5000000');
    expect(result.crypto.base10Czk.toDecimalPlaces(2).toString()).toBe('5000000');

    expect(result.limits.cap40M?.appliesTo).toEqual(['CRYPTO']);
    expect(result.limits.cap40M?.exemptProceedsCzk.toString()).toBe('50000000');
    expect(result.limits.cap40M?.exceeded).toBe(true);
    expect(hasWarning(result, 'CAP_40M_REDUCED')).toBe(true);
  });
});

describe('R-10f neosvobozené krypto tržby čerpají limit 50k paušální daně (§ 7a)', () => {
  it('hrubá tržba 120k (zisk jen 20k) prolomí limit 50k', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2024-11-01', settlementDate: '2024-11-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '120000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);

    expect(result.crypto.base10Czk.toString()).toBe('20000'); // zisk 20k…
    expect(result.limits.flatTax50k.components.nonExemptCryptoProceedsCzk.toString()).toBe('120000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('120000'); // …ale limit čerpá tržba
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(hasWarning(result, 'FLAT_TAX_BROKEN')).toBe(true);
  });

  it('osvobozené krypto tržby limit 50k nečerpají', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '60000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '90000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);
    expect(result.crypto.exemptUnder100k).toBe(true);
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
  });
});

describe('R-10g varování CRYPTO_EMT_ASSUMPTION při aplikaci krypto osvobození', () => {
  it('osvobození dle zj) (úhrn ≤ 100k) → varování o předpokladu ne-EMT', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '60000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '90000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(true);
    // jen JEDNO varování na výsledek
    expect(result.warnings.filter((w) => w.code === 'CRYPTO_EMT_ASSUMPTION')).toHaveLength(1);
  });

  it('osvobození dle zk) (časový test) → varování také (EMT v zk sporné, default osvobodit)', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2020-06-01', settlementDate: '2020-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '500000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);
    expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('500000');
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(true);
  });

  it('plně zdanitelné krypto (žádné osvobození) → bez varování', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2024-11-01', settlementDate: '2024-11-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '150000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(false);
  });

  it('bez krypto transakcí → bez varování', () => {
    const result = run([
      buy({ tradeDate: '2024-02-01', settlementDate: '2024-02-01' }),
      sell({ tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(false);
  });
});

describe('R-10a EMT (stablecoiny) — vyloučené z hodnotového osvobození zj)', () => {
  const usdtBuy = (over: Overrides = {}): ReturnType<typeof buy> =>
    buy({ isin: 'USDT', assetClass: 'CRYPTO', ...over });
  const usdtSell = (over: Overrides = {}): ReturnType<typeof sell> =>
    sell({ isin: 'USDT', assetClass: 'CRYPTO', ...over });

  it('detekce EMT podle tickeru: normalizace uppercase, sufixů a Kraken prefixů', () => {
    expect(isEmtIdentifier('USDT')).toBe(true);
    expect(isEmtIdentifier('usdc')).toBe(true);
    expect(isEmtIdentifier(' dai ')).toBe(true);
    expect(isEmtIdentifier('USDT.S')).toBe(true); // Kraken staked sufix
    expect(isEmtIdentifier('ZUSDC')).toBe(true); // legacy Kraken prefix
    expect(isEmtIdentifier('BTC')).toBe(false);
    expect(isEmtIdentifier('XRP')).toBe(false); // prefix se zkouší jen proti seznamu
    expect(isEmtIdentifier('USD')).toBe(false);
    expect(isEmtIdentifier('US0378331005')).toBe(false);
  });

  it('prodej USDT 50k (pod limitem) je zdanitelný a do úhrnu 100k nevstupuje', () => {
    const result = run([
      usdtBuy({ quantity: '1', pricePerShare: '40000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      usdtSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);

    // tržba 50k ≤ 100k, přesto zdanitelná — zj) EMT vylučuje; pool zůstává prázdný
    expect(result.crypto.pool100kCzk.toString()).toBe('0');
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('0');
    expect(result.crypto.taxableIncomeCzk.toString()).toBe('50000');
    expect(result.crypto.expensesCzk.toString()).toBe('40000');
    expect(result.crypto.base10Czk.toString()).toBe('10000');
    expect(result.crypto.disposals[0]!.isEmt).toBe(true);
    expect(result.crypto.disposals[0]!.taxableProceedsCzk.toString()).toBe('50000');

    expect(hasWarning(result, 'CRYPTO_EMT_DETECTED')).toBe(true);
    // žádné ne-EMT osvobození → varování o exotickém stablecoinu není potřeba
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(false);
  });

  it('BTC 60k + USDT 50k tržeb: úhrn se počítá jen z ne-EMT → BTC osvobozen, USDT zdaněn', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '40000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      cryptoSell({ quantity: '1', pricePerShare: '60000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
      usdtBuy({ quantity: '1', pricePerShare: '45000', tradeDate: '2024-07-01', settlementDate: '2024-07-01' }),
      usdtSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);

    // dohromady 110k > 100k, ale úhrn pro zj) je jen 60k (BTC) → osvobození trvá
    expect(result.crypto.pool100kCzk.toString()).toBe('60000');
    expect(result.crypto.exemptUnder100k).toBe(true);
    const btc = result.crypto.disposals.find((d) => d.isin === 'BTC')!;
    const usdt = result.crypto.disposals.find((d) => d.isin === 'USDT')!;
    expect(btc.isEmt).toBe(false);
    expect(btc.exemptProceedsCzk.toString()).toBe('60000');
    expect(usdt.isEmt).toBe(true);
    expect(usdt.exemptProceedsCzk.toString()).toBe('0');
    expect(usdt.taxableProceedsCzk.toString()).toBe('50000');
    // zdaní se jen USDT: 50k − 45k = 5k
    expect(result.crypto.base10Czk.toString()).toBe('5000');

    // BTC osvobozen → varování o exotickém stablecoinu mimo seznam zůstává
    expect(hasWarning(result, 'CRYPTO_EMT_DETECTED')).toBe(true);
    expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(true);
  });

  it('ztráta z EMT se kompenzuje se ziskem z BTC uvnitř druhu krypto (R-10c)', () => {
    const result = run([
      // BTC: tržba 150k > 100k → zdanitelný zisk +50k
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2025-01-10', settlementDate: '2025-01-10' }),
      cryptoSell({ quantity: '1', pricePerShare: '150000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
      // USDT: ztráta −10k — EMT je TENTÝŽ druh § 10, kompenzuje se
      usdtBuy({ quantity: '1', pricePerShare: '30000', tradeDate: '2025-02-20', settlementDate: '2025-02-20' }),
      usdtSell({ quantity: '1', pricePerShare: '20000', tradeDate: '2025-07-01', settlementDate: '2025-07-01' }),
    ]);

    expect(result.crypto.pool100kCzk.toString()).toBe('150000'); // jen BTC
    expect(result.crypto.taxableIncomeCzk.toString()).toBe('170000');
    expect(result.crypto.expensesCzk.toString()).toBe('130000');
    expect(result.crypto.base10Czk.toString()).toBe('40000'); // 50k − 10k
  });

  it('R-10f: zdanitelné EMT tržby vstupují do limitu 50k paušální daně', () => {
    const result = run([
      usdtBuy({ quantity: '1', pricePerShare: '55000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      usdtSell({ quantity: '1', pricePerShare: '60000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
    ]);

    expect(result.limits.flatTax50k.components.nonExemptCryptoProceedsCzk.toString()).toBe('60000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('60000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(hasWarning(result, 'FLAT_TAX_BROKEN')).toBe(true);
  });

  describe('R-10g: EMT a časový test — přepínač emtTimeTestExempt', () => {
    const heldOver3y = [
      usdtBuy({ quantity: '1', pricePerShare: '40000', tradeDate: '2020-06-01', settlementDate: '2020-06-01' }),
      usdtSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ];

    it('default (bezpečný výklad): USDT držený > 3 roky je přesto zdaněn', () => {
      const result = run(heldOver3y);

      expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('0');
      expect(result.crypto.taxableIncomeCzk.toString()).toBe('50000');
      expect(result.crypto.base10Czk.toString()).toBe('10000');
      expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('50000');

      // varování vyčísluje, co by mírnější výklad osvobodil
      const warning = result.warnings.find((w) => w.code === 'CRYPTO_EMT_DETECTED')!;
      expect(warning).toBeDefined();
      expect(warning.context?.emtTimeTestableCzk).toBe('50000.00');
    });

    it('emtTimeTestExempt=true (mírnější výklad): časový test USDT osvobodí', () => {
      const result = run(heldOver3y, { options: { emtTimeTestExempt: true } });

      expect(result.crypto.timeTestExemptProceedsCzk.toString()).toBe('50000');
      expect(result.crypto.taxableIncomeCzk.toString()).toBe('0');
      expect(result.crypto.base10Czk.toString()).toBe('0');
      expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');

      expect(hasWarning(result, 'CRYPTO_EMT_DETECTED')).toBe(true);
      // osvobozené je jen EMT → varování o exotickém stablecoinu se netýká
      expect(hasWarning(result, 'CRYPTO_EMT_ASSUMPTION')).toBe(false);
    });

    it('hodnotové osvobození zj) EMT nedostane ani při mírnějším výkladu', () => {
      const result = run(
        [
          // držba < 3 roky a tržba pod 100k — zj) by pomohlo, ale EMT je vyloučen
          usdtBuy({ quantity: '1', pricePerShare: '40000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
          usdtSell({ quantity: '1', pricePerShare: '50000', tradeDate: '2025-05-01', settlementDate: '2025-05-01' }),
        ],
        { options: { emtTimeTestExempt: true } },
      );

      expect(result.crypto.pool100kCzk.toString()).toBe('0');
      expect(result.crypto.taxableIncomeCzk.toString()).toBe('50000');
      expect(result.crypto.base10Czk.toString()).toBe('10000');
    });
  });
});

describe('R-10 normalizace druhu: asset_class je vlastnost instrumentu', () => {
  it('SELL bez asset_class se počítá jako krypto, když je BUY označen CRYPTO', () => {
    const result = run([
      cryptoBuy({ quantity: '1', pricePerShare: '100000', tradeDate: '2024-06-01', settlementDate: '2024-06-01' }),
      // uživatel v šabloně vyplnil asset_class jen u nákupu — prodej NESMÍ
      // tiše sklouznout pod CP limit a CP časový test
      sell({ isin: 'BTC', quantity: '1', pricePerShare: '150000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
    ]);

    expect(result.crypto.disposals).toHaveLength(1);
    expect(result.securities.disposals).toHaveLength(0);
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('150000');
    expect(result.limits.limit100k.usedCzk.toString()).toBe('0');
    expect(hasWarning(result, 'ASSET_CLASS_NORMALIZED')).toBe(true);
  });
});
