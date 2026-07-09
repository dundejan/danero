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

  it('czDateText: ISO datum po česku', () => {
    expect(czDateText('2026-03-12')).toBe(`12.${S}3.${S}2026`);
    expect(czDateText('2025-04-01')).toBe(`1.${S}4.${S}2025`);
    expect(czDateText('neplatné')).toBe('neplatné');
  });
});
