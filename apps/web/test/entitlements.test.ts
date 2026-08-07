import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb } from '@/db';
import { reportPurchases, subscriptions, user } from '@/db/schema';
import {
  billingEnabled,
  canGenerateReport,
  hasActiveSubscription,
  resolveEntitlements,
  usersWithActiveSubscription,
} from '@/lib/entitlements';

/** Oprávnění podle docs/19 — hranice vede podle automatizace, ne podle dat. */
describe('tarify a oprávnění', () => {
  afterEach(() => {
    delete process.env.DANERO_BILLING;
    delete process.env.STRIPE_SECRET_KEY;
    // NODE_ENV je v typech Nextu readonly — přiřazení neprojde typecheckem
    vi.unstubAllEnvs();
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

  it('produkce se Stripe klíčem a bez DANERO_BILLING spadne, ne aby rozdávala zdarma', () => {
    // Přepínač je fail-open: chybějící nebo překlepnutá hodnota tiše odemkne
    // všechno (nový projekt, preview prostředí, obnova ze zálohy). Kdo nastavil
    // Stripe klíč, ten platby chce — nesoulad je zjevná miskonfigurace.
    vi.stubEnv('NODE_ENV', 'production');
    process.env.STRIPE_SECRET_KEY = 'sk_test_ukazka';

    expect(() => billingEnabled()).toThrow(/DANERO_BILLING/);

    process.env.DANERO_BILLING = 'stripee'; // překlep
    expect(() => billingEnabled()).toThrow(/DANERO_BILLING/);

    process.env.DANERO_BILLING = 'stripe';
    expect(billingEnabled()).toBe(true);
  });

  it('vlastní instance bez Stripu běží dál se vším odemčeným', () => {
    // záměr z docs/19: paywall je konfigurace provozovatele, ne zmrzačený kód
    vi.stubEnv('NODE_ENV', 'production');
    expect(billingEnabled()).toBe(false);
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

  it('vrácený nákup neodemyká nic', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Vrácený', email: 'vraceny@danero.cz' });
    // řádek se při vrácení peněz nemaže, jen zamyká (C-24, C-25) — nesmí ale
    // dál odemykat podklady
    await db.insert(reportPurchases).values({
      userId: 'u1',
      taxYear: 2026,
      revokedAt: new Date('2026-03-01T00:00:00Z'),
      revokedReason: 'refund',
    });

    expect(await canGenerateReport(db, 'u1', 2026)).toBe(false);
    expect((await resolveEntitlements(db, 'u1')).reportYears).toEqual([]);
  });

  it('nesmyslný daňový rok se databáze ani neptá', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Hraniční', email: 'hranice@danero.cz' });
    await db.insert(reportPurchases).values({ userId: 'u1', taxYear: 2026 });

    // `tax_year` je integer — 1e21 v dotazu skončilo neošetřenou výjimkou,
    // takže /api/epo vracelo 500 místo hlášky (C-27)
    for (const rok of [1e21, -1e21, 2024.5, Number.NaN]) {
      expect(await canGenerateReport(db, 'u1', rok)).toBe(false);
    }
    expect(await canGenerateReport(db, 'u1', 2026)).toBe(true);
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
      // Stripe drží u zrušení k datu obnovy stav 'active' a jen zvedne
      // cancel_at_period_end; na 'canceled' přepne až po konci období.
      {
        userId: 'zrusil',
        status: 'active',
        currentPeriodEnd: konecObdobi,
        cancelAtPeriodEnd: true,
      },
      { userId: 'nezaplatil', status: 'past_due', currentPeriodEnd: konecObdobi },
    ]);

    const now = new Date('2026-08-05T00:00:00Z');
    expect(await hasActiveSubscription(db, 'zrusil', now)).toBe(true);
    expect(await hasActiveSubscription(db, 'nezaplatil', now)).toBe(false);
  });

  it('přístup dává jen zaplacený stav — ne cokoli, co není past_due', { timeout: 30_000 }, async () => {
    process.env.DANERO_BILLING = 'stripe';
    const db = await createPgliteDb();
    // Konec období v budoucnu u VŠECH: přesně tak to Stripe nechává po
    // vyčerpaném dunningu (zruší předplatné, ale current_period_end zůstane
    // na konci NEZAPLACENÉHO roku) i po opuštěné 3DS výzvě v Checkoutu.
    const konecObdobi = new Date('2027-01-01T00:00:00Z');
    const stavy = [
      'active',
      'trialing',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused',
      'neco_noveho_od_stripe',
    ];
    await db.insert(user).values(
      stavy.map((s) => ({ id: s, name: s, email: `${s}@danero.cz` })),
    );
    await db
      .insert(subscriptions)
      .values(stavy.map((s) => ({ userId: s, status: s, currentPeriodEnd: konecObdobi })));

    const now = new Date('2026-08-05T00:00:00Z');
    const pristup: Record<string, boolean> = {};
    for (const s of stavy) pristup[s] = await hasActiveSubscription(db, s, now);

    expect(pristup).toEqual({
      active: true,
      trialing: true,
      canceled: false,
      unpaid: false,
      incomplete: false,
      incomplete_expired: false,
      paused: false,
      neco_noveho_od_stripe: false,
    });
    // crony musí filtrovat stejně jako stránky, jinak by neplatícím běžel sync
    expect(await usersWithActiveSubscription(db, now)).toEqual(new Set(['active', 'trialing']));
  });
});
