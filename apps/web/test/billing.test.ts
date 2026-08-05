import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { user } from '@/db/schema';
import { applyStripeEvent } from '@/lib/billing';
import { canGenerateReport, hasActiveSubscription } from '@/lib/entitlements';

/**
 * Zpracování Stripe událostí (docs/19). Webhook chodí i opakovaně a mimo pořadí,
 * takže hlavní vlastnost, kterou testujeme, je idempotence.
 */

const checkoutEvent = (overrides: Record<string, unknown>) =>
  ({
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', mode: 'payment', ...overrides } },
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

  it('zrušení běží do konce období, teprve pak se zamkne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(
      db,
      subscriptionEvent({ status: 'canceled', cancel_at_period_end: true }),
    );

    expect(await hasActiveSubscription(db, 'u1', new Date('2026-08-05T00:00:00Z'))).toBe(true);
    expect(await hasActiveSubscription(db, 'u1', new Date('2027-06-01T00:00:00Z'))).toBe(false);
    delete process.env.DANERO_BILLING;
  });

  it('platba bez vazby na uživatele nic nezapíše a neshodí běh', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const outcome = await applyStripeEvent(db, checkoutEvent({ metadata: {} }));
    expect(outcome).toContain('bez uživatele');
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
