import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { PositionsTable } from '@/components/positions-table';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { czk } from '@/lib/format';
import { analyzeForUser, getProfile, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export default async function OverviewPage() {
  const user = await requireUser();
  const db = await getDb();

  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-24">
        <h1 className="font-display text-3xl font-bold">Zatím žádná data</h1>
        <p className="text-inkoust-tlumeny">
          Nahraj export z Trading212 a Danero pohlídá zbytek — časové testy, limity
          i podklady k přiznání.
        </p>
        <Link
          href="/import"
          className="rounded-md bg-ruzova px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Nahrát výpisy
        </Link>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  const { result, positions, labels } = analyzeForUser(txs, profile, year, today);

  const importantWarnings = result.warnings.filter((w) => w.level !== 'INFO');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-3xl font-bold">Přehled {year}</h1>
        <p className="font-mono text-xs text-inkoust-tlumeny">
          {txs.length} transakcí · metoda {result.options.matchingMethod} ·{' '}
          {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB'}
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.limits.flatTax50k.applicable && (
          <LimitGauge
            label="Paušální daň — 50 000 Kč"
            hint="Zdanitelné příjmy § 8–10: neosvobozené tržby z prodejů + zahraniční dividendy brutto. Při překročení podáváš přiznání a přehledy."
            status={result.limits.flatTax50k.status}
          />
        )}
        {result.limits.employee20k.applicable && (
          <LimitGauge
            label="Vedlejší příjmy — 20 000 Kč"
            hint="Zdanitelné příjmy § 7–10 vedle zaměstnání. Při překročení podáváš přiznání."
            status={result.limits.employee20k.status}
          />
        )}
        <LimitGauge
          label="Prodeje CP — 100 000 Kč"
          hint="Úhrn hrubých tržeb z prodeje cenných papírů. Do limitu jsou VŠECHNY prodeje osvobozené; nad limit se daní ty bez časového testu."
          status={result.limits.limit100k}
        />
        <Card className="space-y-1">
          <CardTitle>Orientační daň z investic</CardTitle>
          <p className="font-mono text-lg font-medium">
            {czk(
              result.tax.recommended === 'GENERAL'
                ? result.tax.general.taxCzk
                : result.tax.separate16a.taxCzk,
            )}
          </p>
          <p className="text-xs text-inkoust-tlumeny">
            Základ § 10: {czk(result.securities.base10Czk)} · § 8: {czk(result.dividends.base8Czk)}
            {result.tax.recommended === 'SEPARATE_16A' && ' · doporučen § 16a'}
          </p>
          <p className="text-xs text-inkoust-tlumeny">{result.tax.note}</p>
        </Card>
      </section>

      <HorizonStrip positions={positions} labels={labels} today={today} />

      {importantWarnings.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Upozornění ({importantWarnings.length})</CardTitle>
          {importantWarnings.slice(0, 8).map((warning, i) => (
            <p
              key={`${warning.code}-${i}`}
              className={warning.level === 'ERROR' ? 'text-sm text-cervena' : 'text-sm text-jantar'}
            >
              {warning.message}
            </p>
          ))}
          {importantWarnings.length > 8 && (
            <p className="text-xs text-inkoust-tlumeny">
              … a dalších {importantWarnings.length - 8}. Kompletní seznam bude v reportu.
            </p>
          )}
        </Card>
      )}

      <PositionsTable positions={positions} labels={labels} />
    </div>
  );
}
