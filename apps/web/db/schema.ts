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
} from 'drizzle-orm/pg-core';

/* ── Better Auth core schéma (email+heslo; 2FA přijde v F4) ─────────────── */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
