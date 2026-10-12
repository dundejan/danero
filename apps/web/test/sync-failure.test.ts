import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IbkrFlexError, Trading212ApiError } from '@danero/importers';
import { accountStates } from '@/app/(app)/import/account-state';
import { encryptSecret } from '@/lib/crypto';
import {
  describeSyncFailure,
  parseSyncFailure,
  redactSecrets,
  storedSyncFailure,
  type FailedAccount,
} from '@/lib/sync-failure';

/**
 * Chyba synchronizace se uživateli vypisovala syrově: „Trading212 API 500 na
 * /history/exports: {…}“. Nepozná z toho, jestli má něco udělat, počkat, nebo
 * napsat nám. Na obrazovce má být věta podle druhu chyby — broker neodpovídá,
 * klíč nefunguje, moc dotazů — a syrový text až za rozbalením, kde ho najde,
 * když ho bude chtít poslat provozovateli.
 */
const T212 = { broker: 'trading212', label: 'Trading 212' };
const IBKR = { broker: 'ibkr', label: 'Interactive Brokers' };

const t212 = (status: number, path = '/history/exports', body = '{"code":"InternalError"}') =>
  new Trading212ApiError(status, `Trading212 API ${status} na ${path}: ${body}`);

describe('věta podle druhu chyby', () => {
  it('broker neodpovídá: chyba serveru, vypršený export i síť', () => {
    for (const error of [
      t212(500),
      t212(503, '/equity/portfolio', '<html>Service Unavailable</html>'),
      new Trading212ApiError(500, 'Export 123 selhal na straně Trading212.'),
      new Trading212ApiError(408, 'Export 123 nebyl vygenerován ani po 4 dotazech (260 s).'),
      new Trading212ApiError(502, 'Stažení exportu selhalo (502)'),
    ]) {
      const failure = describeSyncFailure(error, T212);
      expect(failure.text).toBe(
        'Trading 212 teď neodpovídá. Zkus to za chvíli znovu — co už se stáhlo, zůstává.',
      );
      expect(failure.detail).toBe(error.message);
    }

    const network = describeSyncFailure(new TypeError('fetch failed'), T212);
    expect(network.text).toContain('Nepodařilo se spojit se serverem brokera');
    expect(network.text).not.toContain('fetch failed');
    expect(network.detail).toBe('fetch failed');

    const ibkr = describeSyncFailure(
      new IbkrFlexError('503', 'IBKR Flex služba neodpovídá (HTTP 503) — zkus synchronizaci za chvíli znovu.'),
      IBKR,
    );
    expect(ibkr.text).toBe(
      'Interactive Brokers teď neodpovídá. Zkus to za chvíli znovu — co už se stáhlo, zůstává.',
    );
    expect(ibkr.detail).toContain('HTTP 503');
  });

  it('neplatný klíč: říká, co s ním', () => {
    const rejected = describeSyncFailure(t212(401, '/equity/account/cash', ''), T212);
    expect(rejected.text).toMatch(/Trading 212 klíč odmítl/);
    expect(rejected.text).toMatch(/napoj/);
    expect(rejected.text).not.toMatch(/Zkus to za chvíli/);
    expect(rejected.detail).toContain('401');

    // 403 = klíč platí, ale nemá práva; věta vyjmenuje, která jsou potřeba
    const forbidden = describeSyncFailure(t212(403), T212);
    expect(forbidden.text).toMatch(/nemá potřebná oprávnění/);
    expect(forbidden.text).toMatch(/Account data, History/);
    expect(forbidden.detail).toContain('Trading212 API 403');

    const ibkr = describeSyncFailure(
      new IbkrFlexError('403', 'IBKR Flex služba odmítla požadavek (HTTP 403) — zkontroluj token a Query ID v nastavení.'),
      IBKR,
    );
    expect(ibkr.text).toMatch(/Interactive Brokers přístup odmítl/);
    expect(ibkr.text).toMatch(/token a Query ID/);
    expect(ibkr.detail).toContain('HTTP 403');
  });

  it('limit dotazů: stačí počkat', () => {
    const limited = describeSyncFailure(
      new Trading212ApiError(429, 'Trading212 API: rate limit i po opakování (/history/exports)'),
      T212,
    );
    expect(limited.text).toBe(
      'Trading 212 omezil počet dotazů. Zkus to za pár minut znovu — co už se stáhlo, zůstává.',
    );
    expect(limited.detail).toContain('rate limit');

    const ibkr = describeSyncFailure(
      new IbkrFlexError('1018', 'IBKR Flex služba vrátila chybu 1018: Too many requests have been made from this token.'),
      IBKR,
    );
    expect(ibkr.text).toMatch(/Interactive Brokers omezil počet dotazů/);
    expect(ibkr.detail).toContain('1018');
  });

  it('jiná chyba brokera: obecná věta a detail k odeslání', () => {
    const odd = describeSyncFailure(t212(400, '/history/exports', '{"errorMessage":"Bad dates"}'), T212);
    expect(odd.text).toBe(
      'Synchronizace se nepovedla. Zkus ji znovu; když to potrvá, napiš nám a přilož technický detail.',
    );
    expect(odd.detail).toContain('Bad dates');

    const ibkr = describeSyncFailure(
      new IbkrFlexError('1099', 'IBKR Flex služba vrátila chybu 1099: Something odd'),
      IBKR,
    );
    expect(ibkr.text).toMatch(/Synchronizace se nepovedla/);
    expect(ibkr.detail).toContain('1099');
  });

  it('věta, která už lidská je, projde beze změny', () => {
    const ibkr = new IbkrFlexError('1012', 'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.');
    const t212Partial = new Trading212ApiError(502, 'Stažený export je neúplný — přišlo 10 z 20 bajtů, přenos se zřejmě přerušil. Spusť synchronizaci znovu.');
    const plain = new Error('Účet u brokera byl během synchronizace odpojen — sync přerušen.');
    // věty klientů brokerů nesou jako detail jen kód chyby (pro podporu) …
    expect(describeSyncFailure(ibkr, IBKR)).toEqual({ text: ibkr.message, detail: 'Kód IBKR Flex: 1012' });
    expect(describeSyncFailure(t212Partial, T212)).toEqual({
      text: t212Partial.message,
      detail: 'Stav odpovědi Trading 212: 502',
    });
    // … obyčejná chyba detail nemá
    expect(describeSyncFailure(plain, T212)).toEqual({ text: plain.message });
  });

  it('technický detail nenese přístupové údaje a je krátký', () => {
    const leaky = describeSyncFailure(
      new TypeError('fetch failed: https://ndcdyn.interactivebrokers.com/Flex/GetStatement?t=TAJNY-TOKEN-123456&q=987&v=3'),
      IBKR,
    );
    expect(leaky.detail).not.toContain('TAJNY-TOKEN-123456');
    expect(leaky.detail).toContain('GetStatement');

    const long = describeSyncFailure(t212(500, '/x', 'x'.repeat(2000)), T212);
    expect(long.detail!.length).toBeLessThanOrEqual(401);
  });
});

