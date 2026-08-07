import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb } from '@/db';
import { reportPurchases, subscriptions, user } from '@/db/schema';
import {
  applyStripeEvent,
  cancelStripeSubscription,
  pendingSubscriptionId,
  purchaseBlock,
  recordReportPurchase,
  reconcileSubscriptions,
  sendRenewalNotices,
  stripeCustomerFor,
} from '@/lib/billing';
import { canGenerateReport, hasActiveSubscription } from '@/lib/entitlements';

/** Stripe klient je jediné, co v testech nahrazujeme — po síti nechodíme. */
const zrusena: string[] = [];
const stripeState = {
  /** ID promokódu → kód, který zákazník napsal. */
  promotionCodes: new Map<string, string>(),
  /** ID platby → zákazník (dispute nese jen charge, ne zákazníka). */
  charges: new Map<string, { customer: string | null }>(),
  /** Skutečný stav ve Stripe pro rekonciliaci. */
  subscriptionsByCustomer: new Map<string, Stripe.Subscription[]>(),
  subscriptionsById: new Map<string, Stripe.Subscription>(),
  /** Událost, kterou vrátí ověření podpisu ve webhook routě. */
  event: null as Stripe.Event | null,
};

vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  stripe: () => ({
    subscriptions: {
      cancel: async (id: string) => {
        zrusena.push(id);
        return { id, status: 'canceled' };
      },
      list: async ({ customer }: { customer: string }) => ({
        data: stripeState.subscriptionsByCustomer.get(customer) ?? [],
      }),
      retrieve: async (id: string) => {
        const found = stripeState.subscriptionsById.get(id);
        if (!found) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
        return found;
      },
    },
    promotionCodes: {
      retrieve: async (id: string) => {
        const code = stripeState.promotionCodes.get(id);
        if (!code) throw new Error('No such promotion code');
        return { id, code };
      },
    },
    charges: {
      retrieve: async (id: string) => {
        const charge = stripeState.charges.get(id);
        if (!charge) throw new Error('No such charge');
        return charge;
      },
    },
    webhooks: {
      constructEventAsync: async () => {
        if (!stripeState.event) throw new Error('Neplatný podpis');
        return stripeState.event;
      },
    },
  }),
}));

/**
 * Zpracování Stripe událostí (docs/19). Webhook chodí i opakovaně a mimo pořadí,
 * takže hlavní vlastnosti, které testujeme, jsou idempotence a odolnost proti
 * přeházenému pořadí.
 */

const checkoutEvent = (
  overrides: Record<string, unknown>,
  type = 'checkout.session.completed',
  created = 1_786_000_000,
) =>
  ({
    type,
    created,
    data: { object: { id: 'cs_test_1', mode: 'payment', payment_status: 'paid', ...overrides } },
  }) as unknown as Stripe.Event;

const subscriptionEvent = (
  overrides: Record<string, unknown>,
  created = 1_786_000_000,
  type = 'customer.subscription.updated',
) =>
  ({
    type,
    created,
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

/** Předplatné tak, jak ho vrátí Stripe API při rekonciliaci. */
const stripeSubscription = (overrides: Record<string, unknown>): Stripe.Subscription =>
  ({
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1798761600 }] },
    metadata: { userId: 'u1' },
    ...overrides,
  }) as unknown as Stripe.Subscription;

async function dbWithUser(id = 'u1') {
  const db = await createPgliteDb();
  await db.insert(user).values({ id, name: 'Test', email: `${id}@danero.cz` });
  return db;
}

