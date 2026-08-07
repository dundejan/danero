import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ── Better Auth core schéma (email+heslo; 2FA přijde v F4) ─────────────── */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  verified: boolean('verified').notNull().default(false),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/* ── Doména Danero ───────────────────────────────────────────────────────── */

/** Daňový profil = konfigurace enginu per uživatel (docs/02, tabulka přepínačů). */
export const taxpayerProfiles = pgTable('taxpayer_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  regime: text('regime').notNull(), // PAUSAL | ZAMESTNANEC | OSVC | JINE
  hasBusinessAssets: boolean('has_business_assets').notNull().default(false),
  w8benFiled: boolean('w8ben_filed').notNull().default(true),
  otherIncomeCzk: numeric('other_income_czk', { precision: 18, scale: 2 }).notNull().default('0'),
  matchingMethod: text('matching_method').notNull().default('FIFO'),
  fxMethod: text('fx_method').notNull().default('UNIFIED'),
  limit100kStrict: boolean('limit_100k_strict').notNull().default(true),
  timeTestBasis: text('time_test_basis').notNull().default('settlement'),
  // R-12i: prémie bezcenně expirovaných opcí jako výdaj druhu (default = restriktivní NE)
  derivativesExpensesPerType: boolean('derivatives_expenses_per_type').notNull().default(false),
  // R-10g: časový test osvobozuje i stablecoiny (EMT)? (default = bezpečné NE, zdanit)
  emtTimeTestExempt: boolean('emt_time_test_exempt').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Zafixovaná konfigurace jednoho daňového roku (R-05c). Vzniká ve chvíli, kdy
 * si uživatel za rok vygeneruje podklady k přiznání, a od té chvíle se ten rok
 * počítá zapsanou metodou i po pozdější změně profilu — zákon u párování
 * prodejů žádá průkaznost a konzistenci, takže podané přiznání se nesmí zpětně
 * přepočítat. Chybějící řádek = platí metoda z `taxpayer_profiles`.
 */
export const taxYearSettings = pgTable(
  'tax_year_settings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    /** FIFO | LIFO | MAX_PROFIT | MAX_LOSS — hodnota platná pro tenhle rok. */
    matchingMethod: text('matching_method').notNull(),
    pinnedAt: timestamp('pinned_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.taxYear] })],
);

/**
 * Audit události účtu (G8b): přihlášení, importy, změny profilu a klíčů.
 * Jen zobrazení uživateli (transparentnost) — žádná citlivá data v detailu.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Better Auth rate limiting (G10a) — DB storage kvůli serverless produkci
 * (in-memory čítač na Vercelu nepřežije request). Pole dle better-auth
 * dist/api/rate-limiter (key, count, lastRequest v ms).
 */
export const rateLimit = pgTable('rate_limit', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/**
 * Aplikační rate limity (G10a) — upload/EPO/export per uživatel. Okno se
 * resetuje atomicky v upsertu (lib/rate-limit.ts), žádný cron úklid netřeba.
 */
export const appRateLimits = pgTable('app_rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at').notNull(),
});

/**
 * Notifikační preference (G8d, H3) — per uživatel. Přepínače řídí JEN e-maily
 * (v aplikaci se upozornění zobrazují vždy); `emailEnabled` je jediný master
 * vypínač. Chybějící řádek = všechno zapnuté, denní souhrn (bez onboardingu).
 */
export const notificationPrefs = pgTable('notification_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').notNull().default(true),
  timeTestEvents: boolean('time_test_events').notNull().default(true),
  limitEvents: boolean('limit_events').notNull().default(true),
  /** E-maily kalendářních připomínek (termíny přiznání, roční shrnutí). */
  calendarEmails: boolean('calendar_emails').notNull().default(true),
  /** 'DAILY' | 'WEEKLY' — jak často chodí digest. */
  emailFrequency: text('email_frequency').notNull().default('DAILY'),
  /** Kdy naposledy odešel digest — WEEKLY podle něj čeká na týdenní okno. */
  // withTimezone: bez zóny by postgres.js četl hodnotu v lokální zóně serveru
  // (latentní posun týdenního okna mimo UTC) — timestamptz je round-trip čistý
  lastDigestAt: timestamp('last_digest_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Napojený broker účet — API klíč šifrovaný AES-256-GCM (lib/crypto.ts), nikdy plaintext. */
export const brokerAccounts = pgTable('broker_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  broker: text('broker').notNull(), // 'trading212'
  label: text('label').notNull().default('Trading 212'),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  lastSyncStatus: text('last_sync_status'),
  /**
   * Chyba posledního (ne)doběhnutého syncu — ukládá se VEDLE rekonciliace,
   * aby selhání běhu nepřepsalo poslední platný výsledek rekonciliace pozic.
   * Úspěšný sync ji nuluje.
   */
  lastSyncError: text('last_sync_error'),
  /** Výsledek poslední rekonciliace pozic (serializovaný ReconciliationReport). */
  lastReconciliation: jsonb('last_reconciliation'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const importBatches = pgTable('import_batches', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  broker: text('broker').notNull(),
  filename: text('filename').notNull(),
  added: integer('added').notNull(),
  duplicates: integer('duplicates').notNull(),
  errorCount: integer('error_count').notNull(),
  skippedCount: integer('skipped_count').notNull(),
  warningCount: integer('warning_count').notNull(),
  /** { errors, skipped, warnings } — RowIssue[] pro zobrazení uživateli */
  issues: jsonb('issues').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('import_batches_user_created_idx').on(t.userId, t.createdAt)]);

/**
 * Notifikace hlídače (osvobození pozic, pásma limitů). PK (userId, dedupeKey)
 * zaručuje, že každá událost vznikne jen jednou; e-mail se posílá dávkově
 * (digest) a značí emailedAt.
 */
export const notifications = pgTable('notifications', {
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  emailedAt: timestamp('emailed_at'),
}, (t) => [primaryKey({ columns: [t.userId, t.dedupeKey] })]);

/**
 * Background joby pro dlouhé operace (T212 sync). Životní cyklus: server action
 * job zapíše (pending) a hned vrátí odpověď; zpracování startuje `after()` po
 * odeslání odpovědi a záchrannou sítí je cron tick /api/cron/jobs (viz lib/jobs.ts).
 */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 't212-sync'
    /** Granularita deduplikace (u syncu accountId) — viz unikátní index níže. */
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('pending'), // pending | running | success | error
    /** Vstup jobu (např. { accountId }). */
    payload: jsonb('payload'),
    /** Průběžný stav pro UI (u syncu stav per rok — SyncProgress). */
    progress: jsonb('progress'),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    /** Poslední známka života — podle ní cron pozná job zabitý restartem procesu. */
    heartbeatAt: timestamp('heartbeat_at'),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [
    index('jobs_user_created_idx').on(t.userId, t.createdAt),
    index('jobs_status_idx').on(t.status),
    // Nejvýš jeden aktivní job na (uživatel, typ, dedupeKey) — enqueue je díky
    // tomu odolný proti souběhu (klik uživatele vs. cron tick na dvou procesech).
    uniqueIndex('jobs_active_unique_idx')
      .on(t.userId, t.type, t.dedupeKey)
      .where(sql`status in ('pending', 'running')`),
  ],
);

/**
 * Denní kurzy ČNB (R-06b) — SDÍLENÁ referenční data trhu, ne uživatelská
 * (výjimka z tenancy pravidla; plní je cron/backfill z oficiálního ČNB API).
 * Kurz je CZK za 1 jednotku měny (normalizováno z kotací za 100/1000).
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    /** Den vyhlášení (ISO). ČNB vyhlašuje jen pracovní dny. */
    day: text('day').notNull(),
    currency: text('currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 6 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.currency] })],
);

/**
 * Uživatelský číselník instrumentů pro brokery, kteří neexportují ISIN/měnu
 * (XTB, Fio): symbol → ISIN (+ měna instrumentu). Plní se formulářem při
 * importu a při dalších importech se použije automaticky.
 */
export const instrumentAliases = pgTable(
  'instrument_aliases',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    broker: text('broker').notNull(),
    symbol: text('symbol').notNull(),
    isin: text('isin').notNull(),
    currency: text('currency'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.broker, t.symbol] })],
);