describe('uložení do jednoho sloupce', () => {
  it('věta a detail se uloží spolu a přečtou zpátky', () => {
    const stored = storedSyncFailure(t212(500), T212);
    expect(parseSyncFailure(stored)).toEqual(describeSyncFailure(t212(500), T212));
    expect(stored.startsWith('Trading 212 teď neodpovídá.')).toBe(true);
  });

  it('starší záznam bez detailu je celý věta', () => {
    expect(parseSyncFailure('Trading 212 neodpovídá.')).toEqual({ text: 'Trading 212 neodpovídá.' });
  });

  it('detail smí mít víc řádků (tělo odpovědi brokera)', () => {
    const error = t212(502, '/history/exports', '<html>\n<body>Bad Gateway</body>\n</html>');
    const parsed = parseSyncFailure(storedSyncFailure(error, T212));
    expect(parsed.text).toMatch(/teď neodpovídá/);
    expect(parsed.detail).toContain('<body>Bad Gateway</body>');
  });
});

describe('stav účtu na Zdrojích dat', () => {
  const account = (lastSyncError: string) => ({
    label: 'Trading 212',
    lastSyncError,
    lastSyncedAt: null,
    lastSyncStatus: 'error',
  });
  const text = (node: React.ReactNode): string =>
    renderToStaticMarkup(node as ReactElement).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('syrová chyba brokera není vidět — jen věta, detail za rozbalením', () => {
    const [failure] = accountStates(account(storedSyncFailure(t212(500), T212)), null, 'nápověda');
    expect(failure!.text).toBe('Poslední synchronizace selhala');
    expect(failure!.note).toBe(
      'Trading 212 teď neodpovídá. Zkus to za chvíli znovu — co už se stáhlo, zůstává.',
    );
    expect(failure!.note).not.toContain('Trading212 API');
    expect(failure!.details?.summary).toBe('Technický detail');
    expect(text(failure!.details?.body)).toContain('Trading212 API 500 na /history/exports');
  });

  it('věta bez detailu dostane radu zkusit to znovu jako dřív', () => {
    const [failure] = accountStates(account('Spojení spadlo.'), null, 'nápověda');
    expect(failure!.note).toBe(
      'Spojení spadlo. Spusť ji znovu — co už se stáhlo, zůstává a nic se nezdvojí.',
    );
    expect(failure!.details).toBeUndefined();
  });

  /**
   * Věta klienta už říká, co dělat. Bez detailu ji stránka brala jako starší
   * záznam a přidala obecné „Spusť ji znovu…“: „…a ulož ho znovu. Spusť ji
   * znovu — co už se stáhlo, zůstává“ (u neplatného tokenu navíc špatná rada)
   * a „Spusť synchronizaci znovu. Spusť ji znovu…“.
   */
  it('za větu klienta, která radu už má, se obecná rada nepřidává', () => {
    for (const [error, acc] of [
      [new IbkrFlexError('1012', 'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.'), IBKR],
      [new Trading212ApiError(502, 'Stažený export je neúplný — přišlo 10 z 20 bajtů, přenos se zřejmě přerušil. Spusť synchronizaci znovu.'), T212],
    ] as const) {
      const [failure] = accountStates(account(storedSyncFailure(error, acc)), null, 'nápověda');
      expect(failure!.note).toBe(error.message);
      expect(failure!.note).not.toContain('Spusť ji znovu');
      expect(failure!.details?.summary).toBe('Technický detail');
    }
  });
});