/** Zachytí odeslané e-maily do souboru (stejný mechanismus jako v E2E). */
function captureEmails(): () => { subject: string; text: string }[] {
  const path = join(mkdtempSync(join(tmpdir(), 'danero-billing-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = path;
  return () => {
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { subject: string; text: string });
    } catch {
      return [];
    }
  };
}

const ROK_2026 = new Date('2026-08-05T00:00:00Z');

afterEach(() => {
  delete process.env.DANERO_BILLING;
  delete process.env.DANERO_EMAIL_LOG;
  stripeState.promotionCodes.clear();
  stripeState.charges.clear();
  stripeState.subscriptionsByCustomer.clear();
  stripeState.subscriptionsById.clear();
  stripeState.event = null;
  zrusena.length = 0;
});

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
  });

  it('opakovaný webhook o téže platbě nic nezdvojí', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const event = checkoutEvent({
      client_reference_id: 'u1',
      metadata: { userId: 'u1', taxYear: '2026' },
    });

    await applyStripeEvent(db, event);
    await applyStripeEvent(db, event);

    expect(await db.select().from(reportPurchases)).toHaveLength(1);
  });

  it('předplatné se uloží i s koncem zaplaceného období', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(db, subscriptionEvent({}));

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
    expect(await canGenerateReport(db, 'u1', 2021, ROK_2026)).toBe(true);
  });

  it('zrušení obnovy běží do konce období, teprve pak se zamkne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    // Stripe u zrušení k datu obnovy drží stav 'active' a jen zvedne příznak;
    // na 'canceled' přepne až po konci zaplaceného období.
    await applyStripeEvent(db, subscriptionEvent({ status: 'active', cancel_at_period_end: true }));

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
    expect(await hasActiveSubscription(db, 'u1', new Date('2027-06-01T00:00:00Z'))).toBe(false);
  });

  it('zrušení pro nezaplacení zamkne hned, i když období ještě neuplynulo', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    // vyčerpaný dunning: Stripe předplatné zruší, ale current_period_end nechá
    // na konci NEZAPLACENÉHO období — bez výčtu zaplacených stavů by neplatič
    // dostal celý rok zdarma
    await applyStripeEvent(db, subscriptionEvent({ status: 'past_due' }, 1_786_000_100));
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
    await applyStripeEvent(
      db,
      subscriptionEvent({ status: 'canceled' }, 1_786_000_200, 'customer.subscription.deleted'),
    );

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
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

    // ID se čte před smazáním (kaskáda řádek zahodí), ruší se až po něm
    const id = await pendingSubscriptionId(db, 'u1');
    expect(id).toBe('sub_ke_zruseni');
    await cancelStripeSubscription(id!, 'u1');

    // bez tohohle by zákazníkovi bez účtu chodilo 990 Kč ročně dál
    expect(zrusena).toEqual(['sub_ke_zruseni']);
  });

  it('účet bez předplatného nemá co rušit', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
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

/** C-3: Stripe pořadí doručení negarantuje a řádek je jeden na uživatele. */
describe('pořadí událostí o předplatném', () => {
  it('opožděné zrušení STARÉHO předplatného nesebere přístup, za který zákazník právě zaplatil', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    // předplatné A doběhne do past_due → UI zase nabídne koupi
    await applyStripeEvent(db, subscriptionEvent({ id: 'sub_A' }, 1_786_000_000));
    await applyStripeEvent(db, subscriptionEvent({ id: 'sub_A', status: 'past_due' }, 1_786_000_100));
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);

    // zákazník koupí předplatné B — zaplaceno do roku 2028
    await applyStripeEvent(
      db,
      subscriptionEvent(
        { id: 'sub_B', items: { data: [{ current_period_end: 1861920000 }] } },
        1_786_000_300,
        'customer.subscription.created',
      ),
    );
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);

    // teprve teď dorazí dunning k předplatnému A — událost STARŠÍ než stav v DB
    const outcome = await applyStripeEvent(
      db,
      subscriptionEvent(
        { id: 'sub_A', status: 'canceled' },
        1_786_000_200,
        'customer.subscription.deleted',
      ),
    );

    // kdo právě zaplatil, nesmí přijít o přístup kvůli opožděné poště Stripu
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
    // a portál musí vést k předplatnému B, ne ke starému
    const [row] = await db.select().from(subscriptions);
    expect(row?.stripeSubscriptionId).toBe('sub_B');
    expect(outcome).toContain('zahozena');
  });

  it('opožděná událost o TÉMŽE předplatném nevrátí starý stav', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(db, subscriptionEvent({ status: 'past_due' }, 1_786_000_500));
    const outcome = await applyStripeEvent(db, subscriptionEvent({ status: 'active' }, 1_786_000_400));

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
    expect(outcome).toContain('zahozena');
  });

  it('novější událost o jiném předplatném stav přepíše', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();

    await applyStripeEvent(db, subscriptionEvent({ id: 'sub_A' }, 1_786_000_000));
    await applyStripeEvent(
      db,
      subscriptionEvent({ id: 'sub_B', status: 'canceled' }, 1_786_000_900, 'customer.subscription.deleted'),
    );

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });
});

