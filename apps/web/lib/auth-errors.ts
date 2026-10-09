/**
 * Hlášky přihlašovacího formuláře a úprava opsaných kódů — čisté funkce bez
 * Reactu a bez sítě, aby šly otestovat samy (`test/auth-errors.test.ts`).
 *
 * Formulář do revize 5 sváděl KAŽDOU chybu serveru na e-mail a heslo: po
 * šestém pokusu četl uživatel se správným heslem „zkontroluj e-mail a heslo“
 * a šel si ho obnovovat, při výpadku databáze totéž četl každý (L15-01).
 * Odpověď serveru má tři různé příčiny a každá chce jinou radu.
 */

/** Z chyby klienta Better Auth nás zajímá jen stav odpovědi a kód chyby. */
export interface AuthClientError {
  status?: number | undefined;
  code?: string | undefined;
}

/** Hláška pod polem; `link` je adresa, kterou má smysl nabídnout ke kliknutí. */
export interface AuthErrorMessage {
  text: string;
  link?: { href: string; label: string };
}

/**
 * Stejná věta jako u obnovy hesla a opakovaného odeslání odkazu, jen s minutou:
 * strop přihlášení i registrace je 5 pokusů a uvolní se 60 s po posledním
 * povoleném (`rateLimit.customRules` v `lib/auth.ts`).
 */
const TOO_MANY_REQUESTS = 'Zkoušel jsi to příliš často. Zkus to prosím za minutu.';

const SERVER_FAILURE =
  'Tentokrát je chyba na naší straně, ne v tvých údajích. Zkus to prosím za chvíli znovu.';

/** Origin adresy, nebo `null`, když adresa nejde přečíst (pak ji neporovnáváme). */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `INVALID_ORIGIN`: stránka je otevřená na jiné adrese, než kterou má server
 * nastavenou jako svou (`BETTER_AUTH_URL`) — typicky alias `*.vercel.app` nebo
 * `127.0.0.1` místo `localhost` (L15-02). S údaji uživatele to nemá nic
 * společného, pomůže jen otevřít aplikaci jinde.
 *
 * Adresa jde z nastavení instance (`SITE_URL`), žádná tu není natvrdo. Když
 * na ní uživatel už je, odkaz by ho poslal tam, kde stojí — pak je vada
 * v nastavení (`NEXT_PUBLIC_APP_URL` se rozchází s `BETTER_AUTH_URL`) a říkáme to.
 */
function invalidOriginMessage(
  mode: 'prihlaseni' | 'registrace',
  site: { siteUrl: string; currentOrigin?: string | undefined },
): AuthErrorMessage {
  const action = mode === 'registrace' ? 'Registrace' : 'Přihlášení';
  const siteOrigin = originOf(site.siteUrl);
  if (siteOrigin === null || siteOrigin === site.currentOrigin) {
    return {
      text: `${action} z téhle adresy server odmítá. Chyba je v nastavení aplikace, ne v tvých údajích.`,
    };
  }
  return {
    text: `${action} z téhle adresy nefunguje — aplikace běží jinde. Otevři ji tam a zkus to znovu:`,
    link: { href: site.siteUrl, label: new URL(site.siteUrl).host },
  };
}

/**
 * Chyba přihlášení nebo registrace → co uživateli říct.
 *
 * Pořadí je záměrné: kód chyby má přednost před stavem (na 403 končí víc
 * různých věcí), teprve pak stavy 429 a 5xx. Všechno ostatní — špatné heslo,
 * neplatný e-mail, krátké heslo — zůstává u dosavadní věty; server schválně
 * neprozrazuje, který z údajů nesedí. Nepotvrzený účet (`EMAIL_NOT_VERIFIED`)
 * si formulář řeší sám dřív, než se sem dostane.
 */
export function credentialsErrorMessage(
  mode: 'prihlaseni' | 'registrace',
  error: AuthClientError,
  site: { siteUrl: string; currentOrigin?: string | undefined },
): AuthErrorMessage {
  if (error.code === 'INVALID_ORIGIN') return invalidOriginMessage(mode, site);
  if (error.status === 429) return { text: TOO_MANY_REQUESTS };
  if (error.status !== undefined && error.status >= 500) return { text: SERVER_FAILURE };
  return {
    text:
      mode === 'registrace'
        ? 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo o délce aspoň 10 znaků.'
        : 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
  };
}

/**
 * Chyba ověření záložního kódu. Po pěti špatných opisech v jedné výzvě vrací
 * plugin `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` i na SPRÁVNÝ kód — „kód nesedí“
 * by pak uživatele nechalo opisovat dokola kód, který je v pořádku (L6b-10).
 * Kód tím nepropadne, po novém přihlášení heslem projde.
 */
export function backupCodeErrorMessage(error: AuthClientError): string {
  if (error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') {
    return 'Pokusů bylo moc a tahle výzva už nepřijme ani správný kód. Načti stránku, přihlas se znovu heslem a zkus to ještě jednou — záložní kód ti zůstává.';
  }
  return 'Záložní kód nesedí. Zkontroluj, že jsi ho opsal celý včetně pomlčky a že sedí velká a malá písmena.';
}

/**
 * Atribut `pattern` pole na kód z autentikátoru: šest číslic, mezi kterými
 * i kolem kterých smí být mezery. Aplikace kód zobrazují jako „123 456“ a ze
 * schránky přijde s mezerou na konci — dřívější `\d{6}` takový kód zastavilo
 * bublinou prohlížeče, která neřekne, co je špatně (L6b-06).
 */
export const TOTP_CODE_PATTERN = '\\s*(?:\\d\\s*){6}';

/** Prohlížeč `title` připojí k bublině o nesprávném formátu — jediné místo, kde jde tvar popsat. */
export const TOTP_CODE_TITLE = 'Šest číslic z aplikace autentikátoru';

/** Kód z autentikátoru před odesláním: bez bílých znaků („123 456“ → „123456“). */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** Bílé znaky a pomlčky všech délek — telefon z „-“ rád udělá „–“. */
const BACKUP_CODE_SEPARATORS = /[\s\u2010-\u2015\u2212-]+/g;

/**
 * Záložní kód před odesláním. Plugin generuje deset znaků a–z, A–Z, 0–9
 * s pomlčkou po pátém (`generateBackupCodesFn` v better-auth, two-factor/
 * backup-codes) a porovnává na znak přesně, takže chybějící pomlčka nebo
 * mezera místo ní znamenala „nesedí“ (L6b-10).
 *
 * Oddělovače v kódu nic nenesou, proto je jde zahodit a pomlčku vrátit na
 * její místo. Když po tom nezbude přesně deset znaků kódu, vstup jen ořízneme
 * a necháme rozhodnout server — nic si nedomýšlíme.
 *
 * Velikost písmen se NEOPRAVUJE: kódy ji rozlišují a porovnává je knihovna.
 */
export function normalizeBackupCode(raw: string): string {
  const characters = raw.replace(BACKUP_CODE_SEPARATORS, '');
  if (!/^[A-Za-z0-9]{10}$/.test(characters)) return raw.trim();
  return `${characters.slice(0, 5)}-${characters.slice(5)}`;
}
