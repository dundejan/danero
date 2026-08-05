import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { Db } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { logEvent } from '@/lib/log';
import { promoCodeFrom } from '@/lib/stripe';

/**
 * Zápis výsledků plateb do databáze (docs/19). Volá se z webhooku, který chodí
 * i opakovaně — všechno tady proto musí být idempotentní.
 */

/** Předplatné ze Stripe → naše tabulka. */
export async function upsertSubscription(
  db: Db,
  args: {
    userId: string;
    status: string;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    promoCode?: string | null;
  },
): Promise<void> {
  const values = {
    userId: args.userId,
    status: args.status,
    currentPeriodEnd: args.currentPeriodEnd,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    source: 'stripe',
    stripeCustomerId: args.stripeCustomerId ?? null,
    stripeSubscriptionId: args.stripeSubscriptionId ?? null,
    promoCode: args.promoCode ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

/** Jednorázový nákup podkladů; druhý webhook o téže platbě nic nezdvojí. */
export async function recordReportPurchase(
  db: Db,
  args: {
    userId: string;
    taxYear: number;
    stripePaymentIntentId?: string | null;
    promoCode?: string | null;
  },
): Promise<void> {
  await db
    .insert(reportPurchases)
    .values({
      userId: args.userId,
      taxYear: args.taxYear,
      stripePaymentIntentId: args.stripePaymentIntentId ?? null,
      promoCode: args.promoCode ?? null,
    })
    .onConflictDoNothing();
}

/** Konec zaplaceného období ze Stripe předplatného (vteřiny → Date). */
function periodEnd(subscription: Stripe.Subscription): Date {
  const item = subscription.items.data[0];
  const seconds = item?.current_period_end ?? 0;
  return new Date(seconds * 1000);
}

/**
 * Jeden webhook event → změny v databázi. Vrací krátký popis pro log; neznámé
 * typy událostí tiše ignoruje (Stripe jich posílá víc, než si vyžádáme).
 */
export async function applyStripeEvent(db: Db, event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      if (!userId) {
        logEvent('error', 'billing.session_without_user', { sessionId: session.id });
        return 'session bez uživatele';
      }
      const promoCode = promoCodeFrom(session);

      if (session.mode === 'payment') {
        const taxYear = Number(session.metadata?.taxYear);
        if (!Number.isInteger(taxYear)) {
          logEvent('error', 'billing.purchase_without_year', { sessionId: session.id });
          return 'nákup bez daňového roku';
        }
        await recordReportPurchase(db, {
          userId,
          taxYear,
          stripePaymentIntentId:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          promoCode,
        });
        return `podklady ${taxYear} pro ${userId}`;
      }
      // předplatné dorovná následující customer.subscription.* event, tady jen
      // uložíme vazbu na zákazníka, ať ji máme i kdyby další event nedorazil
      return `checkout ${session.mode} pro ${userId}`;
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
      await upsertSubscription(db, {
        userId,
        status: subscription.status,
        currentPeriodEnd: periodEnd(subscription),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        stripeCustomerId:
          typeof subscription.customer === 'string' ? subscription.customer : null,
        stripeSubscriptionId: subscription.id,
      });
      return `předplatné ${subscription.status} pro ${userId}`;
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

    default:
      return `ignorováno: ${event.type}`;
  }
}
