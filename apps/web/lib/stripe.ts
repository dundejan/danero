import Stripe from 'stripe';

/**
 * Stripe klient a konfigurace (docs/19). Klíč jen z env — nikdy v kódu.
 * Hostovaný Checkout záměrně: neredirectujeme přes Stripe.js, takže se nemusí
 * rozvolňovat CSP (`default-src 'self'`), která je jinak přísná.
 */
let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY není nastaven — platby jsou vypnuté.');
  client ??= new Stripe(key);
  return client;
}

export interface StripePrices {
  report: string;
  subscription: string;
}

export function stripePrices(): StripePrices {
  const report = process.env.STRIPE_PRICE_REPORT;
  const subscription = process.env.STRIPE_PRICE_SUBSCRIPTION;
  if (!report || !subscription) {
    throw new Error('Chybí STRIPE_PRICE_REPORT nebo STRIPE_PRICE_SUBSCRIPTION.');
  }
  return { report, subscription };
}

/** Veřejná URL aplikace pro návratové odkazy z Checkoutu. */
export function appUrl(): string {
  return process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

/**
 * Použitý promokód z dokončené Checkout session — podklad pro výplaty partnerům
 * (docs/19). Stripe ho vrací jen po rozbalení `total_details.breakdown`.
 */
export function promoCodeFrom(session: Stripe.Checkout.Session): string | null {
  const discount = session.total_details?.breakdown?.discounts?.[0]?.discount;
  if (!discount) return null;
  const promo = discount.promotion_code;
  // rozbalený objekt jen když si ho vyžádáme přes `expand`; jinak přijde ID
  return typeof promo === 'string' ? promo : (promo?.code ?? null);
}
