import { and, desc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { Db } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { user } from '@/db/schema';
import { purchaseConfirmationEmail, resolveEmailSender, subscriptionRenewalEmail } from '@/lib/email';
import { czDate } from '@/lib/format';
import {
  hasActiveSubscription,
  hasUnsettledSubscription,
  isPaidSubscription,
  isPlausibleTaxYear,
  isSellableTaxYear,
} from '@/lib/entitlements';
import { errorText, logEvent } from '@/lib/log';
import { PRICE_REPORT_CZK, PRICE_SUBSCRIPTION_CZK } from '@/lib/pricing';
import { checkRateLimit } from '@/lib/rate-limit';
import { stripe } from '@/lib/stripe';

/**
 * Zápis výsledků plateb do databáze (docs/19). Volá se z webhooku, který chodí
 * i opakovaně a MIMO POŘADÍ — všechno tady proto musí být idempotentní a stav
 * předplatného se přepisuje jen událostí novější, než ze které pochází uložený
 * stav (C-3, viz `acceptsEvent`).
 */

// Ceny mají jediný zdroj pravdy (lib/pricing.ts) — dvě kopie by se dřív nebo
// později rozešly a zákazník by viděl jinou cenu v ceníku a jinou v potvrzení.

/** ID ze Stripe pole, které může přijít rozbalené jako objekt. */
function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

/** Čas, kdy událost vznikla ve Stripe (vteřiny → Date). */
function eventTime(event: Stripe.Event): Date {
  return new Date(event.created * 1000);
}

interface StoredSubscription {
  status: string;
  currentPeriodEnd: Date;
  stripeSubscriptionId: string | null;
  lastEventAt: Date | null;
}

/**
 * Smí událost přepsat uložený stav předplatného? (C-3, C-20)
 *
 * Stripe pořadí doručení negarantuje a `subscriptions` má jeden řádek na
 * uživatele, takže bez téhle brány vyhraje poslední doručená událost — i kdyby
 * byla o týden starší nebo o úplně jiném předplatném.
 *
 * - TÉHOŽ předplatného: rozhoduje čas události, starší se zahodí (stejný čas
 *   projde — je to opakované doručení téže události a zápis je idempotentní),
 * - JINÉHO předplatného: čas NErozhoduje. Dunning starého předplatného trvá
 *   dny, takže jeho `deleted` skoro vždy dorazí AŽ POTOM, co si zákazník koupil
 *   a zaplatil nové (C-20) — a je to událost pravdivá i čerstvá, jen o něčem,
 *   co už zákazníka nezajímá. Rozhoduje proto stejné pořadí jako v rekonciliaci
 *   (`bestSubscription`): zaplacené vyhrává, při shodě pozdější konec období.
 *   Opačný případ — řádek drží mrtvé předplatné a přijde událost o novém
 *   zaplaceném — projde, protože zaplacené vyhrává nad nezaplaceným.
 * - bez uložené známky (ruční grant, vazba z checkoutu): pustit.
 *
 * Zbytkové riziko (zákazník má ve Stripe zrušeno, ale řádek drží staré
 * zaplacené předplatné, o kterém událost nikdy nedorazila) padá na denní
 * rekonciliaci — ta se ptá Stripe a řádek srovná do 24 h.
 */
export function acceptsEvent(
  stored: StoredSubscription | undefined,
  incoming: {
    stripeSubscriptionId: string | null;
    status: string;
    currentPeriodEnd: Date;
    eventAt: Date;
  },
  now = new Date(),
): boolean {
  if (!stored?.lastEventAt) return true;
  const sameSubscription =
    stored.stripeSubscriptionId === null ||
    stored.stripeSubscriptionId === incoming.stripeSubscriptionId;
  if (sameSubscription) {
    const rozdil = incoming.eventAt.getTime() - stored.lastEventAt.getTime();
    if (rozdil > 0) return true;
    if (rozdil < 0) return false;
    // C-3-10: shodná vteřina. Stripe posílá `deleted` a `updated` běžně
    // v tomtéž `created`, takže se pořadí z časové známky poznat nedá —
    // a `>=` nechalo vyhrát to, co dorazilo druhé: po `deleted(canceled)`
    // přišlo `updated(active)` a v DB zůstalo aktivní předplatné.
    // Při shodě proto NIKDY neodemykáme; opačný směr (zamknout) projde.
    return !(isPaidSubscription(incoming, now) && !isPaidSubscription(stored, now));
  }

  const storedPaid = isPaidSubscription(stored, now);
  const incomingPaid = isPaidSubscription(incoming, now);
  if (storedPaid !== incomingPaid) return incomingPaid;
  if (incoming.currentPeriodEnd.getTime() !== stored.currentPeriodEnd.getTime()) {
    return incoming.currentPeriodEnd.getTime() > stored.currentPeriodEnd.getTime();
  }
  return incoming.eventAt.getTime() > stored.lastEventAt.getTime();
}

export interface SubscriptionState {
  userId: string;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  promoCode?: string | null;
  consentAt?: Date | null;
  /** Čas události/dotazu, ze kterého stav pochází; `null` = ruční grant. */
  eventAt?: Date | null;
}

/** Předplatné ze Stripe → naše tabulka. */
export async function upsertSubscription(db: Db, args: SubscriptionState): Promise<void> {
  const base = {
    userId: args.userId,
    status: args.status,
    currentPeriodEnd: args.currentPeriodEnd,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    source: 'stripe',
    lastEventAt: args.eventAt ?? null,
    updatedAt: new Date(),
  };
  // Nepovinná pole se přepisují, JEN když je událost nese: obnova předplatného
  // promokód ani souhlas neposílá a přepsat je na null by zahodilo podklad pro
  // výplaty partnerům (docs/19 §4) i důkaz žádosti dle § 1837 písm. l OZ.
  const optional = {
    ...(args.stripeCustomerId ? { stripeCustomerId: args.stripeCustomerId } : {}),
    ...(args.stripeSubscriptionId ? { stripeSubscriptionId: args.stripeSubscriptionId } : {}),
    ...(args.promoCode ? { promoCode: args.promoCode } : {}),
    ...(args.consentAt ? { consentAt: args.consentAt } : {}),
  };
  const values = { ...base, ...optional };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

async function storedSubscription(db: Db, userId: string): Promise<StoredSubscription | undefined> {
  const [row] = await db
    .select({
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      lastEventAt: subscriptions.lastEventAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return row;
}

/**
 * Zápis stavu předplatného přes bránu pořadí. Vrací, jestli se zapsalo a jestli
 * se tím přístup POPRVÉ odemkl — na to visí potvrzení o uzavření smlouvy
 * (§ 1824a OZ), které se nesmí posílat při každé obnově ani při zrušení.
 */
async function writeSubscription(
  db: Db,
  state: SubscriptionState,
  now = new Date(),
): Promise<{ written: boolean; unlocked: boolean }> {
  const stored = await storedSubscription(db, state.userId);
  const eventAt = state.eventAt ?? now;
  const incoming = {
    stripeSubscriptionId: state.stripeSubscriptionId ?? null,
    status: state.status,
    currentPeriodEnd: state.currentPeriodEnd,
    eventAt,
  };
  if (!acceptsEvent(stored, incoming, now)) {
    logEvent('warn', 'billing.stale_subscription_event', {
      userId: state.userId,
      subscriptionId: state.stripeSubscriptionId ?? null,
      storedSubscriptionId: stored?.stripeSubscriptionId ?? null,
      eventAt: eventAt.toISOString(),
      storedEventAt: stored?.lastEventAt?.toISOString() ?? null,
    });
    return { written: false, unlocked: false };
  }
  const wasPaid = isPaidSubscription(stored, now);
  await upsertSubscription(db, { ...state, eventAt });
  const isPaid = isPaidSubscription(
    { status: state.status, currentPeriodEnd: state.currentPeriodEnd },
    now,
  );
  // C-3-09: `!wasPaid && isPaid` platí i po vybraném dunningu
  // (active → past_due → active), takže zákazník dostal potvrzení objednávky
  // podruhé. Potvrzení podle § 1824a se váže na UZAVŘENÍ smlouvy, a to je
  // nové předplatné — dunning běží pod tímtéž `stripeSubscriptionId`.
  // Rozhoduje stav, ze kterého se přechází, ne shoda ID: `incomplete` je
  // předplatné, které se ještě nikdy nerozběhlo (3DS výzva u prvního nákupu),
  // kdežto `past_due`/`unpaid` znamená, že aktivní už bylo a jen se doplácí.
  const NIKDY_NEBEZELO = new Set(['incomplete', 'incomplete_expired']);
  const prvniAktivace =
    !stored ||
    stored.stripeSubscriptionId !== (state.stripeSubscriptionId ?? null) ||
    NIKDY_NEBEZELO.has(stored.status);
  return { written: true, unlocked: prvniAktivace && !wasPaid && isPaid };
}

/** Jednorázový nákup podkladů; druhý webhook o téže platbě nic nezdvojí. */
export async function recordReportPurchase(
  db: Db,
  args: {
    userId: string;
    taxYear: number;
    stripePaymentIntentId?: string | null;
    stripeCustomerId?: string | null;
    promoCode?: string | null;
    consentAt?: Date | null;
  },
): Promise<boolean> {
  // vrací, jestli se rok opravdu odemkl — podle toho se pozná první doručení
  // webhooku a pošle se potvrzovací e-mail jen jednou
  const values = {
    userId: args.userId,
    taxYear: args.taxYear,
    stripePaymentIntentId: args.stripePaymentIntentId ?? null,
    stripeCustomerId: args.stripeCustomerId ?? null,
    promoCode: args.promoCode ?? null,
    consentAt: args.consentAt ?? null,
  };
  const inserted = await db
    .insert(reportPurchases)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: reportPurchases.id });
  if (inserted.length > 0) return true;

  // Řádek pro ten rok už existuje. Když ho zrušilo vrácení peněz a tohle je
  // JINÁ platba, koupil si zákazník rok znovu — a musí ho zase dostat.
  if (args.stripePaymentIntentId) {
    const revived = await db
      .update(reportPurchases)
      .set({ ...values, revokedAt: null, revokedReason: null })
      .where(
        and(
          eq(reportPurchases.userId, args.userId),
          eq(reportPurchases.taxYear, args.taxYear),
          isNotNull(reportPurchases.revokedAt),
          or(
            isNull(reportPurchases.stripePaymentIntentId),
            ne(reportPurchases.stripePaymentIntentId, args.stripePaymentIntentId),
          ),
        ),
      )
      .returning({ id: reportPurchases.id });
    if (revived.length > 0) {
      logEvent('warn', 'billing.report_purchase_repurchased', {
        userId: args.userId,
        taxYear: args.taxYear,
        paymentIntentId: args.stripePaymentIntentId,
      });
      return true;
    }
  }

  const [existing] = await db
    .select({ revokedAt: reportPurchases.revokedAt })
    .from(reportPurchases)
    .where(
      and(eq(reportPurchases.userId, args.userId), eq(reportPurchases.taxYear, args.taxYear)),
    );
  // Tatáž platba, kterou jsme už jednou vrátili (typicky ji znovu našla
  // rekonciliace v seznamu zaplacených sessions). Odemknout ji zpátky by
  // znamenalo dát protiplnění za peníze, které zákazník má u sebe.
  if (existing?.revokedAt) {
    logEvent('info', 'billing.revoked_purchase_left_locked', {
      userId: args.userId,
      taxYear: args.taxYear,
      paymentIntentId: args.stripePaymentIntentId ?? null,
    });
    return false;
  }
  // Druhá platba za tentýž rok narazí na unique index. Tiché zahození by
  // znamenalo peníze na účtu bez protiplnění a bez jakékoli stopy — tohle je
  // jediné místo, odkud se dá dohledat, komu se má vrátit (C-6).
  logEvent('error', 'billing.duplicate_report_purchase', {
    userId: args.userId,
    taxYear: args.taxYear,
    paymentIntentId: args.stripePaymentIntentId ?? null,
  });
  return false;
}

/**
 * Potvrzení o uzavření smlouvy (§ 1824a OZ). Selhání odeslání nesmí shodit
 * webhook — platba proběhla, e-mail se dá poslat znovu, ale opakovaný 500 by
 * Stripe zbytečně zkoušel dokola.
 */
/**
 * C-3-03: potvrzení objednávky musí uvádět, co jsme SKUTEČNĚ strhli, ne
 * ceníkovou konstantu. S partnerským kódem PARTNER20 se strhlo 392 Kč, zatímco
 * e-mail tvrdil „Cena: 490 Kč — cena je konečná". Stripe posílá částky
 * v haléřích; cizí měnu radši nepřevádíme (viz `renewalPriceCzk`).
 */
function paidCzkFrom(
  amountTotal: number | null | undefined,
  currency: string | null | undefined,
  fallbackCzk: number,
): number {
  if (typeof amountTotal !== 'number' || amountTotal < 0) return fallbackCzk;
  if (currency && currency.toLowerCase() !== 'czk') return fallbackCzk;
  return Number((amountTotal / 100).toFixed(2));
}

async function sendConfirmation(
  db: Db,
  userId: string,
  what: string,
  priceCzk: number,
  consentAt: Date | null,
  kind: 'subscription' | 'report',
): Promise<void> {
  try {
    const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (!row) return;
    await resolveEmailSender()({
      to: row.email,
      ...purchaseConfirmationEmail({ what, priceCzk, consentGiven: Boolean(consentAt), kind }),
    });
  } catch (error) {
    logEvent('error', 'billing.confirmation_email_failed', {
      userId,
      error: errorText(error),
    });
  }
}

/**
 * Zákazník ve Stripe pro daného uživatele — z předplatného, jinak z posledního
 * jednorázového nákupu. Slouží dvěma věcem: aby další Checkout nezaložil dalšího
 * zákazníka (C-3c) a aby se do zákaznického portálu s doklady dostal i ten, kdo
 * koupil jen podklady nebo komu předplatné doběhlo (E-4).
 */
export async function stripeCustomerFor(db: Db, userId: string): Promise<string | null> {
  const [subscription] = await db
    .select({ customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  if (subscription?.customerId) return subscription.customerId;
  const [purchase] = await db
    .select({ customerId: reportPurchases.stripeCustomerId })
    .from(reportPurchases)
    .where(eq(reportPurchases.userId, userId))
    .orderBy(desc(reportPurchases.createdAt))
    .limit(1);
  return purchase?.customerId ?? null;
}

/** Důvod, proč nákup nepustit dál — zároveň hodnota `?stav=` pro hlášku v UI. */
export type PurchaseBlock =
  | 'prilis-casto'
  | 'uz-mas-predplatne'
  | 'mas-v-predplatnem'
  | 'chyba-rok'
  | 'uz-mas-rok'
  | 'resi-se-platba';

/** Co se kupuje. Podklady bez daňového roku neexistují — proto ho typ vyžaduje. */
export type Purchase = { kind: 'subscription' } | { kind: 'report'; taxYear: number };

/**
 * Vstupní kontrola nákupu (C-12, C-3c, C-6, C-26, C-27). Vrací důvod odmítnutí,
 * nebo null. Jediné místo, kde se rozhoduje, jestli se smí založit Checkout —
 * server action ho jen zavolá, takže obejít UI nic nezmění.
 *
 * - rok mimo rozsah: dřív prošlo cokoli, včetně „roku 0" z chybějícího pole,
 * - rate limit: nákupní akce ho jako jediné neměly, přestože upload i export ano,
 * - dvě předplatná vedle sebe nedávají smysl a rozjela by se z nich dvě různá
 *   Stripe předplatná téhož uživatele,
 * - podklady za rok, který má předplatitel v ceně hlídání, se neprodávají,
 * - a ani rok, který už jednou zaplatil: unique index ho zachytil až ve
 *   webhooku, tedy ve chvíli, kdy jsou peníze pryč.
 *
 * Pořadí je schválně takové: nejdřív se odpoví na otázky, které se dají
 * zodpovědět z dat (rok mimo rozsah, „tohle už máš zaplacené"), a teprve pak
 * se sahá na rate limit. Kdo mačká tlačítko u roku, který má v ceně hlídání,
 * ať se dozví právě tohle — ne „Zkoušíš to moc často" po jedenáctém kliknutí
 * (nález C-3-13). Limit tak zůstává na to, k čemu je: na skutečné pokusy
 * o založení Checkoutu.
 */
export async function purchaseBlock(
  db: Db,
  userId: string,
  purchase: Purchase,
  now = new Date(),
): Promise<PurchaseBlock | null> {
  if (purchase.kind === 'report' && !isSellableTaxYear(purchase.taxYear, now)) return 'chyba-rok';
  if (await hasActiveSubscription(db, userId, now)) {
    return purchase.kind === 'subscription' ? 'uz-mas-predplatne' : 'mas-v-predplatnem';
  }
  // Dunning (`past_due`, `unpaid`, `paused`) přístup nedává, ale předplatné ve
  // Stripe pořád běží a nikdo ho neruší — druhý nákup by tedy vyrobil dvě
  // souběžná předplatná téhož zákazníka a po vybrání dluhu 2× 990 Kč (C-3-05).
  // Podkladů za jeden rok se to netýká, ty vedle sebe stát můžou.
  if (purchase.kind === 'subscription' && (await hasUnsettledSubscription(db, userId))) {
    return 'resi-se-platba';
  }
  if (purchase.kind === 'report') {
    const [owned] = await db
      .select({ id: reportPurchases.id })
      .from(reportPurchases)
      .where(
        and(
          eq(reportPurchases.userId, userId),
          eq(reportPurchases.taxYear, purchase.taxYear),
          isNull(reportPurchases.revokedAt),
        ),
      );
    if (owned) return 'uz-mas-rok';
  }
  // Až úplně na konci: sem se dostane jen pokus, ze kterého by SKUTEČNĚ vznikl
  // Checkout. Dřív limit ubíral i klikání na rok, který má uživatel dávno
  // zaplacený, a od jedenáctého kliknutí mu místo „Tohle už máš" odpovědělo
  // „Zkoušíš to moc často" (C-3-13).
  if (!(await checkRateLimit(db, `checkout:${userId}`, { max: 10, windowMs: 10 * 60_000 }))) {
    return 'prilis-casto';
  }
  return null;
}

/**
 * ID předplatného, které bude po smazání účtu potřeba zrušit ve Stripe. Čte se
 * PŘED smazáním, protože FK kaskáda řádek `subscriptions` zahodí — samotné
 * zrušení ale patří až za úspěšné smazání (heslo ověřuje teprve `deleteUser`).
 */
export async function pendingSubscriptionId(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ subscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return row?.subscriptionId ?? null;
}

/**
 * Zruší předplatné ve Stripe po smazání účtu. Bez toho by zákazníkovi chodila
 * platba za službu, kterou už nemá, a zrušit by si ji nemohl: do zákaznického
 * portálu se vchází jen přihlášením, které po smazání neexistuje.
 *
 * Selhání nesmí shodit už provedené smazání (právo na výmaz je silnější), ale
 * musí být hlasité — `stripeSubscriptionId` je v tu chvíli už jen v tomhle logu.
 */
export async function cancelStripeSubscription(
  subscriptionId: string,
  userId: string,
): Promise<void> {
  try {
    await stripe().subscriptions.cancel(subscriptionId);
    logEvent('info', 'billing.subscription_canceled_on_delete', { userId, subscriptionId });
  } catch (error) {
    logEvent('error', 'billing.cancel_on_delete_failed', {
      userId,
      subscriptionId,
      error: errorText(error),
    });
  }
}

/** Souhlas se zahájením plnění z metadat Checkoutu. */
function consentFrom(metadata: Stripe.Metadata | null | undefined): Date | null {
  const raw = metadata?.consentAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Promokód z pole `discounts`, které Stripe posílá i ve webhooku (bez expand). */
function promoRefFrom(session: Stripe.Checkout.Session): string | null {
  const fromDiscounts = session.discounts?.[0]?.promotion_code;
  if (fromDiscounts) return typeof fromDiscounts === 'string' ? fromDiscounts : fromDiscounts.code;
  // záloha: rozpad slev v total_details — ten ale Stripe pošle jen po `expand`
  const promo = session.total_details?.breakdown?.discounts?.[0]?.discount?.promotion_code;
  if (!promo) return null;
  return typeof promo === 'string' ? promo : promo.code;
}

/**
 * Použitý promokód z dokončené Checkout session — podklad pro výplaty partnerům
 * (docs/19 §4).
 *
 * Zrada: webhook nese `promotion_code` jako ID (`promo_…`), ne jako kód, který
 * zákazník napsal — a `total_details.breakdown`, ze kterého se to četlo dřív,
 * neposílá bez `expand` vůbec, takže se neukládalo nikdy nic. ID se proto
 * dotáhne na čitelný kód; když se to nepovede, uloží se aspoň ID, partner jde
 * dohledat i podle něj.
 */
export async function promoCodeFrom(session: Stripe.Checkout.Session): Promise<string | null> {
  const ref = promoRefFrom(session);
  if (!ref) return null;
  if (!ref.startsWith('promo_')) return ref;
  try {
    const promo = await stripe().promotionCodes.retrieve(ref);
    return promo.code ?? ref;
  } catch (error) {
    logEvent('warn', 'billing.promo_code_lookup_failed', { ref, error: errorText(error) });
    return ref;
  }
}

/** Konec zaplaceného období ze Stripe předplatného (vteřiny → Date). */
function periodEnd(subscription: Stripe.Subscription): Date {
  const item = subscription.items.data[0];
  const seconds = item?.current_period_end ?? 0;
  return new Date(seconds * 1000);
}

/** Stripe předplatné → stav pro naši tabulku. */
function stateFrom(
  subscription: Stripe.Subscription,
  userId: string,
  eventAt: Date,
): SubscriptionState {
  return {
    userId,
    status: subscription.status,
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    stripeCustomerId: idOf(subscription.customer),
    stripeSubscriptionId: subscription.id,
    consentAt: consentFrom(subscription.metadata),
    eventAt,
  };
}

/**
 * Vazba na zákazníka a předplatné z dokončeného Checkoutu. Stav předplatného
 * dorovná `customer.subscription.*` nebo denní rekonciliace; tady jde o to,
 * aby zaplacený zákazník nezůstal bez jediné stopy, kdyby ta událost nikdy
 * nedorazila (C-4) — bez `stripeCustomerId` nejde ani portál, ani rekonciliace.
 */
async function linkCheckoutSubscription(
  db: Db,
  args: {
    userId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    promoCode: string | null;
    consentAt: Date | null;
  },
): Promise<string> {
  const stored = await db
    .select({
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      promoCode: subscriptions.promoCode,
      consentAt: subscriptions.consentAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, args.userId));
  const row = stored[0];

  if (!row) {
    // 'incomplete' není mezi zaplacenými stavy, takže vazba sama nic neodemyká;
    // `lastEventAt` zůstává null — stav neznáme, takže ho smí přepsat cokoli
    await db
      .insert(subscriptions)
      .values({
        userId: args.userId,
        status: 'incomplete',
        currentPeriodEnd: new Date(0),
        source: 'stripe',
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        promoCode: args.promoCode,
        consentAt: args.consentAt,
      })
      .onConflictDoNothing();
    return `checkout předplatného pro ${args.userId} — uložena vazba na zákazníka`;
  }

  // událost o předplatném dorazila dřív: doplní se jen to, co v řádku chybí,
  // ať se nepřepíše čerstvější stav (promokód nese jen session, ne předplatné)
  const patch = {
    ...(row.stripeCustomerId || !args.stripeCustomerId
      ? {}
      : { stripeCustomerId: args.stripeCustomerId }),
    ...(row.stripeSubscriptionId || !args.stripeSubscriptionId
      ? {}
      : { stripeSubscriptionId: args.stripeSubscriptionId }),
    ...(row.promoCode || !args.promoCode ? {} : { promoCode: args.promoCode }),
    ...(row.consentAt || !args.consentAt ? {} : { consentAt: args.consentAt }),
  };
  if (Object.keys(patch).length > 0) {
    await db
      .update(subscriptions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(subscriptions.userId, args.userId));
  }
  return `checkout předplatného pro ${args.userId}`;
}

/**
 * Vrácení peněz zamyká přístup (C-8): po odstoupení do 14 dnů, refundaci nebo
 * chargebacku nesmí zůstat odemčeno. Nenajít odpovídající nákup je legitimní
 * (vrácená platba za předplatné, ruční refund mimo Danero) — jen se to zaloguje.
 *
 * Řádek se NEMAŽE, jen se označí (C-24, C-25): smazaný by ho denní rekonciliace
 * našla ve Stripe jako zaplacenou session a odemkla znovu, a vyhraná reklamace
 * by neměla co vrátit zpátky. Důvod se přepisuje schválně — po refundaci už
 * vyhraná reklamace přístup nevrací, peníze jsou u zákazníka.
 */
async function revokeReportPurchase(
  db: Db,
  paymentIntentId: string | null,
  reason: string,
): Promise<number> {
  if (!paymentIntentId) return 0;
  const revoked = await db
    .update(reportPurchases)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(eq(reportPurchases.stripePaymentIntentId, paymentIntentId))
    .returning({ userId: reportPurchases.userId, taxYear: reportPurchases.taxYear });
  logEvent(revoked.length > 0 ? 'warn' : 'info', 'billing.report_purchase_revoked', {
    reason,
    paymentIntentId,
    removed: revoked.length,
    userId: revoked[0]?.userId ?? null,
    taxYear: revoked[0]?.taxYear ?? null,
  });
  return revoked.length;
}

/**
 * Vrátí přístup, který sebrala reklamace (C-25). Vrací se JEN to, co zamkla
 * reklamace: když mezitím zákazník dostal peníze zpátky (`revokedReason`
 * přepsal refund), zůstává zamčeno.
 */
async function restoreReportPurchase(db: Db, paymentIntentId: string | null): Promise<number> {
  if (!paymentIntentId) return 0;
  const restored = await db
    .update(reportPurchases)
    .set({ revokedAt: null, revokedReason: null })
    .where(
      and(
        eq(reportPurchases.stripePaymentIntentId, paymentIntentId),
        eq(reportPurchases.revokedReason, 'dispute'),
      ),
    )
    .returning({ userId: reportPurchases.userId, taxYear: reportPurchases.taxYear });
  logEvent(restored.length > 0 ? 'warn' : 'info', 'billing.report_purchase_restored', {
    paymentIntentId,
    restored: restored.length,
    userId: restored[0]?.userId ?? null,
    taxYear: restored[0]?.taxYear ?? null,
  });
  return restored.length;
}

/** Ukončí zaplacené období předplatného daného zákazníka (chargeback, refundace). */
async function endSubscriptionPeriod(
  db: Db,
  customerId: string | null,
  at: Date,
  reason: string,
): Promise<boolean> {
  if (!customerId) return false;
  const updated = await db
    .update(subscriptions)
    .set({
      status: 'canceled',
      currentPeriodEnd: at,
      cancelAtPeriodEnd: true,
      // C-3-02: bez tohohle důvodu denní rekonciliace zámek do rána zrušila —
      // ve Stripe předplatné běží dál, chargeback ruší platbu, ne předplatné
      revokedReason: reason,
      lastEventAt: at,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .returning({ userId: subscriptions.userId });
  if (updated.length > 0) {
    logEvent('warn', 'billing.subscription_revoked', {
      reason,
      customerId,
      userId: updated[0]?.userId ?? null,
    });
  }
  return updated.length > 0;
}

/**
 * Srovná předplatné zákazníka se skutečným stavem ve Stripe (vyhraná reklamace).
 * Totéž, co dělá denní rekonciliace, jen hned — zákazník, kterému banka dala
 * za pravdu, nemá čekat do rána na přístup, za který zaplatil.
 */
async function resyncSubscription(db: Db, customerId: string | null, at: Date): Promise<boolean> {
  if (!customerId) return false;
  const [row] = await db
    .select({
      userId: subscriptions.userId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId));
  if (!row) return false;
  try {
    const actual = await currentSubscription(customerId, row.stripeSubscriptionId, at);
    if (!actual) return false;
    await upsertSubscription(db, stateFrom(actual, row.userId, at));
    // zámek po reklamaci padá, teprve když reklamaci vyhrajeme (C-3-02)
    await db
      .update(subscriptions)
      .set({ revokedReason: null, updatedAt: new Date() })
      .where(eq(subscriptions.userId, row.userId));
    logEvent('warn', 'billing.subscription_restored', { userId: row.userId, customerId });
    return true;
  } catch (error) {
    logEvent('error', 'billing.subscription_restore_failed', {
      customerId,
      error: errorText(error),
    });
    return false;
  }
}

/** Zákazník, kterému patří platba — dispute ho na rozdíl od charge nenese. */
async function customerOfCharge(charge: string | Stripe.Charge | null): Promise<string | null> {
  if (!charge) return null;
  if (typeof charge !== 'string') return idOf(charge.customer as string | { id: string } | null);
  try {
    const full = await stripe().charges.retrieve(charge);
    return idOf(full.customer as string | { id: string } | null);
  } catch (error) {
    logEvent('error', 'billing.charge_lookup_failed', { chargeId: charge, error: errorText(error) });
    return null;
  }
}

/**
 * Existuje uživatel, kterému má platba patřit? (C-23)
 *
 * Smazání účtu ruší předplatné ve Stripe, takže `customer.subscription.deleted`
 * s `metadata.userId` neexistujícího uživatele dorazí při KAŽDÉM takovém
 * smazání. Bez téhle kontroly na něm zápis narazí na cizí klíč, webhook vrátí
 * 500, Stripe to zkouší tři dny a při opakovaných selháních endpoint zakáže —
 * čímž by přestaly chodit i platby ostatních.
 */
async function knownUser(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  return Boolean(row);
}

/**
 * Jeden webhook event → změny v databázi. Vrací krátký popis pro log; neznámé
 * typy událostí tiše ignoruje (Stripe jich posílá víc, než si vyžádáme).
 */
export async function applyStripeEvent(db: Db, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    // async_payment_succeeded je druhá polovina odložených plateb (převod, SEPA):
    // completed dorazí hned a NEZAPLACENÁ, peníze až po dnech.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      if (!userId) {
        logEvent('error', 'billing.session_without_user', { sessionId: session.id });
        return 'session bez uživatele';
      }
      if (!(await knownUser(db, userId))) {
        logEvent('warn', 'billing.event_for_deleted_user', { type: event.type, userId });
        return `uživatel ${userId} už neexistuje — ${event.type} zahozena`;
      }
      // Dokončený checkout ≠ zaplaceno. Bez téhle kontroly by odložená platební
      // metoda odemkla podklady dřív, než peníze dorazí — a kdyby nedorazily
      // nikdy, zůstalo by odemčeno navždy (Stripe pošle async_payment_failed,
      // který nic nevrací zpět).
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        logEvent('info', 'billing.session_unpaid', {
          sessionId: session.id,
          paymentStatus: session.payment_status,
        });
        return `session ${session.id} zatím nezaplacená (${session.payment_status})`;
      }
      const promoCode = await promoCodeFrom(session);
      const customerId = idOf(session.customer);

      if (session.mode === 'payment') {
        const taxYear = Number(session.metadata?.taxYear);
        // Rok z metadat plníme sami, ale zaplacenou session s nesmyslným rokem
        // (nebo bez něj) nesmí webhook shodit dotazem mimo rozsah `integer` —
        // peníze na účtu bez záznamu se pak dohledávají jen z tohohle logu.
        if (!isPlausibleTaxYear(taxYear)) {
          logEvent('error', 'billing.purchase_without_year', {
            sessionId: session.id,
            userId,
            taxYear: session.metadata?.taxYear ?? null,
          });
          return 'nákup bez daňového roku';
        }
        const created = await recordReportPurchase(db, {
          userId,
          taxYear,
          stripePaymentIntentId: idOf(session.payment_intent),
          stripeCustomerId: customerId,
          promoCode,
          consentAt: consentFrom(session.metadata),
        });
        // e-mail jen při prvním doručení webhooku, ne při každém opakování
        if (created) {
          await sendConfirmation(
            db,
            userId,
            `Podklady k přiznání za rok ${taxYear}`,
            paidCzkFrom(session.amount_total, session.currency, PRICE_REPORT_CZK),
            consentFrom(session.metadata),
            'report',
          );
        }
        return `podklady ${taxYear} pro ${userId}`;
      }
      return await linkCheckoutSubscription(db, {
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: idOf(session.subscription),
        promoCode,
        consentAt: consentFrom(session.metadata),
      });
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      if (!userId) {
        logEvent('error', 'billing.subscription_without_user', { id: subscription.id });
        return 'předplatné bez uživatele';
      }
      // smazaný účet: předplatné se při mazání ruší, takže `deleted` o něm
      // dorazí vždycky — a cizí klíč by z webhooku udělal 500 (C-23)
      if (!(await knownUser(db, userId))) {
        logEvent('warn', 'billing.event_for_deleted_user', { type: event.type, userId });
        return `uživatel ${userId} už neexistuje — ${event.type} zahozena`;
      }
      // 'canceled' držíme do konce zaplaceného období — rozhoduje datum, ne stav
      const result = await writeSubscription(db, stateFrom(subscription, userId, eventTime(event)));
      if (!result.written) return `zastaralá událost o ${subscription.id} pro ${userId} — zahozena`;
      // Potvrzení patří k prvnímu odemčení, ne k prvnímu ŘÁDKU: první událost
      // může nést 'incomplete' nebo dorazit až po `updated` a potvrzení by pak
      // neodešlo nikdy (§ 1824a OZ).
      if (result.unlocked) {
        await sendConfirmation(
          db,
          userId,
          'Celoroční hlídání daní z investic (roční předplatné)',
          await renewalPriceCzk(subscription.id, idOf(subscription.customer)),
          consentFrom(subscription.metadata),
          'subscription',
        );
      }
      return `předplatné ${subscription.status} pro ${userId}`;
    }

    // Vrácené peníze musí zamknout podklady — jinak po odstoupení do 14 dnů
    // zůstane odemčeno (C-8).
    //
    // Předplatného se refundace ZÁMĚRNĚ nedotýká. Od C-3c má uživatel jednoho
    // zákazníka ve Stripe, takže vrácení 490 Kč za podklady se od vrácení
    // 990 Kč za hlídání nedá spolehlivě rozeznat (rozeznávat to podle toho,
    // jestli se nějaký nákup smazal, selže při opakovaném doručení webhooku —
    // podruhé už tam ten řádek není a přišel by o přístup platící zákazník).
    // Zrušit hlídání patří k refundaci ve Stripe: `customer.subscription.*`
    // stav dorovná hned a denní rekonciliace nejpozději do dne. U odstoupení
    // od ROČNÍ služby to sedí i právně — vrací se poměrná část a do konce
    // poskytnutého období služba běží (§ 1834 OZ, viz E-3).
    case 'charge.refunded': {
      const charge = event.data.object;
      // `charge.refunded` chodí i u ČÁSTEČNÉ refundace (C-24). Vrácených 20 Kč
      // z 490 je gesto, ne odstoupení od smlouvy — sebrat za ně celé podklady
      // by bylo horší než nevrátit nic. Zamyká se až vrácení celé částky.
      const refunded = charge.amount_refunded ?? 0;
      if (!charge.refunded && refunded < charge.amount) {
        logEvent('info', 'billing.partial_refund', {
          chargeId: charge.id,
          amount: charge.amount,
          amountRefunded: refunded,
        });
        return `částečná refundace ${charge.id} (${refunded} z ${charge.amount}): přístup zůstává`;
      }
      const removed = await revokeReportPurchase(db, idOf(charge.payment_intent), 'refund');
      return `refundace ${charge.id}: podklady ${removed}`;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object;
      const removed = await revokeReportPurchase(db, idOf(dispute.payment_intent), 'dispute');
      // Reklamovaná platba za PODKLADY nesmí sebrat hlídání: `endSubscriptionPeriod`
      // hledá jen podle zákazníka, takže chargeback 490 Kč ukončil i samostatné
      // předplatné za 990 Kč, které zákazník řádně platí (nález C-3-02).
      const ended =
        removed > 0
          ? false
          : await endSubscriptionPeriod(
              db,
              await customerOfCharge(dispute.charge),
              eventTime(event),
              'dispute',
            );
      return `reklamace platby ${dispute.id}: podklady ${removed}, předplatné ${ended ? 'ukončeno' : 'beze změny'}`;
    }

    // Reklamace skončila. Prohraná nechává zamčeno (peníze jsou pryč), ale
    // vyhraná — a stejně tak dotaz banky uzavřený bez chargebacku — musí
    // přístup vrátit: peníze zůstaly u nás, takže služba zákazníkovi patří
    // (C-25). Bez tohohle by placený zákazník zůstal zamčený natrvalo.
    case 'charge.dispute.closed': {
      const dispute = event.data.object;
      if (dispute.status !== 'won' && dispute.status !== 'warning_closed') {
        logEvent('warn', 'billing.dispute_lost', { disputeId: dispute.id, status: dispute.status });
        return `reklamace ${dispute.id} skončila jako ${dispute.status}: zůstává zamčeno`;
      }
      const restored = await restoreReportPurchase(db, idOf(dispute.payment_intent));
      const resumed = await resyncSubscription(
        db,
        await customerOfCharge(dispute.charge),
        eventTime(event),
      );
      return `reklamace ${dispute.id} vyhrána: podklady ${restored}, předplatné ${resumed ? 'obnoveno' : 'beze změny'}`;
    }

    // Odložená platba nakonec neprošla: nic se odemknout nesmí, a kdyby se
    // odemklo (dvojí doručení, ruční zásah), vrátí se to zpátky.
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object;
      const removed = await revokeReportPurchase(db, idOf(session.payment_intent), 'async_failed');
      logEvent('warn', 'billing.async_payment_failed', {
        sessionId: session.id,
        userId: session.client_reference_id ?? session.metadata?.userId ?? null,
        removed,
      });
      return `odložená platba ${session.id} selhala: podklady ${removed}`;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      if (!customerId) return 'faktura bez zákazníka';
      // stav si dorovná customer.subscription.updated; tohle je jen pro log,
      // ať je z monitoringu vidět, že někomu neprošla platba
      const [row] = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, customerId));
      logEvent('warn', 'billing.payment_failed', { userId: row?.userId ?? null });
      return `neúspěšná platba ${row?.userId ?? customerId}`;
    }

    /**
     * Upomínku před obnovou (E-1) posíláme z vlastního cronu (`sendRenewalNotices`),
     * ne odsud: interval `invoice.upcoming` se nastavuje jen v dashboardu Stripu
     * (API ho nevystavuje) a /podminky slibují konkrétních 14 dní — smluvní
     * závazek nemá viset na přepínači, který nejde ověřit z kódu. Událost tu
     * jen potvrdíme, ať z logu není vidět „ignorováno" a nikdo ji nezapojí
     * podruhé; e-mail by pak odešel dvakrát.
     */
    case 'invoice.upcoming':
      return 'nadcházející faktura — upomínku řeší cron, ne webhook';

    default:
      return `ignorováno: ${event.type}`;
  }
}

