import { describe, expect, it } from 'vitest';
import {
  DEADLINE_LEAD_OPTIONS,
  DEFAULT_NOTIFICATION_RULES,
  formatNumberList,
  LIMIT_THRESHOLD_OPTIONS,
  notificationRules,
  parseNumberList,
  pickOption,
  summaryPeriod,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';

/**
 * Pravidla hlídače si uživatel nastavuje sám, ale do generování událostí smí
 * vstoupit jen hodnota z nabídky — formulář jde odeslat i mimo naše UI.
 */
describe('pravidla hlídače: čtení uložených voleb', () => {
  it('chybějící hodnota = výchozí, prázdná = uživatel schválně nechce nic', () => {
    expect(parseNumberList(null, TIME_TEST_LEAD_OPTIONS, [30, 7])).toEqual([30, 7]);
    expect(parseNumberList(undefined, TIME_TEST_LEAD_OPTIONS, [30, 7])).toEqual([30, 7]);
    expect(parseNumberList('', TIME_TEST_LEAD_OPTIONS, [30, 7])).toEqual([]);
  });

  it('hodnoty mimo nabídku se zahodí, duplicity zmizí a pořadí se srovná', () => {
    expect(parseNumberList('7,30,7,3,999', TIME_TEST_LEAD_OPTIONS, [])).toEqual([7, 30]);
    expect(parseNumberList('100,60,1', LIMIT_THRESHOLD_OPTIONS, [])).toEqual([60, 100]);
    expect(parseNumberList('nesmysl', LIMIT_THRESHOLD_OPTIONS, [85])).toEqual([]);
  });

  it('jedna hodnota z nabídky projde, cokoli jiného spadne na výchozí', () => {
    expect(pickOption(14, DEADLINE_LEAD_OPTIONS, 30)).toBe(14);
    expect(pickOption(13, DEADLINE_LEAD_OPTIONS, 30)).toBe(30);
    expect(pickOption('MONTHLY', ['OFF', 'MONTHLY'] as const, 'OFF')).toBe('MONTHLY');
    expect(pickOption(null, ['OFF', 'MONTHLY'] as const, 'OFF')).toBe('OFF');
  });

  it('řádek bez nových sloupců (starý účet) dá výchozí pravidla', () => {
    expect(notificationRules({})).toEqual(DEFAULT_NOTIFICATION_RULES);
  });

  it('lhůty se čtou sestupně — hlídač hledá nejbližší, do které se dny vejdou', () => {
    expect(notificationRules({ timeTestLeadDays: '7,90,30' }).timeTestLeadDays).toEqual([90, 30, 7]);
  });

  it('zápis a čtení se vrátí na totéž', () => {
    const stored = formatNumberList([60, 85, 100]);
    expect(stored).toBe('60,85,100');
    expect(parseNumberList(stored, LIMIT_THRESHOLD_OPTIONS, [])).toEqual([60, 85, 100]);
  });
});

describe('období pravidelného přehledu', () => {
  it('vypnuto nemá období, měsíc a čtvrtletí ho mají jednoznačné', () => {
    expect(summaryPeriod('2026-08-11', 'OFF')).toBeNull();
    expect(summaryPeriod('2026-08-11', 'MONTHLY')).toBe('2026-08');
    expect(summaryPeriod('2026-01-31', 'MONTHLY')).toBe('2026-01');
    expect(summaryPeriod('2026-08-11', 'QUARTERLY')).toBe('2026-Q3');
    expect(summaryPeriod('2026-01-01', 'QUARTERLY')).toBe('2026-Q1');
    expect(summaryPeriod('2026-12-31', 'QUARTERLY')).toBe('2026-Q4');
  });
});
