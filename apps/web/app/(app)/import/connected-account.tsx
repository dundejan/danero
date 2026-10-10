import { SyncJobProgress, type SyncJobView } from '@/components/sync-job-progress';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { SectionHeader } from '@/components/ui/section';
import { StatusLabel, type Tone } from '@/components/ui/status';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  historyScopeText,
  syncStatusLabel,
  type BrokerAccountRow,
  type StoredReconciliation,
} from '@/lib/broker-sync';
import { czDateTime, plural } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { disconnectBrokerAction, syncBrokerAction } from './actions';

interface BrokerCopy {
  /** Popisek tlačítka, které stáhne historii poprvé. */
  firstSyncButton: string;
  /** Co první stažení udělá — jedna věta pod stavem, dokud neproběhlo. */
  firstSyncHint: string;
  /** Co stahují další synchronizace — do vysvětlivky u data té poslední. */
  regular: string;
  /** Co čekat, když synchronizace běží (jak dlouho, co mezitím přijde). */
  progressHint?: string;
}

/** Neutrální default — broker bez vlastních textů nesmí dostat cizí instrukce. */
const DEFAULT_COPY: BrokerCopy = {
  firstSyncButton: 'Synchronizovat',
  firstSyncHint: 'Stáhne historii od brokera a poběží na pozadí.',
  regular: 'Stahuje se aktuální historie od brokera.',
};

/** Texty podle brokera — liší se tím, kolik historie umí jeho rozhraní vydat. */
const BROKER_COPY: Record<string, BrokerCopy> = {
  trading212: {
    firstSyncButton: 'Stáhnout kompletní historii',
    firstSyncHint: 'Projde všechny roky od založení účtu — může to trvat i deset minut.',
    regular: 'Stahuje se běžný rok; kompletní historie proběhla při prvním spuštění.',
    // Řečeno jednou a v okamžiku, kdy to člověk potřebuje: telefon mu začne
    // pípat notifikacemi „dokumenty připraveny ke stažení“ právě teď.
    progressHint:
      'Asi minuta na každý rok; můžeš odejít, poběží dál. Notifikace o dokumentech ke stažení, které ti Trading 212 mezitím pošle, jsou od nás.',
  },
  ibkr: {
    firstSyncButton: 'Synchronizovat',
    firstSyncHint:
      'Stáhne období nastavené ve Flex Query, typicky posledních 365 dní. Starší historii nahraj jako XML — nic se nezdvojí.',
    regular: 'Stahuje se období nastavené ve Flex Query (typicky posledních 365 dní).',
  },
};

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const RETRY_HINT = 'Spusť ji znovu — co už se stáhlo, zůstává a nic se nezdvojí.';

interface AccountState {
  tone: Tone;
  /** Stav jednou větou. */
  text: string;
  /** Tichá věta pod stavem: co se stalo nebo co udělat. */
  note?: React.ReactNode;
  /** Podrobnosti na požádání (rozdíly v pozicích, výklad neúplné historie). */
  details?: { summary: string; body: React.ReactNode };
}

/**
 * Stav účtu jednou větou a to, co k němu patří. Pořadí větví je pořadí
 * závažnosti: selhání celého běhu (pád API) žije vedle rekonciliace — ta drží
 * poslední platný stav pozic a chybou se nepřepisuje, proto se o ní při
 * selhání zmíní aspoň poznámka.
 */
function accountState(
  account: BrokerAccountRow,
  reconciliation: StoredReconciliation | null,
  copy: BrokerCopy,
): AccountState {
  const instruments = (count: number): string =>
    `${count} ${plural(count, 'instrument', 'instrumenty', 'instrumentů')}`;

  if (account.lastSyncError) {
    return {
      tone: 'danger',
      text: 'Poslední synchronizace selhala',
      note: (
        <>
          {account.lastSyncError} {RETRY_HINT}
          {reconciliation?.ok &&
            ` Pozice z poslední úspěšné synchronizace sedí s ${account.label} (${instruments(reconciliation.matchedCount)}).`}
        </>
      ),
    };
  }
  if (!reconciliation) {
    return account.lastSyncedAt
      ? { tone: 'neutral', text: capitalize(syncStatusLabel(account.lastSyncStatus)) }
      : { tone: 'neutral', text: 'Připojeno. Zbývá stáhnout historii.', note: copy.firstSyncHint };
  }
  if (reconciliation.ok) {
    return {
      tone: 'success',
      text: `Pozice sedí s ${account.label} · ${instruments(reconciliation.matchedCount)}`,
    };
  }
  if (reconciliation.error) {
    return {
      tone: 'danger',
      text: 'Synchronizace selhala',
      note: `${reconciliation.error} ${RETRY_HINT}`,
    };
  }
  if (reconciliation.warning) {
    // Data jsou stažená, jen kontrola pozic má výhradu (neúplná historie,
    // broker neposlal pozice). Krátké znění stavu drží `syncStatusLabel`,
    // celé zdůvodnění z enginu je na požádání.
    return {
      tone: 'caution',
      text: capitalize(syncStatusLabel(account.lastSyncStatus)),
      details: { summary: 'Co to znamená', body: <p>{tidy(reconciliation.warning)}</p> },
    };
  }
  const differences = reconciliation.issues.length + reconciliation.unmatchedTickers.length;
  return {
    tone: 'caution',
    text: `Pozice nesedí s ${account.label}`,
    note: 'Nejspíš chybí část historie nebo korporátní akce.',
    details: {
      summary: `Rozdíly (${differences})`,
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
            Malé rozdíly bývají dnešní obchody, které broker do exportu propíše se zpožděním —
            další synchronizace je srovná sama. Trvalý rozdíl znamená chybějící historii nebo
            korporátní akci.
          </p>
        </>
      ),
    },
  };
}