/** C-4: ztracená událost se sama nespraví — jednou denně se ptáme Stripe. */
describe('denní rekonciliace se Stripe', () => {
  it('srovná stav, o kterém událost nikdy nedorazila', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(db, subscriptionEvent({}));
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);

    // ve Stripe je mezitím zrušené (událost se ztratila nebo ji endpoint odmítl)
    stripeState.subscriptionsByCustomer.set('cus_1', [
      stripeSubscription({ status: 'canceled', cancel_at_period_end: true }),
    ]);

    const result = await reconcileSubscriptions(db, ROK_2026);

    expect(result).toMatchObject({ checked: 1, updated: 1, failed: 0 });
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });

  it('doplní řádek zákazníkovi, kterému nedorazila ani jedna událost o předplatném', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    // stopu po zákazníkovi máme jen z dřívějšího jednorázového nákupu
    await db
      .insert(reportPurchases)
      .values({ userId: 'u1', taxYear: 2025, stripeCustomerId: 'cus_9' });
    stripeState.subscriptionsByCustomer.set('cus_9', [
      stripeSubscription({ id: 'sub_ztracene', customer: 'cus_9' }),
    ]);

    const result = await reconcileSubscriptions(db, ROK_2026);

    expect(result).toMatchObject({ linked: 1, failed: 0 });
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
  });

  it('předplatné, které ve Stripe není, se zamkne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(db, subscriptionEvent({}));

    stripeState.subscriptionsByCustomer.set('cus_1', []);
    await reconcileSubscriptions(db, ROK_2026);

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });

  it('bez známého zákazníka se ptá aspoň na ID předplatného', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    // starší řádek, který vznikl ještě bez uložené vazby na zákazníka
    await db.insert(subscriptions).values({
      userId: 'u1',
      status: 'active',
      currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
      stripeSubscriptionId: 'sub_stare',
    });
    stripeState.subscriptionsById.set(
      'sub_stare',
      stripeSubscription({ id: 'sub_stare', status: 'canceled' }),
    );

    await reconcileSubscriptions(db, ROK_2026);

    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });

  it('ruční grant se do Stripe neptá', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await db.insert(subscriptions).values({
      userId: 'u1',
      status: 'active',
      currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
      source: 'grant',
    });

    const result = await reconcileSubscriptions(db, ROK_2026);

    expect(result.checked).toBe(0);
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
  });
});

/** C-3c, C-6, C-12: co se nesmí prodat a jak často. */
describe('kontrola před nákupem', () => {
  it('kdo má běžící předplatné, nekoupí druhé ani podklady navíc', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(db, subscriptionEvent({}));

    expect(await purchaseBlock(db, 'u1', 'subscription', ROK_2026)).toBe('uz-mas-predplatne');
    // podklady za všechny roky má v ceně hlídání — prodat mu je znovu za 490 Kč
    // by bylo účtování za něco, co už zaplatil
    expect(await purchaseBlock(db, 'u1', 'report', ROK_2026)).toBe('mas-v-predplatnem');
  });

  it('bez předplatného nákup projde', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    expect(await purchaseBlock(db, 'u1', 'subscription', ROK_2026)).toBeNull();
  });

  it('nákupní akce mají rate limit jako upload a export', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    for (let i = 0; i < 10; i += 1) {
      expect(await purchaseBlock(db, 'u1', 'report', ROK_2026)).toBeNull();
    }
    expect(await purchaseBlock(db, 'u1', 'report', ROK_2026)).toBe('prilis-casto');
  });
});

