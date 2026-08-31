import { describe, expect, it } from 'vitest';
import type { EngineOptions } from '../src';
import { buy, CFG_2025, hasWarning, run, sell } from './helpers';

/**
 * R-13 Prodej nakrátko (short na spotu) — golden testy.
 *
 * K prodeji nakrátko neexistuje v ČR žádný výkladový zdroj (D-59 ani ZDP slovo
 * „nakrátko“ neznají, KOOV mlčí, Taxomat ho nepodporuje), takže pravidla stojí
 * na zákonném textu — viz docs/02 R-13a…j. Vše v CZK bez FX na CFG_2025.
 *
 * Short se pozná VÝHRADNĚ podle `positionEffect` (SELL+OPEN, BUY+CLOSE);
 * bez značky jde o běžný obchod a platí dosavadní chování.
 */

const shortOpen = (over: Record<string, unknown> = {}) =>
  sell({ isin: 'US0378331005', positionEffect: 'OPEN', quantity: '100', pricePerShare: '300', ...over });
const shortCover = (over: Record<string, unknown> = {}) =>
  buy({ isin: 'US0378331005', positionEffect: 'CLOSE', quantity: '100', pricePerShare: '200', ...over });

describe('R-13a/c: short otevřený i pokrytý v jednom roce', () => {
  it('příjem = tržba z prodeje, výdaj = zpětný nákup; zisk je základ § 10', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', pricePerShare: '3000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '2000' }),
    ]);
    expect(result.securities.taxableIncomeCzk.toString()).toBe('300000');
    expect(result.securities.expensesCzk.toString()).toBe('200000');
    expect(result.securities.base10Czk.toString()).toBe('100000');
  });

  it('ztrátový short: k zápornému rozdílu se nepřihlíží (§ 10/4)', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', pricePerShare: '2000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '3000' }),
    ]);
    expect(result.securities.rawGainLossCzk.toString()).toBe('-100000');
    expect(result.securities.base10Czk.toString()).toBe('0');
  });

  it('nevyrábí fantomový lot ani „prodáno víc, než evidujeme“', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06' }),
    ]);
    // bez R-13 by prodej bez pozice vyrobil syntetický lot za 0 Kč a hlásil
    // uživateli, že má neúplnou historii
    expect(hasWarning(result, 'NEGATIVE_POSITION')).toBe(false);
    expect(result.positions).toEqual([]);
  });
});

describe('R-13e: short čerpá stovku a může přes ni přetlačit i longy', () => {
  it('malý short pod stovkou je osvobozený jako každý jiný prodej CP', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', quantity: '10', pricePerShare: '300' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', quantity: '10', pricePerShare: '200' }),
    ]);
    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.securities.base10Czk.toString()).toBe('0');
  });

  it('velký short zdaní i jinak osvobozený dlouhý prodej', () => {
    // dlouhý prodej za 50 000 Kč by sám o sobě do stovky spadl
    const dlouhy = [
      buy({ isin: 'CZ0000000001', quantity: '50', pricePerShare: '600', tradeDate: '2024-01-10' }),
      sell({ isin: 'CZ0000000001', quantity: '50', pricePerShare: '1000', tradeDate: '2025-06-02', settlementDate: '2025-06-03' }),
    ];
    const bezShortu = run(dlouhy);
    expect(bezShortu.securities.exemptUnder100k).toBe(true);
    expect(bezShortu.securities.base10Czk.toString()).toBe('0');

    const seShortem = run([
      ...dlouhy,
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', pricePerShare: '3000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '2500' }),
    ]);
    // 300 000 (short) + 50 000 (long) → stovka prasklá, daní se obojí
    expect(seShortem.securities.exemptUnder100k).toBe(false);
    expect(seShortem.securities.pool100kCzk.toString()).toBe('350000');
    // zisk shortu 50 000 + zisk longu 20 000
    expect(seShortem.securities.base10Czk.toString()).toBe('70000');
  });
});

