/**
 * Výsledek úpravy a smazání záznamu v číselníku instrumentů (/import, blok
 * „Doplněné údaje instrumentů“) tak, jak ho akce předává stránce v adrese.
 *
 * Jména parametrů jsou česky — uživatel je vidí. Toast i `ClearFeedbackUrl`
 * je po zobrazení z adresy mažou (`ALIAS_FEEDBACK_PARAMS`).
 */

/** Kotva bloku se seznamem (otevře ho `OpenOnHash`). */
export const ALIAS_LIST_ANCHOR = 'ciselnik';

const PARAM_ROW = 'zaznam';
const PARAM_ISIN = 'zadany-isin';
const PARAM_CURRENCY = 'zadana-mena';

export const ALIAS_FEEDBACK_PARAMS: readonly string[] = [PARAM_ROW, PARAM_ISIN, PARAM_CURRENCY];

/** Chyby, které se ukazují přímo u řádku seznamu (ne v toastu). */
export const ALIAS_ROW_ERRORS = [
  'zaznam-isin',
  'zaznam-kontrola',
  'zaznam-mena',
  'zaznam-pouzity',
  'smazani-pouzite',
] as const;
export type AliasRowError = (typeof ALIAS_ROW_ERRORS)[number];

export const isAliasRowError = (code: string): code is AliasRowError =>
  (ALIAS_ROW_ERRORS as readonly string[]).includes(code);

/** Klíč řádku seznamu. Stránka ho jen porovnává s vlastními záznamy, nerozkládá ho. */
export const aliasRowKey = (broker: string, symbol: string): string => `${broker}/${symbol}`;

/** Co uživatel do pole zadal — vrací se do formuláře po chybě; jen znaky, které ISIN/měna smí mít. */
const enteredIsin = (value: string): string => value.replace(/[^A-Z0-9]/g, '').slice(0, 12);
const enteredCurrency = (value: string): string => value.replace(/[^A-Z]/g, '').slice(0, 3);

export function aliasFeedbackUrl(
  result: { ok: 'zaznam-upraven' | 'zaznam-smazan' } | { error: string },
  row: { broker: string; symbol: string },
  entered?: { isin: string; currency: string },
): string {
  const query = new URLSearchParams(
    'ok' in result ? { ulozeno: result.ok } : { chyba: result.error },
  );
  query.set(PARAM_ROW, aliasRowKey(row.broker, row.symbol));
  if (entered && enteredIsin(entered.isin)) query.set(PARAM_ISIN, enteredIsin(entered.isin));
  if (entered && enteredCurrency(entered.currency)) {
    query.set(PARAM_CURRENCY, enteredCurrency(entered.currency));
  }
  return `/import?${query.toString()}#${ALIAS_LIST_ANCHOR}`;
}

/** Údaje k výsledku z adresy; hodnoty se znovu omezí na povolené znaky (adresu mohl napsat kdokoli). */
export function aliasFeedbackDetails(params: Record<string, string | string[] | undefined>): {
  rowKey: string | undefined;
  isin: string | undefined;
  currency: string | undefined;
} {
  const first = (name: string): string | undefined => {
    const value = params[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    rowKey: first(PARAM_ROW),
    isin: enteredIsin(first(PARAM_ISIN)?.toUpperCase() ?? '') || undefined,
    currency: enteredCurrency(first(PARAM_CURRENCY)?.toUpperCase() ?? '') || undefined,
  };
}