/** C-6, C-7, C-14, E-4, E-5: co se musí uložit a komu se má co poslat. */
describe('stopy po platbě', () => {
  it('druhá platba za tentýž rok se nezahodí potichu', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await recordReportPurchase(db, { userId: 'u1', taxYear: 2026, stripePaymentIntentId: 'pi_1' });
    const second = await recordReportPurchase(db, {
      userId: 'u1',
      taxYear: 2026,
      stripePaymentIntentId: 'pi_2',
    });
    spy.mockRestore();

    // peníze na účtu jsou, protiplnění není — musí být z čeho je vrátit
    expect(second).toBe(false);
    expect(errors.join('\n')).toContain('billing.duplicate_report_purchase');
    expect(errors.join('\n')).toContain('pi_2');
  });

  it('promokód se uloží u podkladů i u předplatného', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    stripeState.promotionCodes.set('promo_1', 'PARTNER20');
    // Stripe posílá ve webhooku ID promokódu, ne kód, a `total_details.breakdown`
    // bez expand vůbec — bez dotažení by v DB nezůstalo nic (docs/19 §4)
    const discounts = [{ promotion_code: 'promo_1' }];

    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_1',
        discounts,
      }),
    );
    await applyStripeEvent(
      db,
      checkoutEvent(
        {
          id: 'cs_test_2',
          mode: 'subscription',
          client_reference_id: 'u1',
          metadata: { userId: 'u1' },
          customer: 'cus_1',
          subscription: 'sub_1',
          discounts,
        },
        'checkout.session.completed',
        1_786_000_050,
      ),
    );
    await applyStripeEvent(db, subscriptionEvent({}, 1_786_000_100));

    const [purchase] = await db.select().from(reportPurchases);
    const [subscription] = await db.select().from(subscriptions);
    expect(purchase?.promoCode).toBe('PARTNER20');
    expect(subscription?.promoCode).toBe('PARTNER20');
  });

  it('checkout uloží vazbu na zákazníka, takže neúspěšná platba najde uživatele', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();

    // událost o předplatném zatím nedorazila — vazbu má jen dokončený checkout
    await applyStripeEvent(
      db,
      checkoutEvent({
        mode: 'subscription',
        client_reference_id: 'u1',
        metadata: { userId: 'u1' },
        customer: 'cus_9',
        subscription: 'sub_9',
      }),
    );

    const outcome = await applyStripeEvent(db, {
      type: 'invoice.payment_failed',
      created: 1_786_000_100,
      data: { object: { customer: 'cus_9' } },
    } as unknown as Stripe.Event);

    // bez vazby by v logu zůstalo jen ID zákazníka a userId: null
    expect(outcome).toContain('u1');
  });

  it('sama vazba z checkoutu nic neodemyká', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(
      db,
      checkoutEvent({
        mode: 'subscription',
        client_reference_id: 'u1',
        metadata: { userId: 'u1' },
        customer: 'cus_9',
        subscription: 'sub_9',
      }),
    );
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });

  it('do portálu s doklady se dostane i ten, kdo koupil jen podklady', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_1',
        customer: 'cus_jednorazovy',
      }),
    );

    // § 16 z. 634/1992: doklad o zaplacení musí najít i on
    expect(await stripeCustomerFor(db, 'u1')).toBe('cus_jednorazovy');
  });

  it('potvrzení o smlouvě odejde i když první událost nese incomplete', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    const emails = captureEmails();

    // 3DS výzva: předplatné vznikne jako incomplete a teprve pak se zaplatí
    await applyStripeEvent(
      db,
      subscriptionEvent({ status: 'incomplete' }, 1_786_000_000, 'customer.subscription.created'),
    );
    expect(emails()).toHaveLength(0);

    await applyStripeEvent(db, subscriptionEvent({}, 1_786_000_100));
    const first = emails();
    expect(first).toHaveLength(1);
    expect(first[0]?.subject).toContain('Celoroční hlídání');

    // obnova ani další úprava potvrzení znovu neposílá
    await applyStripeEvent(db, subscriptionEvent({ cancel_at_period_end: true }, 1_786_000_200));
    expect(emails()).toHaveLength(1);
  });
});

