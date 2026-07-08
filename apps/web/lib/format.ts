import type { Money } from '@danero/shared';

const czkFormat = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
});

const numberFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 4 });

export const czk = (value: Money | number): string =>
  czkFormat.format(typeof value === 'number' ? value : value.toNumber());

export const qty = (value: Money | number): string =>
  numberFormat.format(typeof value === 'number' ? value : value.toNumber());

export const czDate = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString('cs-CZ');

const amountFormat = new Intl.NumberFormat('cs-CZ', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Částka v cizí měně česky: „1 234,56 USD" (+ volitelné znaménko u P/L). */
export const money = (value: Money | number, currency: string, signed = false): string => {
  const n = typeof value === 'number' ? value : value.toNumber();
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${amountFormat.format(n)} ${currency}`;
};
