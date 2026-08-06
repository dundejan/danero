import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { createPgliteDb } from '@/db';
import { user } from '@/db/schema';
import { applyStripeEvent, cancelStripeSubscription, pendingSubscriptionId } from '@/lib/billing';
import { canGenerateReport, hasActiveSubscription } from '@/lib/entitlements';

/** Stripe klient je jediné, co v testech nahrazujeme — po síti nechodíme. */
const zrusena: string[] = [];
vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  stripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        zrusena.push(id);
        return { id, status: 'canceled' };
      },
    },
  }),
}));

/**
 * Zpracování Stripe událostí (docs/19). Webhook chodí i opakovaně a mimo pořadí,
 * takže hlavní vlastnost, kterou testujeme, je idempotence.
 */

const checkoutEvent = (overrides: Record<string, unknown>, type = 'checkout.session.completed') =>
  ({
    type,
    data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', ...overrides } },
  }) as unknown as Stripe.Event;

const subscriptionEvent = (overrides: Record<string, unknown>) =>
  ({
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        cancel_at_period_end: false,
        items: { data: [{ current_period_end: 1798761600 }] }, // 2027-01-01
        metadata: { userId: 'u1' },
        ...overrides,
      },
    },
  }) as unknown as Stripe.Event;

async function dbWithUser() {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  return db;
}

describe('zpracování plateb ze Stripe', () => {
  it('nákup podkladů odemkne jen zaplacený rok', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_1',
      }),
    );

    expect(await canGenerateReport(db, 'u1', 2026)).toBe(true);
    expect(await canGenerateReport(db, 'u1', 2025)).toBe(false);
    delete process.env.DANERO_BILLING;
  });

  it('opakovaný webhook o téže platbě nic nezdvojí', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const event = checkoutEvent({
      client_reference_id: 'u1',
      metadata: { userId: 'u1', taxYear: '2026' },
    });

    await applyStripeEvent(db, event);
    await applyStripeEvent(db, event);

    const { reportPurchases } = await import('@/db/schema');
    expect(await db.select().from(reportPurchases)).toHaveLength(1);
  });

  it('předplatné se uloží i s koncem zaplaceného období', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(db, subscriptionEvent({}));

    const now = new Date('2026-08-05T00:00:00Z');
    expect(await hasActiveSubscription(db, 'u1', now)).toBe(true);
    expect(await canGenerateReport(db, 'u1', 2021, now)).toBe(true);
    delete process.env.DANERO_BILLING;
  });

  it('zrušení obnovy běží do konce období, teprve pak se zamkne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    // Stripe u zrušení k datu obnovy drží stav 'active' a jen zvedne příznak;
    // na 'canceled' přepne až po konci zaplaceného období.
    await applyStripeEvent(db, subscriptionEvent({ status: 'active', cancel_at_period_end: true }));

    expect(await hasActiveSubscription(db, 'u1', new Date('2026-08-05T00:00:00Z'))).toBe(true);
    expect(await hasActiveSubscription(db, 'u1', new Date('2027-06-01T00:00:00Z'))).toBe(false);
    delete process.env.DANERO_BILLING;
  });

  it('zrušení pro nezaplacení zamkne hned, i když období ještě neuplynulo', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    // vyčerpaný dunning: Stripe předplatné zruší, ale current_period_end nechá
    // na konci NEZAPLACENÉHO období — bez výčtu zaplacených stavů by neplatič
    // dostal celý rok zdarma
    await applyStripeEvent(db, subscriptionEvent({ status: 'past_due' }));
    expect(await hasActiveSubscription(db, 'u1', new Date('2026-08-05T00:00:00Z'))).toBe(false);
    await applyStripeEvent(db, {
      ...subscriptionEvent({ status: 'canceled' }),
      type: 'customer.subscription.deleted',
    } as unknown as Stripe.Event);

    expect(await hasActiveSubscription(db, 'u1', new Date('2026-08-05T00:00:00Z'))).toBe(false);
    delete process.env.DANERO_BILLING;
  });

  it('nezaplacená Checkout session nic neodemkne; odemkne ji až potvrzená platba', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    const session = {
      client_reference_id: 'u1',
      metadata: { userId: 'u1', taxYear: '2026' },
      payment_intent: 'pi_odlozena',
    };

    // odložená platební metoda (převod, SEPA): session je completed, ale nezaplacená
    const outcome = await applyStripeEvent(db, checkoutEvent({ ...session, payment_status: 'unpaid' }));
    expect(outcome).toContain('nezaplacen');
    expect(await canGenerateReport(db, 'u1', 2026)).toBe(false);

    // až když peníze dorazí, Stripe pošle async_payment_succeeded
    await applyStripeEvent(
      db,
      checkoutEvent({ ...session }, 'checkout.session.async_payment_succeeded'),
    );
    expect(await canGenerateReport(db, 'u1', 2026)).toBe(true);
    delete process.env.DANERO_BILLING;
  });

  it('platba bez vazby na uživatele nic nezapíše a neshodí běh', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const outcome = await applyStripeEvent(db, checkoutEvent({ metadata: {} }));
    expect(outcome).toContain('bez uživatele');
  });

  it('smazání účtu zruší běžící předplatné ve Stripe', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(db, subscriptionEvent({ id: 'sub_ke_zruseni' }));
    zrusena.length = 0;

    // ID se čte před smazáním (kaskáda řádek zahodí), ruší se až po něm
    const id = await pendingSubscriptionId(db, 'u1');
    expect(id).toBe('sub_ke_zruseni');
    await cancelStripeSubscription(id!, 'u1');

    // bez tohohle by zákazníkovi bez účtu chodilo 990 Kč ročně dál
    expect(zrusena).toEqual(['sub_ke_zruseni']);
    delete process.env.DANERO_BILLING;
  });

  it('účet bez předplatného nemá co rušit', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    zrusena.length = 0;
    expect(await pendingSubscriptionId(db, 'u1')).toBeNull();
    expect(zrusena).toEqual([]);
  });

  it('neznámý typ události se ignoruje', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const outcome = await applyStripeEvent(db, {
      type: 'payment_intent.created',
      data: { object: {} },
    } as unknown as Stripe.Event);
    expect(outcome).toContain('ignorováno');
  });
});
