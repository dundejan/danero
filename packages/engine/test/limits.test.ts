import { describe, expect, it } from 'vitest';
import { TAX_YEAR_CONFIGS, type TaxYearConfig } from '../src';
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

  it('R-08f: předpoklad 12 měsíců v paušálním režimu musí zaznít (nález A1-05)', () => {
    // Kdo do režimu vstoupil během roku, zaplatil záloh míň (až o 1 100 Kč)
    // a doplatek je podhodnocený. Počet měsíců profil nenese — engine to
    // neumí spočítat, ale nesmí ten předpoklad zamlčet.
    const result = run([
      buy({ quantity: '100', pricePerShare: '1150', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '2000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
    ]);
    const warning = result.warnings.find((w) => w.code === 'FLAT_TAX_BROKEN')!;
    expect(warning.context).toMatchObject({ advanceMonths: 12 });
    expect(warning.message).toContain('12 měsíc');
    expect(warning.message).toContain('doplatek bude vyšší');
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

  it('R-08b: paušalista pod limitem se dozví, že zápočet stojí paušální daň (§ 7a odst. 5)', () => {
    // limit NEprolomen (2 000 Kč z 50 000) + nenulová zahraniční srážka
    const result = run([dividend({ sourceCountry: 'US', gross: '2000', withholdingTax: '300' })]);
    expect(result.limits.flatTax50k.applicable).toBe(true);
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('300');

    const warning = result.warnings.find(
      (w) => w.code === 'FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE',
    )!;
    expect(warning).toBeDefined();
    expect(warning.level).toBe('INFO');
    expect(warning.context).toMatchObject({ foreignWithholdingCzk: '300.00' });
    // spouštěčem odst. 5 je UPLATNĚNÍ zápočtu v přiznání, ne samotné podání
    expect(warning.message).toContain('v přiznání uplatnil');
    expect(warning.message).toContain('§ 7a odst. 5');
    // částka se doplňuje stejně jako u sousedních varování (czkText — pevná mezera)
    expect(warning.message).toMatch(/^Sraženou daň ze zahraničí \(300\s?Kč\)/u);
    // paušální REŽIM tím nekončí (§ 2a odst. 8) — to musí zaznít
    expect(warning.message).toContain('V paušálním režimu bys přitom zůstal');
    // v textu nesmí být interní kód pravidla (pravidlo 3 CLAUDE.md)
    expect(warning.message).not.toMatch(/R-\d/);
  });

  it('R-08b: kdo limit 50k prolomil, tuhle výhradu vidět nesmí — zápočet mu patří celý', () => {
    // odst. 5 dopadá jen na „poplatníka podle odstavce 1 nebo 2“; prolomivší
    // odst. 1 nesplňuje, daň mu paušální dani rovna není už proto a zápočet
    // uplatní v plné výši
    const result = run([
      dividend({ sourceCountry: 'US', gross: '60000', withholdingTax: '9000' }),
    ]);
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(result.dividends.foreignWithholdingCzk.gt(0)).toBe(true);
    expect(hasWarning(result, 'FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE')).toBe(false);
    expect(hasWarning(result, 'FLAT_TAX_BROKEN')).toBe(true);
  });

  it('R-08b: mimo paušál a bez zahraniční srážky se výhrada nevydá', () => {
    const zamestnanec = run(
      [dividend({ sourceCountry: 'US', gross: '2000', withholdingTax: '300' })],
      { profile: { regime: 'ZAMESTNANEC' } },
    );
    expect(hasWarning(zamestnanec, 'FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE')).toBe(false);

    const bezSrazky = run([dividend({ sourceCountry: 'US', gross: '2000', withholdingTax: '0' })]);
    expect(bezSrazky.limits.flatTax50k.applicable).toBe(true);
    expect(hasWarning(bezSrazky, 'FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE')).toBe(false);
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

/**
 * A1-3-04: u poplatníka s cennými papíry v obchodním majetku (R-02f)
 * osvobození t) ani u) neexistuje. Pool je proto nulový — a měřák z toho
 * dělal „0 / 100 000, zóna OK“ přesně tam, kde se daní každá koruna.
 */
describe('R-02f: limit 100k u obchodního majetku není nevyčerpaný, ale neaplikovatelný', () => {
  const txs = [
    buy({ quantity: '1', pricePerShare: '50000', tradeDate: '2020-01-10', settlementDate: '2020-01-10' }),
    sell({ quantity: '1', pricePerShare: '90000', tradeDate: '2025-04-01', settlementDate: '2025-04-01' }),
  ];

  it('s obchodním majetkem je limit neaplikovatelný a nehlásí zónu v pořádku', () => {
    const result = run(txs, { profile: { hasSecuritiesInBusinessAssets: true } });
    expect(result.limits.limit100k.applicable).toBe(false);
    expect(result.limits.limit100k.limitCzk.toString()).toBe('0');
    // daní se celý prodej, i když je tržba pod 100 000 Kč
    expect(result.securities.base10Czk.toString()).toBe('40000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('90000');
  });

  it('bez obchodního majetku zůstává limit beze změny', () => {
    const result = run(txs);
    expect(result.limits.limit100k.applicable).toBe(true);
    expect(result.limits.limit100k.limitCzk.toString()).toBe('100000');
    expect(result.securities.base10Czk.toString()).toBe('0');
  });
});

/**
 * A1-3-06: § 38g počítá do limitu i příjmy podle § 7, které Danero z výpisů
 * nevidí a ruční pole v Nastavení je (kvůli paušálu) nepokrývá. Zaměstnanec
 * s 15 000 Kč z investic viděl „15 000/20 000 v pořádku“, přestože mu stačilo
 * 5 001 Kč z faktury, aby povinnost podat přiznání vznikla.
 */
describe('R-09: limity podání říkají, že o příjmech z § 7 nevědí (A1-3-06)', () => {
  it('zaměstnanec pod limitem se dozví, že se počítá i samostatná činnost', () => {
    const result = run([dividend({ gross: '15000', sourceCountry: 'US' })], {
      profile: { regime: 'ZAMESTNANEC' },
    });
    expect(result.limits.employee20k.status.exceeded).toBe(false);
    expect(hasWarning(result, 'FILING_LIMIT_IGNORES_SELF_EMPLOYMENT')).toBe(true);
  });

  it('když je limit prolomený už z investic, upozornění nemá co dodat', () => {
    const result = run([dividend({ gross: '25000', sourceCountry: 'US' })], {
      profile: { regime: 'ZAMESTNANEC' },
    });
    expect(result.limits.employee20k.status.exceeded).toBe(true);
    expect(hasWarning(result, 'FILING_LIMIT_IGNORES_SELF_EMPLOYMENT')).toBe(false);
  });

  it('paušalistovi se nevydá — u něj je § 7 sám paušál (R-08)', () => {
    const result = run([dividend({ gross: '15000', sourceCountry: 'US' })], {
      profile: { regime: 'PAUSAL' },
    });
    expect(hasWarning(result, 'FILING_LIMIT_IGNORES_SELF_EMPLOYMENT')).toBe(false);
  });
});

/** Konfigurace roku přímo z registru — test má držet čísla, která uvidí uživatel. */
const registryConfig = (year: number): TaxYearConfig => {
  const config = TAX_YEAR_CONFIGS[year];
  if (!config) throw new Error(`rok ${year} v registru chybí`);
  return config;
};

/** Zahraniční dividenda v korunách v daném roce — hrubý zdanitelný příjem bez kurzu. */
const dividendIn = (year: number, gross: string) =>
  dividend({ gross, sourceCountry: 'US', date: `${year}-03-10` });

/**
 * R-09a/R-09b: zák. č. 180/2026 Sb. (část druhá, body 21 a 22) zvedl od
 * zdaňovacího období 2027 obě částky § 38g na dvojnásobek. Rok 2027 přitom
 * do registru přišel s limity roku 2026 a zaměstnanci s vedlejšími příjmy
 * 20–40 tisíc by tvrdil, že přiznání podává (nález L3-01 revize 5).
 */
describe('R-09a/R-09b: limity § 38g po letech (zák. č. 180/2026 Sb.)', () => {
  it('R-09b: zaměstnanec s 30 000 Kč vedle mzdy podává přiznání za 2026, za 2027 už ne', () => {
    const before = run([dividendIn(2026, '30000')], {
      profile: { regime: 'ZAMESTNANEC' },
      config: registryConfig(2026),
    });
    expect(before.limits.employee20k.status.limitCzk.toString()).toBe('20000');
    expect(before.limits.employee20k.status.zone).toBe('EXCEEDED');

    const after = run([dividendIn(2027, '30000')], {
      profile: { regime: 'ZAMESTNANEC' },
      config: registryConfig(2027),
    });
    expect(after.limits.employee20k.applicable).toBe(true);
    expect(after.limits.employee20k.status.limitCzk.toString()).toBe('40000');
    expect(after.limits.employee20k.status.zone).toBe('WARNING');
    expect(after.limits.employee20k.status.exceeded).toBe(false);
  });

  it('R-09b: hrana 2027 — přesně 40 000 Kč ještě vyhovuje, koruna navíc už ne', () => {
    const at = run([dividendIn(2027, '40000')], {
      profile: { regime: 'ZAMESTNANEC' },
      config: registryConfig(2027),
    });
    expect(at.limits.employee20k.status.exceeded).toBe(false);

    const over = run([dividendIn(2027, '40001')], {
      profile: { regime: 'ZAMESTNANEC' },
      config: registryConfig(2027),
    });
    expect(over.limits.employee20k.status.exceeded).toBe(true);
  });

  it('R-09a: bez zaměstnání 70 000 Kč — za 2026 přiznání ano, za 2027 ne', () => {
    const before = run([dividendIn(2026, '70000')], {
      profile: { regime: 'JINE' },
      config: registryConfig(2026),
    });
    expect(before.limits.generalFiling50k.status.limitCzk.toString()).toBe('50000');
    expect(before.limits.generalFiling50k.status.zone).toBe('EXCEEDED');

    const after = run([dividendIn(2027, '70000')], {
      profile: { regime: 'JINE' },
      config: registryConfig(2027),
    });
    expect(after.limits.generalFiling50k.applicable).toBe(true);
    expect(after.limits.generalFiling50k.status.limitCzk.toString()).toBe('100000');
    expect(after.limits.generalFiling50k.status.exceeded).toBe(false);

    const over = run([dividendIn(2027, '100001')], {
      profile: { regime: 'JINE' },
      config: registryConfig(2027),
    });
    expect(over.limits.generalFiling50k.status.exceeded).toBe(true);
  });

  it('R-09: hláška o příjmech z § 7 jmenuje limit toho roku, ne loňský', () => {
    const result = run([dividendIn(2027, '30000')], {
      profile: { regime: 'ZAMESTNANEC' },
      config: registryConfig(2027),
    });
    const warning = result.warnings.find((w) => w.code === 'FILING_LIMIT_IGNORES_SELF_EMPLOYMENT');
    expect(warning?.context).toMatchObject({ limitCzk: '40000.00' });
  });

  it('R-08b: limit 50 000 Kč pro daň rovnou paušální dani novela nemění', () => {
    // § 7a odst. 1 písm. b) bod 4 zůstal — mění se jen § 38g
    expect(registryConfig(2027).limits.flatTaxOtherIncome).toBe('50000');
    const result = run([dividendIn(2027, '60000')], {
      profile: { regime: 'PAUSAL' },
      config: registryConfig(2027),
    });
    expect(result.limits.flatTax50k.status.limitCzk.toString()).toBe('50000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
  });

  it('R-15b: registr nese částky § 38g po letech — do 2026 staré, od 2027 nové', () => {
    for (const year of [2024, 2025, 2026]) {
      expect(registryConfig(year).limits.generalFiling, `rok ${year}`).toBe('50000');
      expect(registryConfig(year).limits.employeeSideIncome, `rok ${year}`).toBe('20000');
    }
    expect(registryConfig(2027).limits.generalFiling).toBe('100000');
    expect(registryConfig(2027).limits.employeeSideIncome).toBe('40000');
    // ostatní zákonné částky rok 2027 dědí beze změny
    expect(registryConfig(2027).limits.securitiesProceedsExemption).toBe('100000');
    expect(registryConfig(2027).limits.cryptoProceedsExemption).toBe('100000');
    expect(registryConfig(2027).limits.exemptIncomeReporting).toBe('5000000');
    expect(registryConfig(2027).limits.timeTestCap).toEqual(registryConfig(2026).limits.timeTestCap);
  });
});

/**
 * R-08f: od ZO 2027 se paušalista v 1. pásmu může přihlásit k přirážce
 * 1 400 Kč měsíčně, která ho zprošťuje evidence tržeb (§ 2b, § 38lk odst. 7
 * písm. a) a odst. 8 ZDP ve znění zák. č. 180/2026 Sb.). Věta o zálohách
 * uváděla jen 9 662 Kč a 100 Kč — částky, které takový poplatník neplatí
 * (nález L3-02 revize 5). Doplatek se přitom nemění: o přirážku roste daň
 * v přiznání (§ 16ab odst. 4) i zaplacené zálohy na daň.
 */
describe('R-08f: přirážka k paušální záloze od ZO 2027', () => {
  const plain = (text: string): string => text.replaceAll(String.fromCharCode(160), ' ');
  const breach = (year: number) =>
    run([dividendIn(year, '80000')], {
      profile: { regime: 'PAUSAL' },
      config: registryConfig(year),
    });

  it('věta o zálohách za 2027 řekne, kolik platí poplatník s přirážkou', () => {
    const warning = breach(2027).warnings.find((w) => w.code === 'FLAT_TAX_BROKEN')!;
    const message = plain(warning.message);

    // základní částky 1. pásma zůstávají
    expect(message).toContain('100 Kč měsíčně z paušální zálohy 9 662 Kč, 1. pásmo');
    // dovětek: přirážka, záloha s ní a její daňová složka
    expect(message).toContain('přirážce 1 400 Kč měsíčně');
    expect(message).toContain('11 062 Kč');
    expect(message).toContain('1 500 Kč');
    // a hlavně: doplatek je stejný, ať přirážku platí, nebo ne
    expect(message).toContain('doplatek se tím nemění');
  });

  it('doplatek se přirážkou nemění — zálohy se započítávají bez ní na obou stranách', () => {
    const impact = breach(2027).limits.flatTax50k.breachImpact!;
    // dividenda 80 000 Kč × 15 % = 12 000 Kč; zálohy na daň 12 × 100 Kč
    expect(impact.taxCzk.toString()).toBe('12000');
    expect(impact.advancesCreditCzk.toString()).toBe('1200');
    expect(impact.additionalTaxCzk.toString()).toBe('10800');
    expect(impact.monthlyAdvanceCzk!.toString()).toBe('9662');
  });

  it('za rok 2026 a starší o přirážce nepadne ani slovo', () => {
    for (const year of [2025, 2026]) {
      const warning = breach(year).warnings.find((w) => w.code === 'FLAT_TAX_BROKEN')!;
      expect(warning.message, `rok ${year}`).not.toContain('přirážc');
    }
  });

  it('registr: přirážka 1 400 Kč je jen u roku 2027', () => {
    expect(registryConfig(2027).flatTaxAdvance).toEqual({
      monthlyTotalCzk: '9662',
      monthlyTaxCzk: '100',
      monthlySurchargeCzk: '1400',
    });
    for (const year of [2024, 2025, 2026]) {
      expect(registryConfig(year).flatTaxAdvance?.monthlySurchargeCzk, `rok ${year}`).toBeUndefined();
    }
  });
});
