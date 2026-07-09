import { describe, expect, it } from 'vitest';
import type { EngineWarning } from '@danero/engine';
import { groupByCode, withholdingSummary } from '@/components/warnings-list';

const w = (over: Partial<EngineWarning>): EngineWarning => ({
  code: 'WITHHOLDING_ABOVE_TREATY',
  level: 'WARNING',
  message: 'x',
  ...over,
});

describe('seskupení kontrol výpočtu podle kódu', () => {
  it('zachová pořadí prvního výskytu a přebírá nejvyšší závažnost', () => {
    const groups = groupByCode([
      w({ code: 'A', level: 'WARNING' }),
      w({ code: 'B', level: 'INFO' }),
      w({ code: 'A', level: 'ERROR' }),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['A', 'B']);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.level).toBe('ERROR');
  });
});

describe('agregovaný souhrn WITHHOLDING_ABOVE_TREATY', () => {
  const labels = new Map([
    ['US0378331005', 'AAPL'],
    ['NL0010273215', 'ASML'],
  ]);

  it('sečte overCzk, vypíše unikátní seřazené tituly a u US přidá radu W-8BEN', () => {
    const group = groupByCode([
      w({ context: { isin: 'US0378331005', country: 'US', overCzk: '100.50' } }),
      w({ context: { isin: 'US0378331005', country: 'US', overCzk: '200.00' } }),
      w({ context: { isin: 'NL0010273215', country: 'NL', overCzk: '49.50' } }),
    ])[0]!;
    // Intl vkládá nezlomitelné mezery — pro čitelnost testu normalizujeme na obyčejné
    const text = withholdingSummary(group, labels).replace(/ /g, ' ');
    expect(text).toContain('U 3 dividend');
    expect(text).toContain('350 Kč'); // 100,50 + 200 + 49,50 zaokrouhleno na celé Kč
    expect(text).toContain('Dotčené tituly: AAPL, ASML.');
    expect(text).toContain('W-8BEN');
  });

  it('bez US výskytu radu W-8BEN vynechá; bez ISIN vynechá výčet titulů', () => {
    const group = groupByCode([
      w({ context: { country: 'NL', overCzk: '10.00' } }),
      w({ context: { country: 'DE', overCzk: '5.00' } }),
    ])[0]!;
    const text = withholdingSummary(group, labels);
    expect(text).not.toContain('W-8BEN');
    expect(text).not.toContain('Dotčené tituly');
  });
});
