import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import type { EngineWarning } from '@danero/engine';
import { groupByCode, warningCaseLine, withholdingSummary } from '@/components/warnings-list';

const w = (over: Partial<EngineWarning>): EngineWarning => ({
  code: 'WITHHOLDING_ABOVE_TREATY',
  level: 'WARNING',
  message: 'x',
  ...over,
});

describe('seskupení kontrol výpočtu podle kódu', () => {
  it('přebírá nejvyšší závažnost skupiny', () => {
    const groups = groupByCode([
      w({ code: 'A', level: 'WARNING' }),
      w({ code: 'B', level: 'INFO' }),
      w({ code: 'A', level: 'ERROR' }),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['A', 'B']);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.level).toBe('ERROR');
  });

  it('řadí ERROR → WARNING → INFO, uvnitř úrovně podle počtu výskytů sestupně', () => {
    const groups = groupByCode([
      w({ code: 'I', level: 'INFO' }),
      w({ code: 'W1', level: 'WARNING' }),
      w({ code: 'W2', level: 'WARNING' }),
      w({ code: 'W2', level: 'WARNING' }),
      w({ code: 'E', level: 'ERROR' }),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['E', 'W2', 'W1', 'I']);
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

  it('předaná propadlá srážka za rok má přednost před součtem contextů', () => {
    const group = groupByCode([
      w({ context: { country: 'US', overCzk: '100.00' } }),
      w({ context: { country: 'US', overCzk: '50.00' } }),
    ])[0]!;
    // 276 − 150 z karty § 8 (vč. rozdílů ze zaokrouhlení zápočtu dolů);
    // Intl vkládá nezlomitelné mezery — normalizujeme na obyčejné
    const text = withholdingSummary(group, labels, d('126')).replace(/ /g, ' ');
    expect(text).toContain('126 Kč');
    expect(text).not.toContain('150 Kč');
  });
});

describe('kompaktní řádek případu (warningCaseLine)', () => {
  const labels = new Map([['US0378331005', 'AAPL']]);

  it('se strukturovaným contextem skládá „TICKER · datum · částka“', () => {
    const line = warningCaseLine(
      w({
        message: 'Dividenda AAPL z 13. 2. 2026 (US): dlouhé vysvětlení, které se nemá opakovat.',
        context: { isin: 'US0378331005', date: '2026-02-13', country: 'US', overCzk: '75.45' },
      }),
      labels,
    ).replace(/ /g, ' ');
    expect(line).toBe('AAPL · 13. 2. 2026 · 75 Kč');
  });

  it('bez labelu použije ISIN; chybějící části vynechá', () => {
    const line = warningCaseLine(
      w({ context: { isin: 'DE0007164600', overCzk: '10.00' } }),
      labels,
    ).replace(/ /g, ' ');
    expect(line).toBe('DE0007164600 · 10 Kč');
  });

  it('bez strukturovaného contextu vrací plný text (auditní stopa jiných kódů)', () => {
    const line = warningCaseLine(
      w({
        code: 'TRANSFER_WITHOUT_ACQUISITION',
        message: 'Převod bez údajů o nabytí.',
        context: { txId: 't-1' },
      }),
      labels,
    );
    expect(line).toBe('Převod bez údajů o nabytí.');
  });
});
