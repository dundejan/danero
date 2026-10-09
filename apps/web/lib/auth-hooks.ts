import { createHash } from 'node:crypto';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { expireCookie, setSessionCookie } from 'better-auth/cookies';
import { and, eq, like } from 'drizzle-orm';
import type { Db } from '@/db';
import { user, verification } from '@/db/schema';
import {
  COMMON_PASSWORD_CODE,
  COMMON_PASSWORD_MESSAGE,
  isCommonPassword,
} from '@/lib/password-strength';
import { checkRateLimit, releaseRateLimit } from '@/lib/rate-limit';

/** Kontext, který dostává háček — ať jdou háčky psát i jako obyčejné funkce. */
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Otisk adresy tam, kde adresa sama čitelně ležet nemá: v cookie prohlížeče
 * a v klíči tabulky limitů (ta nemá cizí klíč na účet a řádek v ní přežije
 * i jeho smazání).
 */
export const emailFingerprint = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

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
 * L21-04: „důvěryhodné zařízení" server nesmí vydat.
 *
 * Better Auth při ověření druhého faktoru s `trustDevice: true` vyrazí cookie
 * `trust_device` a záznam `trust-device-<náhodný řetězec>` ve `verification`
 * (hodnota = userId). S nimi dalších 30 dní stačí samotné heslo a platnost se
 * každým přihlášením posouvá. Formulář ten příznak neposílá a Nastavení
 * takové zařízení neukáže ani neodvolá — šlo ho vyrazit jen přímým voláním
 * API a přežilo pak odhlášení ostatních zařízení, změnu hesla i vypnutí
 * a nové zapnutí 2FA z jiného prohlížeče.
 *
 * Příznak proto přepisujeme na `false` dřív, než se k němu endpoint dostane.
 * Nevracíme chybu: tělo je jinak platné a kód z autentikátoru by se zbytečně
 * spálil (D-01). Cesta `/two-factor/verify-otp` je tu pro úplnost — kódy
 * e-mailem nemáme zapnuté, ale endpoint týž příznak přijímá.
 *
 * Vrácený `context` Better Auth sloučí s požadavkem (`runBeforeHooks`
 * v `better-auth/dist/api/dispatch.mjs`); hodnota z háčku má přednost.
 */
const TRUST_DEVICE_PATHS = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/verify-otp',
]);

export function withoutTrustDevice(
  path: string | undefined,
  body: unknown,
): { context: { body: { trustDevice: false } } } | undefined {
  if (!path || !TRUST_DEVICE_PATHS.has(path)) return undefined;
  if (!body || typeof body !== 'object' || !('trustDevice' in body)) return undefined;
  return { context: { body: { trustDevice: false } } };
}

/**
 * L8a-03 (rozhodnutí R14): strop pokusů o přihlášení na jednu ADRESU.
 *
 * Vestavěný limit `/sign-in/email` (5 za minutu) se počítá podle IP, takže kdo
 * adresy střídá, hádá heslo jednoho účtu bez brzdy — naměřeno 68 špatných
 * pokusů a pak úspěšné přihlášení. Tady je strop na adresu: deset pokusů
 * v okně čtvrt hodiny, další se do konce okna odmítají.
 *
 * - **Počítá se PŘED ověřením hesla a atomicky** (`checkRateLimit`), ne až po
 *   neúspěchu: čtení stavu a pozdější zápis by šlo předběhnout souběžnými
 *   pokusy a z deseti by jich byly stovky. Správné heslo počítadlo smaže
 *   (`settleSignInAttempt`), takže běžné přihlašování se do stropu nesčítá.
 * - Klíč je otisk adresy, ne id účtu, a počítá se i pro adresu bez účtu —
 *   odpověď tak neprozradí, jestli účet existuje.
 * - **Známý prohlížeč má vlastní počítadlo.** Kdo se z prohlížeče už jednou
 *   přihlásil správným heslem, nese podepsanou cookie s otiskem adresy a jeho
 *   pokusy se počítají zvlášť. Bez toho by kdokoli, kdo adresu zná, uměl
 *   majiteli přihlášení zamykat dokola (deset pokusů každou čtvrthodinu);
 *   takhle si cizí člověk vyčerpá jen počítadlo neznámých prohlížečů.
 *   Hádat heslo cookie nepomůže: i její počítadlo má strop a bez správného
 *   hesla ji nikdo nedostane.
 * - Dokončená obnova hesla maže obě počítadla (`clearSignInFailures`): kdo je
 *   na novém zařízení zrovna zamčený, dostane se dovnitř hned.
 *
 * Vědomá cena, která zbývá: na zařízení, ze kterého se majitel ještě
 * nepřihlásil, mu cizí člověk umí přihlášení heslem na čtvrt hodiny zavřít.
 * Obnova hesla e-mailem funguje dál a zámek ruší.
 */
