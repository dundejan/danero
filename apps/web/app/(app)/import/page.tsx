import { desc, eq } from 'drizzle-orm';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { importBatches } from '@/db/schema';
import { requireUser } from '@/lib/session';
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Import výpisů</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Nahraj CSV exporty z Trading212 (History → Export, všechny kategorie, po jednom
          roce) — potřeba je kompletní historie od prvního nákupu. Opakované nahrání nic
          nezdvojí. Jiného brokera? Použij{' '}
          <a
            className="font-medium text-ruzova"
            href="https://github.com/dundejan/danero/blob/main/docs/06-import.md"
          >
            univerzální šablonu
          </a>
          .
        </p>
      </header>

      {chyba && (
        <p className="rounded-md border border-cervena px-4 py-3 text-sm text-cervena">
          {chyba === 'velikost'
            ? 'Soubor je větší než 20 MB — rozděl export na kratší období.'
            : 'Vyber aspoň jeden CSV soubor.'}
        </p>
      )}

      <Card>
        <form action={uploadImportAction} className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <input
            type="file"
            name="soubory"
            accept=".csv,text/csv"
            multiple
            required
            className="flex-1 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-pozadi file:px-4 file:py-2 file:text-sm file:font-semibold file:text-inkoust"
          />
          <Button type="submit">Nahrát výpisy</Button>
        </form>
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
