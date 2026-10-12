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

/** Způsob zdanění zahraničních dividend a úroků (R-07d): s ostatními příjmy, nebo zvlášť. */
export type DividendTaxation = TaxYearResult['tax']['recommended'];

/**
 * Jedno pojetí daně pro přehled, report i simulátor (nálezy R1B-02 a R1B-03).
 *
 * Do 10. 10. 2026 si každá stránka vybírala hlavní číslo sama: přehled po
 * prolomení paušálního limitu ukazoval „Doplatek daně 980 Kč“, report pod
 * týmž verdiktem „Orientační daň z investic 2 180 Kč“ a o zálohách mlčel.
 * Obě čísla jsou správně — liší se o zaplacené zálohy — jen to nikde nestálo.
 *
 * Pravidlo: hlavní číslo je **doplatek** tam, kde se od daně odečítají zálohy
 * z paušálního režimu (R-08f: paušalista po prolomení limitu), jinak
 * **orientační daň z investic**. Kde stojí obě, stojí mezi nimi i zálohy.
 *
 * Nic se tu nepočítá nově — jen se z výsledku enginu vybírá, co k čemu patří.
 */
export interface TaxSummary {
  /**
   * Zdanění dividend, se kterým hlavní číslo počítá. Po prolomení paušálního
   * limitu je to vždy obecný základ: doplatek z něj engine počítá záměrně
   * (R-08f — výhodnost § 16a závisí na podnikání, které Danero nezná).
   */
  variant: DividendTaxation;
  /** Orientační daň z investic v té variantě, před odečtením záloh. */
  taxCzk: Money;
  /** Daň při druhém způsobu zdanění dividend — jen když rok nějaké má. */
  otherVariantTaxCzk: Money | null;
  /** Paušalista po prolomení limitu: k dani přibývá pojistné a přehledy (R-08e). */
  flatTaxBroken: boolean;
  /**
   * Zálohy na daň z paušálního režimu, které se od daně odečtou. `null`, když
   * se neodečítají: limit prolomený není, nebo výši zálohy pro ten rok
   * neznáme (R-15e).
   */
  advances: { totalCzk: Money; monthlyCzk: Money; months: number } | null;
  /** Doplatek = daň − zálohy, nejmíň nula. `null`, když se zálohy neodečítají. */
  dueCzk: Money | null;
}

export function taxSummary(result: Pick<TaxYearResult, 'tax' | 'limits' | 'dividends'>): TaxSummary {
  const impact = result.limits.flatTax50k.breachImpact;
  const variant: DividendTaxation = impact ? 'GENERAL' : result.tax.recommended;
  const taxOf = (taxation: DividendTaxation): Money =>
    taxation === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;
  // bez známé výše zálohy (`monthlyAdvanceCzk`) engine neodečítá nic
  const advancesKnown = impact !== null && impact.monthlyAdvanceCzk !== null;
  return {
    variant,
    taxCzk: impact ? impact.taxCzk : taxOf(variant),
    otherVariantTaxCzk: result.dividends.base8Czk.gt(0)
      ? taxOf(variant === 'GENERAL' ? 'SEPARATE_16A' : 'GENERAL')
      : null,
    flatTaxBroken: impact !== null,
    advances: advancesKnown
      ? {
          totalCzk: impact.advancesCreditCzk,
          monthlyCzk: impact.advancesCreditCzk.div(impact.advanceMonths),
          months: impact.advanceMonths,
        }
      : null,
    dueCzk: advancesKnown ? impact.additionalTaxCzk : null,
  };
}