const SIGN_IN_ATTEMPT_MAX = 10;
const SIGN_IN_ATTEMPT_WINDOW_MS = 15 * 60_000;
const SIGN_IN_PATH = '/sign-in/email';
const KNOWN_BROWSER_COOKIE = 'known_browser';
const KNOWN_BROWSER_MAX_AGE_S = 60 * 60 * 24 * 180;

const signInAttemptKey = (email: string, knownBrowser: boolean): string =>
  `signin_fail:${emailFingerprint(email)}${knownBrowser ? ':known' : ''}`;

const signInEmail = (body: unknown): string | null => {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email ? email : null;
};

/** Přihlásil se už někdy tenhle prohlížeč na tuhle adresu správným heslem? */
async function isKnownBrowser(ctx: HookContext, email: string): Promise<boolean> {
  const cookie = ctx.context.createAuthCookie(KNOWN_BROWSER_COOKIE);
  const fingerprint = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  return Boolean(fingerprint) && fingerprint === emailFingerprint(email);
}

export async function clearSignInFailures(db: Db, email: string): Promise<void> {
  await releaseRateLimit(db, signInAttemptKey(email, false));
  await releaseRateLimit(db, signInAttemptKey(email, true));
}

export function limitSignInAttempts(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_PATH) return;
    const email = signInEmail(ctx.body);
    if (!email) return;
    const allowed = await checkRateLimit(
      db,
      signInAttemptKey(email, await isKnownBrowser(ctx, email)),
      { max: SIGN_IN_ATTEMPT_MAX, windowMs: SIGN_IN_ATTEMPT_WINDOW_MS },
    );
    if (allowed) return;
    throw new APIError('TOO_MANY_REQUESTS', {
      message:
        'Na tuhle adresu bylo moc neúspěšných pokusů o přihlášení. Zkus to za čtvrt hodiny, nebo si nastav nové heslo přes „Zapomenuté heslo“.',
      code: 'SIGN_IN_LOCKED',
    });
  });
}

/**
 * Po odpovědi přihlášení: správné heslo smaže počítadlo tohohle prohlížeče
 * a prohlížeč si odnese cookie „známý“. Správné heslo poznáme podle toho, že
 * endpoint neskončil chybou, nebo skončil na nepotvrzené adrese — tu Better
 * Auth kontroluje až PO hesle. Všechno ostatní (401, chyba serveru) nechává
 * pokus započítaný.
 *
 * Běží přímo v kontextu `afterHooks`, protože zapisuje cookie.
 */
export async function settleSignInAttempt(db: Db, ctx: HookContext): Promise<void> {
  if (ctx.path !== SIGN_IN_PATH) return;
  const email = signInEmail(ctx.body);
  if (!email) return;
  const returned = ctx.context.returned;
  const passwordCorrect =
    !isAPIError(returned) ||
    (returned.statusCode === 403 && returned.body?.code === 'EMAIL_NOT_VERIFIED');
  if (!passwordCorrect) return;

  await releaseRateLimit(db, signInAttemptKey(email, await isKnownBrowser(ctx, email)));
  const cookie = ctx.context.createAuthCookie(KNOWN_BROWSER_COOKIE, {
    maxAge: KNOWN_BROWSER_MAX_AGE_S,
  });
  await ctx.setSignedCookie(
    cookie.name,
    emailFingerprint(email),
    ctx.context.secret,
    cookie.attributes,
  );
}

/**
 * L8a-04 (rozhodnutí R21): nejběžnější hesla se nepřijímají — všude, kde se
 * heslo nastavuje (registrace, obnova, změna). Co je „běžné“, říká
 * `lib/password-strength.ts`. Kratší heslo než 10 znaků necháváme pravidlu
 * o délce, ať uživatel čte tu hlášku, která sedí.
 */
const MIN_PASSWORD_LENGTH = 10;
const NEW_PASSWORD_FIELDS: Record<string, string> = {
  '/sign-up/email': 'password',
  '/reset-password': 'newPassword',
  '/change-password': 'newPassword',
};

export function rejectCommonPassword() {
  return createAuthMiddleware(async (ctx) => {
    const field = ctx.path ? NEW_PASSWORD_FIELDS[ctx.path] : undefined;
    if (!field) return;
    const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return;
    if (!isCommonPassword(password)) return;
    throw new APIError('BAD_REQUEST', {
      message: COMMON_PASSWORD_MESSAGE,
      code: COMMON_PASSWORD_CODE,
    });
  });
}

/**
 * `hooks.before` bere jediný middleware — tenhle spojuje všechny dohromady

/**
 * `hooks.before` bere jediný middleware — tenhle spojuje všechny dohromady
 * a drží jejich pořadí na jednom místě. Úprava požadavku se vrací návratovou
 * hodnotou, proto jde `withoutTrustDevice` až za háčky, které jen odmítají.
 */
