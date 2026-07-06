import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { EngineError, FxConverter, MapRateProvider, WarningCollector } from '../src';
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

  it('CZK se nepřepočítává', () => {
    const converter = new FxConverter(CFG_2025, 'UNIFIED', new WarningCollector());
    expect(converter.toCzk(d('123.45'), 'CZK', '2025-06-01').toString()).toBe('123.45');
  });
});
