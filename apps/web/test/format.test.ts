import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { money, plural, qty, yearList } from '@/lib/format';
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

describe('qty: počet kusů (L6a-08)', () => {
  it('drobná kryptopozice se ukáže přesně, ne zaokrouhlená na 4 místa nebo na nulu', () => {
    expect(qty(d('0.00075667'))).toBe('0,00075667');
    expect(qty(d('0.00004321'))).toBe('0,00004321');
    expect(qty(0.00000001)).toBe('0,00000001');
  });

  it('koncové nuly nepřidává a celé kusy zůstávají bez desetin', () => {
    expect(qty(d('10'))).toBe('10');
    expect(qty(d('2.5'))).toBe('2,5');
    expect(qty(d('2.12500000'))).toBe('2,125');
    expect(qty(d('1234.5'))).toBe('1 234,5');
  });

  it('devátým místem počínaje zaokrouhluje', () => {
    expect(qty(d('0.123456789'))).toBe('0,12345679');
  });

  it('číslo z hlášky simulátoru „Držíš jen … ks“ jde zadat zpátky a pozici nepřekročí', () => {
    // dřív hláška ukázala 0,0008 ks a totéž číslo vzápětí odmítla jako víc, než držíš
    for (const held of [d('0.00075667'), d('0.00004321'), d('12.5'), d('3')]) {
      const typed = qty(held).replace(/\s/g, '').replace(',', '.');
      expect(d(typed).eq(held), `${held.toString()} → „${qty(held)}“`).toBe(true);
    }
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
    // E-29: za které roky XML existuje, se má uživatel dozvědět předem, ne
    // až ve chvíli, kdy ho chce stáhnout
    expect(yearList(EPO_SUPPORTED_YEARS)).toBe('2024 a 2025');
  });
});
