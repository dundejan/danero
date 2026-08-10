import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { and, eq, like } from 'drizzle-orm';
import type { Db } from '@/db';
import { verification } from '@/db/schema';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * D-01: TOTP kód musí být jednorázový.
 *
 * Better Auth ho po použití nezneplatní, takže týž šestimístný kód projde
 * kolikrát chce, dokud běží jeho ~90s okno (předchozí/aktuální/následující
 * třicetivteřinový krok) — a projde i pro úplně jinou přihlašovací výzvu.
 * Kdo kód odchytí (podvržená přihlašovací stránka, MITM), otevře si během
 * minuty a půl vlastní relaci, i když ho oběť mezitím sama použila.
 * OWASP ASVS 2.8.1 to zakazuje.
 *
 * Použitý kód si proto zapíšeme do `app_rate_limits` (klíč `totp:<uživatel>:<kód>`,
 * limit 1) — stejný atomický upsert jako u ostatních limitů, takže to drží i přes
 * víc instancí; paměť jedné z nich by na Vercelu ostatním neřekla nic. Zápis je
 * PŘED ověřením kódu schválně: dva souběžné pokusy se stejným kódem se tím
 * seřadí a projde jen první z nich. Cena je, že kód „spálí" i pokus, který
 * skončí jinou chybou — jenže ten kód by za pár desítek vteřin vypršel stejně.
 *
 * V tabulce tak leží kódy, které už jsou tím pádem neplatné, a jen po dobu,
 * kdy by je server ještě přijal (okno + rezerva); pak je smaže `pruneRateLimits`.
 * Kód se porovnává znak po znaku i uvnitř Better Authu, takže se klíč nedá
 * obejít jiným zápisem téhož čísla.
 */
const TOTP_REPLAY_WINDOW_MS = 120_000;
const TWO_FACTOR_COOKIE = 'two_factor';

export function rejectReusedTotpCode(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/two-factor/verify-totp') return;
    const code = (ctx.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string' || !code) return;

    // Stejné pořadí jako v Better Authu: relace má přednost před cookie
    // přihlašovací výzvy. Bez obojího endpoint stejně skončí chybou, tak
    // ať kbelík zbytečně nezakládáme.
    const session = await getSessionFromCtx(ctx);
    let userId = session?.user.id ?? null;
    if (!userId) {
      const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
      const challengeToken = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
      const challenge = challengeToken
        ? await ctx.context.internalAdapter.findVerificationValue(challengeToken)
        : null;
      userId = challenge?.value ?? null;
    }
    if (!userId) return;

    const unused = await checkRateLimit(db, `totp:${userId}:${code}`, {
      max: 1,
      windowMs: TOTP_REPLAY_WINDOW_MS,
    });
    if (!unused) {
      throw new APIError('UNAUTHORIZED', {
        message: 'Tenhle kód už byl použit. Opiš z aplikace ten, který se zobrazuje teď.',
        code: 'TOTP_CODE_ALREADY_USED',
      });
    }
  });
}

/**
 * D-3-02: citlivé operace musí mít strop i PER ÚČET, ne jen per IP.
 *
 * Vestavěné limity Better Authu se počítají podle IP adresy, a tu si klient
 * u nás píše sám do `X-Forwarded-For`. Naměřeno: při rotaci téhle hlavičky
 * prošlo na `/api/auth/change-password` **25 z 25 pokusů, ani jedna 429**.
 * Server actions v Nastavení per-účet limit mají (`limitAccountAction`),
 * jenže tytéž operace jdou zavolat přímo na `/api/auth/*`, kde neplatil.
 * Z unesené relace je tím pádem neomezený password oracle: uhádnuté heslo
 * = změna e-mailu i vypnutí druhého faktoru.
 *
 * Klíč je userId, takže střídání adres nepomůže. Okno a stropy jsou stejné
 * jako u odpovídajících server actions, aby se limit nedal obejít přechodem
 * z jedné cesty na druhou — čítač je pro obě tentýž.
 */
const ACCOUNT_WINDOW_MS = 5 * 60_000;

/** Cesta → (operace sdílená se server action, strop v okně). */
const ACCOUNT_LIMITS: Record<string, { operation: string; max: number }> = {
  '/change-password': { operation: 'password_change', max: 5 },
  '/change-email': { operation: 'email_change', max: 5 },
  '/delete-user': { operation: 'account_delete', max: 3 },
  '/two-factor/enable': { operation: 'two_factor_enable', max: 5 },
  '/two-factor/disable': { operation: 'two_factor_disable', max: 5 },
};

export function limitSensitiveAccountOperations(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    const limit = ACCOUNT_LIMITS[ctx.path];
    if (!limit) return;
    // Bez relace endpoint stejně skončí na 401 — kbelík nezakládáme, jinak by
    // šlo cizí účet vyčerpat zvenčí (a útočník userId ani nezná).
    const session = await getSessionFromCtx(ctx);
    const userId = session?.user.id;
    if (!userId) return;

    const allowed = await checkRateLimit(db, `${limit.operation}:${userId}`, {
      max: limit.max,
      windowMs: ACCOUNT_WINDOW_MS,
    });
    if (!allowed) {
      throw new APIError('TOO_MANY_REQUESTS', {
        message: 'Zkoušíš to moc často. Dej tomu pár minut a zkus to znovu.',
        code: 'ACCOUNT_RATE_LIMITED',
      });
    }
  });
}

/**
 * `hooks.before` bere jediný middleware — tenhle spojuje všechny dohromady
 * a drží jejich pořadí na jednom místě.
 */
export function beforeHooks(db: Db) {
  const hooks = [rejectReusedTotpCode(db), limitSensitiveAccountOperations(db)];
  return createAuthMiddleware(async (ctx) => {
    for (const hook of hooks) await hook(ctx);
  });
}

/**
 * D-02: po změně hesla musí padnout všechny vydané odkazy na obnovu hesla.
 *
 * Better Auth spotřebuje jen ten token, kterým se reset provedl — ostatní žijí
 * dál do svého vypršení (hodina). Starý odkaz ve schránce tak ještě hodinu po
 * dokončené obnově znovu přepíše heslo; kdo se do schránky dostal, obejde tím
 * i to, že si uživatel heslo mezitím sám změnil.
 *
 * Tokeny leží ve `verification` jako `reset-password:<token>` s hodnotou
 * userId — mažeme přesně ty, ověřovací e-maily ani výzvy 2FA se netýkají.
 */
export async function revokePasswordResetTokens(db: Db, userId: string): Promise<void> {
  await db
    .delete(verification)
    .where(and(eq(verification.value, userId), like(verification.identifier, 'reset-password:%')));
}

/** Totéž po vědomé změně hesla přihlášeným uživatelem (`/change-password`). */
export function revokeResetTokensAfterPasswordChange(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/change-password') return;
    // after hook běží i po chybě endpointu — ta se sem dostane jako návratová hodnota
    if (isAPIError(ctx.context.returned)) return;
    const userId = ctx.context.session?.user.id;
    if (userId) await revokePasswordResetTokens(db, userId);
  });
}
