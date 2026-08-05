import { afterEach, describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { reportPurchases, subscriptions, user } from '@/db/schema';
import {
  canGenerateReport,
  hasActiveSubscription,
  resolveEntitlements,
  usersWithActiveSubscription,
} from '@/lib/entitlements';

/** Oprávnění podle docs/19 — hranice vede podle automatizace, ne podle dat. */
describe('tarify a oprávnění', () => {
  afterEach(() => {
    delete process.env.DANERO_BILLING;
  });

  it('vlastní instance bez DANERO_BILLING má odemčeno všechno', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Self', email: 'self@danero.cz' });

    const ent = await resolveEntitlements(db, 'u1');
    expect(ent).toEqual({
      brokerSync: true,
      notifications: true,
      simulator: true,
      reportYears: 'all',
    });
    expect(await canGenerateReport(db, 'u1', 2026)).toBe(true);
    // crony si nefiltrují nic — filtr má smysl jen v hostované verzi
    expect(await usersWithActiveSubscription(db)).toEqual(new Set());
  });

  it('bez předplatného je placené zamčené, import a přehled ne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Free', email: 'free@danero.cz' });

    const ent = await resolveEntitlements(db, 'u1');
    expect(ent.brokerSync).toBe(false);
    expect(ent.notifications).toBe(false);
    expect(ent.simulator).toBe(false);
    expect(ent.reportYears).toEqual([]);
  });

  it('jednorázový nákup odemkne jen zaplacený rok', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Jednorázový', email: 'jednou@danero.cz' });
    await db.insert(reportPurchases).values({ userId: 'u1', taxYear: 2026 });

    expect(await canGenerateReport(db, 'u1', 2026)).toBe(true);
    expect(await canGenerateReport(db, 'u1', 2027)).toBe(false);
    // nákup podkladů neodemyká automatiku
    const ent = await resolveEntitlements(db, 'u1');
    expect(ent.brokerSync).toBe(false);
    expect(ent.reportYears).toEqual([2026]);
  });

  it('předplatné odemkne všechno včetně všech daňových roků', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Platící', email: 'plati@danero.cz' });
    await db.insert(subscriptions).values({
      userId: 'u1',
      status: 'active',
      currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
    });

    const now = new Date('2026-08-05T00:00:00Z');
    expect(await hasActiveSubscription(db, 'u1', now)).toBe(true);
    expect((await resolveEntitlements(db, 'u1', now)).reportYears).toBe('all');
    expect(await canGenerateReport(db, 'u1', 2021, now)).toBe(true);
    expect(await usersWithActiveSubscription(db, now)).toEqual(new Set(['u1']));
  });

  it('po konci zaplaceného období se automatika vypne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Vypršel', email: 'konec@danero.cz' });
    await db.insert(subscriptions).values({
      userId: 'u1',
      status: 'active',
      currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
    });

    const now = new Date('2026-08-05T00:00:00Z');
    expect(await hasActiveSubscription(db, 'u1', now)).toBe(false);
    expect(await usersWithActiveSubscription(db, now)).toEqual(new Set());
  });

  it('zrušené předplatné běží do konce období, nezaplacené ne', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'zrusil', name: 'Zrušil', email: 'zrusil@danero.cz' },
      { id: 'nezaplatil', name: 'Nezaplatil', email: 'dluzi@danero.cz' },
    ]);
    const konecObdobi = new Date('2027-01-01T00:00:00Z');
    await db.insert(subscriptions).values([
      {
        userId: 'zrusil',
        status: 'canceled',
        currentPeriodEnd: konecObdobi,
        cancelAtPeriodEnd: true,
      },
      { userId: 'nezaplatil', status: 'past_due', currentPeriodEnd: konecObdobi },
    ]);

    const now = new Date('2026-08-05T00:00:00Z');
    expect(await hasActiveSubscription(db, 'zrusil', now)).toBe(true);
    expect(await hasActiveSubscription(db, 'nezaplatil', now)).toBe(false);
  });
});
