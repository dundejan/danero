import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { accountStates } from '@/app/(app)/import/account-state';
import type { StoredReconciliation } from '@/lib/broker-sync';

/**
 * Stav připojeného účtu na Zdrojích dat (R5-04).
 *
 * Selhání běhu synchronizace a výsledek poslední kontroly pozic jsou dvě
 * nezávislé informace: chyba se zapisuje vedle uložené kontroly a nepřepisuje
 * ji. Redesign při selhání skončil u první z nich — účet, kterému poslední
 * kontrola našla nesoulad (a navrhla split), o tom po pádu dalšího běhu
 * neřekl nic. Původní verze ukazovala obojí.
 */
const reconciliation = (over: Partial<StoredReconciliation> = {}): StoredReconciliation => ({
  ok: true,
  matchedCount: 3,
  unmatchedTickers: [],
  issues: [],
  ...over,
});

const account = (over: Partial<Parameters<typeof accountStates>[0]> = {}) => ({
  label: 'Trading 212',
  lastSyncError: null,
  lastSyncedAt: new Date('2026-10-09T08:00:00Z'),
  lastSyncStatus: 'ok',
  ...over,
});

const MISMATCH = reconciliation({
  ok: false,
  issues: [
    {
      kind: 'quantity',
      isin: 'US0378331005',
      expected: '10',
      actual: '40',
      suggestedSplitRatio: { from: '1', to: '4' },
    },
  ],
  unmatchedTickers: ['XYZ'],
});

const text = (node: React.ReactNode): string =>
  renderToStaticMarkup(node as ReactElement)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('stav připojeného účtu', () => {
  it('selhaný běh nezamlčí nesoulad pozic z poslední kontroly', () => {
    const states = accountStates(
      account({ lastSyncError: 'Trading 212 neodpovídá.', lastSyncStatus: 'error' }),
      MISMATCH,
      'nápověda',
    );
    expect(states.map((state) => state.key)).toEqual(['sync', 'positions']);

    const [failure, positions] = states;
    expect(failure!.tone).toBe('danger');
    expect(failure!.text).toBe('Poslední synchronizace selhala');
    expect(failure!.note).toContain('Trading 212 neodpovídá.');
    expect(failure!.note).toContain('nic se nezdvojí');

    expect(positions!.tone).toBe('caution');
    // minulý čas: je to poslední známý stav, ne výsledek běhu, který spadl
    expect(positions!.text).toBe('Při poslední kontrole pozice neseděly s Trading 212');
    expect(positions!.details?.summary).toBe('Rozdíly z poslední kontroly (2)');
    const body = text(positions!.details?.body);
    expect(body).toContain('US0378331005: vypočteno 10, broker 40');
    expect(body).toContain('vypadá to na split 1:4');
    expect(body).toContain('Nespárované tickery: XYZ');
  });

  it('selhaný běh nezamlčí ani výhradu poslední kontroly', () => {
    const states = accountStates(
      account({ lastSyncError: 'Spojení spadlo.', lastSyncStatus: 'error' }),
      reconciliation({ ok: false, warning: 'Z roku 2022 nemáme ani jednu transakci.' }),
      'nápověda',
    );
    expect(states).toHaveLength(2);
    // účet po pádu nese stav „chyba“ — znění se musí odvodit z uložené kontroly
    expect(states[1]!.text).toBe('Poslední kontrola: pozice sedí, historie neúplná');
    expect(states[1]!.text).not.toContain('chyba');
    expect(text(states[1]!.details?.body)).toContain('Z roku 2022 nemáme');
  });

  it('po selhání nepotvrzuje shodu zeleně, jen ji připomene', () => {
    const states = accountStates(
      account({ lastSyncError: 'Spojení spadlo.', lastSyncStatus: 'error' }),
      reconciliation(),
      'nápověda',
    );
    expect(states).toHaveLength(2);
    expect(states[1]!.tone).toBe('neutral');
    expect(states[1]!.text).toBe(
      'Při poslední kontrole pozice seděly s Trading 212 · 3 instrumenty',
    );
  });

  it('neopakuje chybu dvakrát, když selhala i sama kontrola', () => {
    const states = accountStates(
      account({ lastSyncError: 'Spojení spadlo.', lastSyncStatus: 'error' }),
      reconciliation({ ok: false, error: 'Spojení spadlo.' }),
      'nápověda',
    );
    expect(states.map((state) => state.key)).toEqual(['sync']);
  });

  it('bez chyby zůstává jediná věta jako dřív', () => {
    expect(accountStates(account(), reconciliation(), 'nápověda')).toEqual([
      { key: 'positions', tone: 'success', text: 'Pozice sedí s Trading 212 · 3 instrumenty' },
    ]);

    const [mismatch] = accountStates(account({ lastSyncStatus: 'mismatch' }), MISMATCH, 'nápověda');
    expect(mismatch!.text).toBe('Pozice nesedí s Trading 212');
    expect(mismatch!.details?.summary).toBe('Rozdíly (2)');

    const [incomplete] = accountStates(
      account({ lastSyncStatus: 'incomplete' }),
      reconciliation({ ok: false, warning: 'Chybí rok 2022.' }),
      'nápověda',
    );
    expect(incomplete!.text).toBe('Pozice sedí, historie neúplná');
  });

  it('čerstvě připojený účet říká, co zbývá', () => {
    expect(
      accountStates(
        account({ lastSyncedAt: null, lastSyncStatus: null }),
        null,
        'Projde všechny roky.',
      ),
    ).toEqual([
      {
        key: 'sync',
        tone: 'neutral',
        text: 'Připojeno. Zbývá stáhnout historii.',
        note: 'Projde všechny roky.',
      },
    ]);
  });
});
