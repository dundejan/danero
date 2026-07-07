import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { PositionsTable } from '@/components/positions-table';
import { Card, CardTitle } from '@/components/ui/card';
import { YearSwitcher } from '@/components/year-switcher';
import { getDb } from '@/db';
import { czk } from '@/lib/format';
import { analyzeForUser, availableYears, getProfile, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
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
  const currentYear = new Date().getFullYear();
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;
  const { result, positions, labels } = analyzeForUser(txs, profile, year, today);

  const importantWarnings = result.warnings.filter((w) => w.level !== 'INFO');
  // stejný typ upozornění (např. nadsmluvní srážka u desítek dividend) = jedna řádka s počtem
  const groupedWarnings = [
    ...importantWarnings
      .reduce((groups, warning) => {
        const existing = groups.get(warning.code);
        if (existing) existing.count += 1;
        else groups.set(warning.code, { count: 1, sample: warning });
        return groups;
      }, new Map<string, { count: number; sample: (typeof importantWarnings)[number] }>())
      .values(),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Přehled {year}</h1>
        <div className="flex flex-wrap items-baseline gap-4">
          <YearSwitcher years={years} active={year} hrefBase="/prehled" />
          <p className="font-mono text-xs text-inkoust-tlumeny">
            {txs.length} transakcí · {result.options.matchingMethod} ·{' '}
            {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB'}
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.limits.flatTax50k.applicable && (
          <LimitGauge
            label="Limit paušální daně — 50 000 Kč"
            hint="Platí jen pro paušální daň (§ 7a): úhrn ZDANITELNÝCH příjmů mimo živnost — neosvobozené tržby z prodejů, zahraniční dividendy (brutto), úroky, nájem. Osvobozené prodeje se nepočítají. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
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
          label="Osvobození prodejů — 100 000 Kč"
          hint="Platí pro každého (§ 4): jsou-li tvoje celkové tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou VŠECHNY osvobozené (i bez 3 let držení). Nad limit se daní prodeje bez splněného časového testu."
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

      {result.options.limit100kIncludesTimeTestExempt &&
        !result.securities.exemptUnder100k &&
        result.securities.totalGrossProceedsCzk
          .sub(result.securities.timeTestExemptProceedsCzk)
          .lte(result.limits.limit100k.limitCzk) && (
          <Card className="space-y-1">
            <CardTitle>Mohlo by tě zajímat</CardTitle>
            <p className="text-sm">
              Počítáme bezpečným výkladem: do limitu 100k vstupují i prodeje osvobozené
              časovým testem. Podle mírnějšího (sporného) výkladu by tvůj úhrn byl jen{' '}
              <span className="font-mono">
                {czk(
                  result.securities.totalGrossProceedsCzk.sub(
                    result.securities.timeTestExemptProceedsCzk,
                  ),
                )}
              </span>{' '}
              a všechny letošní prodeje by byly osvobozené. Výklad si můžeš přepnout
              v nastavení — rozhodnutí (a riziko) je na tobě.
            </p>
          </Card>
        )}

      <HorizonStrip positions={positions} labels={labels} today={today} />

      {groupedWarnings.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Upozornění ({importantWarnings.length})</CardTitle>
          {groupedWarnings.map(({ count, sample }) => (
            <p
              key={sample.code}
              className={sample.level === 'ERROR' ? 'text-sm text-cervena' : 'text-sm text-jantar'}
            >
              {count > 1 && <span className="font-mono text-xs">{count}× </span>}
              {sample.message}
              {count > 1 && (
                <span className="text-xs text-inkoust-tlumeny"> (všechny případy v reportu)</span>
              )}
            </p>
          ))}
        </Card>
      )}

      <PositionsTable positions={positions} labels={labels} />
    </div>
  );
}
