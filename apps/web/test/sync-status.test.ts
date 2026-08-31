import { describe, expect, it } from 'vitest';
import {
  deriveSyncStatus,
  syncErrorText,
  syncStatusLabel,
  type StoredReconciliation,
} from '@/lib/broker-sync';

/**
 * Díra v historii není nesoulad pozic. Tvrdit „pozice nesedí" tam, kde sedí,
 * je stejná lež jako zelené „sedí" nad neúplnými daty — navíc neodstranitelná,
 * protože starý rok už uživatel z API brokera nedostane (IBKR Flex Query
 * pokrývá jen posledních 365 dní).
 */
const reconciliation = (over: Partial<StoredReconciliation> = {}): StoredReconciliation => ({
  ok: true,
  matchedCount: 3,
  unmatchedTickers: [],
  issues: [],
  ...over,
});

describe('stav synchronizace účtu', () => {
  it('pozice sedí a historie je úplná → v pořádku', () => {
    expect(deriveSyncStatus(0, reconciliation())).toBe('ok');
  });

  it('pozice sedí, ale chybí rok historie → neúplná historie, ne nesoulad', () => {
    const stav = deriveSyncStatus(
      0,
      reconciliation({
        ok: false,
        coverage: {
          firstYear: 2020,
          lastYear: 2026,
          missingYears: [2022],
          historyBeforeFirstBuyMissing: false,
          incompleteIsins: [],
        },
        warning: 'Z roku 2022 nemáme ani jednu transakci…',
      }),
    );
    expect(stav).toBe('incomplete');
  });

  // B4-4: bez sekce Open Positions se neporovnávalo nic. Prázdné `issues`
  // vypadají stejně jako shoda, takže by stav tvrdil „pozice sedí“ o kontrole,
  // která vůbec neproběhla.
  it('broker pozice neposlal → neporovnáno, ne „pozice sedí“', () => {
    const stav = deriveSyncStatus(
      0,
      reconciliation({
        ok: false,
        matchedCount: 0,
        positionsUnavailable: true,
        warning: 'Výpis neobsahuje sekci Open Positions…',
      }),
    );
    expect(stav).toBe('unverified');
    expect(syncStatusLabel(stav)).not.toContain('pozice sedí');
    expect(syncStatusLabel(stav)).toBe('data stažena, pozice jsme neporovnali');
  });

  it('pozice opravdu nesedí → nesoulad', () => {
    const stav = deriveSyncStatus(
      0,
      reconciliation({
        ok: false,
        issues: [{ kind: 'QUANTITY_MISMATCH', isin: 'US0378331005', expected: '10', actual: '12' }],
      }),
    );
    expect(stav).toBe('mismatch');
  });

  it('neznámý ticker u brokera je taky nesoulad, ne neúplná historie', () => {
    expect(
      deriveSyncStatus(0, reconciliation({ ok: false, unmatchedTickers: ['ABCD'] })),
    ).toBe('mismatch');
  });

  it('chybové řádky importu mají přednost před vším', () => {
    expect(deriveSyncStatus(2, reconciliation())).toBe('errors');
    expect(deriveSyncStatus(0, null)).toBe('errors');
  });
});

/**
 * K5-09 + K5-10: `catch` kolem rekonciliace i kolem celého jobu chytá i chyby
 * runtime, takže se do `lastSyncError` (a odtud na /import) dostávaly surové
 * anglické hlášky — naměřeno `positions is not iterable` a `fetch failed`.
 * Uživatel z nich nepozná, jestli má něco udělat, počkat, nebo napsat nám.
 */
describe('text chyby syncu pro uživatele', () => {
  it('síťové selhání se přeloží do češtiny', () => {
    const text = syncErrorText(new TypeError('fetch failed'));
    expect(text).not.toContain('fetch failed');
    expect(text).toContain('spojit se serverem brokera');

    expect(syncErrorText(new Error('connect ECONNREFUSED 1.2.3.4:443'))).toContain(
      'spojit se serverem brokera',
    );
    expect(syncErrorText(new Error('getaddrinfo ENOTFOUND live.trading212.com'))).toContain(
      'spojit se serverem brokera',
    );
  });

  it('změněný tvar odpovědi brokera se přeloží do češtiny', () => {
    const text = syncErrorText(new TypeError('positions is not iterable'));
    expect(text).not.toContain('is not iterable');
    expect(text).toContain('v jiném tvaru');

    expect(syncErrorText(new TypeError("Cannot read properties of undefined (reading 'map')"))).toContain(
      'v jiném tvaru',
    );
  });

  it('vypršené spojení má vlastní větu', () => {
    expect(syncErrorText(new Error('The operation was aborted due to timeout'))).toContain(
      'odpovídal příliš dlouho',
    );
  });

  it('naše vlastní české hlášky projdou beze změny', () => {
    const nase = 'Trading212 API 403 na /equity/portfolio';
    expect(syncErrorText(new Error(nase))).toBe(nase);
    expect(syncErrorText(new Error('Účet u brokera už neexistuje.'))).toBe(
      'Účet u brokera už neexistuje.',
    );
  });
});
