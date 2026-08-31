/**
 * Typy událostí Stripe, které kód obsluhuje — a na které tedy MUSÍ být
 * přihlášený webhook endpoint.
 *
 * Vlastní soubor bez závislostí schválně: `lib/billing.ts` si tahá databázi,
 * takže by ho ověřovací skript nemohl naimportovat.
 *
 * Bez tohohle seznamu se vazba na konfiguraci ve Stripe nedala zkontrolovat.
 * Endpoint byl přihlášený jen k pěti typům, takže `charge.refunded`,
 * `charge.dispute.created` ani `checkout.session.async_payment_*` nikdy
 * nedorazily: obsluha refundací a reklamací byla v produkci mrtvá, přestože
 * v kódu je a má testy (nález C-22). Rozchod byl mezi repozitářem a cizí
 * službou, takže ho neukázalo CI ani typecheck.
 *
 * Kontrola i náprava: `node scripts/stripe-webhook.mjs check|fix`.
 */
export const HANDLED_STRIPE_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'invoice.payment_failed',
  'invoice.upcoming',
] as const;

/**
 * Verze Stripe API, ve které kód čte doručené události.
 *
 * Webhookový endpoint si ve Stripe drží VLASTNÍ `api_version` — nezávisle na
 * verzi, kterou posílá SDK v odchozích dotazech. Rozejít se to umí úplně tiše:
 * ve verzi `2025-03-31.basil` se `current_period_end` přestěhovalo
 * z předplatného do jeho položek, takže endpoint připnutý ke starší verzi
 * doručuje tvar, ve kterém konec zaplaceného období není tam, kde ho čekáme —
 * a platící zákazník zůstane zamčený (nález K5-04). Naostro se to stalo
 * 9. 8. 2026, jen se to chytilo těsně před první skutečnou platbou.
 *
 * Hodnota musí sedět na `Stripe.API_VERSION` ze SDK; hlídá to test
 * v `test/billing.test.ts`, takže povýšení SDK si o srovnání endpointu řekne
 * samo. Stav ve Stripe ověří `node scripts/stripe-webhook.mjs check`.
 */
export const EXPECTED_STRIPE_API_VERSION = '2026-07-29.dahlia';

/**
 * Co je špatně na `api_version` webhookového endpointu? Vrací větu pro
 * `scripts/stripe-webhook.mjs`, nebo `null`, když je všechno v pořádku.
 *
 * `null` na endpointu znamená „posílej události ve verzi výchozí pro účet" —
 * a tu Stripe přes API nevystavuje, takže se nedá ověřit vůbec nijak. Pro
 * veřejné repo, kde si endpoint zakládá každý provozovatel sám, je to stejné
 * riziko jako stará verze.
 */
export function webhookApiVersionProblem(apiVersion: string | null): string | null {
  if (apiVersion === EXPECTED_STRIPE_API_VERSION) return null;
  if (!apiVersion) {
    return `verze API není připnutá — události chodí ve verzi výchozí pro účet, kterou z API nezjistíme; připni ${EXPECTED_STRIPE_API_VERSION}`;
  }
  return `verze API ${apiVersion}, ale kód čte události ve verzi ${EXPECTED_STRIPE_API_VERSION} — pole se mezi verzemi stěhují (v 2025-03-31.basil třeba current_period_end) a pozná se to až rozbitým předplatným`;
}
