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

/**
 * Běží aplikace na ostrém klíči? Webhook tím porovnává `event.livemode`
 * s režimem, ve kterém sami jsme (C-13) — tvrdé „jen livemode" by rozbilo
 * provoz v sandboxu, tohle chytí záměnu secretů v obou směrech.
 */
export function stripeLivemode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  // omezené klíče (restricted) mají prefix rk_, plné sk_
  return key.startsWith('sk_live_') || key.startsWith('rk_live_');
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