/**
 * Poslední známé ceny instrumentů z broker API (T212 portfolio, IBKR OpenPositions).
 * Zapisují se při každém syncu; CSV-only uživatelé řádky nemají → UI poctivě
 * ukazuje „bez cen“. Ceny jsou v měně instrumentu, orientační (ne kotace burzy).
 */
export const instrumentPrices = pgTable(
  'instrument_prices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    isin: text('isin').notNull(),
    /** Cena za kus v měně instrumentu (Decimal jako string). */
    price: text('price').notNull(),
    currency: text('currency').notNull(),
    /** Odkud cena přišla ('trading212' | 'ibkr'). */
    source: text('source').notNull(),
    asOf: timestamp('as_of').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.isin] })],
);

/**
 * Kanonické transakce — zdroj pravdy pro engine. Payload je serializovaný
 * kanonický model (Decimal → string), engine ho rehydratuje přes Zod.
 * PK (userId, dedupeKey) = idempotentní import z definice.
 */
export const transactions = pgTable(
  'transactions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    batchId: text('batch_id').notNull(),
    broker: text('broker').notNull(),
    type: text('type').notNull(),
    txDate: text('tx_date').notNull(),
    isin: text('isin'),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.dedupeKey] }),
    index('transactions_user_date_idx').on(t.userId, t.txDate),
  ],
);

