import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import {
  EngineError,
  FxConverter,
  MapRateProvider,
  WarningCollector,
  type EngineWarning,
} from '../src';
import { buy, CFG_2025, run, sell } from './helpers';

describe('R-06 měnové přepočty', () => {
  const usdTrade = [
    buy({ isin: 'US0000000001', quantity: '100', pricePerShare: '100', currency: 'USD', tradeDate: '2022-03-01', settlementDate: '2022-03-01' }),
    sell({ isin: 'US0000000001', quantity: '100', pricePerShare: '120', currency: 'USD', tradeDate: '2025-02-01', settlementDate: '2025-02-01' }),
  ];

  it('R-06a: jednotný kurz — výdaj kurzem roku nákupu, příjem kurzem roku prodeje', () => {
    // fixture kurzy: 2022 USD 23 → výdaj 230 000; 2025 USD 20 → příjem 240 000
    const result = run(usdTrade);
    expect(result.securities.taxableIncomeCzk.toString()).toBe('240000');
    expect(result.securities.expensesCzk.toString()).toBe('230000');
    expect(result.securities.base10Czk.toString()).toBe('10000');
  });

  it('R-06b: denní kurzy ČNB dávají jiný výsledek — engine počítá obě varianty', () => {
    const daily = new MapRateProvider({
      'USD:2022-03-01': '24',
      'USD:2025-02-01': '21',
    });
    const result = run(usdTrade, { options: { fxMethod: 'CNB_DAILY' }, dailyRates: daily });
    expect(result.securities.taxableIncomeCzk.toString()).toBe('252000');
    expect(result.securities.expensesCzk.toString()).toBe('240000');
    expect(result.securities.base10Czk.toString()).toBe('12000');
  });

  it('víkend/svátek: denní kurz se hledá zpět k poslednímu vyhlášenému', () => {
    const converter = new FxConverter(
      CFG_2025,
      'CNB_DAILY',
      new WarningCollector(),
      new MapRateProvider({ 'USD:2025-01-30': '21' }),
    );
    expect(converter.toCzk(d('100'), 'USD', '2025-02-01').toString()).toBe('2100');
  });

  it('chybějící jednotný kurz roku → fallback na denní s varováním; bez obojího → EngineError', () => {
    const configWithout2022 = { ...CFG_2025, unifiedRatesByYear: { 2025: { USD: '20' } } };

    const warnings = new WarningCollector();
    const withFallback = new FxConverter(
      configWithout2022,
      'UNIFIED',
      warnings,
      new MapRateProvider({ 'USD:2022-03-01': '24' }),
    );
    expect(withFallback.toCzk(d('100'), 'USD', '2022-03-01').toString()).toBe('2400');
    expect(warnings.has('FX_UNIFIED_RATE_MISSING')).toBe(true);

    const withoutFallback = new FxConverter(configWithout2022, 'UNIFIED', new WarningCollector());
    expect(() => withoutFallback.toCzk(d('100'), 'USD', '2022-03-01')).toThrow(EngineError);
  });

  /**
   * R-06b, větev „denní kurz chybí“ (nález L13-03 revize 5).
   *
   * Do té doby ji neprovedl jediný test: `dailyRate()` mohla vracet kurz 1 Kč
   * a mlčet a celá sada zůstala zelená. Přitom to není okrajový případ jedné
   * měny — když tabulka denních kurzů chybí celá (výpadek stahování), jde touhle
   * větví každý cizoměnový přepočet poplatníka, který si denní kurzy zvolil.
   *
   * ⚠️ Testy zamykají DNEŠNÍ chování, ne rozhodnutý výklad. R-06 říká, že se
   * soustavy kurzů v jednom období nekombinují, a R-06b v docs/02 tuhle větev
   * nepopisuje vůbec — jestli má engine při chybějícím denním kurzu sáhnout po
   * jednotném (a výsledek nést varování), nebo výpočet odmítnout, je otevřené
   * rozhodnutí (revize 5, bod JB2). Až padne, tyhle testy se podle něj buď
   * nechají, nebo otočí; do té doby hlídají, že se větev nezmění potichu.
   */
  describe('R-06b: denní kurz chybí (dnešní chování, výklad čeká na rozhodnutí JB2)', () => {
    const fxWarnings = (warnings: EngineWarning[]) =>
      warnings
        .filter((w) => w.code.startsWith('FX_'))
        .map((w) => ({ code: w.code, level: w.level, context: w.context }));

    it('R-06b: bez denního kurzu se použije jednotný kurz roku transakce a přepočet nese varování FX_DAILY_RATE_MISSING', () => {
      const warnings = new WarningCollector();
      const converter = new FxConverter(CFG_2025, 'CNB_DAILY', warnings);

      // fixture kurzy: USD 2025 = 20, USD 2022 = 23 — rozhoduje rok transakce, ne rok konfigurace
      expect(converter.toCzk(d('100'), 'USD', '2025-02-01').toString()).toBe('2000');
      expect(converter.toCzk(d('100'), 'USD', '2022-03-01').toString()).toBe('2300');

      expect(fxWarnings(warnings.items)).toEqual([
        {
          code: 'FX_DAILY_RATE_MISSING',
          level: 'WARNING',
          context: { currency: 'USD', date: '2025-02-01' },
        },
        {
          code: 'FX_DAILY_RATE_MISSING',
          level: 'WARNING',
          context: { currency: 'USD', date: '2022-03-01' },
        },
      ]);
      // text musí říct, čím se počítalo a že se soustavy míchat nesmí
      expect(warnings.items[0]?.message).toContain('použit jednotný kurz');
      expect(warnings.items[0]?.message).toContain('§ 38 odst. 1');
    });

    it('R-06b: denní kurz starý 10 dní ještě platí, 11 dní starý už ne — pak jednotný kurz s varováním', () => {
      const tenDays = new WarningCollector();
      const withinReach = new FxConverter(
        CFG_2025,
        'CNB_DAILY',
        tenDays,
        new MapRateProvider({ 'USD:2025-01-22': '21' }),
      );
      expect(withinReach.toCzk(d('100'), 'USD', '2025-02-01').toString()).toBe('2100');
      expect(tenDays.items).toEqual([]);

      const elevenDays = new WarningCollector();
      const outOfReach = new FxConverter(
        CFG_2025,
        'CNB_DAILY',
        elevenDays,
        new MapRateProvider({ 'USD:2025-01-21': '21' }),
      );
      expect(outOfReach.toCzk(d('100'), 'USD', '2025-02-01').toString()).toBe('2000');
      expect(elevenDays.has('FX_DAILY_RATE_MISSING')).toBe(true);
    });

    it('R-06b: bez denního i jednotného kurzu výpočet skončí chybou FX_RATE_MISSING, ne tichým kurzem', () => {
      // fixtura CHF nezná v žádném roce; druhý převodník má tabulku denních kurzů, ale jen pro jinou měnu
      const warnings = new WarningCollector();
      const converters = [
        new FxConverter(CFG_2025, 'CNB_DAILY', warnings),
        new FxConverter(
          CFG_2025,
          'CNB_DAILY',
          warnings,
          new MapRateProvider({ 'USD:2025-02-01': '21' }),
        ),
      ];

      for (const converter of converters) {
        let thrown: unknown;
        try {
          converter.toCzk(d('100'), 'CHF', '2025-02-01');
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(EngineError);
        expect((thrown as EngineError).code).toBe('FX_RATE_MISSING');
      }
      // chyba není varování — kolektor zůstává prázdný
      expect(warnings.items).toEqual([]);
    });

    it('R-06b: celý výpočet metodou denních kurzů bez tabulky kurzů vyjde jednotným kurzem a ohlásí to u příjmu i výdaje', () => {
      const result = run(usdTrade, { options: { fxMethod: 'CNB_DAILY' } });

      // stejná čísla jako R-06a výše: výdaj 100 × 100 × 23, příjem 100 × 120 × 20
      expect(result.securities.taxableIncomeCzk.toString()).toBe('240000');
      expect(result.securities.expensesCzk.toString()).toBe('230000');
      expect(result.securities.base10Czk.toString()).toBe('10000');

      const reported = fxWarnings(result.warnings);
      expect(reported.length).toBeGreaterThan(0);
      expect(new Set(reported.map((w) => w.code))).toEqual(new Set(['FX_DAILY_RATE_MISSING']));
      expect(new Set(reported.map((w) => w.context?.date))).toEqual(
        new Set(['2022-03-01', '2025-02-01']),
      );
    });

    it('R-06b: chybí-li denní kurz jen pro den nákupu, sejdou se v jednom výpočtu obě soustavy — a varování to řekne', () => {
      const daily = new MapRateProvider({ 'USD:2025-02-01': '21' });
      const result = run(usdTrade, { options: { fxMethod: 'CNB_DAILY' }, dailyRates: daily });

      // příjem denním kurzem (120 × 100 × 21), výdaj jednotným kurzem roku 2022 (100 × 100 × 23)
      expect(result.securities.taxableIncomeCzk.toString()).toBe('252000');
      expect(result.securities.expensesCzk.toString()).toBe('230000');

      const reported = fxWarnings(result.warnings);
      expect(reported.length).toBeGreaterThan(0);
      expect(new Set(reported.map((w) => `${w.code} ${String(w.context?.date)}`))).toEqual(
        new Set(['FX_DAILY_RATE_MISSING 2022-03-01']),
      );
    });
  });

  it('CZK se nepřepočítává', () => {
    const converter = new FxConverter(CFG_2025, 'UNIFIED', new WarningCollector());
    expect(converter.toCzk(d('123.45'), 'CZK', '2025-06-01').toString()).toBe('123.45');
  });

  it('GBX (pence) se normalizuje na GBP/100', () => {
    const converter = new FxConverter(CFG_2025, 'UNIFIED', new WarningCollector());
    // 1000 pencí = 10 GBP × fixture kurz 30 = 300 CZK
    expect(converter.toCzk(d('1000'), 'GBX', '2025-06-01').toString()).toBe('300');
  });
});
