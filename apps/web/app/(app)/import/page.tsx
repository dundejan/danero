import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { SyncJobProgress, type SyncJobView } from '@/components/sync-job-progress';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { getDb } from '@/db';
import { brokerAccounts, importBatches } from '@/db/schema';
import {
  syncStatusLabel,
  type BrokerAccountRow,
  type StoredReconciliation,
} from '@/lib/broker-sync';
import { activeSyncJobsByAccount, toSyncJobView } from '@/lib/jobs';
import { requireUser } from '@/lib/session';
import { syncBrokerAction } from '../nastaveni/actions';
import { deleteBatchAction, uploadImportAction } from './actions';

interface BatchIssues {
  errors?: Array<{ line: number; message: string }>;
  warnings?: Array<{ line: number; message: string }>;
}

interface BrokerCopy {
  firstSync: string;
  regular: string;
  buttonFirst: string;
  note?: string;
}

/** Neutrální default — broker bez vlastních textů nesmí dostat cizí instrukce. */
const DEFAULT_COPY: BrokerCopy = {
  firstSync: 'Synchronizace stáhne historii od brokera a poběží na pozadí.',
  regular: 'Stahuje se aktuální historie od brokera.',
  buttonFirst: 'Synchronizovat',
};

/** Broker-specifické texty sync karty. */
const BROKER_COPY: Record<string, BrokerCopy> = {
  trading212: {
    firstSync:
      'První synchronizace projde všechny roky od založení účtu — kvůli limitům Trading212 může trvat i deset minut. Poběží na pozadí, průběh uvidíš tady.',
    regular: 'Stahuje se běžný rok; kompletní historie proběhla při prvním spuštění.',
    buttonFirst: 'Stáhnout kompletní historii',
    note: 'Trading212 ti k tomu pošle notifikace „dokumenty připraveny ke stažení" — to jsme my, klidně je ignoruj.',
  },
  ibkr: {
    firstSync:
      'Synchronizace stáhne období nastavené ve Flex Query (typicky posledních 365 dní) a poběží na pozadí. Starší historii nahraj jednorázově jako XML soubory níž — nic se nezdvojí.',
    regular: 'Stahuje se období nastavené ve Flex Query (typicky posledních 365 dní).',
    buttonFirst: 'Synchronizovat',
  },
};