export interface ReconcileResult {
  /** Kolik uživatelů se porovnávalo se Stripe. */
  checked: number;
  /** Kolika se stav lišil a srovnal se. */
  updated: number;
  /** Kolika chyběl řádek úplně (událost nikdy nedorazila). */
  linked: number;
  /** Kolik zaplacených nákupů se našlo jen ve Stripe a doplnilo do databáze. */
  recovered: number;
  /** U kolika dotaz do Stripe selhal — příště znovu. */
  failed: number;
}

/** Předplatné zákazníka, které má rozhodovat: zaplacené vyhrává, pak nejpozdější konec období. */
function bestSubscription(candidates: Stripe.Subscription[], now: Date): Stripe.Subscription | null {
  const ranked = [...candidates].sort((a, b) => {
    const paid = Number(isPaidStripe(b, now)) - Number(isPaidStripe(a, now));
    if (paid !== 0) return paid;
    return periodEnd(b).getTime() - periodEnd(a).getTime();
  });
  return ranked[0] ?? null;
}

function isPaidStripe(subscription: Stripe.Subscription, now: Date): boolean {
  return isPaidSubscription(
    { status: subscription.status, currentPeriodEnd: periodEnd(subscription) },
    now,
  );
}

/**
 * Denní srovnání se Stripe (C-4). Webhook je nejlepší, co máme, ale ztracená
 * nebo trvale odmítnutá událost se sama nikdy nespraví: zaplacený zákazník by
 * zůstal bez přístupu a neplatící s ním. Rekonciliace se ptá Stripe na skutečný
 * stav a je zároveň pojistkou na pořadí událostí — ptá se přes ZÁKAZNÍKA, takže
 * najde i předplatné, o kterém řádek neví.
 *
 * Druhá půlka (C-21) jde opačným směrem: projde zaplacené Checkout sessions ve
 * Stripe a hledá platby, ke kterým v databázi NENÍ ŽÁDNÝ řádek. Bez toho byl
 * zákazník, jehož jediný webhook se ztratil, pro záchrannou síť neviditelný
 * navždy — a u jednorázových podkladů je ta událost jediná, která kdy přijde.
 *
 * Ruční granty (`source = 'grant'`) se nekontrolují, ty ve Stripe nejsou.
 */
