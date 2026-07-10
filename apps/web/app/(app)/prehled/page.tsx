import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/schema';
import { LimitDrawdownChart } from '@/components/charts';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitGauge } from '@/components/limit-gauge';
import { PositionsTable } from '@/components/positions-table';
import { Card, CardTitle } from '@/components/ui/card';
import { ViewSwitch } from '@/components/view-switch';
import { WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import { getDb } from '@/db';
import {
  exemptionOutlook,
  flatTax50kSeries,
  horizonDots,
  limit100kSeries,
} from '@/lib/charts-data';
import { loadInstrumentPrices } from '@/lib/prices';
import { czk, METHOD_LABEL, plural } from '@/lib/format';
import { analyzeForUserCached } from '@/lib/engine-cache';
import {
  availableYears,
  dailyRatesForProfile,
  getProfile,
  instrumentNames,
  loadTransactions,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Přehled — Danero' };

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
          Připoj brokera nebo nahraj výpis a Danero pohlídá zbytek — časové testy, limity i podklady
          k přiznání.
        </p>
        <Link
          href="/vitejte"
          className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Otevřít průvodce
        </Link>
      </div>
    );
  }

  const recentNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(5);

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4)); // rok z téhož okamžiku (UTC) jako today
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;
  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  const { result, positions, labels } = analyzeForUserCached(
    user.id,
    txs,
    profile,
    year,
    today,
    dailyRates,
  );
  const limit100kChart = limit100kSeries(result);
  const flatTax50kChart = flatTax50kSeries(result);
  const prices = await loadInstrumentPrices(db, user.id);

  const importantWarnings = result.warnings.filter((w) => w.level !== 'INFO');
  const forfeitedWithholdingCzk = result.dividends.foreignWithholdingCzk.sub(
    result.dividends.creditableWithholdingCzk,
  );

  // Verdikt: limit, jehož prolomení znamená povinnost podat přiznání — dle
  // režimu (PAUSAL → 50k § 7a, ZAMESTNANEC → 20k, JINE → obecných 50k);
  // OSVČ mimo paušál podává přiznání tak jako tak, verdikt-box tam nedává smysl.
  const filingLimit = result.limits.flatTax50k.applicable
    ? { status: result.limits.flatTax50k.status, label: 'limit 50 000 Kč pro paušální daň' }
    : result.limits.employee20k.applicable
      ? { status: result.limits.employee20k.status, label: 'limit 20 000 Kč vedlejších příjmů' }
      : result.limits.generalFiling50k.applicable
        ? { status: result.limits.generalFiling50k.status, label: 'limit 50 000 Kč pro podání přiznání' }
        : null;
  // „nejblíž prolomení" = nejvyšší čerpání ze sledovaných limitů
  const watchedLimits = [
    ...(filingLimit ? [filingLimit] : []),
    { status: result.limits.limit100k, label: 'limit 100 000 Kč pro osvobození prodejů CP' },
  ];
  const nearestLimit = watchedLimits.reduce((a, b) => (b.status.ratio > a.status.ratio ? b : a));
  const estimatedTaxCzk =
    result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">Přehled {year}</h1>
        <div className="flex flex-wrap items-baseline gap-4">
          <YearSwitcher years={years} active={year} hrefBase="/prehled" />
          <p className="font-mono text-xs text-inkoust-tlumeny">
            {txs.length} {plural(txs.length, 'transakce', 'transakce', 'transakcí')} ·{' '}
            {METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod} ·{' '}
            {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB'}
          </p>
        </div>
      </header>

      {filingLimit && (
        <Card className="border-l-4 border-l-ruzova">
          {filingLimit.status.exceeded ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="font-display text-xl font-bold">
                  Za rok {year} podáš daňové přiznání
                </p>
                <p className="text-sm text-inkoust-tlumeny">
                  Orientační daň z investic:{' '}
                  <span className="font-mono text-inkoust">{czk(estimatedTaxCzk)}</span> · papírově
                  do 1. 4. {year + 1}, elektronicky do 2. 5. {year + 1}
                </p>
              </div>
              <Link
                href="/report"
                className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Připravit podklady
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="font-display text-xl font-bold">
                Zatím ti povinnost podat přiznání nevzniká
              </p>
              <p className="text-sm text-inkoust-tlumeny">
                Limity hlídáme denně. Nejblíž je {nearestLimit.label} — čerpáno{' '}
                {Math.round(nearestLimit.status.ratio * 100)} %.
              </p>
            </div>
          )}
        </Card>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {result.limits.flatTax50k.applicable && (
          <LimitGauge
            label="Limit paušální daně — 50 000 Kč"
            hint="Platí jen pro paušální daň (§ 7a): úhrn ZDANITELNÝCH příjmů mimo samostatnou činnost (podnikání) — neosvobozené tržby z prodejů CP i kryptoaktiv, plnění z derivátů, zahraniční dividendy (brutto), úroky, nájem. Osvobozené prodeje se nepočítají. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
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
          label="Osvobození prodejů CP — 100 000 Kč"
          hint="Platí pro každého (§ 4 odst. 1 písm. t): jsou-li tvoje celkové tržby z prodeje cenných papírů za rok do 100 000 Kč, jsou VŠECHNY osvobozené (i bez 3 let držení). Nad limit se daní prodeje bez splněného časového testu."
          status={result.limits.limit100k}
        />
        {(result.crypto.disposals.length > 0 ||
          positions.some((p) => p.assetClass === 'CRYPTO' && p.totalRemaining.gt(0))) && (
          <LimitGauge
            label="Osvobození krypta — 100 000 Kč"
            hint="Samostatný limit pro kryptoaktiva (§ 4/1 zj — R-10a), nezávislý na limitu pro cenné papíry: jsou-li tržby z prodejů a směn krypta za rok do 100 000 Kč, jsou osvobozené. Neplatí pro stablecoiny (elektronické peněžní tokeny) a pro příjmy před 15. 2. 2025."
            status={result.limits.cryptoLimit100k}
          />
        )}
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
            Základ § 10 (prodeje):{' '}
            {czk(
              result.securities.base10Czk
                .plus(result.crypto.base10Czk)
                .plus(result.derivatives.base10Czk),
            )}{' '}
            · § 8 (dividendy a úroky): {czk(result.dividends.base8Czk)}
            {result.tax.recommended === 'SEPARATE_16A' &&
              ' · doporučen § 16a (samostatný základ pro zahraniční dividendy)'}
          </p>
          <p className="text-xs text-inkoust-tlumeny">{result.tax.note}</p>
        </Card>
      </section>

      {(limit100kChart.points.length > 1 || (flatTax50kChart?.points.length ?? 0) > 1) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {limit100kChart.points.length > 1 && (
            <Card>
              <CardTitle>Čerpání limitu 100 000 Kč v průběhu roku</CardTitle>
              <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                Kumulativní tržby z prodejů CP; přerušované čáry = pásma 60/85/100 %.
              </p>
              <LimitDrawdownChart series={limit100kChart} name="Tržby z prodejů" />
            </Card>
          )}
          {flatTax50kChart && flatTax50kChart.points.length > 1 && (
            <Card>
              <CardTitle>Čerpání limitu 50 000 Kč v průběhu roku</CardTitle>
              <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                Zdanitelné příjmy mimo samostatnou činnost (podnikání) — neosvobozené prodeje,
                zahraniční dividendy, úroky.
              </p>
              <LimitDrawdownChart series={flatTax50kChart} name="Zdanitelné příjmy" />
            </Card>
          )}
        </section>
      )}

      {result.options.limit100kIncludesTimeTestExempt &&
        !result.securities.exemptUnder100k &&
        result.securities.totalGrossProceedsCzk
          .sub(result.securities.timeTestExemptProceedsCzk)
          .lte(result.limits.limit100k.limitCzk) && (
          <Card className="space-y-1">
            <CardTitle>Mohlo by tě zajímat</CardTitle>
            <p className="text-sm">
              Počítáme bezpečným výkladem: do limitu 100k vstupují i prodeje osvobozené časovým
              testem. Podle mírnějšího (sporného) výkladu by tvůj úhrn byl jen{' '}
              <span className="font-mono">
                {czk(
                  result.securities.totalGrossProceedsCzk.sub(
                    result.securities.timeTestExemptProceedsCzk,
                  ),
                )}
              </span>{' '}
              a všechny letošní prodeje by byly osvobozené. Výklad si můžeš přepnout v Nastavení —
              rozhodnutí (a riziko) je na tobě.
            </p>
          </Card>
        )}

      {/* H4: graf a tabulka jsou dvě zobrazení téže informace — jednotný nadpis,
          přepínač pohledu; default graf (bez JS se vykreslí ten). Bez otevřených
          pozic by přepínač stál nad prázdnem — místo něj poctivý prázdný stav. */}
      <Card>
        {positions.length > 0 ? (
          <ViewSwitch
            title="Horizont osvobození"
            ariaLabel="Zobrazení horizontu osvobození"
            defaultKey="graf"
            views={[
              {
                key: 'graf',
                label: 'Graf',
                content: (
                  <HorizonStrip
                    dots={horizonDots(positions, labels, prices, currentYear)}
                    today={today}
                    outlook={exemptionOutlook(positions, prices, today, currentYear)}
                    embedded
                  />
                ),
              },
              {
                key: 'tabulka',
                label: 'Tabulka',
                content: (
                  <PositionsTable
                    positions={positions}
                    labels={labels}
                    names={instrumentNames(txs)}
                    embedded
                  />
                ),
              },
            ]}
          />
        ) : (
          <>
            <CardTitle>Horizont osvobození</CardTitle>
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              Žádné otevřené pozice — jakmile nějakou koupíš, uvidíš tady, kdy se
              osvobodí od daně (3letý časový test).
            </p>
          </>
        )}
      </Card>

      {importantWarnings.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Kontroly výpočtu ({importantWarnings.length})</CardTitle>
          <WarningsList
            warnings={importantWarnings}
            labels={labels}
            forfeitedWithholdingCzk={forfeitedWithholdingCzk}
          />
        </Card>
      )}

      {recentNotifications.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Poslední upozornění</CardTitle>
          {recentNotifications.map((notification) => (
            <div key={notification.dedupeKey} className="text-sm">
              <span className="font-medium">{notification.title}</span>{' '}
              <span className="text-xs text-inkoust-tlumeny">
                · {notification.createdAt.toLocaleDateString('cs-CZ')}
              </span>
              <p className="text-inkoust-tlumeny">{notification.body}</p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
