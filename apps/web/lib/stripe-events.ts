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