export async function reconcileSubscriptions(db: Db, now = new Date()): Promise<ReconcileResult> {
  const rows = await db
    .select({
      userId: subscriptions.userId,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      source: subscriptions.source,
      revokedReason: subscriptions.revokedReason,
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions);
  const known = new Map(rows.map((row) => [row.userId, row]));

  // zákazníci z jednorázových nákupů, kterým řádek chybí úplně — přesně sem
  // spadne ztracená událost o založení předplatného
  const purchases = await db
    .select({ userId: reportPurchases.userId, customerId: reportPurchases.stripeCustomerId })
    .from(reportPurchases);
  const extra = new Map<string, string>();
  for (const purchase of purchases) {
    if (purchase.customerId && !known.has(purchase.userId)) {
      extra.set(purchase.userId, purchase.customerId);
    }
  }

  const result: ReconcileResult = { checked: 0, updated: 0, linked: 0, recovered: 0, failed: 0 };

  for (const row of rows) {
    if (row.source !== 'stripe') continue;
    if (!row.stripeCustomerId && !row.stripeSubscriptionId) continue;
    // C-3-02: přístup, který jsme odebrali my (reklamace platby), se srovnáním
    // se Stripe nesmí vrátit — ve Stripe předplatné běží dál, protože
    // chargeback ruší platbu, ne předplatné. Rozdíl je záměrný, jen ho hlásíme.
    if (row.revokedReason) {
      logEvent('warn', 'billing.reconcile_skipped_revoked', {
        userId: row.userId,
        reason: row.revokedReason,
      });
      continue;
    }
    result.checked += 1;
    try {
      const actual = await currentSubscription(row.stripeCustomerId, row.stripeSubscriptionId, now);
      if (!actual) {
        // ve Stripe už žádné předplatné není: zamknout (stav 'canceled' není
        // mezi zaplacenými), ale jen když si řádek myslí něco jiného
        if (row.status !== 'canceled') {
          await upsertSubscription(db, {
            userId: row.userId,
            status: 'canceled',
            currentPeriodEnd: row.currentPeriodEnd,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
            stripeCustomerId: row.stripeCustomerId,
            stripeSubscriptionId: row.stripeSubscriptionId,
            eventAt: now,
          });
          logEvent('warn', 'billing.reconcile_missing_in_stripe', { userId: row.userId });
          result.updated += 1;
        }
        continue;
      }
      const state = stateFrom(actual, row.userId, now);
      const same =
        row.status === state.status &&
        row.currentPeriodEnd.getTime() === state.currentPeriodEnd.getTime() &&
        row.cancelAtPeriodEnd === state.cancelAtPeriodEnd &&
        row.stripeSubscriptionId === state.stripeSubscriptionId;
      if (same) continue;
      // C-3-04: rekonciliace zapisuje napřímo (a musí — je autoritativní i pro
      // událost, která by prošla jako zastaralá), ale první odemčení si musí
      // všimnout sama. Zákazník, kterému se ztratil webhook, jinak nikdy
      // nedostal potvrzení o uzavření smlouvy (§ 1824a OZ).
      // hodnoty si vytáhneme dřív: `isPaidSubscription` je typový guard, takže
      // by za negací zúžil `row` na never
      const { userId, stripeCustomerId } = row;
      const wasPaid = isPaidSubscription(row, now);
      await upsertSubscription(db, state);
      logEvent('warn', 'billing.reconcile_fixed', {
        userId,
        from: row.status,
        to: state.status,
      });
      if (!wasPaid && isPaidSubscription(state, now)) {
        await sendConfirmation(
          db,
          userId,
          'Celoroční hlídání daní z investic (roční předplatné)',
          await renewalPriceCzk(state.stripeSubscriptionId ?? null, stripeCustomerId),
          state.consentAt ?? null,
          'subscription',
        );
      }
      result.updated += 1;
    } catch (error) {
      result.failed += 1;
      logEvent('error', 'billing.reconcile_failed', {
        userId: row.userId,
        error: errorText(error),
      });
    }
  }

  for (const [userId, customerId] of extra) {
    result.checked += 1;
    try {
      const actual = await currentSubscription(customerId, null, now);
      if (!actual) continue;
      await upsertSubscription(db, stateFrom(actual, userId, now));
      logEvent('warn', 'billing.reconcile_linked', { userId });
      result.linked += 1;
    } catch (error) {
      result.failed += 1;
      logEvent('error', 'billing.reconcile_failed', { userId, error: errorText(error) });
    }
  }

  const recovered = await recoverLostCheckouts(db, now);
  result.checked += recovered.checked;
  result.recovered += recovered.recovered;
  result.failed += recovered.failed;

  return result;
}

/**
 * Kolik dní zpátky se ve Stripe hledají platby, o kterých databáze neví.
 *
 * Stripe doručuje webhook 3 dny a pak to vzdá; s denním cronem je týden sedm
 * pokusů o záchranu i pro platbu, u které selhalo doručení úplně (výpadek,
 * zakázaný endpoint). Delší okno by jen vytahovalo tytéž zaplacené sessions
 * dokola — z každé je po jednom úspěšném zpracování řádek v databázi.
 */
const CHECKOUT_LOOKBACK_DAYS = 7;

/** Kolik stránek po 100 sessions se maximálně projde, ať cron neběží donekonečna. */
const CHECKOUT_MAX_PAGES = 10;

export interface RecoverResult {
  /** Kolik zaplacených sessions se prošlo. */
  checked: number;
  /** Kolik z nich v databázi chybělo a doplnilo se. */
  recovered: number;
  /** U kolika to selhalo — příště znovu. */
  failed: number;
}

/**
 * Platby, o kterých naše databáze neví (C-21).
 *
 * Rekonciliace předplatných umí jen srovnat řádky, které už existují. Kdo
 * zaplatil a jehož jediný webhook se ztratil, ale žádný řádek nemá — a je tedy
 * pro záchrannou síť neviditelný, přestože mu `success_url` napsala „funkce
 * jsou odemčené". Proto se ptáme Stripe na zaplacené Checkout sessions a
 * dohledáváme je zpátky na uživatele (`client_reference_id`).
 *
 * Vrácené peníze se tím neobnoví: nákup se při refundaci nemaže, jen zamyká,
 * takže `recordReportPurchase` pozná, že tuhle platbu už jednou vrátil.
 */
export async function recoverLostCheckouts(db: Db, now = new Date()): Promise<RecoverResult> {
  const result: RecoverResult = { checked: 0, recovered: 0, failed: 0 };
  const since = Math.floor((now.getTime() - CHECKOUT_LOOKBACK_DAYS * 86_400_000) / 1000);
  let startingAfter: string | undefined;

  for (let page = 0; page < CHECKOUT_MAX_PAGES; page += 1) {
    let batch: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      batch = await stripe().checkout.sessions.list({
        status: 'complete',
        created: { gte: since },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      result.failed += 1;
      logEvent('error', 'billing.recover_list_failed', { error: errorText(error) });
      return result;
    }

    for (const session of batch.data) {
      result.checked += 1;
      try {
        if (await recoverSession(db, session, now)) result.recovered += 1;
      } catch (error) {
        result.failed += 1;
        logEvent('error', 'billing.recover_failed', {
          sessionId: session.id,
          error: errorText(error),
        });
      }
    }

    if (!batch.has_more) break;
    startingAfter = batch.data[batch.data.length - 1]?.id;
    if (!startingAfter) break;
  }
  return result;
}

/** Jedna zaplacená session ze Stripe → chybějící řádek v databázi. */
async function recoverSession(
  db: Db,
  session: Stripe.Checkout.Session,
  now: Date,
): Promise<boolean> {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return false;
  }
  const userId = session.client_reference_id ?? session.metadata?.userId;
  if (!userId || !(await knownUser(db, userId))) return false;

  if (session.mode === 'payment') {
    const paymentIntentId = idOf(session.payment_intent);
    // bez ID platby se nedá poznat, jestli tenhle nákup už neznáme
    if (!paymentIntentId) return false;
    const [known] = await db
      .select({ id: reportPurchases.id })
      .from(reportPurchases)
      .where(eq(reportPurchases.stripePaymentIntentId, paymentIntentId));
    if (known) return false;
    const taxYear = Number(session.metadata?.taxYear);
    if (!isPlausibleTaxYear(taxYear)) {
      logEvent('error', 'billing.recover_without_year', { sessionId: session.id, userId });
      return false;
    }
    const consentAt = consentFrom(session.metadata);
    const created = await recordReportPurchase(db, {
      userId,
      taxYear,
      stripePaymentIntentId: paymentIntentId,
      stripeCustomerId: idOf(session.customer),
      promoCode: await promoCodeFrom(session),
      consentAt,
    });
    if (!created) return false;
    logEvent('warn', 'billing.recovered_report_purchase', { userId, taxYear, sessionId: session.id });
    // potvrzení o uzavření smlouvy (§ 1824a OZ) zákazníkovi nikdy nedorazilo
    await sendConfirmation(
      db,
      userId,
      `Podklady k přiznání za rok ${taxYear}`,
      paidCzkFrom(session.amount_total, session.currency, PRICE_REPORT_CZK),
      consentAt,
      'report',
    );
    return true;
  }

  // Předplatné: řádek s vazbou na zákazníka už rekonciliace výše vidí, takže
  // zachraňujeme jen toho, o kom nevíme vůbec nic.
  const [row] = await db
    .select({
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  if (row?.stripeCustomerId || row?.stripeSubscriptionId) return false;

  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);
  const consentAt = consentFrom(session.metadata);
  const promoCode = await promoCodeFrom(session);
  const actual = await currentSubscription(customerId, subscriptionId, now);
  if (!actual) {
    // ve Stripe už žádné předplatné neběží — aspoň uložíme vazbu na zákazníka,
    // ať ho zítřejší rekonciliace vidí a ať se zákazník dostane do portálu
    await linkCheckoutSubscription(db, {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      promoCode,
      consentAt,
    });
    logEvent('warn', 'billing.recovered_customer_link', { userId, sessionId: session.id });
    return true;
  }
  const state = stateFrom(actual, userId, now);
  const written = await writeSubscription(
    db,
    { ...state, promoCode, consentAt: state.consentAt ?? consentAt },
    now,
  );
  logEvent('warn', 'billing.recovered_subscription', { userId, sessionId: session.id });
  if (written.unlocked) {
    await sendConfirmation(
      db,
      userId,
      'Celoroční hlídání daní z investic (roční předplatné)',
      await renewalPriceCzk(actual.id, customerId),
      consentAt,
      'subscription',
    );
  }
  return true;
}

/**
 * Skutečné předplatné ve Stripe. Přes zákazníka (najde i to, o kterém náš řádek
 * neví), přes ID jen když zákazníka neznáme. Zmizelé předplatné = `null`.
 */
async function currentSubscription(
  customerId: string | null,
  subscriptionId: string | null,
  now: Date,
): Promise<Stripe.Subscription | null> {
  if (customerId) {
    const list = await stripe().subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 10,
    });
    return bestSubscription(list.data, now);
  }
  if (!subscriptionId) return null;
  try {
    return await stripe().subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') return null;
    throw error;
  }
}

