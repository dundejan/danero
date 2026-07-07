import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { getDb } from '@/db';
import { brokerAccounts, importBatches } from '@/db/schema';
import type { StoredReconciliation } from '@/lib/t212-sync';
import { requireUser } from '@/lib/session';
import { syncTrading212Action } from '../nastaveni/actions';
import { uploadImportAction } from './actions';

interface BatchIssues {
  errors?: Array<{ line: number; message: string }>;
  warnings?: Array<{ line: number; message: string }>;
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const { chyba } = await searchParams;
  const batches = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.userId, user.id))
    .orderBy(desc(importBatches.createdAt))
    .limit(20);
  const t212Accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  const t212 = t212Accounts[0];
  const reconciliation = (t212?.lastReconciliation ?? null) as StoredReconciliation | null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Import dat</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Stačí připojit Trading212 API klíč — Danero si stáhne kompletní historii samo
          a pak ji denně aktualizuje. Ruční nahrání CSV je záložní varianta (a cesta pro
          jiné brokery přes{' '}
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
            : 'Vyber aspoň jeden CSV soubor.'}
        </p>
      )}

      <Card className="space-y-3">
        <CardTitle>Trading212 — automatická synchronizace</CardTitle>
        {t212 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-inkoust-tlumeny">
                {t212.lastSyncedAt
                  ? `Naposledy ${t212.lastSyncedAt.toLocaleString('cs-CZ')} (${t212.lastSyncStatus}). Stahuje se běžný rok; kompletní historie proběhla při prvním spuštění.`
                  : 'První synchronizace projde všechny roky od založení účtu — může trvat i pár minut, generování exportů dělá Trading212.'}
              </p>
              <form action={syncTrading212Action}>
                <SubmitButton variant="secondary" pendingLabel="Synchronizuji… (i minuty)">
                  {t212.lastSyncedAt ? 'Synchronizovat teď' : 'Stáhnout kompletní historii'}
                </SubmitButton>
              </form>
            </div>
            {reconciliation && (
              <div className="space-y-1 border-t border-linka pt-3">
                {reconciliation.ok ? (
                  <p className="text-sm font-medium text-zelena">
                    Pozice sedí s Trading212 ({reconciliation.matchedCount} instrumentů).
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-jantar">
                      Pozice nesedí s Trading212 — pravděpodobně chybí historie nebo
                      korporátní akce:
                    </p>
                    {reconciliation.error && (
                      <p className="text-sm text-cervena">{reconciliation.error}</p>
                    )}
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
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-inkoust-tlumeny">
            Připoj read-only API klíč v{' '}
            <Link href="/nastaveni#trading212" className="font-medium text-ruzova">
              nastavení
            </Link>{' '}
            — Danero si pak stáhne kompletní historii od založení účtu, denně ji
            aktualizuje a hlídá, že pozice sedí.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>Ruční nahrání CSV (záložní varianta)</CardTitle>
        <form action={uploadImportAction} className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <input
            type="file"
            name="soubory"
            accept=".csv,text/csv"
            multiple
            required
            className="flex-1 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-pozadi file:px-4 file:py-2 file:text-sm file:font-semibold file:text-inkoust"
          />
          <SubmitButton pendingLabel="Nahrávám a počítám…">Nahrát výpisy</SubmitButton>
        </form>
        <p className="text-xs text-inkoust-tlumeny">
          T212: History → Export, všechny kategorie, po jednom roce. Opakované nahrání
          nic nezdvojí — deduplikace je součástí importu.
        </p>
      </Card>

      <section className="space-y-3">
        <CardTitle>Historie importů</CardTitle>
        {batches.length === 0 && (
          <p className="text-sm text-inkoust-tlumeny">
            Zatím žádná data. Nahraj export z Trading212 a Danero pohlídá zbytek.
          </p>
        )}
        {batches.map((batch) => {
          const issues = batch.issues as BatchIssues;
          return (
            <Card key={batch.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm">{batch.filename}</span>
                <span className="text-xs text-inkoust-tlumeny">
                  {batch.createdAt.toLocaleString('cs-CZ')} · {batch.broker}
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
