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
 *
 * Pojistka (C-5) v duchu `lib/auth.ts` a `lib/crypto.ts`: samotný přepínač je
 * fail-open, takže překlep nebo chybějící proměnná na novém prostředí tiše
 * rozdá všechno zdarma. Kdo nastavil Stripe klíč, ten platby chce — nesoulad
 * je proto zjevná miskonfigurace a v produkci se na ni umírá hlasitě.
 * Self-host bez Stripu tím netrpí: bez `STRIPE_SECRET_KEY` se nic nekontroluje.
 */
export function billingEnabled(): boolean {
  const mode = process.env.DANERO_BILLING;
  if (mode !== 'stripe' && process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV === 'production') {
    throw new Error(
      'STRIPE_SECRET_KEY je nastavený, ale DANERO_BILLING není "stripe" — paywall by byl vypnutý a všechno zdarma. Nastav DANERO_BILLING=stripe, nebo Stripe klíč odeber.',
    );
  }
  return mode === 'stripe';
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

/**
 * Stavy Stripe předplatného, které znamenají ZAPLACENO. Schválně výčtem, ne
 * výjimkou z něj: kdyby se ptalo „co není past_due", dostal by přístup i stav
 * `canceled` po vyčerpaném dunningu — Stripe totiž při zrušení pro nezaplacení
 * nechá `current_period_end` na konci toho NEzaplaceného období, takže by
 * neplatič dostal rok zdarma. Totéž `unpaid`, `incomplete` (opuštěná 3DS výzva),
 * `paused` i jakýkoli stav, který Stripe teprve zavede.
 *
 * Zrušení k datu obnovy tím netrpí: Stripe u něj drží stav `active` a jen zvedne
 * `cancel_at_period_end`, na `canceled` přepne až po konci zaplaceného období.
 */
const PAID_STATUSES = new Set(['active', 'trialing']);

/** Jediné místo, kde se rozhoduje „běží předplatné?" — používá i stránka /predplatne. */
export function isPaidSubscription<T extends { status: string; currentPeriodEnd: Date }>(
  row: T | undefined,
  now = new Date(),
): row is T {
  return Boolean(row && PAID_STATUSES.has(row.status) && row.currentPeriodEnd > now);
}

/** Aktivní předplatné = zaplacený stav a zaplacené období ještě neskončilo. */
export async function hasActiveSubscription(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ status: subscriptions.status, currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return isPaidSubscription(row, now);
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
    rows.filter((r) => PAID_STATUSES.has(r.status) && r.end > now).map((r) => r.userId),
  );
}