/** Kolik dní předem se posílá upomínka — /podminky slibují 14. */
/**
 * Kolik dní před obnovou se otevírá okno upomínky.
 *
 * Slib v `/podminky`, `/cenik` i `/predplatne` zní **14 dní předem**. Okno je
 * proto o den širší: cron běží jednou denně ve 03:40 UTC, kdežto období končí
 * v okamžik nákupu (třeba v 10:00). Při okně přesně 14 dnů by první běh, který
 * do okna trefí, odeslal e-mail jen **13,26 dne** předem — tedy míň, než
 * podmínky slibují (nález E-24). S 15 dny odejde upomínka vždy 14–15 dní
 * předem a závazek je splnitelný i při posunu běhu cronu.
 */
const RENEWAL_NOTICE_DAYS = 15;

/**
 * Kolik se při obnově opravdu strhne (E-25).
 *
 * Konstanta 990 Kč je jen záloha pro případ, že se Stripe nedovoláme: Checkout
 * má zapnuté promokódy (docs/19 §4), takže zákazník se slevou by dostal e-mail
 * s cenou, která se mu nestrhne — a údaj o ceně před stržením musí být pravdivý
 * (§ 1811 odst. 2 písm. c OZ). Ptáme se proto na náhled nadcházející faktury,
 * kde je sleva i případný zůstatek zákazníka už započítaný.
 */
