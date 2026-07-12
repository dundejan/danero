import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { buy, CFG_2025, hasWarning, run, sell } from './helpers';

/**
 * R-12 Deriváty (docs/02) — golden testy. Bez oficiálního výkladu (žádný KOOV
 * ani NSS) stojí pravidla na § 10/4, D-59 K § 10 a poradenské praxi — viz
 * docs/02 R-12a…q. Vše v CZK (bez FX) na CFG_2025, pokud test neříká jinak.
 */

type Overrides = Record<string, unknown>;
const optBuy = (over: Overrides = {}): ReturnType<typeof buy> =>
  buy({ isin: 'OPT:AAPL260619C200', assetClass: 'DERIVATIVE', quantity: '1', ...over });
const optSell = (over: Overrides = {}): ReturnType<typeof sell> =>
  sell({ isin: 'OPT:AAPL260619C200', assetClass: 'DERIVATIVE', quantity: '1', ...over });

describe('R-12h/b: uzavřené derivátové obchody — příjem, párovaný výdaj, kompenzace v druhu', () => {
  it('prodej nakoupené opce: příjem = prodejní cena, výdaj = prémie + poplatky', () => {
    const result = run([
      optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03', settlementDate: '2025-02-03', fee: { amount: '50', currency: 'CZK' } }),
      optSell({ pricePerShare: '15000', tradeDate: '2025-06-10', settlementDate: '2025-06-10', fee: { amount: '50', currency: 'CZK' } }),
    ]);
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('15000');
    expect(result.derivatives.expensesCzk.toString()).toBe('10100');
    expect(result.derivatives.base10Czk.toString()).toBe('4900');
    expect(result.derivatives.items).toHaveLength(1);
    expect(result.derivatives.items[0]!.kind).toBe('LONG_CLOSE');
  });

  it('ztráty a zisky derivátů se v rámci roku kompenzují (R-12b), ztráta druhu zaniká', () => {
    const result = run([
      // obchod A: zisk 5 000
      optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03' }),
      optSell({ pricePerShare: '15000', tradeDate: '2025-06-10' }),
      // obchod B: ztráta 8 000
      optBuy({ isin: 'OPT:B', pricePerShare: '10000', tradeDate: '2025-03-01' }),
      optSell({ isin: 'OPT:B', pricePerShare: '2000', tradeDate: '2025-07-01' }),
    ]);
    // příjmy 17 000, výdaje 20 000 → výdaje jen do výše příjmů, základ 0
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('17000');
    expect(result.derivatives.expensesCzk.toString()).toBe('17000');
    expect(result.derivatives.rawGainLossCzk.toString()).toBe('-3000');
    expect(result.derivatives.base10Czk.toString()).toBe('0');
  });
});

describe('R-12c: deriváty nemají ŽÁDNÉ osvobození', () => {
  it('tržba pod 100k i držení přes 3 roky je plně zdanitelné, pooly 100k nečerpá', () => {
    const result = run([
      optBuy({ pricePerShare: '10000', tradeDate: '2021-02-03', settlementDate: '2021-02-03' }),
      optSell({ pricePerShare: '50000', tradeDate: '2025-06-10', settlementDate: '2025-06-10' }),
    ]);
    // drženo 4 roky, tržba 50k < 100k — u CP by bylo dvojnásobně osvobozeno
    expect(result.derivatives.base10Czk.toString()).toBe('40000');
    expect(result.limits.limit100k.usedCzk.toString()).toBe('0');
    expect(result.limits.cryptoLimit100k.usedCzk.toString()).toBe('0');
    expect(result.limits.reporting38v).toHaveLength(0);
  });
});

