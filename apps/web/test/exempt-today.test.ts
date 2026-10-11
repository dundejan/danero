import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { exemptToday, type ExemptTodayRow } from '@/lib/exempt-today';

/**
 * „Bez daně už dnes“ na portfoliu, kde pozice nemají cenu.
 *
 * Do 11. 10. 2026 stálo u portfolia se dvěma oceněnými pozicemi a třemi bez
 * ceny „0 Kč · 0 % z oceněných pozic · 3 bez ceny“ — nula vypadala jako
 * výsledek, přitom kusy bez daně měly právě ty tři pozice, které cenu nemají.
 * Ceny jsou jen od připojeného brokera, takže kdo nahrává výpisy, nemá žádnou.
 */
const NBSP = ' ';

const row = (quantity: string, exempt: string, valueCzk?: string): ExemptTodayRow => ({
  quantity: d(quantity),
  exemptQuantity: d(exempt),
  ...(valueCzk === undefined ? {} : { valueCzk: d(valueCzk) }),
});

describe('exemptToday: číslo „Bez daně už dnes“', () => {
  it('všechno oceněné: částka a podíl portfolia', () => {
    const result = exemptToday([row('10', '10', '30000'), row('20', '5', '40000')])!;
    // 30 000 + čtvrtina ze 40 000
    expect(result.value).toBe(`40${NBSP}000${NBSP}Kč`);
    expect(result.note).toBe(`57,1${NBSP}% portfolia`);
    expect(result).toMatchObject({ positive: true, missing: 0 });
  });

  it('nula je pravdivá, když je všechno oceněné a nic bez daně', () => {
    const result = exemptToday([row('10', '0', '30000'), row('20', '0', '40000')])!;
    expect(result.value).toBe(`0${NBSP}Kč`);
    expect(result.note).toBe(`0${NBSP}% portfolia`);
    expect(result.positive).toBe(false);
  });

  it('zopakování nálezu: „0 Kč“ jen proto, že pozicím s kusy bez daně chybí cena', () => {
    // dvě oceněné pozice na osvobození čekají, tři bez ceny — dvě z nich ho mají
    const result = exemptToday([
      row('15', '0', '20000'),
      row('20', '0', '50000'),
      row('40', '40'),
      row('10', '6'),
      row('50000000', '0'),
    ])!;
    expect(result.value).toBe('2 z 5 pozic');
    expect(result.value).not.toMatch(/Kč/);
    expect(result.note).toBe('aspoň zčásti · bez ceny');
    expect(result).toMatchObject({ positive: true, missing: 2 });
  });

  it('jen část bez ceny: částka zůstává a říká, kolik pozic v ní chybí', () => {
    const result = exemptToday([
      row('10', '10', '30000'),
      row('20', '0', '50000'),
      row('40', '40'),
      row('10', '6'),
      row('5', '5'),
      row('7', '1'),
      row('9', '9'),
    ])!;
    expect(result.value).toBe(`30${NBSP}000${NBSP}Kč`);
    expect(result.note).toBe('chybí 5 pozic bez ceny');
    expect(result.missing).toBe(5);
    // skloňování: jedna a dvě pozice
    expect(exemptToday([row('10', '10', '30000'), row('40', '40')])!.note).toBe(
      'chybí 1 pozice bez ceny',
    );
    expect(exemptToday([row('10', '10', '30000'), row('40', '40'), row('4', '2')])!.note).toBe(
      'chybí 2 pozice bez ceny',
    );
  });

  it('pozice bez ceny, která na osvobození teprve čeká, v částce nechybí', () => {
    // mince bez ceny koupená letos: ani s cenou by k částce nic nepřidala
    const result = exemptToday([row('10', '10', '30000'), row('20', '0', '50000'), row('1000', '0')])!;
    expect(result.value).toBe(`30${NBSP}000${NBSP}Kč`);
    expect(result.note).toBe(`37,5${NBSP}% z oceněných pozic`);
    expect(result.missing).toBe(0);
  });

  it('žádná cena: počet pozic, nikdy částka ani součet kusů napříč tituly', () => {
    const result = exemptToday([row('40', '40'), row('10', '6'), row('20', '0'), row('50000000', '0'), row('15', '0')])!;
    expect(result.value).toBe('2 z 5 pozic');
    expect(result.note).toBe('aspoň zčásti');
    expect(result).toMatchObject({ positive: true, missing: 2 });

    const nothing = exemptToday([row('40', '0'), row('10', '0')])!;
    expect(nothing.value).toBe('0 z 2 pozic');
    expect(nothing.note).toBeUndefined();
    expect(nothing.positive).toBe(false);
  });

  it('jediná pozice bez ceny: kusy téhož titulu sečíst jde', () => {
    expect(exemptToday([row('10', '6')])).toMatchObject({ value: '6 z 10 ks', positive: true });
    expect(exemptToday([row('0.5', '0')])).toMatchObject({
      value: '0 z 0,5 ks',
      positive: false,
    });
  });

  it('prázdné portfolio číslo nemá a nulová hodnota nedělí nulou', () => {
    expect(exemptToday([])).toBeNull();
    const zero = exemptToday([row('10', '10', '0'), row('5', '0', '0')])!;
    expect(zero.value).toBe(`0${NBSP}Kč`);
    expect(zero.note).toBeUndefined();
  });
});
