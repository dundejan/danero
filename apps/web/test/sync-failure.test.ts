import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IbkrFlexError, Trading212ApiError } from '@danero/importers';
import { accountStates } from '@/app/(app)/import/account-state';
import { describeSyncFailure, parseSyncFailure, storedSyncFailure } from '@/lib/sync-failure';

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

  it('věta, která už lidská je, projde beze změny a bez detailu', () => {
    for (const [error, account] of [
      [new IbkrFlexError('1012', 'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.'), IBKR],
      [new Trading212ApiError(502, 'Stažený export je neúplný — přišlo 10 z 20 bajtů, přenos se zřejmě přerušil. Spusť synchronizaci znovu.'), T212],
      [new Error('Účet u brokera byl během synchronizace odpojen — sync přerušen.'), T212],
    ] as const) {
      expect(describeSyncFailure(error, account)).toEqual({ text: error.message });
    }
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
});
