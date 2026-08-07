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

/**
 * Běží ostrý provoz na zkušebním (sandboxovém) klíči? (C-29)
 *
 * Nasazená aplikace prodává za 490 a 990 Kč, ale se sandboxovým klíčem se
 * žádné peníze nepřevedou: „platba" projde testovací kartou a funkce se
 * odemknou zadarmo. Zákazník by přitom byl v dobré víře, že zaplatil.
 *
 * Poznává se to z prefixu klíče, ne z vlastní proměnné — druhá pravda by se
 * dala rozejít s tou první. Jakmile Jan nastaví `sk_live_…`, pojistka zmizí
 * sama, bez zásahu do kódu. Mimo produkci (vývoj, E2E, testy) nedělá nic:
 * tam je zkušební klíč to jediné správné.
 */
export function stripeSandboxInProduction(): boolean {
  if (process.env.NODE_ENV !== 'production') return false;
  // vlastní instance bez plateb žádný klíč nemá a nic neprodává
  if (!process.env.STRIPE_SECRET_KEY) return false;
  return !stripeLivemode();
}

/** Hláška do UI — jedna věta česky, bez žargonu, stejná všude. */
export const SANDBOX_NOTICE =
  'Platby tu teď běží ve zkušebním režimu: objednávka se nedokončí a nic se ti nestrhne. Než to spustíme naostro, je Danero pro tebe zdarma.';

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

