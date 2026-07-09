import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { getDb, type Db } from '@/db';
import * as schema from '@/db/schema';

/**
 * Žádný secret natvrdo v kódu: produkce vyžaduje BETTER_AUTH_SECRET (jinak pád),
 * dev si jednorázově vygeneruje náhodný secret do gitignorované .data/ —
 * unikátní per stroj, přežívá restarty (session se neinvalidují).
 */
export function resolveSecret(): string {
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

/**
 * Bez BETTER_AUTH_URL by tichý localhost default vypnul Secure flag session
 * cookie (Better Auth ho odvozuje z https:// v baseURL) — produkce musí
 * spadnout při startu, ne vydávat nezabezpečené cookies.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.BETTER_AUTH_URL;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_URL musí být v produkci nastavena (https URL aplikace).');
  }
  return 'http://localhost:3000';
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
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    user: {
      // GDPR práva z /soukromi: hard delete (FK kaskády smažou i transakce
      // a šifrované broker klíče) a změna e-mailu — obojí jen s heslem/session
      deleteUser: { enabled: true },
      // e-mailová verifikace zatím není (Resend klíč čeká na Jana) — bez
      // updateEmailWithoutVerification by /change-email vždy spadl
      changeEmail: { enabled: true, updateEmailWithoutVerification: true },
    },
    // G10a: rate limiting auth endpointů — jen v produkci (E2E registruje
    // opakovaně z jedné IP), DB storage kvůli serverless
    rateLimit: {
      enabled: process.env.NODE_ENV === 'production',
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
        '/change-password': { window: 300, max: 5 },
        '/delete-user': { window: 300, max: 3 },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // audit přihlášení (G8b) — nesmí shodit login, logAudit chyby polyká
          after: async (session) => {
            const { logAudit } = await import('@/lib/audit');
            await logAudit(db, session.userId, 'LOGIN');
          },
        },
      },
    },
    // nextCookies MUSÍ být poslední: propisuje Set-Cookie ze server actions
    // (bez něj by změna hesla s rotací session uživatele odhlásila)
    plugins: [twoFactor({ issuer: 'Danero' }), nextCookies()],
    secret: resolveSecret(),
    baseURL: resolveBaseUrl(),
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
