import { Decimal, type Money } from '@danero/shared';

/**
 * Deterministické české formátování čísel pro texty varování — záměrně bez
 * Intl (ručně přes regex), aby byl výstup enginu bit po bitu stejný v každém
 * runtime (Node, prohlížeč, testy) a šel snadno testovat na přesné texty.
 */

/** Nezlomitelná mezera — oddělovač tisíců i mezera před jednotkou (Kč, %). */
const NBSP = ' ';

/** „1234567" → „1 234 567" — tisíce oddělené nezlomitelnou mezerou. */
const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** Číslo s desetinnou čárkou a tisíci po česku (bez jednotky). */
const czNumber = (value: Money, decimalPlaces?: number): string => {
  const abs = value.abs();
  const fixed = decimalPlaces === undefined ? abs.toFixed() : abs.toFixed(decimalPlaces);
  const [whole = '0', frac] = fixed.split('.');
  const sign = value.isNegative() ? '-' : '';
  return `${sign}${groupThousands(whole)}${frac ? `,${frac}` : ''}`;
};

/** Částka v celých Kč (zaokrouhlení HALF_UP): „264 312 Kč". */
export function czkText(m: Money): string {
  return `${czNumber(m.toDecimalPlaces(0, Decimal.ROUND_HALF_UP))}${NBSP}Kč`;
}

/** Desetinný zlomek jako procento: pctText(d('0.15')) → „15 %"; pctText(r, 2) → „93,75 %". */
export function pctText(fraction: Money, decimalPlaces = 0): string {
  const value = fraction.mul(100).toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  return `${czNumber(value, decimalPlaces)}${NBSP}%`;
}

/** Počet kusů/kontraktů: desetinná čárka, tisíce s mezerou („1 234,5"). */
export function qtyText(m: Money): string {
  return czNumber(m);
}

/** ISO datum po česku: „2026-03-12" → „12. 3. 2026". */
export function czDateText(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)}.${NBSP}${Number(month)}.${NBSP}${year}`;
}
