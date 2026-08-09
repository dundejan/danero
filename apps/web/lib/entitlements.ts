import { and, eq, isNull } from 'drizzle-orm';
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

/**
 * Rok, který smí vůbec vstoupit do dotazu nad `report_purchases`.
 *
 * `tax_year` je `integer`, takže cokoli mimo rozsah int4 dotaz shodí — a to se
 * dá vyvolat zvenčí: `POST /api/epo` s `rok: 1e21` skončil místo hlášky
 * neošetřenou výjimkou (C-27). Tohle je jen pojistka proti nesmyslu, ne
 * pravidlo, co se smí prodat — na to je `isSellableTaxYear`.
 */
export function isPlausibleTaxYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2999;
}

/**
 * Kolik let zpět jde koupit podklady. Daň jde stanovit (a přiznání podat či
 * opravit) nejdéle 10 let po lhůtě pro řádné přiznání — § 148 odst. 5 daňového
 * řádu. Za starší rok už podklady nemají komu posloužit.
 */
const OLDEST_SELLABLE_TAX_YEAR_OFFSET = 10;

/**
 * Daňový rok, za který se smí prodat jednorázový nákup podkladů.
 *
 * Bez téhle meze prošlo do Stripu i do databáze cokoli: chybějící pole dalo
 * `Number(null) === 0` a uložil se „rok 0", stejně tak 1999, 2100 nebo −2024
 * (C-27). Rok, který ještě neskončil, prodáváme schválně — hlídač počítá
 * průběžně a podklady za běžný rok dávají smysl už v jeho průběhu.
 */
export function isSellableTaxYear(year: number, now = new Date()): boolean {
  if (!isPlausibleTaxYear(year)) return false;
  const current = now.getUTCFullYear();
  return year >= current - OLDEST_SELLABLE_TAX_YEAR_OFFSET && year <= current;
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

/**
 * Stavy, ve kterých předplatné ve Stripe pořád ŽIJE, jen zrovna neodemyká:
 * platba neprošla a Stripe ji dny až týdny zkouší znovu (dunning), nebo je
 * inkaso pozastavené. Nic z toho staré předplatné neruší.
 *
 * `incomplete` sem NEPATŘÍ: to je opuštěná výzva 3DS, kde se nestrhlo nic
 * a Stripe ji do 24 hodin zahodí — kdyby blokovala nový pokus o nákup,
 * zákazník by kvůli jednomu nedokončenému kliknutí nemohl den zaplatit.
 */
const UNSETTLED_STATUSES = new Set(['past_due', 'unpaid', 'paused']);

/** Řeší se u předplatného nezaplacená platba? (dunning) */
export function isUnsettledStatus(status: string | null | undefined): boolean {
  return Boolean(status && UNSETTLED_STATUSES.has(status));
}

/**
 * Má uživatel ve Stripe předplatné, které sice neodemyká, ale pořád existuje?
 *
 * Bez téhle otázky pouštěl `purchaseBlock` nákup po celou dobu dunningu (dny
 * až týdny), a protože staré předplatné nikdo neruší, skončil zákazník se
 * DVĚMA běžícími předplatnými u téhož zákazníka — až se dunning vybere,
 * strhne se **2× 990 Kč**. V databázi je přitom na uživatele jen jeden řádek,
 * takže to druhé předplatné není odkud vidět (nález C-3-05).
 */
export async function hasUnsettledSubscription(
  db: Db,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  return isUnsettledStatus(row?.status);
}

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

  // vrácené peníze a prohraná reklamace řádek nemažou, jen ho zneplatní (C-24)
  const purchases = await db
    .select({ taxYear: reportPurchases.taxYear })
    .from(reportPurchases)
    .where(and(eq(reportPurchases.userId, userId), isNull(reportPurchases.revokedAt)));

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
  // rok mimo rozsah `integer` neptáme databáze — dotaz by spadl (C-27)
  if (!isPlausibleTaxYear(taxYear)) return false;
  if (await hasActiveSubscription(db, userId, now)) return true;
  const [row] = await db
    .select({ id: reportPurchases.id })
    .from(reportPurchases)
    .where(
      and(
        eq(reportPurchases.userId, userId),
        eq(reportPurchases.taxYear, taxYear),
        isNull(reportPurchases.revokedAt),
      ),
    );
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
