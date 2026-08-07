import { describe, expect, it } from 'vitest';
import { money, plural, yearList } from '@/lib/format';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';

describe('plural: český tvar slova k číslu', () => {
  it('1 → jednotné, 2–4 → few, 0 a 5+ → many', () => {
    expect(plural(1, 'transakce', 'transakce', 'transakcí')).toBe('transakce');
    expect(plural(2, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(4, 'den', 'dny', 'dní')).toBe('dny');
    expect(plural(5, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(0, 'den', 'dny', 'dní')).toBe('dní');
    expect(plural(127, 'transakce', 'transakce', 'transakcí')).toBe('transakcí');
  });
});

describe('money: částky v historii transakcí', () => {
  it('zaokrouhluje na 2 desetinná místa s čárkou a jednotkou', () => {
    expect(money(0.73383905457, 'USD')).toBe('0,73 USD');
    expect(money(0.13, 'USD')).toBe('0,13 USD');
  });
});

describe('yearList: výčet roků česky (podmínky a ceník o XML pro EPO)', () => {
  it('spojuje poslední dva roky spojkou „a“, ostatní čárkou', () => {
    expect(yearList([2024])).toBe('2024');
    expect(yearList([2024, 2025])).toBe('2024 a 2025');
    expect(yearList([2026, 2024, 2025])).toBe('2024, 2025 a 2026');
    expect(yearList([])).toBe('');
  });

  it('podmínky i ceník tak píší roky, za které XML pro EPO opravdu existuje', () => {
    // E-29: kupující 490Kč tarifu se rozsah nesmí dozvědět až po zaplacení
    expect(yearList(EPO_SUPPORTED_YEARS)).toBe('2024 a 2025');
  });
});
