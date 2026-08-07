import { desc, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { Db } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { user } from '@/db/schema';
import { purchaseConfirmationEmail, resolveEmailSender, subscriptionRenewalEmail } from '@/lib/email';
import { czDate } from '@/lib/format';
import { hasActiveSubscription, isPaidSubscription } from '@/lib/entitlements';
import { errorText, logEvent } from '@/lib/log';
import { checkRateLimit } from '@/lib/rate-limit';
import { stripe } from '@/lib/stripe';

/**
 * Zápis výsledků plateb do databáze (docs/19). Volá se z webhooku, který chodí
 * i opakovaně a MIMO POŘADÍ — všechno tady proto musí být idempotentní a stav
 * předplatného se přepisuje jen událostí novější, než ze které pochází uložený
 * stav (C-3, viz `acceptsEvent`).
 */

/** Cena za rok podkladů a za roční hlídání (docs/19 §1) — do potvrzovacího e-mailu. */
const PRICE_REPORT_CZK = 490;
const PRICE_SUBSCRIPTION_CZK = 990;

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
 * Smí událost přepsat uložený stav předplatného? (C-3)
 *
 * Stripe pořadí doručení negarantuje a `subscriptions` má jeden řádek na
 * uživatele, takže bez téhle brány vyhraje poslední doručená událost — i kdyby
 * byla o týden starší nebo o úplně jiném předplatném. Reálný scénář: staré
 * předplatné doběhne dunning a pošle `deleted` až potom, co si zákazník koupil
 * nové a zaplatil do příštího roku; přepis by mu sebral přístup, za který
 * právě zaplatil, a poslal ho ke starému zákazníkovi v portálu.
 *
 * - TÉHOŽ předplatného: starší událost zahodit (stejný čas projde — je to
 *   opakované doručení téže události a zápis je idempotentní),
 * - JINÉHO předplatného: zpracovat jen ostře novější,
 * - bez uložené známky (ruční grant, vazba z checkoutu): pustit.
 */
export function acceptsEvent(
  stored: StoredSubscription | undefined,
  incoming: { stripeSubscriptionId: string | null; eventAt: Date },
): boolean {
  if (!stored?.lastEventAt) return true;
  const sameSubscription =
    stored.stripeSubscriptionId === null ||
    stored.stripeSubscriptionId === incoming.stripeSubscriptionId;
  return sameSubscription
    ? incoming.eventAt.getTime() >= stored.lastEventAt.getTime()
    : incoming.eventAt.getTime() > stored.lastEventAt.getTime();
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
  if (!acceptsEvent(stored, { stripeSubscriptionId: state.stripeSubscriptionId ?? null, eventAt })) {
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
  return { written: true, unlocked: !wasPaid && isPaid };
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
  // vrací, jestli řádek opravdu vznikl — podle toho se pozná první doručení
  // webhooku a pošle se potvrzovací e-mail jen jednou
  const inserted = await db
    .insert(reportPurchases)
    .values({
      userId: args.userId,
      taxYear: args.taxYear,
      stripePaymentIntentId: args.stripePaymentIntentId ?? null,
      stripeCustomerId: args.stripeCustomerId ?? null,
      promoCode: args.promoCode ?? null,
      consentAt: args.consentAt ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: reportPurchases.id });
  if (inserted.length === 0) {
    // Druhá platba za tentýž rok narazí na unique index. Tiché zahození by
    // znamenalo peníze na účtu bez protiplnění a bez jakékoli stopy — tohle je
    // jediné místo, odkud se dá dohledat, komu se má vrátit (C-6).
    logEvent('error', 'billing.duplicate_report_purchase', {
      userId: args.userId,
      taxYear: args.taxYear,
      paymentIntentId: args.stripePaymentIntentId ?? null,
    });
  }
  return inserted.length > 0;
}

/**
 * Potvrzení o uzavření smlouvy (§ 1824a OZ). Selhání odeslání nesmí shodit
 * webhook — platba proběhla, e-mail se dá poslat znovu, ale opakovaný 500 by
 * Stripe zbytečně zkoušel dokola.
 */
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
export type PurchaseBlock = 'prilis-casto' | 'uz-mas-predplatne' | 'mas-v-predplatnem';

/**
 * Vstupní kontrola nákupu (C-12, C-3c, C-6). Vrací důvod odmítnutí, nebo null.
 *
 * - rate limit: nákupní akce ho jako jediné neměly, přestože upload i export ano,
 * - dvě předplatná vedle sebe nedávají smysl a rozjela by se z nich dvě různá
 *   Stripe předplatná téhož uživatele,
 * - podklady za rok, který má předplatitel v ceně hlídání, se neprodávají.
 */
export async function purchaseBlock(
  db: Db,
  userId: string,
  kind: 'subscription' | 'report',
  now = new Date(),
): Promise<PurchaseBlock | null> {
  if (!(await checkRateLimit(db, `checkout:${userId}`, { max: 10, windowMs: 10 * 60_000 }))) {
    return 'prilis-casto';
  }
  if (await hasActiveSubscription(db, userId, now)) {
    return kind === 'subscription' ? 'uz-mas-predplatne' : 'mas-v-predplatnem';
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
 */
async function revokeReportPurchase(
  db: Db,
  paymentIntentId: string | null,
  reason: string,
): Promise<number> {
  if (!paymentIntentId) return 0;
  const removed = await db
    .delete(reportPurchases)
    .where(eq(reportPurchases.stripePaymentIntentId, paymentIntentId))
    .returning({ userId: reportPurchases.userId, taxYear: reportPurchases.taxYear });
  logEvent(removed.length > 0 ? 'warn' : 'info', 'billing.report_purchase_revoked', {
    reason,
    paymentIntentId,
    removed: removed.length,
    userId: removed[0]?.userId ?? null,
    taxYear: removed[0]?.taxYear ?? null,
  });
  return removed.length;
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
        if (!Number.isInteger(taxYear)) {
          logEvent('error', 'billing.purchase_without_year', { sessionId: session.id });
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
            PRICE_REPORT_CZK,
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
          PRICE_SUBSCRIPTION_CZK,
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
      const removed = await revokeReportPurchase(db, idOf(charge.payment_intent), 'refund');
      return `refundace ${charge.id}: podklady ${removed}`;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object;
      const removed = await revokeReportPurchase(db, idOf(dispute.payment_intent), 'dispute');
      const ended = await endSubscriptionPeriod(
        db,
        await customerOfCharge(dispute.charge),
        eventTime(event),
        'dispute',
      );
      return `reklamace platby ${dispute.id}: podklady ${removed}, předplatné ${ended ? 'ukončeno' : 'beze změny'}`;
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

  const result: ReconcileResult = { checked: 0, updated: 0, linked: 0, failed: 0 };

  for (const row of rows) {
    if (row.source !== 'stripe') continue;
    if (!row.stripeCustomerId && !row.stripeSubscriptionId) continue;
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
      await upsertSubscription(db, state);
      logEvent('warn', 'billing.reconcile_fixed', {
        userId: row.userId,
        from: row.status,
        to: state.status,
      });
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

  return result;
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
      noticeSentFor: subscriptions.renewalNoticeSentFor,
    })
    .from(subscriptions)
    .innerJoin(user, eq(user.id, subscriptions.userId));

  const due = rows.filter(
    (row) =>
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
          priceCzk: PRICE_SUBSCRIPTION_CZK,
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
