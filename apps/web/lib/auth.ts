import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { getDb, type Db } from '@/db';
import * as schema from '@/db/schema';
import {
  beforeHooks,
  revokePasswordResetTokens,
  revokeResetTokensAfterPasswordChange,
} from '@/lib/auth-hooks';

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

/**
 * Rate limit Better Authu se klíčuje podle IP klienta z `X-Forwarded-For`.
 * Tu hlavičku ale smí napsat kdokoli, takže Better Auth musí vědět, kterým
 * hopům v řetězci věřit — bez `trustedProxies` platí „věřím jen hlavičce
 * s JEDINOU hodnotou“ a obě odchylky bolí:
 *
 *  - hodnot je víc (běžná nginx proxy s `$proxy_add_x_forwarded_for`) → IP
 *    vyjde `null` a VŠICHNI sdílí jeden kbelík: kdokoli spálí 5 pokusů
 *    a nikdo se nepřihlásí,
 *  - hodnota chybí (kontejner bez proxy) → totéž.
 *
 * S neprázdným seznamem se řetězec čte ZPRAVA a první nedůvěryhodná adresa je
 * klient. Default kryje obě produkční topologie:
 *  - Vercel (danero.cz): edge hlavičku přepisuje a cizí IP nepropouští, takže
 *    v řetězci je právě jedna veřejná adresa klienta — v žádném privátním
 *    rozsahu není, projde jako klient,
 *  - self-hosting za vlastní proxy: hopy proxy mají adresy z privátních
 *    rozsahů (loopback, RFC1918, docker), přeskočí se a zbyde veřejná IP,
 *    kterou proxy do řetězce doplnila.
 *
 * Kdo má před sebou CDN s veřejnými adresami (Cloudflare) nebo chce seznam
 * zúžit na konkrétní adresu své proxy, vyjmenuje rozsahy v
 * `DANERO_TRUSTED_PROXIES` (IP nebo CIDR, oddělené čárkou; prázdná hodnota
 * = žádná důvěryhodná proxy). Zúžení dává smysl tam, kde do aplikace chodí
 * klienti PŘÍMO z privátního rozsahu (instance v LAN) — ti by jinak sdíleli
 * kbelík s ostatními v téže síti.
 */
const DEFAULT_TRUSTED_PROXIES = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  'fc00::/7',
];

