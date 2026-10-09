/**
 * Hlášky přihlašovacího formuláře a úprava opsaných kódů — čisté funkce bez
 * Reactu a bez sítě, aby šly otestovat samy (`test/auth-errors.test.ts`).
 *
 * Formulář do revize 5 sváděl KAŽDOU chybu serveru na e-mail a heslo: po
 * šestém pokusu četl uživatel se správným heslem „zkontroluj e-mail a heslo“
 * a šel si ho obnovovat, při výpadku databáze totéž četl každý (L15-01).
 * Odpověď serveru má tři různé příčiny a každá chce jinou radu.
 */

import { COMMON_PASSWORD_CODE, COMMON_PASSWORD_MESSAGE } from '@/lib/password-strength';

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

/**
 * Strop neúspěšných přihlášení na adresu (R14, `rejectLockedSignIn`
 * v `lib/auth-hooks.ts`): čtvrt hodiny, ne minuta, a s cestou ven — obnova
 * hesla zámek ruší hned.
 */
const SIGN_IN_LOCKED: AuthErrorMessage = {
  text: 'Na tuhle adresu bylo moc neúspěšných pokusů o přihlášení, tak jsme ho kvůli bezpečnosti na čtvrt hodiny pozastavili. Nechceš čekat? Nastav si nové heslo:',
  link: { href: '/zapomenute-heslo', label: 'Zapomenuté heslo' },
};

const SERVER_FAILURE =
  'Tentokrát je chyba na naší straně, ne v tvých údajích. Zkus to prosím za chvíli znovu.';

/**
 * Co formulář ví o adrese instance: `siteUrl` je výslovně nastavená veřejná
 * adresa (nebo nic, když nastavená není), `currentOrigin` ta, na které
 * uživatel právě stojí.
 */
export interface SiteAddress {
  siteUrl: string | undefined;
  currentOrigin?: string | undefined;
}

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
 * Adresa jde z výslovného nastavení instance (`NEXT_PUBLIC_APP_URL`), žádná
 * tu není natvrdo — a formulář ji schválně nebere ze `SITE_URL`, které padá na
 * adresu hostované služby: vlastní instance postavená podle návodu proměnnou
 * nemá a self-hoster na `localhost:3000` by četl „aplikace běží jinde“
 * s odkazem na cizí web (L10-03). Prohlížeč `BETTER_AUTH_URL` nezná, takže bez
 * nastavené adresy odkaz nenabízíme vůbec.
 *
 * Odkaz chybí i tehdy, když na nastavené adrese uživatel už je — poslal by ho
 * tam, kde stojí (`NEXT_PUBLIC_APP_URL` se rozchází s `BETTER_AUTH_URL`).
 * V obou případech je vada v nastavení a hláška jmenuje proměnnou: přečte ji
 * hlavně ten, kdo instanci provozuje, a jinde než v logu serveru vodítko nemá.
 */