/**
 * Waitlist před spuštěním (docs/12, fáze P0): jen e-mail + čas. Souhlas je
 * omezený na jednorázové oznámení o otevření (zákon 480/2004 Sb.) — text
 * souhlasu nese formulář; PK e-mail = opakované přihlášení nic nezdvojí.
 */
export const waitlist = pgTable('waitlist', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Roční hlídání (docs/19). Jedna aktivní řádka na uživatele; historii obnov
 * drží Stripe. `source: 'grant'` je ruční přidělení bez platby (partneři,
 * kompenzace) — proto nejsou stripe sloupce povinné.
 */
export const subscriptions = pgTable('subscriptions', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** 'active' | 'past_due' | 'canceled' — mapuje stav ze Stripe. */
  status: text('status').notNull(),
  /** Do kdy je zaplaceno; po tomhle datu hlídání nefunguje ani u 'active'. */
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  /** Uživatel zrušil obnovu, ale do konce období mu služba běží dál. */
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  source: text('source').notNull().default('stripe'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  /** Použitý promokód — podklad pro výplaty partnerům (docs/19). */
  promoCode: text('promo_code'),
  /**
   * Kdy zákazník výslovně požádal o zahájení plnění před uplynutím 14denní
   * lhůty (§ 1837 písm. l OZ). Bez tohohle záznamu bychom nedoložili, že
   * odstoupení už nepřipadá v úvahu — proto se ukládá k platbě, ne do auditu.
   */
  consentAt: timestamp('consent_at'),
  /**
   * Čas události ze Stripe, ze které uložený stav pochází. Stripe negarantuje
   * pořadí doručení: bez téhle známky by opožděné „zrušeno" k STARÉMU
   * předplatnému přepsalo čerstvě zaplacené nové a zákazník by přišel
   * o přístup, za který právě zaplatil. `null` = stav z jiného zdroje než
   * událost (ruční grant, vazba uložená při checkoutu).
   */
  lastEventAt: timestamp('last_event_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Jednorázový nákup podkladů k přiznání za JEDEN daňový rok (docs/19).
 * Platí navždy — jednou zaplacený rok zůstává odemčený.
 */
export const reportPurchases = pgTable(
  'report_purchases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    /**
     * Zákazník ve Stripe i u jednorázového nákupu — bez něj se do zákaznického
     * portálu (doklad o zaplacení, § 16 z. 634/1992) dostane jen předplatitel.
     */
    stripeCustomerId: text('stripe_customer_id'),
    promoCode: text('promo_code'),
    /** Výslovná žádost o zahájení plnění před lhůtou (§ 1837 písm. l OZ). */
    consentAt: timestamp('consent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // druhý nákup téhož roku nedává smysl a webhook chodí i opakovaně
  (t) => [uniqueIndex('report_purchases_user_year_idx').on(t.userId, t.taxYear)],
);