describe('R-12l: zákaz kompenzace mezi druhy', () => {
  it('ztráta z derivátů nesnižuje zisk z CP ani krypta', () => {
    const result = run([
      // deriváty: ztráta 8 000
      optBuy({ pricePerShare: '10000', tradeDate: '2025-03-01' }),
      optSell({ pricePerShare: '2000', tradeDate: '2025-07-01' }),
      // CP: zdanitelný zisk 200 000 (nákup 2025, tržba nad 100k)
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2025-01-05', settlementDate: '2025-01-05' }),
      sell({ quantity: '100', pricePerShare: '3000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    expect(result.securities.base10Czk.toString()).toBe('200000');
    expect(result.derivatives.base10Czk.toString()).toBe('0');
    // dílčí základ § 10 = 200 000 + 0 (ztráta derivátů nezapočtena)
    expect(result.tax.general.baseCzk.toString()).toBe('200000');
  });
});

describe('R-12i: bezcenná expirace long opce — sporný výklad s přepínačem', () => {
  const txs = [
    // opce A expiruje bezcenně (prémie 10 000)
    optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03' }),
    optSell({ pricePerShare: '0', tradeDate: '2025-06-20' }),
    // opce B se ziskem: příjem 15 000, výdaj 5 000
    optBuy({ isin: 'OPT:B', pricePerShare: '5000', tradeDate: '2025-03-01' }),
    optSell({ isin: 'OPT:B', pricePerShare: '15000', tradeDate: '2025-08-01' }),
  ];

  it('default (restriktivní): prémie expirované opce není výdaj, ale vyčíslí se', () => {
    const result = run(txs);
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('15000');
    expect(result.derivatives.expensesCzk.toString()).toBe('5000');
    expect(result.derivatives.base10Czk.toString()).toBe('10000');
    expect(result.derivatives.deniedExpensesCzk.toString()).toBe('10000');
    expect(hasWarning(result, 'DERIVATIVE_EXPIRED_PREMIUM')).toBe(true);
  });

  it('přepínač „výdaje per druh“: prémie se uplatní proti příjmům druhu', () => {
    const result = run(txs, { options: { derivativesExpensesPerDruh: true } });
    expect(result.derivatives.expensesCzk.toString()).toBe('15000'); // 5k + 10k
    expect(result.derivatives.base10Czk.toString()).toBe('0');
    expect(result.derivatives.deniedExpensesCzk.toString()).toBe('0');
    expect(hasWarning(result, 'DERIVATIVE_EXPIRED_PREMIUM')).toBe(false);
  });
});

describe('R-12j: vypsaná (short) opce — hotovostní princip', () => {
  it('přijatá prémie je příjmem roku PŘIJETÍ, i když pozice zůstává otevřená', () => {
    const result = run([
      optSell({ pricePerShare: '12000', tradeDate: '2025-09-01', settlementDate: '2025-09-01' }),
    ]);
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('12000');
    expect(result.derivatives.base10Czk.toString()).toBe('12000');
    expect(result.derivatives.openPositions).toHaveLength(1);
    expect(result.derivatives.openPositions[0]!.quantity.toString()).toBe('-1');
    expect(hasWarning(result, 'DERIVATIVE_OPEN_OVER_YEAR_END')).toBe(true);
  });

  it('zpětný odkup v dalším roce = výdaj druhu bez příjmu → výdaj propadá', () => {
    const txs = [
      optSell({ pricePerShare: '12000', tradeDate: '2025-09-01', settlementDate: '2025-09-01' }),
      optBuy({ pricePerShare: '9000', tradeDate: '2026-02-01', settlementDate: '2026-02-01' }),
    ];
    const y2025 = run(txs);
    expect(y2025.derivatives.base10Czk.toString()).toBe('12000');

    const cfg2026 = { ...CFG_2025, year: 2026, limits: { ...CFG_2025.limits, timeTestCap: null } };
    const y2026 = run(txs, { config: cfg2026 });
    expect(y2026.derivatives.taxableIncomeCzk.toString()).toBe('0');
    expect(y2026.derivatives.expensesCzk.toString()).toBe('0'); // § 10/4: max do výše příjmů
    expect(y2026.derivatives.rawGainLossCzk.toString()).toBe('-9000');
    expect(y2026.derivatives.base10Czk.toString()).toBe('0');
  });

  it('short otevřená a odkoupená v témže roce: prémie příjem, odkup výdaj', () => {
    const result = run([
      optSell({ pricePerShare: '12000', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
      optBuy({ pricePerShare: '9000', tradeDate: '2025-10-01', settlementDate: '2025-10-01' }),
    ]);
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('12000');
    expect(result.derivatives.expensesCzk.toString()).toBe('9000');
    expect(result.derivatives.base10Czk.toString()).toBe('3000');
    expect(result.derivatives.openPositions).toHaveLength(0);
  });

  it('short opce expirovaná bezcenně (odkup za 0): prémie zůstává celá zdaněná', () => {
    const result = run([
      optSell({ pricePerShare: '12000', tradeDate: '2025-03-01' }),
      optBuy({ pricePerShare: '0', tradeDate: '2025-06-20' }),
    ]);
    expect(result.derivatives.base10Czk.toString()).toBe('12000');
    expect(result.derivatives.openPositions).toHaveLength(0);
  });
});

describe('R-12m: kurzové přepočty — výdaj kurzem roku vynaložení', () => {
  it('nákup 2024 v USD (test kurz 23), prodej 2025 v USD (test kurz 20)', () => {
    const result = run([
      optBuy({ pricePerShare: '1000', currency: 'USD', tradeDate: '2024-05-01', settlementDate: '2024-05-01' }),
      optSell({ pricePerShare: '1500', currency: 'USD', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    // příjem 1 500 × 20 = 30 000; výdaj 1 000 × 23 = 23 000 (kurz roku nákupu)
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('30000');
    expect(result.derivatives.expensesCzk.toString()).toBe('23000');
    expect(result.derivatives.base10Czk.toString()).toBe('7000');
  });
});

describe('R-12q: deriváty v limitu 50k paušální daně (hrubá plnění)', () => {
  it('do limitu jde úhrn kladných plnění, ne zisk', () => {
    const result = run([
      optBuy({ pricePerShare: '28000', tradeDate: '2025-02-03' }),
      optSell({ pricePerShare: '30000', tradeDate: '2025-06-10' }),
      // + vypsaná opce s prémií 25 000 (otevřená)
      optSell({ isin: 'OPT:B', pricePerShare: '25000', tradeDate: '2025-09-01' }),
    ]);
    // zisk jen 2 000 + 25 000, ale limit čerpá 55 000 hrubých plnění → PROLOMENO
    expect(result.limits.flatTax50k.components.derivativesIncomeCzk.toString()).toBe('55000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('55000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(hasWarning(result, 'FLAT_TAX_BROKEN')).toBe(true);
  });
});

describe('R-12 izolace: deriváty nevstupují do ledgeru CP', () => {
  it('derivátový instrument netvoří CP pozici ani disposal', () => {
    const result = run([
      optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03' }),
      optSell({ pricePerShare: '15000', tradeDate: '2025-06-10' }),
    ]);
    expect(result.securities.disposals).toHaveLength(0);
    expect(result.positions).toHaveLength(0);
    expect(hasWarning(result, 'NEGATIVE_POSITION')).toBe(false);
  });

  it('normalizace druhu: SELL bez asset_class se počítá jako derivát dle BUY', () => {
    const result = run([
      optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03' }),
      sell({ isin: 'OPT:AAPL260619C200', quantity: '1', pricePerShare: '15000', tradeDate: '2025-06-10', settlementDate: '2025-06-10' }),
    ]);
    expect(result.derivatives.base10Czk.toString()).toBe('5000');
    expect(result.securities.disposals).toHaveLength(0);
  });
});

describe('R-12f/g MARGIN vypořádání (futures, CFD): nominál není příjem', () => {
  const cfdBuy = (over: Overrides = {}): ReturnType<typeof buy> =>
    buy({ isin: 'CFD:AAPL', assetClass: 'DERIVATIVE', settlementStyle: 'MARGIN', quantity: '100', ...over });
  const cfdSell = (over: Overrides = {}): ReturnType<typeof sell> =>
    sell({ isin: 'CFD:AAPL', assetClass: 'DERIVATIVE', settlementStyle: 'MARGIN', quantity: '100', ...over });

  it('CFD přes roky: příjem = rozdíl kurzem dne uzavření, žádný fantomový nominál', () => {
    const result = run([
      cfdBuy({ pricePerShare: '100', currency: 'USD', tradeDate: '2024-05-01', settlementDate: '2024-05-01' }),
      cfdSell({ pricePerShare: '101', currency: 'USD', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    // rozdíl (101 − 100) × 100 = 100 USD × kurz 2025 (20) = 2 000 Kč
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('2000');
    expect(result.derivatives.expensesCzk.toString()).toBe('0');
    expect(result.derivatives.base10Czk.toString()).toBe('2000');
    // limit 50k čerpá jen skutečné plnění, ne nominál 202 000 Kč
    expect(result.limits.flatTax50k.components.derivativesIncomeCzk.toString()).toBe('2000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
  });

  it('otevírací poplatek MARGIN pozice je výdajem při uzavření, kurzem roku zaplacení (R-12f, R-06a)', () => {
    const result = run([
      // fee 10 USD při otevření 2024 (kurz 23) → výdaj 230 Kč při uzavření 2025
      cfdBuy({ pricePerShare: '100', currency: 'USD', tradeDate: '2024-05-01', settlementDate: '2024-05-01', fee: { amount: '10', currency: 'USD' } }),
      cfdSell({ pricePerShare: '101', currency: 'USD', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ]);
    // příjem (101 − 100) × 100 = 100 USD × kurz 2025 (20) = 2 000 Kč
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('2000');
    expect(result.derivatives.expensesCzk.toString()).toBe('230');
    expect(result.derivatives.base10Czk.toString()).toBe('1770');
  });

  it('ztrátové uzavření = výdaj druhu (žádný příjem), short bez cash toku při otevření', () => {
    const result = run([
      // short future: otevření SELL bez příjmu (na rozdíl od prémie opce)
      cfdSell({ pricePerShare: '100', currency: 'CZK', tradeDate: '2025-03-01', settlementDate: '2025-03-01' }),
      // odkup dráž → ztráta (100 − 110) × 100 = −1 000 Kč
      cfdBuy({ pricePerShare: '110', currency: 'CZK', tradeDate: '2025-08-01', settlementDate: '2025-08-01' }),
    ]);
    expect(result.derivatives.taxableIncomeCzk.toString()).toBe('0');
    expect(result.derivatives.rawGainLossCzk.toString()).toBe('-1000');
    expect(result.derivatives.base10Czk.toString()).toBe('0');
    expect(result.limits.flatTax50k.components.derivativesIncomeCzk.toString()).toBe('0');
  });
});

describe('R-12 převody a řez rokem', () => {
  it('TRANSFER_IN derivátu přenáší otevírací cenu; prodej není výpis (přezdanění)', () => {
    const txs = [
      ...parseTransactions([
        { type: 'TRANSFER_IN', id: 'ti1', isin: 'OPT:Z', assetClass: 'DERIVATIVE', quantity: '1', date: '2025-02-01', acquisition: { date: '2024-11-01', costPerShare: '8000', currency: 'CZK' } },
      ]),
      optSell({ isin: 'OPT:Z', pricePerShare: '12000', tradeDate: '2025-06-01', settlementDate: '2025-06-01' }),
    ];
    const result = run(txs);
    expect(result.derivatives.items).toHaveLength(1);
    expect(result.derivatives.items[0]!.kind).toBe('LONG_CLOSE');
    expect(result.derivatives.base10Czk.toString()).toBe('4000'); // 12 000 − 8 000
    // žádná fantomová CP pozice ani chyba záporné pozice
    expect(result.positions).toHaveLength(0);
    expect(hasWarning(result, 'NEGATIVE_POSITION')).toBe(false);
  });

  it('otevřené pozice odpovídají 31. 12. roku, ne konci historie', () => {
    const txs = [
      // výpis 9/2025 odkoupený 2/2026 — k 31. 12. 2025 je pozice OTEVŘENÁ
      optSell({ pricePerShare: '12000', tradeDate: '2025-09-01', settlementDate: '2025-09-01' }),
      optBuy({ pricePerShare: '9000', tradeDate: '2026-02-01', settlementDate: '2026-02-01' }),
      // pozice otevřená až 3/2026 nesmí být vidět v roce 2025
      optBuy({ isin: 'OPT:B', pricePerShare: '500', tradeDate: '2026-03-01', settlementDate: '2026-03-01' }),
    ];
    const y2025 = run(txs);
    expect(y2025.derivatives.openPositions).toHaveLength(1);
    expect(y2025.derivatives.openPositions[0]!.quantity.toString()).toBe('-1');
    expect(hasWarning(y2025, 'DERIVATIVE_OPEN_OVER_YEAR_END')).toBe(true);

    const cfg2026 = { ...CFG_2025, year: 2026, limits: { ...CFG_2025.limits, timeTestCap: null } };
    const y2026 = run(txs, { config: cfg2026 });
    // short odkoupen, zbývá jen long OPT:B z 3/2026
    expect(y2026.derivatives.openPositions).toHaveLength(1);
    expect(y2026.derivatives.openPositions[0]!.quantity.toString()).toBe('1');
  });

  it('smíšené označení instrumentu hlásí ASSET_CLASS_NORMALIZED i u derivátů', () => {
    const result = run([
      optBuy({ pricePerShare: '10000', tradeDate: '2025-02-03' }),
      sell({ isin: 'OPT:AAPL260619C200', quantity: '1', pricePerShare: '15000', tradeDate: '2025-06-10', settlementDate: '2025-06-10' }),
    ]);
    expect(result.derivatives.base10Czk.toString()).toBe('5000');
    expect(hasWarning(result, 'ASSET_CLASS_NORMALIZED')).toBe(true);
  });
});
