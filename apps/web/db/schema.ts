import { sql } from 'drizzle-orm';
import {
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/** Napojený broker účet — API klíč šifrovaný AES-256-GCM (lib/crypto.ts), nikdy plaintext. */
export const brokerAccounts = pgTable('broker_accounts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  broker: text('broker').notNull(), // 'trading212'
  label: text('label').notNull().default('Trading212'),
  credentialsEncrypted: text('credentials_encrypted').notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  lastSyncStatus: text('last_sync_status'),
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
});

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
 * ukazuje „bez cen". Ceny jsou v měně instrumentu, orientační (ne kotace burzy).
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
