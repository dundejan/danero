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

/** Částka v cizí měně česky: „1 234,56 USD“ (+ volitelné znaménko u P/L). */
export const money = (value: Money | number, currency: string, signed = false): string => {
  const n = typeof value === 'number' ? value : value.toNumber();
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${amountFormat.format(n)} ${currency}`;
};

/** Lidské popisky metod párování prodejů (R-05c) — jednotné pro celé UI. */
export const METHOD_LABEL: Record<string, string> = {
  FIFO: 'FIFO',
  LIFO: 'LIFO',
  MAX_PROFIT: 'Max. zisk',
  MAX_LOSS: 'Max. ztráta',
};

/** Popisky kurzové soustavy (R-06) ve srovnáních variant — jednotné pro celé UI. */
export const FX_LABEL: Record<string, string> = {
  UNIFIED: 'jednotný',
  CNB_DAILY: 'denní ČNB',
};

/** České zkratky měsíců (osy grafů, horizont osvobození). */
export const MONTH_LABELS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];

const czPluralRules = new Intl.PluralRules('cs');

/**
 * Správný český tvar slova k číslu: plural(n, 'transakce', 'transakce', 'transakcí').
 * Vrací jen tvar slova (číslo vypíše volající); „few“ platí pro 2–4, „many“
 * pro 0, 5+ i necelá čísla.
 */
export const plural = (n: number, one: string, few: string, many: string): string => {
  const rule = czPluralRules.select(n);
  return rule === 'one' ? one : rule === 'few' ? few : many;
};