export function resolveTrustedProxies(): string[] {
  const fromEnv = process.env.DANERO_TRUSTED_PROXIES;
  if (fromEnv === undefined) return DEFAULT_TRUSTED_PROXIES;
  return fromEnv
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildAuth(db: Db) {
  return betterAuth({
    /**
     * Dvě výchozí HTTP cesty Better Authu, které Danero nepoužívá a které
     * z jedné ukradené session cookie dělají mnohem větší škodu (nálezy
     * D-3-01 a D-3-04). `disabledPaths` zavírá jen HTTP router (`api/index.mjs`
     * vrátí 404) — serverová volání `auth.api.*` fungují dál, takže vlastní
     * server actions zůstávají nedotčené.
     *
     * `/delete-user`: heslo je v Better Authu **volitelné** — bez něj stačí
     * „čerstvá" relace (`session.freshAge`, výchozích 24 h). Ověřeno naostro
     * na danero.cz: `POST /api/auth/delete-user` s prázdným tělem `{}` vrátilo
     * `200 {"success":true,"message":"User deleted"}` a účet zmizel i s FK
     * kaskádami (transakce, šifrované broker klíče, joby, audit log) — bez
     * hesla, bez opsaného „SMAZAT" a bez zrušení předplatného ve Stripe, které
     * `deleteAccountAction` dělá schválně. Mazání účtu tak jde JEN přes tu
     * action.
     * ⚠️ `session: { freshAge: 0 }` je past, ne oprava: nula kontrolu čerstvosti
     * vypne úplně (`update-user.mjs`: `if (!ctx.body.password && freshAge !== 0)`).
     *
     * `/list-sessions`: vrací **syrové `token`** všech relací uživatele, tedy
     * přímo hodnoty session cookies ostatních zařízení (platnost 7 dní) —
     * jedna ukradená cookie tak vydá všechny ostatní. Jde to proti vlastnímu
     * invariantu exportu („token relace se NEexportuje"). Stránka Nastavení
     * čte relace serverově přes `auth.api.listSessions` a do klienta posílá
     * jen popisek zařízení a čas.
     */
    disabledPaths: ['/delete-user', '/list-sessions'],
    advanced: { ipAddress: { trustedProxies: resolveTrustedProxies() } },
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
      // Bez potvrzené adresy se nedá přihlásit. Důvod není formální: obnova
      // hesla i všechna upozornění chodí na tenhle e-mail, takže překlep
      // v adrese = účet, ke kterému se uživatel už nikdy nedostane.
      // Better Auth při pokusu o přihlášení nepotvrzeného účtu pošle nový
      // odkaz sám, takže uživatel nezůstane viset.
      requireEmailVerification: true,
      // E-8: scrypt s dvojnásobnou pamětí proti výchozímu nastavení Better Authu
      // (64 vs 32 MiB). Otisky vzniklé dřív se ověřují původní funkcí, takže
      // vlastní instance s živými účty se nezamknou.
      password: {
        hash: (password) => import('@/lib/password').then((m) => m.hashPassword(password)),
        verify: (data) => import('@/lib/password').then((m) => m.verifyPassword(data)),
      },
      resetPasswordTokenExpiresIn: 60 * 60,
      // ukradená session nepřežije obnovu hesla
      revokeSessionsOnPasswordReset: true,
      // D-02: dokončený reset musí sundat i ostatní vydané odkazy — jinak je
      // starý odkaz ve schránce ještě hodinu živý (detail v lib/auth-hooks.ts)
      onPasswordReset: ({ user }) => revokePasswordResetTokens(db, user.id),
      sendResetPassword: async ({ user, url }) => {
        const { resolveEmailSender, resetPasswordEmail } = await import('@/lib/email');
        await resolveEmailSender()({ to: user.email, ...resetPasswordEmail(url) });
      },
    },
    emailVerification: {
      expiresIn: 60 * 60 * 24,
      // sendOnSignIn schválně NE: Better Auth by odkazu nastavil callbackURL "/"
      // (do těla přihlášení ho předat nejde, klient by na něj skočil i po
      // úspěšném loginu). Nový odkaz posílá po nezdařeném přihlášení samo UI
      // přes sendVerificationEmail — viz components/auth-form.tsx.
      // po kliknutí na odkaz je uživatel rovnou přihlášený — jinak by hned
      // po potvrzení musel zadávat heslo znovu
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const { resolveEmailSender, verifyEmailEmail } = await import('@/lib/email');
        await resolveEmailSender()({ to: user.email, ...verifyEmailEmail(url) });
      },
    },
    user: {
      // GDPR práva z /soukromi: hard delete (FK kaskády smažou i transakce
      // a šifrované broker klíče). Heslo vynucuje `deleteAccountAction`, NE
      // Better Auth — ten ho bere jako volitelné (D-3-01), proto je HTTP cesta
      // `/delete-user` v `disabledPaths` výš.
      deleteUser: { enabled: true },
      // Změna e-mailu VYPNUTA na úrovni endpointu: surové /change-email chce
      // jen session cookie a bez verifikačních e-mailů (Resend čeká na klíč)
      // by unesená session tiše přepsala identitu účtu. Jediná cesta je
      // server action changeEmailAction s re-autentizací heslem (UPDATE přímo).
      changeEmail: { enabled: false },
    },
    // G10a: rate limiting auth endpointů — jen v produkci (E2E registruje
    // opakovaně z jedné IP), DB storage kvůli serverless.
    // DANERO_DISABLE_RATE_LIMIT=1 nastavuje JEN playwright.prod.config.ts —
    // E2E proti `next start` by jinak po 5. registraci dostávalo 429.
    rateLimit: {
      enabled:
        process.env.NODE_ENV === 'production' && process.env.DANERO_DISABLE_RATE_LIMIT !== '1',
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
        // odesílání e-mailů drž nízko — jinak je z formulářů rozesílač
        '/request-password-reset': { window: 300, max: 3 },
        '/reset-password': { window: 300, max: 5 },
        '/send-verification-email': { window: 300, max: 3 },
      },
    },
    // D-01 (jednorázový TOTP kód), D-3-02 (per-účet strop citlivých operací)
    // a D-02 (zneplatnění reset odkazů po změně hesla) — proč a jak je
    // v lib/auth-hooks.ts
    hooks: {
      before: beforeHooks(db),
      after: revokeResetTokensAfterPasswordChange(db),
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