async function renewalPriceCzk(
  subscriptionId: string | null,
  customerId: string | null,
): Promise<number> {
  if (!subscriptionId && !customerId) return PRICE_SUBSCRIPTION_CZK;
  try {
    const invoice = await stripe().invoices.createPreview(
      subscriptionId ? { subscription: subscriptionId } : { customer: customerId! },
    );
    const amount = invoice.amount_due;
    if (typeof amount !== 'number' || amount < 0) return PRICE_SUBSCRIPTION_CZK;
    // e-mail mluví o korunách; cizí měnu radši nepřevádíme, ať v něm nevznikne
    // číslo, které nikde neplatí
    if (invoice.currency && invoice.currency !== 'czk') {
      logEvent('warn', 'billing.renewal_price_currency', {
        subscriptionId,
        currency: invoice.currency,
      });
      return PRICE_SUBSCRIPTION_CZK;
    }
    return Number((amount / 100).toFixed(2));
  } catch (error) {
    logEvent('warn', 'billing.renewal_price_failed', { subscriptionId, error: errorText(error) });
    return PRICE_SUBSCRIPTION_CZK;
  }
}

export interface RenewalNoticeResult {
  /** Kolik předplatných spadlo do okna 14 dnů před obnovou. */
  due: number;
  /** Kolika reálně odešel e-mail (zbytek už ho za tohle období dostal). */
  sent: number;
}

