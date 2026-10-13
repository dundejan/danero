import { IbkrFlexError, Trading212ApiError } from '@danero/importers';
import { syncErrorText } from '@/lib/broker-sync';
import { decryptSecret } from '@/lib/crypto';
import { errorText } from '@/lib/log';

/**
 * Chyba synchronizace tak, jak ji má číst uživatel.
 *
 * Do 11. 10. 2026 se u účtu vypisovalo, co broker vrátil: „Trading212 API 500
 * na /history/exports: {…}“. Z toho člověk nepozná, jestli má něco udělat,
 * počkat, nebo napsat nám. Teď je na obrazovce věta podle druhu chyby
 * a syrový text za rozbalením „Technický detail“ — tam ho najde, když ho bude
 * chtít poslat provozovateli.
 *
 * Druh se určuje ve chvíli, kdy chyba vznikla, ze stavu odpovědi a kódu
 * brokera (ne až z textu při zobrazení). Věta i detail se ukládají do jediného
 * sloupce `lastSyncError`: první řádek je věta, zbytek detail. Starší záznamy
 * detail nemají a čtou se celé jako věta.
 *
 * Věta i detail jdou ven bez přístupových údajů (`redactSecrets`) — čistí se
 * každý řádek, i věta, kterou nic nepřeložilo.
 *
 * Tohle je jen TEXT chyby. Že po neúspěšném běhu zůstává `lastSyncedAt`
 * prázdné (jinak by se plná historie už nestáhla), drží dál
 * `markAccountSyncError` a `finishBrokerSync` v `lib/broker-sync.ts`.
 */
export interface SyncFailure {
  /** Věta pro člověka: co se stalo a co s tím. */
  text: string;
  /** Syrový text chyby k odeslání provozovateli; chybí, když věta řekla všechno. */
  detail?: string;
}

/** Co z účtu u brokera věta potřebuje. */
export interface FailedAccount {
  /** Kód brokera (`trading212`, `ibkr`). */
  broker: string;
  /** Název účtu, jak ho uživatel vidí („Trading 212“). */
  label: string;
  /**
   * Zašifrované přihlašovací údaje připojení. Z textu chyby se podle nich
   * maže všechno, co se s nimi shoduje (`redactSecrets`).
   */
  credentialsEncrypted?: string | null;
}

type FailureKind = 'unreachable' | 'credentials' | 'permissions' | 'rateLimit' | 'other';

const KEEPS_DATA = 'co už se stáhlo, zůstává';

function sentence(kind: FailureKind, account: FailedAccount): string {
  switch (kind) {
    case 'unreachable':
      return `${account.label} teď neodpovídá. Zkus to za chvíli znovu — ${KEEPS_DATA}.`;
    case 'rateLimit':
      return `${account.label} omezil počet dotazů. Zkus to za pár minut znovu — ${KEEPS_DATA}.`;
    case 'credentials':
      return account.broker === 'ibkr'
        ? `${account.label} přístup odmítl — zkontroluj token a Query ID. Když nesedí, odpoj účet a napoj ho znovu.`
        : `${account.label} klíč odmítl — nejspíš je neplatný nebo zrušený. Odpoj účet a napoj ho novým klíčem.`;
    case 'permissions':
      return 'Klíč nemá potřebná oprávnění (Account data, History + podkategorie, Metadata, Portfolio). Vygeneruj nový podle návodu a účet napoj znovu.';
    case 'other':
      return 'Synchronizace se nepovedla. Zkus ji znovu; když to potrvá, napiš nám a přilož technický detail.';
  }
}

/**
 * Hlášky klienta Trading 212, které jsou jen opsaná odpověď brokera. Jeho
 * ostatní hlášky (neúplný export, jiný tvar pozic) jsou hotové české věty
 * a projdou beze změny.
 */
const T212_RAW_MESSAGE = /^(Trading212 API\b|Stažení exportu selhalo|Export \d+ )/;

function trading212Kind(error: Trading212ApiError): FailureKind | null {
  if (!T212_RAW_MESSAGE.test(error.message)) return null;
  if (error.status === 401) return 'credentials';
  if (error.status === 403) return 'permissions';
  if (error.status === 429) return 'rateLimit';
  // 408 = export se do termínu nevygeneroval
  if (error.status === 408 || error.status >= 500) return 'unreachable';
  return 'other';
}