function BrokerSyncCard({
  account,
  activeJob,
}: {
  account: BrokerAccountRow;
  activeJob: SyncJobView | null;
}) {
  const reconciliation = (account.lastReconciliation ?? null) as StoredReconciliation | null;
  const copy = BROKER_COPY[account.broker] ?? DEFAULT_COPY;

  return (
    <Card className="space-y-3">
      <CardTitle>{account.label} — automatická synchronizace</CardTitle>
      {activeJob ? (
        <SyncJobProgress initialJob={activeJob} accountId={account.id} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-inkoust-tlumeny">
              {account.lastSyncedAt
                ? `Naposledy ${account.lastSyncedAt.toLocaleString('cs-CZ')} (${syncStatusLabel(account.lastSyncStatus)}). ${copy.regular}`
                : copy.firstSync}{' '}
              {copy.note}
            </p>
            <form action={syncBrokerAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <SubmitButton variant="secondary" pendingLabel="Spouštím…">
                {account.lastSyncedAt ? 'Synchronizovat teď' : copy.buttonFirst}
              </SubmitButton>
            </form>
          </div>
          {reconciliation && (
            <div className="space-y-1 border-t border-linka pt-3">
              {reconciliation.ok ? (
                <p className="text-sm font-medium text-zelena">
                  Pozice sedí s {account.label} ({reconciliation.matchedCount} instrumentů).
                </p>
              ) : reconciliation.error ? (
                <>
                  <p className="text-sm font-medium text-cervena">
                    Synchronizace selhala: {reconciliation.error}
                  </p>
                  <p className="text-sm text-inkoust-tlumeny">
                    Klidně ji spusť znovu — co už se stáhlo, zůstává, a nic se nezdvojí.
                  </p>
                </>
              ) : reconciliation.warning ? (
                <p className="text-sm font-medium text-jantar">{reconciliation.warning}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-jantar">
                    Pozice nesedí s {account.label} — pravděpodobně chybí historie nebo
                    korporátní akce:
                  </p>
                  {reconciliation.issues.map((issue) => (
                    <p key={issue.isin} className="font-mono text-xs text-inkoust-tlumeny">
                      {issue.isin}: vypočteno {issue.expected}, broker {issue.actual}
                      {issue.suggestedSplitRatio &&
                        ` → vypadá to na split ${issue.suggestedSplitRatio.from}:${issue.suggestedSplitRatio.to}`}
                    </p>
                  ))}
                  {reconciliation.unmatchedTickers.length > 0 && (
                    <p className="font-mono text-xs text-inkoust-tlumeny">
                      Nespárované tickery: {reconciliation.unmatchedTickers.join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-inkoust-tlumeny">
                    Malé rozdíly bývají dnešní obchody, které broker do exportu propíše se
                    zpožděním — další synchronizace je srovná sama. Trvalý rozdíl znamená
                    chybějící historii nebo korporátní akci.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const { chyba } = await searchParams;
  const [batches, accounts] = await Promise.all([
    db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, user.id))
      .orderBy(desc(importBatches.createdAt))
      .limit(20),
    db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, user.id)),
  ]);

  // aktivní job per účet → místo tlačítka a rekonciliace živý průběh
  // (jeden dotaz; cestou se samoléčí zaseknuté joby vč. odpojených účtů)
  const activeJobs = await activeSyncJobsByAccount(db, user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Import dat</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Stačí připojit broker účet — Danero si stáhne historii samo a pak ji denně
          aktualizuje. Ruční nahrání souborů je záložní varianta (a cesta pro jiné brokery
          přes{' '}
          <a
            className="font-medium text-ruzova"
            href="https://github.com/dundejan/danero/blob/main/docs/06-import.md"
          >
            univerzální šablonu
          </a>
          ).
        </p>
      </header>

      {chyba && (
        <p className="rounded-md border border-cervena px-4 py-3 text-sm text-cervena">
          {chyba === 'velikost'
            ? 'Soubor je větší než 20 MB — rozděl export na kratší období.'
            : 'Vyber aspoň jeden CSV nebo XML soubor.'}
        </p>
      )}

      {accounts.length === 0 && (
        <Card className="space-y-3">
          <CardTitle>Automatická synchronizace</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Připoj read-only přístup v{' '}
            <Link href="/nastaveni#trading212" className="font-medium text-ruzova">
              nastavení
            </Link>{' '}
            (Trading212 API klíč nebo IBKR Flex token) — Danero si pak stáhne historii,
            denně ji aktualizuje a hlídá, že pozice sedí.
          </p>
        </Card>
      )}
      {accounts.map((account) => {
        const job = activeJobs.get(account.id);
        return (
          <BrokerSyncCard
            key={account.id}
            account={account}
            activeJob={job ? toSyncJobView(job) : null}
          />
        );
      })}

      <Card className="space-y-3">
        <CardTitle>Ruční nahrání výpisů (záložní varianta)</CardTitle>
        <form action={uploadImportAction} className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <input
            type="file"
            name="soubory"
            accept=".csv,text/csv,.xml,text/xml"
            multiple
            required
            className="flex-1 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-pozadi file:px-4 file:py-2 file:text-sm file:font-semibold file:text-inkoust"
          />
          <SubmitButton pendingLabel="Nahrávám a počítám…">Nahrát výpisy</SubmitButton>
        </form>
        <p className="text-xs text-inkoust-tlumeny">
          T212: History → Export (CSV, všechny kategorie, po jednom roce). IBKR: Flex Query
          XML — pro starší historii vytvoř query s obdobím po letech. Opakované nahrání nic
          nezdvojí — deduplikace je součástí importu.
        </p>
      </Card>

      <section className="space-y-3">
        <CardTitle>Historie importů</CardTitle>
        {batches.length === 0 && (
          <p className="text-sm text-inkoust-tlumeny">
            Zatím žádná data. Nahraj export od brokera a Danero pohlídá zbytek.
          </p>
        )}
        {batches.map((batch) => {
          const issues = batch.issues as BatchIssues;
          return (
            <Card key={batch.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm">{batch.filename}</span>
                <span className="flex items-baseline gap-3 text-xs text-inkoust-tlumeny">
                  {batch.createdAt.toLocaleString('cs-CZ')} · {batch.broker}
                  <form action={deleteBatchAction}>
                    <input type="hidden" name="batchId" value={batch.id} />
                    <button
                      type="submit"
                      className="font-medium text-inkoust-tlumeny hover:text-cervena"
                      title="Smaže jen záznam o importu — transakce zůstávají"
                    >
                      smazat záznam
                    </button>
                  </form>
                </span>
              </div>
              <p className="font-mono text-xs text-inkoust-tlumeny">
                {batch.added} nových · {batch.duplicates} duplicit ·{' '}
                <span className={batch.errorCount > 0 ? 'text-cervena' : undefined}>
                  {batch.errorCount} chyb
                </span>{' '}
                · {batch.warningCount} varování · {batch.skippedCount} přeskočeno
              </p>
              {(issues.errors ?? []).slice(0, 10).map((issue) => (
                <p key={`e-${issue.line}`} className="text-xs text-cervena">
                  Řádek {issue.line}: {issue.message}
                </p>
              ))}
              {(issues.warnings ?? []).slice(0, 5).map((issue) => (
                <p key={`w-${issue.line}`} className="text-xs text-jantar">
                  Řádek {issue.line}: {issue.message}
                </p>
              ))}
            </Card>
          );
        })}
      </section>
    </div>
  );
}
