import type { Tone } from '@/components/ui/status';
import {
  deriveSyncStatus,
  syncStatusLabel,
  type BrokerAccountRow,
  type StoredReconciliation,
} from '@/lib/broker-sync';
import { plural } from '@/lib/format';
import { parseSyncFailure } from '@/lib/sync-failure';
import { tidy } from '@/lib/typography';

export interface AccountState {
  /** Stálý klíč pro vykreslení seznamu stavů. */
  key: 'sync' | 'positions';
  tone: Tone;
  /** Stav jednou větou. */
  text: string;
  /** Tichá věta pod stavem: co se stalo nebo co udělat. */
  note?: string;
  /** Podrobnosti na požádání (rozdíly v pozicích, výklad neúplné historie). */
  details?: { summary: string; body: React.ReactNode };
}

type AccountFields = Pick<
  BrokerAccountRow,
  'label' | 'lastSyncError' | 'lastSyncedAt' | 'lastSyncStatus'
>;

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const RETRY_HINT = 'Spusť ji znovu — co už se stáhlo, zůstává a nic se nezdvojí.';

/**
 * Co pod stavem „synchronizace selhala“ stojí: věta pro člověka a — když
 * chyba nese i syrový text od brokera — ten až za rozbalením, ať ho jde
 * poslat provozovateli (`lib/sync-failure.ts`). Věta s detailem už říká, co
 * dělat (počkat, vyměnit klíč); starší záznam bez detailu dostane obecnou
 * radu zkusit to znovu jako dřív.
 */
function failureNote(stored: string): Pick<AccountState, 'note' | 'details'> {
  const { text, detail } = parseSyncFailure(stored);
  if (detail === undefined) return { note: `${text} ${RETRY_HINT}` };
  return {
    note: text,
    details: {
      summary: 'Technický detail',
      // syrový text bývá JSON nebo adresa bez mezer — smí se zlomit kdekoli
      body: <p className="whitespace-pre-wrap wrap-anywhere">{detail}</p>,
    },
  };
}

const instruments = (count: number): string =>
  `${count} ${plural(count, 'instrument', 'instrumenty', 'instrumentů')}`;

/**
 * Co říká poslední kontrola pozic. `stale` = od té doby selhal další běh, takže
 * je to poslední ZNÁMÝ stav, ne dnešní — věta to říká minulým časem a zelená
 * ustupuje (nad červeným „selhala“ by „sedí“ znělo jako dnešní potvrzení).
 */
function positionsState(
  account: AccountFields,
  reconciliation: StoredReconciliation,
  stale: boolean,
): AccountState {
  if (reconciliation.ok) {
    return {
      key: 'positions',
      tone: stale ? 'neutral' : 'success',
      text: stale
        ? `Při poslední kontrole pozice seděly s ${account.label} · ${instruments(reconciliation.matchedCount)}`
        : `Pozice sedí s ${account.label} · ${instruments(reconciliation.matchedCount)}`,
    };
  }
  if (reconciliation.warning) {
    // Data jsou stažená, jen kontrola pozic má výhradu (neúplná historie,
    // broker neposlal pozice). Krátké znění stavu drží `syncStatusLabel`,
    // celé zdůvodnění z enginu je na požádání. Po selhání dalšího běhu nese
    // účet stav „chyba“, proto se znění odvodí z uložené kontroly.
    const status = stale ? deriveSyncStatus(0, reconciliation) : account.lastSyncStatus;
    return {
      key: 'positions',
      tone: 'caution',
      text: `${stale ? 'Poslední kontrola: ' : ''}${
        stale ? syncStatusLabel(status) : capitalize(syncStatusLabel(status))
      }`,
      details: { summary: 'Co to znamená', body: <p>{tidy(reconciliation.warning)}</p> },
    };
  }
  const differences = reconciliation.issues.length + reconciliation.unmatchedTickers.length;
  return {
    key: 'positions',
    tone: 'caution',
    text: stale
      ? `Při poslední kontrole pozice neseděly s ${account.label}`
      : `Pozice nesedí s ${account.label}`,
    note: 'Nejspíš chybí část historie nebo korporátní akce.',
    details: {
      summary: stale ? `Rozdíly z poslední kontroly (${differences})` : `Rozdíly (${differences})`,
      body: (
        <>
          <ul className="space-y-1 tabular-nums">
            {reconciliation.issues.map((issue) => (
              <li key={issue.isin}>
                {issue.isin}: vypočteno {issue.expected}, broker {issue.actual}
                {issue.suggestedSplitRatio &&
                  ` → vypadá to na split ${issue.suggestedSplitRatio.from}:${issue.suggestedSplitRatio.to}`}
              </li>
            ))}
            {reconciliation.unmatchedTickers.length > 0 && (
              <li>Nespárované tickery: {reconciliation.unmatchedTickers.join(', ')}</li>
            )}
          </ul>
          <p className="mt-2">
            Malé rozdíly bývají dnešní obchody, které broker do exportu propíše se zpožděním — další
            synchronizace je srovná sama. Trvalý rozdíl znamená chybějící historii nebo korporátní
            akci.
          </p>
        </>
      ),
    },
  };
}

/**
 * Stav připojeného účtu: nejvýš dvě věty, každá o něčem jiném.
 *
 * Selhání celého běhu (pád API) žije VEDLE kontroly pozic — ta drží poslední
 * platný stav a chybou se nepřepisuje (`lib/broker-sync.ts`). Jsou to dvě
 * nezávislé informace, proto se ukážou obě: že synchronizace selhala, i co
 * říkala poslední kontrola. První verze redesignu při selhání skončila hned
 * a nesoulad pozic s návrhem splitu zamlčela (R5-04).
 */
export function accountStates(
  account: AccountFields,
  reconciliation: StoredReconciliation | null,
  firstSyncHint: string,
): AccountState[] {
  if (account.lastSyncError) {
    const failure: AccountState = {
      key: 'sync',
      tone: 'danger',
      text: 'Poslední synchronizace selhala',
      ...failureNote(account.lastSyncError),
    };
    // kontrola, která sama skončila chybou, by řekla totéž podruhé
    if (!reconciliation || reconciliation.error) return [failure];
    return [failure, positionsState(account, reconciliation, true)];
  }
  if (!reconciliation) {
    return [
      account.lastSyncedAt
        ? {
            key: 'sync',
            tone: 'neutral',
            text: capitalize(syncStatusLabel(account.lastSyncStatus)),
          }
        : {
            key: 'sync',
            tone: 'neutral',
            text: 'Připojeno. Zbývá stáhnout historii.',
            note: firstSyncHint,
          },
    ];
  }
  if (reconciliation.error) {
    return [
      {
        key: 'sync',
        tone: 'danger',
        text: 'Synchronizace selhala',
        ...failureNote(reconciliation.error),
      },
    ];
  }
  return [positionsState(account, reconciliation, false)];
}