function invalidOriginMessage(
  mode: 'prihlaseni' | 'registrace',
  site: SiteAddress,
): AuthErrorMessage {
  const action = mode === 'registrace' ? 'Registrace' : 'Přihlášení';
  const siteUrl = site.siteUrl?.trim() ?? '';
  const siteOrigin = originOf(siteUrl);
  if (siteOrigin === null || siteOrigin === site.currentOrigin) {
    return {
      text: `${action} z téhle adresy server odmítá. Chyba je v nastavení aplikace, ne v tvých údajích — funguje jen na adrese, kterou má aplikace nastavenou v BETTER_AUTH_URL.`,
    };
  }
  return {
    text: `${action} z téhle adresy nefunguje — aplikace běží jinde. Otevři ji tam a zkus to znovu:`,
    link: { href: siteUrl, label: new URL(siteUrl).host },
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
  site: SiteAddress,
): AuthErrorMessage {
  if (error.code === 'INVALID_ORIGIN') return invalidOriginMessage(mode, site);
  if (error.code === 'SIGN_IN_LOCKED') return SIGN_IN_LOCKED;
  if (error.code === COMMON_PASSWORD_CODE) return { text: COMMON_PASSWORD_MESSAGE };
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
 * Chyba po „Poslat odkaz znovu“ na `/overeni-emailu`.
 *
 * `deliveryConfigured` posílá stránka ze serveru (`emailDeliveryConfigured`
 * v `lib/email.ts`). Na instanci, která nemá čím odeslat, končí každé odeslání
 * stavem 500 a rada „zkus to za chvíli“ by uživatele nechala zkoušet dokola
 * něco, co bez zásahu provozovatele projít nemůže (L10-01).
 */
export function resendVerificationErrorMessage(
  error: AuthClientError,
  deliveryConfigured: boolean,
): string {
  if (error.status === 429) return 'Zkoušel jsi to příliš často. Zkus to prosím za pár minut.';
  if (!deliveryConfigured) {
    return 'Odkaz se neodeslal — tahle instance Danera nemá nastavené odesílání e-mailů. Zkoušet to znovu nepomůže, musí ho nastavit ten, kdo ji provozuje.';
  }
  return 'E-mail se nepodařilo odeslat. Zkus to prosím za chvíli znovu.';
}

/**
 * Hláška druhého kroku přihlášení. `restart` říká, že výzva je mrtvá a další
 * pokus v ní projít nemůže — formulář se má vrátit na e-mail a heslo.
 */
export interface SecondFactorFailure {
  text: string;
  restart: boolean;
}

/**
 * Chyba ověření druhého kroku — kódu z autentikátoru (`totp`) i záložního
 * kódu (`backup`). Rozhoduje KÓD chyby, ne stav odpovědi: na 429 končí zámek
 * účtu i strop požadavků a na 401 špatný kód i propadlá výzva.
 *
 * - `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`: po pěti špatných kódech plugin výzvu
 *   zahodí a odmítne i SPRÁVNÝ kód — „kód nesedí“ by uživatele nechalo
 *   opisovat dokola kód, který je v pořádku (L6b-10, L21-02). Záložní kód tím
 *   nepropadne, po novém přihlášení heslem projde.
 * - `INVALID_TWO_FACTOR_COOKIE`: výzva platí 10 minut; po nich (a po každém
 *   dalším pokusu ve vyčerpané výzvě) server neví, koho ověřuje (L21-02).
 * - `ACCOUNT_TEMPORARILY_LOCKED`: po deseti špatných kódech je druhý krok na
 *   15 minut zamčený a nové přihlášení heslem to neobejde — proto formulář
 *   zůstává v kroku kódu a radí počkat (L21-03).
 */
export function secondFactorErrorMessage(
  step: 'totp' | 'backup',
  error: AuthClientError,
): SecondFactorFailure {
  if (error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE') {
    return {
      text:
        step === 'backup'
          ? 'Špatných pokusů bylo moc a tohle přihlášení už nepřijme ani správný kód. Přihlas se znovu heslem a zkus to ještě jednou — záložní kód ti zůstává.'
          : 'Špatných pokusů bylo moc a tohle přihlášení už nepřijme ani správný kód. Přihlas se znovu heslem a zkus to ještě jednou.',
      restart: true,
    };
  }
  if (error.code === 'INVALID_TWO_FACTOR_COOKIE') {
    return {
      text: 'Platnost tohohle přihlášení vypršela — na zadání kódu je po heslu 10 minut. Přihlas se znovu heslem.',
      restart: true,
    };
  }
  if (error.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
    return {
      text: 'Špatných kódů bylo moc, a tak je dvoufaktorové ověření na 15 minut zamčené — do té doby neprojde ani správný kód. Zkus to prosím později.',
      restart: false,
    };
  }
  if (step === 'backup') {
    return {
      text: 'Záložní kód nesedí. Zkontroluj, že jsi ho opsal celý včetně pomlčky a že sedí velká a malá písmena.',
      restart: false,
    };
  }
  // Použitý kód se podruhé neuzná (D-01). Bez rozlišení by uživatel opisoval
  // týž kód znovu a zase neuspěl — musí počkat na další.
  return {
    text:
      error.code === 'TOTP_CODE_ALREADY_USED'
        ? 'Tenhle kód už byl použitý. Počkej v aplikaci autentikátoru na další a zadej ten.'
        : 'Kód nesedí. Zkontroluj aplikaci autentikátoru a zkus to znovu.',
    restart: false,
  };
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