export function beforeHooks(db: Db) {
  const hooks = [
    rejectReusedTotpCode(db),
    limitSensitiveAccountOperations(db),
    limitSignInAttempts(db),
    rejectCommonPassword(),
  ];
  return createAuthMiddleware(async (ctx) => {
    for (const hook of hooks) await hook(ctx);
    return withoutTrustDevice(ctx.path, ctx.body);
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

/**
 * L21-04: vypnutí 2FA odvolá důvěryhodná zařízení CELÉHO účtu.
 *
 * Better Auth při `/two-factor/disable` smaže jen záznam, jehož cookie nese
 * prohlížeč, který 2FA vypíná. Důvěra vyražená jinde by tak přežila vypnutí
 * i nové zapnutí s novým tajemstvím a druhý faktor by dál přeskakovala.
 * Nové záznamy už nevznikají (`withoutTrustDevice`), tohle uklízí ty, které
 * vznikly dřív — a drží slib z Nastavení, že po zapnutí se při přihlášení
 * vyžaduje kód.
 *
 * Vypnutí má DVĚ cesty a úklid musí být v obou (E18-R1-01): háček níž pro
 * vypnutí z Nastavení a `scripts/two-factor.ts` pro vypnutí provozovatelem —
 * to jde mimo Better Auth, takže se k němu žádný háček nedostane.
 */
export async function revokeTrustedDevices(db: Db, userId: string): Promise<void> {
  await db
    .delete(verification)
    .where(and(eq(verification.value, userId), like(verification.identifier, 'trust-device-%')));
}

export function revokeTrustedDevicesAfterTwoFactorDisable(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/two-factor/disable') return;
    // after hook běží i po chybě endpointu (špatné heslo) — pak se nic nevypnulo
    if (isAPIError(ctx.context.returned)) return;
    const userId = ctx.context.session?.user.id;
    if (userId) await revokeTrustedDevices(db, userId);
  });
}

/**
 * K4-04: audit účtu musí vidět i změny druhého faktoru.
 *
 * Zapnutí 2FA se v Better Authu NEDOKONČUJE na `/two-factor/enable` — ten jen
 * vydá QR kód a záložní kódy. Faktor přeskočí do zapnutého stavu až prvním
 * správným kódem na `/two-factor/verify-totp`, tedy na téže cestě, kudy chodí
 * i přihlášení druhým faktorem. Rozlišíme je podle dvou věcí naráz:
 *
 * 1. **Přihlášení běží bez relace** (jen s cookie přihlašovací výzvy), kdežto
 *    potvrzení nastavení jde z přihlášené relace. Přihlášení navíc audit už má
 *    — zapisuje ho `databaseHooks.session.create`.
 * 2. Novou relaci (`newSession`) vystaví Better Auth na téhle cestě jen tehdy,
 *    když faktor opravdu přepnul na zapnutý. Je to tím pádem pojistka proti
 *    zápisu při opakovaném ověření už zapnutého faktoru.
 *
 * Vypnutí je přímočaré: `/two-factor/disable` má relaci z middleware.
 * Zápis nesmí shodit operaci — `logAudit` si chyby polyká sám.
 */
export function logTwoFactorChanges(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/two-factor/verify-totp' && ctx.path !== '/two-factor/disable') return;
    if (isAPIError(ctx.context.returned)) return;
    const { logAudit } = await import('@/lib/audit');

    if (ctx.path === '/two-factor/disable') {
      const userId = ctx.context.session?.user.id;
      if (userId) await logAudit(db, userId, 'TWO_FACTOR_DISABLED');
      return;
    }

    const sessionCookie = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    if (!sessionCookie) return; // přihlášení druhým faktorem, ne zapínání
    const userId = ctx.context.newSession?.user.id;
    if (userId) await logAudit(db, userId, 'TWO_FACTOR_ENABLED');
  });
}