/** Kódy klienta IBKR Flex, které znamenají „služba teď nefunguje“. */
const IBKR_UNREACHABLE = new Set(['network', 'timeout', 'bad-response']);
/** Kód Flex Web Service pro „moc dotazů z tohohle tokenu“. */
const IBKR_THROTTLED = '1018';
/** Chyba Flex Web Service, pro kterou klient nemá vlastní větu. */
const IBKR_UNTRANSLATED = 'IBKR Flex služba vrátila chybu';

function ibkrKind(error: IbkrFlexError): FailureKind | null {
  if (error.code === IBKR_THROTTLED || error.code === '429') return 'rateLimit';
  if (IBKR_UNREACHABLE.has(error.code) || /^5\d\d$/.test(error.code)) return 'unreachable';
  if (/^4\d\d$/.test(error.code)) return 'credentials';
  if (error.message.startsWith(IBKR_UNTRANSLATED)) return 'other';
  // přeložené kódy (neplatný token, Query ID…) radí konkrétněji než obecná věta
  return null;
}

const MAX_DETAIL_LENGTH = 400;
const REDACTED = '…';

/** Kratší hodnotu nemažeme naslepo — trefila by se do běžného čísla nebo slova v chybě. */
const MIN_SECRET_LENGTH = 6;

/**
 * Hodnoty, kterými se připojení k brokerovi přihlašuje: ID klíče, tajný klíč,
 * token, Query ID — a u Trading 212 i jejich pár tak, jak jde v hlavičce
 * (`Basic base64(id:tajný klíč)`). Když se údaje nepodaří přečíst, je seznam
 * prázdný: čištění podle vzorů proběhne i tak a chyba synchronizace se kvůli
 * tomu nesmí ztratit.
 */
function credentialSecrets(encrypted: string | null | undefined): string[] {
  if (!encrypted) return [];
  let plain: string;
  try {
    plain = decryptSecret(encrypted);
  } catch {
    return [];
  }
  const values: string[] = [];
  try {
    const parsed: unknown = JSON.parse(plain);
    if (parsed !== null && typeof parsed === 'object') {
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string') values.push(value);
      }
      const { keyId, secret } = parsed as { keyId?: unknown; secret?: unknown };
      if (typeof keyId === 'string' && typeof secret === 'string') {
        values.push(Buffer.from(`${keyId}:${secret}`).toString('base64'));
      }
    } else {
      values.push(plain);
    }
  } catch {
    // starší formát: samotný klíč, ne JSON
    values.push(plain);
  }
  return values.filter((value) => value.length >= MIN_SECRET_LENGTH);
}

