import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { reportPurchases, subscriptions } from '@/db/schema';

/**
 * Kdo na co má nárok (docs/19). Hranice vede podle automatizace, ne podle dat:
 * import výpisů a snímek stavu jsou zdarma, aby čísla zůstala pravdivá
 * (limity 100k i 50k se sčítají přes všechny platformy), placené je až to,
 * co běží samo.
 *
 * VLASTNÍ INSTANCE: bez `DANERO_BILLING=stripe` je odemčené všechno. Paywall je
 * konfigurace provozovatele, ne zmrzačený kód — u AGPL by cokoli jiného bylo
 * trapné a self-hoster by ho stejně za minutu vyndal.
 */
export function billingEnabled(): boolean {
  return process.env.DANERO_BILLING === 'stripe';
}

export interface Entitlements {
  /** Napojení brokera přes API a automatický denní sync. */
  brokerSync: boolean;
  /** Hlídací e-maily (limity, časové testy, termíny). */
  notifications: boolean;
  /** Simulátor prodeje a horizont osvobození. */
  simulator: boolean;
  /** Daňové roky s odemčenými podklady; `all` = předplatné pokrývá všechny. */
  reportYears: 'all' | number[];
}

const EVERYTHING: Entitlements = {
  brokerSync: true,
  notifications: true,
  simulator: true,
  reportYears: 'all',
};

const NOTHING_PAID: Entitlements = {
  brokerSync: false,
  notifications: false,
  simulator: false,
  reportYears: [],
};

/** Aktivní předplatné = stav sedí a zaplacené období ještě neskončilo. */
export async function hasActiveSubscription(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  if (!row) return false;
  // 'canceled' se drží do konce zaplaceného období (cancelAtPeriodEnd), takže
  // rozhoduje datum; 'past_due' po splatnosti nechává službu vypnutou
  return row.status !== 'past_due' && row.currentPeriodEnd > now;
}

export async function resolveEntitlements(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<Entitlements> {
  if (!billingEnabled()) return EVERYTHING;
  if (await hasActiveSubscription(db, userId, now)) return EVERYTHING;

  const purchases = await db
    .select({ taxYear: reportPurchases.taxYear })
    .from(reportPurchases)
    .where(eq(reportPurchases.userId, userId));

  return { ...NOTHING_PAID, reportYears: purchases.map((p) => p.taxYear) };
}

/** Podklady za konkrétní rok: předplatné, nebo jednorázový nákup toho roku. */
export async function canGenerateReport(
  db: Db,
  userId: string,
  taxYear: number,
  now = new Date(),
): Promise<boolean> {
  if (!billingEnabled()) return true;
  if (await hasActiveSubscription(db, userId, now)) return true;
  const [row] = await db
    .select({ id: reportPurchases.id })
    .from(reportPurchases)
    .where(and(eq(reportPurchases.userId, userId), eq(reportPurchases.taxYear, taxYear)));
  return Boolean(row);
}

/**
 * Uživatelé, kterým smí běžet automatika (denní sync, notifikace). Crony si tím
 * filtrují frontu, aby zbytečně nesahaly na brokery neplatících účtů.
 */
export async function usersWithActiveSubscription(db: Db, now = new Date()): Promise<Set<string>> {
  if (!billingEnabled()) return new Set();
  const rows = await db
    .select({ userId: subscriptions.userId, status: subscriptions.status, end: subscriptions.currentPeriodEnd })
    .from(subscriptions);
  return new Set(
    rows.filter((r) => r.status !== 'past_due' && r.end > now).map((r) => r.userId),
  );
}