describe('R-13j: short otevřený přes konec roku', () => {
  const prescasovy = [
    shortOpen({ tradeDate: '2025-11-20', settlementDate: '2025-11-21', pricePerShare: '3000' }),
    shortCover({ tradeDate: '2026-01-15', settlementDate: '2026-01-16', pricePerShare: '2000' }),
  ];

  it('default: tržba se zdaní letos bez výdaje a uživatel je varovaný', () => {
    const result = run(prescasovy);
    expect(result.securities.taxableIncomeCzk.toString()).toBe('300000');
    expect(result.securities.expensesCzk.toString()).toBe('0');
    expect(result.securities.base10Czk.toString()).toBe('300000');
    expect(hasWarning(result, 'SHORT_OPEN_AT_YEAR_END')).toBe(true);
  });

  it('mírnější výklad se nedá vrátit ani zvenčí — přepínač je zrušený', () => {
    // R-13b: volba `shortSaleIncomeOnSale` skončila 23. 8. 2026 (opačný výklad
    // nemá oporu). Klíč v typu už neexistuje, ale kdyby se větev v enginu
    // vrátila, tenhle vstup by letos zdanil 0 místo 300 000 Kč.
    const result = run(prescasovy, {
      options: { shortSaleIncomeOnSale: false } as Partial<EngineOptions>,
    });
    expect(result.securities.taxableIncomeCzk.toString()).toBe('300000');
    expect(result.securities.base10Czk.toString()).toBe('300000');
    expect(result.securities.pool100kCzk.toString()).toBe('300000');
  });

  it('rok pokrytí: výdaj bez příjmu druhu propadá (§ 10/4)', () => {
    const result = run(prescasovy, { config: { ...CFG_2025, year: 2026 } });
    expect(result.securities.taxableIncomeCzk.toString()).toBe('0');
    expect(result.securities.expensesCzk.toString()).toBe('200000');
    expect(result.securities.rawGainLossCzk.toString()).toBe('-200000');
    expect(result.securities.base10Czk.toString()).toBe('0');
  });
});

describe('R-13: neúplná historie se nesmí spolknout', () => {
  it('pokrytí bez otevřeného shortu skončí chybou, ne tichým výdajem', () => {
    const result = run([shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '2000' })]);
    expect(hasWarning(result, 'SHORT_COVER_WITHOUT_OPEN')).toBe(true);
  });
});

describe('R-13: pořadí uvnitř dne a kompenzace v druhu', () => {
  it('intradenní short (otevřen i pokryt týž den) se spáruje', () => {
    // U shortu je OTEVŘENÍM prodej, takže sdílená priorita událostí (nákup před
    // prodejem) tu platí obráceně — jinak se pokrytí páruje proti prázdné frontě
    // a vyleze chyba o chybějícím otevření i fantomová otevřená pozice.
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-03', pricePerShare: '3000' }),
      shortCover({ tradeDate: '2025-03-03', settlementDate: '2025-03-03', pricePerShare: '2000' }),
    ]);
    expect(hasWarning(result, 'SHORT_COVER_WITHOUT_OPEN')).toBe(false);
    expect(hasWarning(result, 'SHORT_OPEN_AT_YEAR_END')).toBe(false);
    expect(result.securities.base10Czk.toString()).toBe('100000');
  });

  it('ztrátový short se započte proti ziskovému prodeji uvnitř druhu', () => {
    // Uříznout ztrátu shortu na nulu už u jednotlivého obchodu by zrušilo
    // kompenzaci uvnitř druhu podle § 10/4 (R-13i).
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10' }),
      sell({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '2800', tradeDate: '2025-06-02', settlementDate: '2025-06-03' }),
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', pricePerShare: '2000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '3000' }),
    ]);
    // long: 280 000 − 100 000 = +180 000; short: 200 000 − 300 000 = −100 000
    expect(result.securities.base10Czk.toString()).toBe('80000');
  });

  it('pokrytí z dřívějšího roku nehlásí chybu v letošním přiznání', () => {
    // pokrytí 2024 (otevření mimo nahranou historii) při analýze roku 2025
    const result = run([
      shortCover({ tradeDate: '2024-05-05', settlementDate: '2024-05-06', pricePerShare: '2000' }),
    ]);
    expect(hasWarning(result, 'SHORT_COVER_WITHOUT_OPEN')).toBe(false);
  });
});