/** C-8: vrácené peníze musí zamknout přístup. */
describe('vrácení peněz a reklamace', () => {
  async function dbSePlatbami() {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_1',
        customer: 'cus_1',
      }),
    );
    await applyStripeEvent(db, subscriptionEvent({}));
    return db;
  }

  const refundEvent = (overrides: Record<string, unknown> = {}) =>
    ({
      type: 'charge.refunded',
      created: 1_786_000_500,
      data: {
        object: {
          id: 'ch_1',
          customer: 'cus_1',
          payment_intent: 'pi_1',
          refunded: true,
          amount: 49000,
          amount_refunded: 49000,
          ...overrides,
        },
      },
    }) as unknown as Stripe.Event;

  it('refundace zamkne zaplacené podklady a snese opakování', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_1',
        customer: 'cus_1',
      }),
    );
    expect(await canGenerateReport(db, 'u1', 2026, ROK_2026)).toBe(true);

    await applyStripeEvent(db, refundEvent());

    // odstoupení do 14 dnů + vrácené peníze nesmí nechat odemčeno
    expect(await canGenerateReport(db, 'u1', 2026, ROK_2026)).toBe(false);
    // druhé doručení téže události nesmí spadnout
    await expect(applyStripeEvent(db, refundEvent())).resolves.toContain('refundace');
  });

  it('refundace podkladů nesebere běžící předplatné', { timeout: 30_000 }, async () => {
    // od C-3c má uživatel jednoho zákazníka ve Stripe, takže se refundace
    // 490 Kč nesmí splést s vrácením 990 Kč — hlídání běží dál
    const db = await dbSePlatbami();
    await applyStripeEvent(db, refundEvent());
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
    // ani při opakovaném doručení, kdy už není co mazat
    await applyStripeEvent(db, refundEvent());
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(true);
  });

  it('reklamace platby (chargeback) zamkne podklady i předplatné', { timeout: 30_000 }, async () => {
    const db = await dbSePlatbami();
    // dispute nese jen ID platby, zákazníka si musíme dohledat
    stripeState.charges.set('ch_1', { customer: 'cus_1' });

    const outcome = await applyStripeEvent(db, {
      type: 'charge.dispute.created',
      created: 1_786_000_600,
      data: { object: { id: 'dp_1', charge: 'ch_1', payment_intent: 'pi_1' } },
    } as unknown as Stripe.Event);

    expect(outcome).toContain('ukončeno');
    expect(await canGenerateReport(db, 'u1', 2026, ROK_2026)).toBe(false);
    expect(await hasActiveSubscription(db, 'u1', ROK_2026)).toBe(false);
  });

  it('neúspěšná odložená platba vrátí případné odemčení zpět', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await dbWithUser();
    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026' },
        payment_intent: 'pi_odlozena',
      }),
    );
    expect(await canGenerateReport(db, 'u1', 2026, ROK_2026)).toBe(true);

    await applyStripeEvent(
      db,
      checkoutEvent(
        {
          client_reference_id: 'u1',
          metadata: { userId: 'u1', taxYear: '2026' },
          payment_intent: 'pi_odlozena',
          payment_status: 'unpaid',
        },
        'checkout.session.async_payment_failed',
        1_786_000_700,
      ),
    );

    expect(await canGenerateReport(db, 'u1', 2026, ROK_2026)).toBe(false);
  });

  it('refundace bez odpovídajícího záznamu neshodí webhook', { timeout: 30_000 }, async () => {
    const db = await dbWithUser();
    await expect(
      applyStripeEvent(db, refundEvent({ payment_intent: 'pi_neznama' })),
    ).resolves.toContain('refundace');
  });
});

/** C-13: událost z jiného režimu Stripe, než ve kterém běžíme, se nezpracuje. */
describe('webhook a režim Stripe', () => {
  const request = () =>
    new Request('https://danero.cz/api/stripe/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'stripe-signature': 't=1,v1=fake' },
    });

  it('testovací událost na ostrém klíči se odmítne', { timeout: 30_000 }, async () => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_live_x';
    stripeState.event = {
      type: 'checkout.session.completed',
      livemode: false,
      created: 1,
      data: { object: {} },
    } as unknown as Stripe.Event;

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const response = await POST(request());

    expect(response.status).toBe(400);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('v sandboxu projde testovací událost normálně', { timeout: 30_000 }, async () => {
    process.env.PGLITE_DATA_DIR = ':memory:';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    stripeState.event = {
      type: 'checkout.session.completed',
      livemode: false,
      created: 1,
      data: { object: { id: 'cs_bez_uzivatele', mode: 'payment', payment_status: 'paid' } },
    } as unknown as Stripe.Event;

    const { POST } = await import('@/app/api/stripe/webhook/route');
    const response = await POST(request());

    expect(response.status).toBe(200);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.PGLITE_DATA_DIR;
  });
});

