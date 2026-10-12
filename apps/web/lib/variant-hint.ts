import type { VariantResult } from '@danero/engine';
import type { Money } from '@danero/shared';
import { czk, METHOD_LABEL } from '@/lib/format';
import { LIMIT_NAME } from '@/lib/limit-names';
import { payableTaxCzk } from '@/lib/payable-tax';
import type { RegimeLimit } from '@/lib/simulator-verdict';

/**
 * Výzva „jiná varianta výpočtu by ti vyšla líp“ v reportu (pravidlo 2
 * z CLAUDE.md: počítáme zvolenou variantou, ale ukážeme, co by znamenala ta
 * výhodnější — i s tím, co obnáší).
 *
 * Čistá funkce kvůli testům. Do 10. 10. 2026 měla výzva jediné znění — „S …
 * by daň z investic vyšla X“ — i tehdy, když ji spustil paušální limit: X pak
 * bylo VYŠŠÍ než současná daň a o skutečném přínosu (zůstat pod limitem,
 * nepodávat přiznání, daň neplatit) nepadlo slovo (nález R4-01). A ukázala se
 * i tomu, kdo je pod limitem svého režimu a daň neplatí v žádné variantě.
 */

/**
 * Od jakého rozdílu v dani stojí za to na výhodnější variantu upozornit.
 * Menší rozdíly vznikají jen zaokrouhlením mezi kurzovými soustavami.
 */
const NOTABLE_TAX_SAVING_CZK = 100;

export type VariantHint =
  /** Jiná varianta nechá příjmy pod limitem režimu — přiznání se nepodává. */
  | { reason: 'STAYS_UNDER_LIMIT'; variant: VariantResult; limit: RegimeLimit }
  /** Jiná varianta dá znatelně nižší daň, která se opravdu platí. */
  | { reason: 'LOWER_TAX'; variant: VariantResult; savingCzk: Money };

const sameVariant = (a: VariantResult, b: VariantResult): boolean =>
  a.matchingMethod === b.matchingMethod && a.fxMethod === b.fxMethod;

/**
 * @param active varianta, kterou se rok počítá (zvolená, nebo zafixovaná)
 * @param recommended nejvýhodnější varianta podle enginu
 * @param regimeLimit limit režimu (`regimeLimitFor`); `null` = OSVČ mimo paušál
 */
export function variantHint(
  active: VariantResult | undefined,
  recommended: VariantResult,
  regimeLimit: RegimeLimit | null,
): VariantHint | null {
  if (!active || sameVariant(active, recommended)) return null;
  // úhrn příjmů § 8–10 vede engine pod názvem paušálního limitu pro každý režim
  const overLimit = (variant: VariantResult): boolean =>
    regimeLimit !== null && variant.flatTax50kUsedCzk.gt(regimeLimit.limitCzk);
  if (regimeLimit && overLimit(active) && !overLimit(recommended)) {
    return { reason: 'STAYS_UNDER_LIMIT', variant: recommended, limit: regimeLimit };
  }
  // R-09f: pod limitem režimu se daň neplatí — porovnává se daň k zaplacení
  const payable = (variant: VariantResult): Money =>
    payableTaxCzk(variant.taxCzk, variant.flatTax50kUsedCzk, regimeLimit?.limitCzk ?? null);
  const savingCzk = payable(active).sub(payable(recommended));
  return savingCzk.gte(NOTABLE_TAX_SAVING_CZK)
    ? { reason: 'LOWER_TAX', variant: recommended, savingCzk }
    : null;
}

/** Čím se doporučená varianta liší — 7. pádem, do věty „S …“. */
export function variantDifference(active: VariantResult, other: VariantResult): string {
  return [
    other.matchingMethod !== active.matchingMethod
      ? `párováním ${METHOD_LABEL[other.matchingMethod] ?? other.matchingMethod}`
      : null,
    other.fxMethod !== active.fxMethod
      ? other.fxMethod === 'UNIFIED'
        ? 'jednotným kurzem GFŘ'
        : 'denními kurzy ČNB'
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' a ');
}

/** „pod limitem paušální daně (50 000 Kč)“ — jméno limitu jako na přehledu. */
const underLimit = (limit: RegimeLimit): string =>
  `pod ${LIMIT_NAME[limit.kind].replace(/^Limit /, 'limitem ')} (${czk(limit.limitCzk)})`;

/**
 * Titulek výzvy: říká skutečný přínos. U limitu žádná částka daně — pod
 * limitem se neplatí; u daně rozdíl, ne částka, kterou by čtenář musel sám
 * s něčím porovnávat.
 */
export function variantHintTitle(hint: VariantHint, active: VariantResult): string {
  const difference = variantDifference(active, hint.variant);
  return hint.reason === 'STAYS_UNDER_LIMIT'
    ? `S ${difference} bys zůstal ${underLimit(hint.limit)}`
    : `S ${difference} by daň z investic vyšla o ${czk(hint.savingCzk)} nižší`;
}