/**
 * R-13c mechanika, kterou dřív popisoval jen kód: párování FIFO, dělení výdaje
 * mezi roky poměrem KUSŮ a komise při otevření.
 */
describe('R-13c: párování pokrytí, dělení výdaje mezi roky a komise', () => {
  it('pokrytí spotřebuje NEJSTARŠÍ otevření (FIFO), ne to poslední', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-03', pricePerShare: '3000' }),
      shortOpen({ tradeDate: '2025-06-03', settlementDate: '2025-06-03', pricePerShare: '1000' }),
      shortCover({ tradeDate: '2025-09-05', settlementDate: '2025-09-05', pricePerShare: '2000' }),
    ]);
    // 100 ks pokryto → k 31. 12. zbývá druhé otevření; při LIFO by tu leželo první
    expect(result.shortSales.openAtYearEnd).toHaveLength(1);
    expect(result.shortSales.openAtYearEnd[0]!.openedAt).toBe('2025-06-03');
    expect(result.shortSales.openAtYearEnd[0]!.quantity.toString()).toBe('100');
  });

  it('jedno pokrytí přes dva roky rozdělí výdaj poměrem kusů', () => {
    const result = run([
      // 60 ks otevřeno loni (jejich tržba se zdanila v 2024), 40 ks letos
      shortOpen({ quantity: '60', tradeDate: '2024-11-20', settlementDate: '2024-11-21', pricePerShare: '3000' }),
      shortOpen({ quantity: '40', tradeDate: '2025-02-10', settlementDate: '2025-02-11', pricePerShare: '3000' }),
      shortCover({ quantity: '100', tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '2000' }),
    ]);
    expect(result.shortSales.expensesCzk.toString()).toBe('200000');
    // 60 ze 100 ks patří k loňské tržbě → 60 % ceny zpětného nákupu
    expect(result.shortSales.priorYearIncomeExpensesCzk.toString()).toBe('120000');
  });

  it('v osvobozeném roce zůstane jen výdaj patřící k loni zdaněné tržbě', () => {
    const result = run([
      shortOpen({ quantity: '60', tradeDate: '2024-11-20', settlementDate: '2024-11-21', pricePerShare: '3000' }),
      // letošní tržba 30 000 Kč → celý druh padne pod stovku (R-13e)
      shortOpen({ quantity: '10', tradeDate: '2025-02-10', settlementDate: '2025-02-11', pricePerShare: '3000' }),
      shortCover({ quantity: '70', tradeDate: '2025-05-05', settlementDate: '2025-05-06', pricePerShare: '2000' }),
    ]);
    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.securities.taxableIncomeCzk.toString()).toBe('0');
    // 140 000 × 60/70 — výdaj k osvobozené letošní tržbě se neuplatní
    expect(result.securities.expensesCzk.toString()).toBe('120000');
  });

  it('komise při otevření je výdaj roku PRODEJE, ne roku pokrytí', () => {
    const prescasovy = [
      shortOpen({
        tradeDate: '2025-11-20',
        settlementDate: '2025-11-21',
        pricePerShare: '3000',
        fee: { amount: '500', currency: 'CZK' },
      }),
      shortCover({
        tradeDate: '2026-01-15',
        settlementDate: '2026-01-16',
        pricePerShare: '2000',
        fee: { amount: '400', currency: 'CZK' },
      }),
    ];
    const rokProdeje = run(prescasovy);
    expect(rokProdeje.securities.taxableIncomeCzk.toString()).toBe('300000');
    expect(rokProdeje.securities.expensesCzk.toString()).toBe('500');
    expect(rokProdeje.securities.base10Czk.toString()).toBe('299500');

    // rok pokrytí nese jen cenu zpětného nákupu a jeho vlastní komisi
    const rokPokryti = run(prescasovy, { config: { ...CFG_2025, year: 2026 } });
    expect(rokPokryti.securities.expensesCzk.toString()).toBe('200400');
  });
});