/**
 * L8a-01 (rozhodnutí R1): potvrzení adresy přihlásí jen prohlížeč, který
 * o ověřovací odkaz sám požádal.
 *
 * Better Auth umí po kliknutí na odkaz přihlásit kohokoli, kdo klikl
 * (`autoSignInAfterVerification`). Kdo si cizí adresu předregistroval se svým
 * heslem, tím dostal majitele adresy do účtu, ke kterému sám znal heslo —
 * stačilo, aby majitel klikl na nevyžádaný e-mail. Vypnout přihlášení úplně
 * by ale každému novému uživateli přidalo jedno zadání hesla navíc.
 *
 * Proto dva háčky:
 *  - registrace a žádost o nový odkaz nechají v prohlížeči podepsanou cookie
 *    s otiskem adresy (`rememberVerificationBrowser`),
 *  - po úspěšném potvrzení se relace otevře jen tomu, kdo tu cookie pro
 *    potvrzenou adresu nese (`signInVerificationBrowser`).
 * Kdo klikne jinde (majitel adresy z cizí předregistrace, jiný počítač,
 * skener pošty), skončí na stránce „Adresu máme potvrzenou, přihlas se“.
 * Heslo z cizí předregistrace nezná, takže jde přes „Zapomenuté heslo“ — a to
 * cizí heslo i relace zruší.
 *
 * Selhání je bezpečným směrem: když háček cookie nepozná nebo spadne,
 * uživatel se přihlásí heslem, nikdo se nedostane dovnitř navíc.
 *
 * Účet s druhým faktorem se takhle nepřihlašuje nikdy (týká se jen potvrzení
 * po změně e-mailu) — odkaz v poště nemá kód z telefonu obcházet.
 *
 * Co cookie NEdokládá: kdo ji má, jen z tohohle prohlížeče o odkaz požádal.
 * Bez platného tokenu z e-mailu je k ničemu.
 */
const VERIFICATION_BROWSER_COOKIE = 'verification_browser';
/** Stejně dlouho, jako platí ověřovací odkaz (`emailVerification.expiresIn`). */
const VERIFICATION_BROWSER_MAX_AGE_S = 60 * 60 * 24;
const VERIFICATION_REQUEST_PATHS = new Set(['/sign-up/email', '/send-verification-email']);


export async function rememberVerificationBrowser(ctx: HookContext): Promise<void> {
  if (!ctx.path || !VERIFICATION_REQUEST_PATHS.has(ctx.path)) return;
  if (isAPIError(ctx.context.returned)) return;
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string' || !email) return;
  const cookie = ctx.context.createAuthCookie(VERIFICATION_BROWSER_COOKIE, {
    maxAge: VERIFICATION_BROWSER_MAX_AGE_S,
  });
  await ctx.setSignedCookie(
    cookie.name,
    emailFingerprint(email),
    ctx.context.secret,
    cookie.attributes,
  );
}

/**
 * Kdo byl v tomhle požadavku právě potvrzen. Plní to `afterEmailVerification`
 * (běží jen po úspěšném potvrzení a dostane týž objekt požadavku), čte háček
 * níž. Z návratové hodnoty endpointu se úspěch poznat nedá: s `callbackURL`
 * končí přesměrováním úspěch i vypršelý odkaz.
 */
interface VerifiedUser {
  id: string;
  email: string;
}
const verifiedInRequest = new WeakMap<Request, VerifiedUser>();

export function noteVerifiedUser(user: VerifiedUser, request: Request | undefined): void {
  if (request) verifiedInRequest.set(request, { id: user.id, email: user.email });
}

export async function signInVerificationBrowser(db: Db, ctx: HookContext): Promise<void> {
  if (ctx.path !== '/verify-email' || !ctx.request) return;
  const verified = verifiedInRequest.get(ctx.request);
  if (!verified) return;
  verifiedInRequest.delete(ctx.request);

  const cookie = ctx.context.createAuthCookie(VERIFICATION_BROWSER_COOKIE);
  const fingerprint = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!fingerprint || fingerprint !== emailFingerprint(verified.email)) return;

  const [row] = await db
    .select({ twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, verified.id));
  if (!row || row.twoFactorEnabled) return;

  // kdo už je v tomhle prohlížeči přihlášený jako tentýž účet, novou relaci nepotřebuje
  const current = await getSessionFromCtx(ctx);
  if (current?.user.id === verified.id) return;

  const account = await ctx.context.internalAdapter.findUserById(verified.id);
  if (!account) return;
  const session = await ctx.context.internalAdapter.createSession(verified.id);
  if (!session) return;
  await setSessionCookie(ctx, { session, user: account });
  // jednorázová: další odkaz chce novou žádost z tohohle prohlížeče
  expireCookie(ctx, cookie);
}

/**
 * `hooks.after` bere jediný middleware — stejně jako u `beforeHooks` je jejich
 * pořadí a soupiska na jednom místě.
 */
export function afterHooks(db: Db) {
  const hooks = [
    revokeResetTokensAfterPasswordChange(db),
    revokeTrustedDevicesAfterTwoFactorDisable(db),
    logTwoFactorChanges(db),
  ];
  return createAuthMiddleware(async (ctx) => {
    for (const hook of hooks) await hook(ctx);
    // Tyhle dva zapisují cookies, proto běží přímo v kontextu tohohle
    // middleware: háček zabalený do vlastního `createAuthMiddleware` má
    // vlastní hlavičky odpovědi a ty by se tady zahodily.
    await settleSignInAttempt(db, ctx);
    await rememberVerificationBrowser(ctx);
    await signInVerificationBrowser(db, ctx);
  });
}
