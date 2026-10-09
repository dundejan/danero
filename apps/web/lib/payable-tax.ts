import type { TaxYearResult } from '@danero/engine';
import { ZERO, type Money } from '@danero/shared';
import { regimeLimitFor } from '@/lib/simulator-verdict';

/**
 * Daň, kterou poplatník z investic opravdu zaplatí (docs/02 R-09f, nález
 * L24-02, rozhodnutí R6).
 *
 * „Orientační daň“ z enginu je daň z investic, KDYBY se podávalo přiznání.
 * Kdo je pod limitem svého režimu (paušalista, zaměstnanec, „jiné“), přiznání
 * nepodává a z investic neplatí nic — přesto četl „Orientační daň 1 245 Kč“
 * hned pod větou, že povinnost nevzniká, a simulátor mu u prodeje, který limit
 * teprve prolomí, ukazoval nárůst daně jen o ten jeden prodej. Ve skutečnosti
 * prolomení zdaní všechny letošní zdanitelné příjmy z investic naráz.
 *
 * OSVČ mimo paušál podává vždy, režimový limit nemá (`limitCzk` je `null`)
 * a daň k zaplacení se rovná orientační.
 *
 * ⚠️ Limit vidí jen příjmy, o kterých Danero ví. Nula proto není slib —
 * každé místo, které ji ukazuje, to musí říct.
 */
export function payableTaxCzk(taxCzk: Money, incomeCzk: Money, limitCzk: Money | null): Money {
  if (limitCzk === null) return taxCzk;
  // limity jsou „do X včetně“ — přesně X ještě vyhovuje (stejně jako v enginu)
  return incomeCzk.gt(limitCzk) ? taxCzk : ZERO;
}

/** Orientační daň doporučené varianty. */
export const recommendedTaxCzk = (result: Pick<TaxYearResult, 'tax'>): Money =>
  result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;

/**
 * Je poplatník pod limitem svého režimu, takže orientační daň neplatí?
 * Vrací strop toho limitu, nebo `null` (limit nemá, nebo ho překročil).
 */
export function unpaidUnderLimitCzk(result: Pick<TaxYearResult, 'limits'>): Money | null {
  const limit = regimeLimitFor(result.limits);
  if (!limit) return null;
  // úhrn příjmů § 8–10 vede engine pod názvem paušálního limitu pro každý režim
  return result.limits.flatTax50k.status.usedCzk.gt(limit.limitCzk) ? null : limit.limitCzk;
}
