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

/** Datum česky — ISO string („2026-07-12“), nebo Date z DB (v české zóně;
    server rendruje v UTC a kolem půlnoci by datum uteklo o den). */
export const czDate = (value: string | Date): string =>
  typeof value === 'string'
    ? new Date(`${value}T00:00:00`).toLocaleDateString('cs-CZ')
    : value.toLocaleDateString('cs-CZ', { timeZone: 'Europe/Prague' });

/** Datum a čas z DB v české zóně, bez sekund — jednotný tvar pro celé UI. */
export const czDateTime = (value: Date): string =>
  value.toLocaleString('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Kompaktní částka v Kč bez desetin (grafy, tooltips) — nezlomitelná mezera. */
export const czkCompact = (value: number): string =>
  `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(value)}\u00A0Kč`;

/** Procento česky s nezlomitelnou mezerou: pct(91,4) → „91 %“. */
export const pct = (value: number, decimals = 0): string =>
  `${value.toLocaleString('cs-CZ', { maximumFractionDigits: decimals })}\u00A0%`;

/** Procento se znaménkem u kladných hodnot (P/L): signedPct(3,2, 1) → „+3,2 %“. */
export const signedPct = (value: number, decimals = 0): string =>
  `${value >= 0 ? '+' : ''}${pct(value, decimals)}`;

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
