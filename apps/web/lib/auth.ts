import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { getDb, type Db } from '@/db';
import * as schema from '@/db/schema';

/**
 * Žádný secret natvrdo v kódu: produkce vyžaduje BETTER_AUTH_SECRET (jinak pád),
 * dev si jednorázově vygeneruje náhodný secret do gitignorované .data/ —
 * unikátní per stroj, přežívá restarty (session se neinvalidují).
 */
function resolveSecret(): string {
  const fromEnv = process.env.BETTER_AUTH_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET musí být v produkci nastaven (openssl rand -hex 32).');
  }
  const file = join('.data', 'dev-auth-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync('.data', { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function buildAuth(db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    plugins: [twoFactor({ issuer: 'Danero' })],
    secret: resolveSecret(),
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  });
}

export type Auth = ReturnType<typeof buildAuth>;

/**
 * Líná inicializace: DB (a migrace PGlite) se nesmí dotknout build fáze Next —
 * page-data collection běží ve více procesech a soupeřily by o zámek PGlite.
 */
const globalForAuth = globalThis as unknown as { __daneroAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  globalForAuth.__daneroAuth ??= getDb().then(buildAuth);
  return globalForAuth.__daneroAuth;
}
