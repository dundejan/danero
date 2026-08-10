import { describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import { czDateText, czkText, pctText, qtyText } from '../src/format';

/** Nezlomitelná mezera — oddělovač tisíců i mezera před jednotkou. */
const S = ' ';

describe('formátování čísel pro texty varování (deterministické, bez Intl)', () => {
  it('czkText: celé Kč (HALF_UP), tisíce oddělené mezerou', () => {
    expect(czkText(d('264311.69'))).toBe(`264${S}312${S}Kč`);
    expect(czkText(d('50000'))).toBe(`50${S}000${S}Kč`);
    expect(czkText(d('40000000'))).toBe(`40${S}000${S}000${S}Kč`);
    expect(czkText(d('999'))).toBe(`999${S}Kč`);
    expect(czkText(d('0.5'))).toBe(`1${S}Kč`);
    expect(czkText(d('-1234.5'))).toBe(`-1${S}235${S}Kč`);
  });

  it('pctText: desetinný zlomek jako procento, čárka jako desetinný oddělovač', () => {
    expect(pctText(d('0.15'))).toBe(`15${S}%`);
    expect(pctText(d('0.9375'), 2)).toBe(`93,75${S}%`);
    expect(pctText(d('1'))).toBe(`100${S}%`);
  });

  it('qtyText: počty kusů s desetinnou čárkou', () => {
    expect(qtyText(d('4'))).toBe('4');
    expect(qtyText(d('0.5'))).toBe('0,5');
    expect(qtyText(d('1234.25'))).toBe(`1${S}234,25`);
  });

  // A1-3-08: podíl z reverzního splitu 3:1 je periodické číslo a Decimal ho nese
  // na 32 cifer — v hlášce pak stálo „prodáno o 0,666…67 ks více“.
  it('qtyText: periodický podíl se ořízne na osm desetinných míst', () => {
    expect(qtyText(d('2').div(3))).toBe('0,66666667');
    // koncové nuly nepřibývají, celá čísla zůstávají celá
    expect(qtyText(d('1.50'))).toBe('1,5');
    expect(qtyText(d('10'))).toBe('10');
    // satoshi je nejjemnější jednotka z výpisů a musí projít nedotčená
    expect(qtyText(d('0.00000001'))).toBe('0,00000001');
  });

  // A1-3-09: −0,4 Kč se zaokrouhlí na nulu, ale znaménko zůstávalo → „-0 Kč“.
  it('nula si nenese znaménko, i když se na ni zaokrouhlilo ze záporné částky', () => {
    expect(czkText(d('-0.4'))).toBe(`0${S}Kč`);
    expect(czkText(d('-0'))).toBe(`0${S}Kč`);
    expect(qtyText(d('-0.000000001'))).toBe('0');
    expect(pctText(d('-0.0001'))).toBe(`0${S}%`);
    // skutečně záporné hodnoty znaménko ztratit nesmí
    expect(czkText(d('-0.6'))).toBe(`-1${S}Kč`);
    expect(pctText(d('-0.15'))).toBe(`-15${S}%`);
  });

  it('czDateText: ISO datum po česku', () => {
    expect(czDateText('2026-03-12')).toBe(`12.${S}3.${S}2026`);
    expect(czDateText('2025-04-01')).toBe(`1.${S}4.${S}2025`);
    expect(czDateText('neplatné')).toBe('neplatné');
  });
});