/**
 * Nález revize R6 (č. 6): čištění přístupových údajů se týkalo jen detailu
 * a jen parametrů adresy. Naměřeno: token v první větě nepřeložené chyby
 * prošel celý, `Authorization: Bearer …` v těle odpovědi taky a druhý řádek
 * víceřádkové chyby se stal „detailem“ bez čištění. Text chyby je určený
 * k přeposlání provozovateli — nesmí v něm zůstat nic, čím se dá přihlásit.
 */
describe('chyba synchronizace nenese přístupové údaje (R6)', () => {
  const TOKEN = '123456789012345678901234';
  const KEY_ID = 'smysleny-klic-id-4242';
  const KEY_SECRET = 'smysleny-tajny-klic-8899';
  const BASIC = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
  const SECRETS = [TOKEN, KEY_ID, KEY_SECRET, BASIC];

  /** Všechno, co se k chybě uloží a ukáže — věta i detail. */
  const everything = (error: unknown, account: FailedAccount): string => {
    const stored = storedSyncFailure(error, account);
    const parsed = parseSyncFailure(stored);
    // uložený text a jeho přečtení musí říkat totéž — nic se nesmí schovat mezi řádky
    expect([parsed.text, parsed.detail].filter(Boolean).join('\n')).toBe(stored);
    return stored;
  };
  const expectClean = (text: string): void => {
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
  };

  it('token v adrese zmizí i z první věty nepřeložené chyby', () => {
    const text = everything(
      new TypeError(`Failed to parse URL from https://x/SendRequest?t=${TOKEN}&q=1`),
      IBKR,
    );
    expectClean(text);
    // zbytek chyby zůstává čitelný
    expect(text).toContain('Failed to parse URL from https://x/SendRequest?t=');
    expect(text).toContain('&q=1');
  });

  it('parametr adresy se pozná bez ohledu na velikost písmen', () => {
    const text = everything(
      new IbkrFlexError('500', `IBKR Flex služba neodpovídá (HTTP 500) https://x/?T=${TOKEN}&Token=${TOKEN}`),
      IBKR,
    );
    expectClean(text);
  });

  it('hlavička Authorization a údaje Basic/Bearer zmizí z těla odpovědi', () => {
    for (const body of [
      `{"code":"Unauthorized","apiKey":"${KEY_SECRET}","authorization":"Basic ${BASIC}"}`,
      `Authorization: Bearer ${TOKEN}`,
      `authorization=Basic ${BASIC}; x-api-key: ${KEY_SECRET}`,
      `request headers: { Authorization: '${KEY_SECRET}' }`,
    ]) {
      const text = everything(t212(401, '/equity/account/cash', body), T212);
      expectClean(text);
      expect(text).toMatch(/Trading 212 klíč odmítl/);
      expect(text).toContain('Trading212 API 401 na /equity/account/cash');
    }
  });

  it('víceřádková chyba: čistí se každý řádek, ne jen první', () => {
    const text = everything(
      new Error(`první řádek\nAuthorization: Basic ${BASIC}\ntřetí řádek ?token=${TOKEN}`),
      T212,
    );
    expectClean(text);
    const parsed = parseSyncFailure(text);
    expect(parsed.text).toBe('první řádek');
    expect(parsed.detail).toContain('třetí řádek');
  });

  it('uložený klíč nebo token připojení zmizí, i když ho nic neoznačuje', () => {
    const t212Account = {
      ...T212,
      credentialsEncrypted: encryptSecret(JSON.stringify({ keyId: KEY_ID, secret: KEY_SECRET })),
    };
    const ibkrAccount = {
      ...IBKR,
      credentialsEncrypted: encryptSecret(JSON.stringify({ token: TOKEN, queryId: '998877' })),
    };
    // starší formát T212: samotný klíč, ne JSON
    const legacyAccount = { ...T212, credentialsEncrypted: encryptSecret(KEY_SECRET) };

    expectClean(
      everything(t212(500, '/history/exports', `klient ${KEY_ID} / ${KEY_SECRET} nenalezen`), t212Account),
    );
    expectClean(everything(new Error(`upstream odmítl ${BASIC}`), t212Account));
    expectClean(everything(new Error(`neznámý účet ${TOKEN}\ndruhý řádek ${TOKEN}`), ibkrAccount));
    expectClean(everything(t212(500, '/x', `echo ${KEY_SECRET}`), legacyAccount));
  });

  it('údaje, které se nepodaří rozšifrovat, čištění neshodí', () => {
    const broken = { ...T212, credentialsEncrypted: 'tohle-neni-sifra' };
    expect(() => storedSyncFailure(t212(500), broken)).not.toThrow();
    expect(describeSyncFailure(t212(500), broken).text).toMatch(/teď neodpovídá/);
  });

  it('běžný text chyby čištění nemění', () => {
    for (const message of [
      'IBKR Flex služba odmítla požadavek (HTTP 403) — zkontroluj token a Query ID v nastavení.',
      'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.',
      'IBKR Flex služba vrátila chybu 1018: Too many requests have been made from this token.',
      'Stažený export je neúplný — přišlo 10 z 20 bajtů, přenos se zřejmě přerušil. Spusť synchronizaci znovu.',
      'Trading212 API 500 na /history/exports: {"code":"InternalError"}',
      'upstream returned basic information only, bearer unknown',
    ]) {
      expect(redactSecrets(message)).toBe(message);
    }
  });
});