/**
 * R-13k (nález K6b-01): tržby ze shortu čerpají limity 50k / 20k / 50k.
 *
 * Shorty mají v enginu vlastní tabulku a do `securities.disposals` nevstupují —
 * limity je proto nepočítaly vůbec. Engine si tím protiřečil sám: u téhož
 * portfolia vyčíslil daň z § 10 a zároveň hlásil, že limit 50 000 Kč je
 * nevyčerpaný. Naměřeno na 2 000 náhodných portfoliích: 462× podhodnocený
 * měřák, 4× překlopený verdikt.
 */
describe('R-13k: short čerpá limity 50k, 20k i 50k obecné', () => {
  it('uzavřený short prolomí limit 50k, i když je zisk malý', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', quantity: '200', pricePerShare: '1000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', quantity: '200', pricePerShare: '800' }),
    ]);
    // engine daň z § 10 vyčíslí…
    expect(result.securities.base10Czk.toString()).toBe('40000');
    // …takže měřák nesmí tvrdit, že limit je nevyčerpaný
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('200000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(result.limits.flatTax50k.components.shortSalesIncomeCzk.toString()).toBe('200000');
    // jeden sčítanec živí všechny tři měřáky
    expect(result.limits.employee20k.status.usedCzk.toString()).toBe('200000');
    expect(result.limits.generalFiling50k.status.usedCzk.toString()).toBe('200000');
  });

  /**
   * ⚠️ Past, kterou backlog jmenoval: kdyby se do limitu dávala hrubá tržba
   * bez ohledu na osvobození, hlásil by měřák prolomení i drobnému investorovi,
   * jehož celý úhrn padne pod stovku. Osvobozený příjem limity nečerpá (R-08c).
   */
  it('short pod stovkou je osvobozený a limit nečerpá vůbec', () => {
    const result = run([
      shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', quantity: '10', pricePerShare: '3000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', quantity: '10', pricePerShare: '2000' }),
    ]);
    expect(result.securities.exemptUnder100k).toBe(true);
    expect(result.securities.taxableShortIncomeCzk.toString()).toBe('0');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
    expect(result.limits.flatTax50k.status.exceeded).toBe(false);
  });

  it('long i short čerpají limit společně', () => {
    const result = run([
      buy({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ isin: 'CZ0000000001', quantity: '10', pricePerShare: '6000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      shortOpen({ tradeDate: '2025-04-03', settlementDate: '2025-04-04', quantity: '100', pricePerShare: '1000' }),
      shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', quantity: '100', pricePerShare: '900' }),
    ]);
    // 60 000 z longu + 100 000 ze shortu
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('160000');
  });

  /**
   * Simulátor je funkce, jejímž jediným smyslem je ukázat dopad PŘED obchodem
   * (R-08f). Nad portfoliem s uzavřeným shortem hlásil „30 000 z 50 000,
   * v pohodě" účtu, který byl na 230 000 Kč.
   */
  it('simulátor vidí čerpání ze shortu i v baseline', async () => {
    const { simulateSale } = await import('../src');
    const { profile } = await import('./helpers');
    const input = {
      transactions: [
        shortOpen({ tradeDate: '2025-03-03', settlementDate: '2025-03-04', quantity: '200', pricePerShare: '1000' }),
        shortCover({ tradeDate: '2025-05-05', settlementDate: '2025-05-06', quantity: '200', pricePerShare: '800' }),
        buy({ isin: 'CZ0000000001', quantity: '100', pricePerShare: '100', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      ],
      profile: profile(),
      config: CFG_2025,
    };
    const outcome = simulateSale(input, {
      isin: 'CZ0000000001',
      quantity: '100',
      pricePerShare: '300',
      currency: 'CZK',
      date: '2025-09-01',
    });
    expect(outcome.baseline.flatTax50kUsedCzk.toString()).toBe('200000');
    expect(outcome.simulated.flatTax50kExceeded).toBe(true);
  });
});
