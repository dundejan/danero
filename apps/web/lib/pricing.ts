/**
 * Ceny hostované služby na jednom místě (nález E-37).
 *
 * Do 7. 8. 2026 byly částky napsané ručně v šestnácti textech — ceníku,
 * podmínkách, poučení o odstoupení, FAQ, e-mailech i v aplikaci. Změna ceny
 * tak znamenala šestnáct ručních úprav a jedno opomenutí = jiná cena
 * u spotřebitele, než za jakou se strhne (§ 5 zákona 634/1992 Sb.).
 *
 * ⚠️ Autoritativní je pořád **Stripe Price** — tyhle konstanty musí sedět na
 * něj. Vlastní kopii má i `lib/billing.ts` (potvrzovací e-mail); až se sloučí,
 * zůstane jediný zdroj tady.
 */

/** Jednorázové podklady k přiznání za JEDEN daňový rok. */
export const PRICE_REPORT_CZK = 490;

/** Celoroční hlídání — roční předplatné. */
export const PRICE_SUBSCRIPTION_CZK = 990;

/** Kolik dní se počítá na rok při poměrném vrácení (§ 1834 OZ). */
const DAYS_IN_YEAR = 365;

/** Cena česky, s obyčejnou mezerou — texty i E2E hledají tvar „490 Kč“. */
export const priceLabel = (czk: number): string => `${czk} Kč`;

/**
 * Měsíční ekvivalent ročního předplatného. Zaokrouhluje se **nahoru**, protože
 * text u něj říká „necelých“ — dolů zaokrouhlená částka by slibovala míň, než
 * kolik se strhne.
 */
export const SUBSCRIPTION_PER_MONTH_CZK = Math.ceil(PRICE_SUBSCRIPTION_CZK / 12);

/** Denní ekvivalent, taky „necelé“ — 990 / 365 = 2,71 Kč. */
export const SUBSCRIPTION_PER_DAY_CZK = Math.ceil(PRICE_SUBSCRIPTION_CZK / DAYS_IN_YEAR);

/**
 * Kolik se vrátí při odstoupení po `days` dnech běžícího hlídání
 * (§ 1834 OZ — poměrná část za využité dny). Zaokrouhleno na celé koruny.
 */
export const refundAfterDays = (days: number): number =>
  Math.round(PRICE_SUBSCRIPTION_CZK * (1 - days / DAYS_IN_YEAR));