/**
 * Připojený účet u brokera: stav jednou větou, kdy se naposledy
 * synchronizoval, odkud historie sahá — a dvě akce: synchronizovat a odpojit.
 * Když synchronizace právě běží, je místo toho všeho vidět její průběh.
 *
 * `id` bloku je kód brokera: vede na něj odezva po připojení, odpojení
 * a spuštění synchronizace (`brokerCardAnchor`).
 */
export function ConnectedAccount({
  account,
  activeJob,
}: {
  account: BrokerAccountRow;
  activeJob: SyncJobView | null;
}) {
  const reconciliation = (account.lastReconciliation ?? null) as StoredReconciliation | null;
  const copy = BROKER_COPY[account.broker] ?? DEFAULT_COPY;
  const state = accountState(account, reconciliation, copy);
  // Odkud data vlastně jsou. Patří i pod zelené „pozice sedí“: zavřenou pozici
  // z roku, na který jsme se brokera nezeptali, kontrola pozic neodhalí (B4-3).
  const coverage = reconciliation?.coverage;
  const historyScope = coverage ? historyScopeText(coverage) : null;

  return (
    <div id={account.broker} className="scroll-mt-20">
      <SectionHeader
        as="h3"
        title={account.label}
        actions={
          !activeJob && (
            <form action={syncBrokerAction}>
              <input type="hidden" name="ucet" value={account.id} />
              <SubmitButton
                variant={account.lastSyncedAt ? 'secondary' : 'tinted'}
                size="sm"
                pendingLabel="Spouštím…"
              >
                {account.lastSyncedAt ? 'Synchronizovat teď' : copy.firstSyncButton}
              </SubmitButton>
            </form>
          )
        }
      />
      {activeJob ? (
        <div className="mt-3">
          <SyncJobProgress
            initialJob={activeJob}
            accountId={account.id}
            broker={account.label}
            hint={copy.progressHint}
          />
        </div>
      ) : (
        <>
          <div className="mt-2">
            <StatusLabel tone={state.tone}>{state.text}</StatusLabel>
            {state.note && (
              <p className="type-footnote mt-1 text-pretty text-ink-muted">{state.note}</p>
            )}
            {state.details && (
              <Disclosure summary={state.details.summary}>{state.details.body}</Disclosure>
            )}
          </div>
          <Group className="mt-3" aria-label={`Účet ${account.label}`}>
            {account.lastSyncedAt && (
              <Row
                label="Poslední synchronizace"
                info={
                  <InfoPopover label="Poslední synchronizace" title="Co se synchronizuje">
                    <p>{tidy(copy.regular)}</p>
                    <p>Danero synchronizuje samo každý den; tlačítkem to jen uspíšíš.</p>
                  </InfoPopover>
                }
                value={czDateTime(account.lastSyncedAt)}
              />
            )}
            {coverage?.checkedFromYear !== undefined && historyScope && (
              <Row
                label="Stažená historie"
                info={
                  <InfoPopover label="Stažená historie">
                    <p>{tidy(historyScope)}</p>
                  </InfoPopover>
                }
                value={`od roku ${coverage.checkedFromYear}`}
              />
            )}
            <Row label="Přístupový klíč" hint="uložený šifrovaně, nikde se nezobrazuje">
              <ConfirmDialog
                trigger={
                  <Button variant="danger" size="sm">
                    Odpojit
                  </Button>
                }
                action={disconnectBrokerAction}
                fields={{ ucet: account.id }}
                pendingLabel="Odpojuji…"
                title={`Odpojit ${account.label}?`}
                description="Smažeme uložený klíč a účet se přestane synchronizovat. Transakce, které se z něj už stáhly, zůstanou."
                confirmLabel="Odpojit"
              />
            </Row>
          </Group>
        </>
      )}
    </div>
  );
}