describe('upomínka před automatickou obnovou (E-1)', () => {
  it('odejde 14 dní předem a za totéž období jen jednou', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const emails = captureEmails();
    const db = await dbWithUser();
    const konec = new Date('2027-01-01T00:00:00Z');
    await db.insert(subscriptions).values({
      userId: 'u1',
      status: 'active',
      currentPeriodEnd: konec,
      cancelAtPeriodEnd: false,
    });

    // 20 dní předem je brzy
    expect(await sendRenewalNotices(db, new Date('2026-12-12T08:00:00Z'))).toEqual({ due: 0, sent: 0 });
    expect(emails()).toEqual([]);

    // 14 dní předem odejde
    expect(await sendRenewalNotices(db, new Date('2026-12-18T08:00:00Z'))).toEqual({ due: 1, sent: 1 });
    const mail = emails().find((m) => m.subject.includes('obnoví'));
    expect(mail?.text).toContain('990 Kč');
    expect(mail?.text).toContain('1. 1. 2027');

    // cron běží denně — druhý běh za totéž období už nic neposílá
    expect(await sendRenewalNotices(db, new Date('2026-12-19T08:00:00Z'))).toEqual({ due: 0, sent: 0 });
    expect(emails().filter((m) => m.subject.includes('obnoví'))).toHaveLength(1);
  });

  it('zrušené obnově ani neplatícímu se neposílá nic', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const emails = captureEmails();
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'zrusil', name: 'Z', email: 'z@danero.cz' },
      { id: 'neplati', name: 'N', email: 'n@danero.cz' },
    ]);
    const konec = new Date('2027-01-01T00:00:00Z');
    await db.insert(subscriptions).values([
      // obnovu zrušil — nic se nestrhne, upomínka by mátla
      { userId: 'zrusil', status: 'active', currentPeriodEnd: konec, cancelAtPeriodEnd: true },
      { userId: 'neplati', status: 'past_due', currentPeriodEnd: konec, cancelAtPeriodEnd: false },
    ]);

    expect(await sendRenewalNotices(db, new Date('2026-12-18T08:00:00Z'))).toEqual({ due: 0, sent: 0 });
    expect(emails()).toEqual([]);
  });

  it('webhook invoice.upcoming e-mail neposílá — jinak by odešel dvakrát', { timeout: 30_000 }, async () => {
    const emails = captureEmails();
    const db = await dbWithUser();
    const outcome = await applyStripeEvent(db, {
      type: 'invoice.upcoming',
      created: 1_786_000_100,
      data: { object: { customer: 'cus_1', amount_due: 99_000 } },
    } as unknown as Stripe.Event);
    expect(outcome).toContain('cron');
    expect(emails()).toEqual([]);
  });
});

describe('poučení o odstoupení v potvrzení objednávky (E-3)', () => {
  it('u podkladů právo zaniká dodáním, u hlídání zůstává s poměrnou částí', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const emails = captureEmails();
    const db = await dbWithUser();

    await applyStripeEvent(
      db,
      checkoutEvent({
        client_reference_id: 'u1',
        metadata: { userId: 'u1', taxYear: '2026', consentAt: '2026-08-07T00:00:00Z' },
        payment_intent: 'pi_podklady',
      }),
    );
    await applyStripeEvent(
      db,
      subscriptionEvent({ metadata: { userId: 'u1', consentAt: '2026-08-07T00:00:00Z' } }),
    );

    const [podklady, hlidani] = emails();
    // digitální obsah dodaný okamžitě — § 1837 písm. l
    expect(podklady?.text).toContain('1837');
    expect(podklady?.text).toContain('ztrácíš');
    // průběžně poskytovaná služba — právo TRVÁ, doplácí se poměrná část (§ 1834)
    expect(hlidani?.text).toContain('zůstává');
    expect(hlidani?.text).toContain('1834');
    expect(hlidani?.text).not.toContain('ztrácíš');
    delete process.env.DANERO_BILLING;
  });
});