/**
 * Text chyby bez přístupových údajů.
 *
 * Chyba synchronizace je určená k přeposlání provozovateli a broker i runtime
 * do ní umí opsat, čím se klient přihlašoval: token IBKR Flex jde v adrese
 * (`?t=…`), klíč Trading 212 v hlavičce `Authorization` a tělo chybové
 * odpovědi umí obojí zopakovat. Maže se proto
 * - cokoli, co se shoduje s uloženými údaji připojení (`secrets`),
 * - hodnoty parametrů adresy, které nesou klíč nebo token,
 * - hodnota hlavičky `Authorization` a údaje `Basic` / `Bearer`, ať stojí kdekoli,
 * - hodnoty klíčů jako `apiKey`, `token`, `secret` v těle odpovědi.
 * Raději smazat o slovo víc než o token míň: je to technický detail, ne věta.
 */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let clean = text;
  // nejdelší napřed: kratší údaj může být částí delšího
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.length >= MIN_SECRET_LENGTH) clean = clean.split(secret).join(REDACTED);
  }
  return (
    clean
      .replace(
        /([?&](?:t|token|key|api[_-]?key|access[_-]?token|secret|password)=)[^&\s"'<>]+/gi,
        `$1${REDACTED}`,
      )
      // „Authorization: Basic abc“, "authorization":"Bearer abc", Authorization: 'abc'
      .replace(
        /(authorization["']?\s*[:=]\s*["']?)((?:basic|bearer|digest|token)\s+)?[^\s"',;<>}]+/gi,
        (_match, prefix: string, scheme: string | undefined) =>
          `${prefix}${scheme ?? ''}${REDACTED}`,
      )
      // údaj Basic/Bearer bez hlavičky; čistě malá písmena za slovem jsou věta, ne údaj
      .replace(
        /\b([Bb]asic|BASIC|[Bb]earer|BEARER)\s+(?=[a-z]*[A-Z0-9+/=._~-])[A-Za-z0-9+/=._~-]{8,}/g,
        `$1 ${REDACTED}`,
      )
      .replace(
        /(["']?\b(?:x-)?(?:api[_-]?key|api[_-]?secret|client[_-]?secret|access[_-]?token|secret|token|password)["']?\s*[:=]\s*["']?)[^\s"',;&<>}]+/gi,
        `$1${REDACTED}`,
      )
  );
}

/** Detail: bez přístupových údajů a krátký (zkracuje se až vyčištěný text). */
function cleanDetail(raw: string, secrets: readonly string[]): string {
  const redacted = redactSecrets(raw, secrets);
  return redacted.length > MAX_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_DETAIL_LENGTH)}…`
    : redacted;
}

/** Věta a detail oddělené koncem řádku — věta je vždy jednořádková. */
const DETAIL_SEPARATOR = '\n';

/** Věta a detail k chybě, kterou synchronizace účtu skončila. */
export function describeSyncFailure(error: unknown, account: FailedAccount): SyncFailure {
  const secrets = credentialSecrets(account.credentialsEncrypted);
  const raw = errorText(error, 2000);
  const kind =
    error instanceof Trading212ApiError
      ? trading212Kind(error)
      : error instanceof IbkrFlexError
        ? ibkrKind(error)
        : null;
  if (kind !== null) return { text: sentence(kind, account), detail: cleanDetail(raw, secrets) };
  // Zbylé chyby klientů brokerů jsou hotové české věty, které už říkají, co
  // dělat („vygeneruj nový token a ulož ho znovu“, „Spusť synchronizaci
  // znovu“). Detail u nich nese jen kód — a hlavně odlišuje větu, která radu
  // má, od staršího záznamu bez detailu: tomu stránka přidává obecné „Spusť
  // ji znovu…“ a za větou klienta by ta rada stála podruhé, u neplatného
  // tokenu navíc špatně.
  if (error instanceof IbkrFlexError) {
    return { text: redactSecrets(error.message, secrets), detail: `Kód IBKR Flex: ${error.code}` };
  }
  if (error instanceof Trading212ApiError) {
    return {
      text: redactSecrets(error.message, secrets),
      detail: `Stav odpovědi Trading 212: ${error.status}`,
    };
  }
  // chyby runtime (síť, jiný tvar odpovědi) mají vlastní české věty — K5-09, K5-10
  const translated = syncErrorText(error);
  if (translated !== errorText(error))
    return { text: translated, detail: cleanDetail(raw, secrets) };
  // Chyba, kterou nic nepřeložilo, jde na obrazovku tak, jak je — čistí se
  // proto i ona. Víc řádků: první je věta, zbytek detail (tak se to i uloží
  // a přečte), a čistí se každý z nich.
  const [first = '', ...rest] = translated.split(DETAIL_SEPARATOR);
  const text = redactSecrets(first, secrets);
  return rest.length === 0
    ? { text }
    : { text, detail: cleanDetail(rest.join(DETAIL_SEPARATOR), secrets) };
}

/** Chyba v podobě, v jaké se ukládá do `lastSyncError`. */
export function storedSyncFailure(error: unknown, account: FailedAccount): string {
  const { text, detail } = describeSyncFailure(error, account);
  return detail === undefined ? text : `${text}${DETAIL_SEPARATOR}${detail}`;
}

/** Přečte uložený `lastSyncError` zpátky na větu a detail. */
export function parseSyncFailure(stored: string): SyncFailure {
  const split = stored.indexOf(DETAIL_SEPARATOR);
  if (split < 0) return { text: stored };
  return { text: stored.slice(0, split), detail: stored.slice(split + DETAIL_SEPARATOR.length) };
}