/**
 * Upomínka před automatickou obnovou (E-1 z auditu). `/podminky`, `/cenik`
 * i `/predplatne` slibují e-mail 14 dní předem; bez něj by šlo o tichý
 * auto-renew, který docs/19 §5 zakazuje.
 *
 * Proč vlastní cron a ne `invoice.upcoming`: interval té události se nastavuje
 * jen v dashboardu Stripu (v API není) a výchozí je 7 dní. Smluvní závazek
 * nemá viset na přepínači, který z kódu neověřím.
 *
 * `renewalNoticeSentFor` drží konec období, pro který už upomínka odešla —
 * cron tak může běžet klidně každou hodinu a e-mail odejde za období právě
 * jednou. Zrušené obnovy (`cancelAtPeriodEnd`) se přeskakují: tam se nic
 * nestrhne a upomínka by matoucí.
 */
export async function sendRenewalNotices(
  db: Db,
  now = new Date(),
): Promise<RenewalNoticeResult> {
  const window = new Date(now.getTime() + RENEWAL_NOTICE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      userId: subscriptions.userId,
      email: user.email,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      status: subscriptions.status,
      source: subscriptions.source,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      noticeSentFor: subscriptions.renewalNoticeSentFor,
    })
    .from(subscriptions)
    .innerJoin(user, eq(user.id, subscriptions.userId));

  const due = rows.filter(
    (row) =>
      // ruční grant (partner, přispěvatel) se neobnovuje a nic se nestrhne —
      // upomínka „obnoví se za 990 Kč" by u něj byla nepravdivá
      row.source === 'stripe' &&
      !row.cancelAtPeriodEnd &&
      isPaidSubscription(row, now) &&
      row.currentPeriodEnd <= window &&
      row.noticeSentFor?.getTime() !== row.currentPeriodEnd.getTime(),
  );

  let sent = 0;
  for (const row of due) {
    try {
      await resolveEmailSender()({
        to: row.email,
        ...subscriptionRenewalEmail({
          renewsOn: czDate(row.currentPeriodEnd),
          priceCzk: await renewalPriceCzk(row.stripeSubscriptionId, row.stripeCustomerId),
        }),
      });
      // značka až PO odeslání: když e-mail selže, zkusí se zítra znovu
      await db
        .update(subscriptions)
        .set({ renewalNoticeSentFor: row.currentPeriodEnd })
        .where(eq(subscriptions.userId, row.userId));
      sent += 1;
    } catch (error) {
      logEvent('error', 'billing.renewal_notice_failed', {
        userId: row.userId,
        error: errorText(error),
      });
    }
  }
  return { due: due.length, sent };
}
