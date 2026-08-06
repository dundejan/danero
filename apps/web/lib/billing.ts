import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { Db } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';
import { user } from '@/db/schema';
import { purchaseConfirmationEmail, resolveEmailSender } from '@/lib/email';
import { errorText, logEvent } from '@/lib/log';
import { promoCodeFrom, stripe } from '@/lib/stripe';

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
    consentAt?: Date | null;
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
    ...(args.consentAt ? { consentAt: args.consentAt } : {}),
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
      promoCode: args.promoCode ?? null,
      consentAt: args.consentAt ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: reportPurchases.id });
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
): Promise<void> {
  try {
    const [row] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
    if (!row) return;
    await resolveEmailSender()({
      to: row.email,
      ...purchaseConfirmationEmail({ what, priceCzk, consentGiven: Boolean(consentAt) }),
    });
  } catch (error) {
    logEvent('error', 'billing.confirmation_email_failed', {
      userId,
      error: errorText(error),
    });
  }
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
      const promoCode = promoCodeFrom(session);

      if (session.mode === 'payment') {
        const taxYear = Number(session.metadata?.taxYear);
        if (!Number.isInteger(taxYear)) {
          logEvent('error', 'billing.purchase_without_year', { sessionId: session.id });
          return 'nákup bez daňového roku';
        }
        const created = await recordReportPurchase(db, {
          userId,
          taxYear,
          stripePaymentIntentId:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          promoCode,
          consentAt: consentFrom(session.metadata),
        });
        // e-mail jen při prvním doručení webhooku, ne při každém opakování
        if (created) {
          await sendConfirmation(
            db,
            userId,
            `Podklady k přiznání za rok ${taxYear}`,
            490,
            consentFrom(session.metadata),
          );
        }
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
      const [existing] = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId));

      // 'canceled' držíme do konce zaplaceného období — rozhoduje datum, ne stav
      await upsertSubscription(db, {
        userId,
        status: subscription.status,
        currentPeriodEnd: periodEnd(subscription),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        stripeCustomerId:
          typeof subscription.customer === 'string' ? subscription.customer : null,
        stripeSubscriptionId: subscription.id,
        consentAt: consentFrom(subscription.metadata),
      });
      if (!existing && subscription.status === 'active') {
        await sendConfirmation(
          db,
          userId,
          'Celoroční hlídání daní z investic (roční předplatné)',
          990,
          consentFrom(subscription.metadata),
        );
      }
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
