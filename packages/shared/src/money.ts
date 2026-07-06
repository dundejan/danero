import Decimal from 'decimal.js';

// Peněžní aritmetika výhradně přes Decimal — nikdy JS number (floaty ve finančních
// výpočtech nejsou akceptovatelné). V DB ukládat jako `numeric`/string.
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Money = Decimal;

export const d = (value: Decimal.Value): Decimal => new Decimal(value);
export const ZERO = new Decimal(0);

export const sum = (values: Iterable<Decimal>): Decimal => {
  let acc = ZERO;
  for (const v of values) acc = acc.plus(v);
  return acc;
};

/** Zaokrouhlení základu daně na celá sta Kč dolů (§ 16 odst. 2 ZDP). */
export const roundBaseDownTo100 = (v: Decimal): Decimal =>
  v.lte(0) ? ZERO : v.div(100).floor().mul(100);
