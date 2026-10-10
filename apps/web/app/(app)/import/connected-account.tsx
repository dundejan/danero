import { SyncJobProgress, type SyncJobView } from '@/components/sync-job-progress';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { SectionHeader } from '@/components/ui/section';
import { StatusLabel } from '@/components/ui/status';
import { SubmitButton } from '@/components/ui/submit-button';
import {
  historyScopeText,
  type BrokerAccountRow,
  type StoredReconciliation,
} from '@/lib/broker-sync';
import { czDateTime } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { accountStates } from './account-state';
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
  const states = accountStates(account, reconciliation, copy.firstSyncHint);
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
          <div className="mt-2 space-y-3">
            {states.map((state) => (
              <div key={state.key}>
                <StatusLabel tone={state.tone}>{state.text}</StatusLabel>
                {state.note && (
                  <p className="type-footnote mt-1 text-pretty text-ink-muted">{state.note}</p>
                )}
                {state.details && (
                  <Disclosure summary={state.details.summary}>{state.details.body}</Disclosure>
                )}
              </div>
            ))}
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
