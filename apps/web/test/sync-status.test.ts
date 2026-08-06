import { describe, expect, it } from 'vitest';
import { deriveSyncStatus, type StoredReconciliation } from '@/lib/broker-sync';

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
