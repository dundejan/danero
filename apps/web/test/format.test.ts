import { describe, expect, it } from 'vitest';
import { money, plural } from '@/lib/format';

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
