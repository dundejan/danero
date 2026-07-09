import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import {
  AllocationDonut,
  DividendsByMonthChart,
  ExemptionOutlookChart,
  FeesByYearChart,
  RealizedByYearChart,
} from '@/components/charts';
import { PositionCard } from '@/components/position-card';
import { ViewSwitch } from '@/components/view-switch';
import { YearSwitcher } from '@/components/year-switcher';
import { getDb } from '@/db';
import {
  dividendsByMonth,
  exemptionOutlook,
  feesByYear,
  portfolioAllocation,
  realizedGainsByYear,
} from '@/lib/charts-data';
import { czDate, czk, money, plural, qty } from '@/lib/format';
import { cn } from '@/lib/utils';
import { analyzeForUserCached } from '@/lib/engine-cache';
import {
  dailyRatesForProfile,
  availableYears,
  engineInputForUser,
  getProfile,
  instrumentLabels,
  instrumentNames,
  loadTransactions,
} from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import { loadInstrumentPrices } from '@/lib/prices';
import { activePortfolio } from '@/lib/portfolio-context';
import { requireUser } from '@/lib/session';
import { analyzeTaxYear, type TaxYearResult } from '@danero/engine';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Portfolio — Danero' };

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const portfolio = await activePortfolio(db, user.id);
  const profile = await getProfile(db, user.id, portfolio.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id, portfolio.id);
  if (txs.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="font-display text-3xl font-bold">Portfolio</h1>
        <p className="text-sm text-inkoust-tlumeny">
          Zatím žádná data —{' '}
          <Link href="/import" className="font-medium text-ruzova">
            naimportuj výpisy
          </Link>{' '}
          a Danero ukáže hodnotu portfolia, dividendy i výhled osvobozování.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  const dailyRates = await dailyRatesForProfile(db, txs, profile, currentYear);
  const { result, positions, labels } = analyzeForUserCached(
    user.id,
    portfolio.id,
    txs,
    profile,
    year,
    today,
    dailyRates,
  );
  const prices = await loadInstrumentPrices(db, user.id, portfolio.id);
  const names = instrumentNames(txs);
  const valuation = valuePositions(positions, labels, names, prices, currentYear);

  // realizované P/L: engine per rok (čistá funkce nad týmiž transakcemi)
  const resultsByYear = new Map<number, TaxYearResult>(
    years.map((y) => [
      y,
      y === year ? result : analyzeTaxYear(engineInputForUser(txs, profile, y, dailyRates)),
    ]),
  );
  const realized = realizedGainsByYear(resultsByYear);
  const dividends = dividendsByMonth(result);
  const fees = feesByYear(txs);
  const outlook = exemptionOutlook(positions, prices, today, currentYear);
  const labelsAll = instrumentLabels(txs);
  const allocation = portfolioAllocation(valuation);
  const exemptShareToday = outlook?.points[0]?.exemptShare ?? null;

  // E2: sloupec „Bez daně" jen když má co říct — informaci o nule nese KPI
  // „Bez daně už dnes"
  const anyExempt = valuation.rows.some((row) => row.exemptQuantity.gt(0));

  // nejbližší konec časového testu per pozice — pro mobilní karty
  const nearestExemption = new Map<string, string | null>(
    positions.map((position) => {
      const pending = position.lots.filter((lot) => !lot.isExempt);
      return [
        position.isin,
        pending.length
          ? pending.reduce((a, b) => (a.exemptFrom < b.exemptFrom ? a : b)).exemptFrom
          : null,
      ];
    }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Portfolio</h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Hodnota z posledních cen od brokera, grafy z tvých transakcí.
          </p>
        </div>
        <YearSwitcher years={years} active={year} hrefBase="/portfolio" />
      </header>

      <section
        className={cn(
          'grid gap-4',
          allocation ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3',
        )}
      >
        <Card>
          <CardTitle>Hodnota portfolia</CardTitle>
          {valuation.pricedCount > 0 ? (
            <>
              <p className="mt-2 font-display text-3xl font-bold">{czk(valuation.totalCzk)}</p>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Orientační přepočet jednotným kurzem {valuation.fxYear}
                {valuation.oldestPriceAt &&
                  `, ceny k ${valuation.oldestPriceAt.toLocaleDateString('cs-CZ')}`}
                {valuation.unpricedCount > 0 &&
                  ` · ${valuation.unpricedCount} ${plural(valuation.unpricedCount, 'pozice', 'pozice', 'pozic')} bez ceny či kurzu (nezapočteno)`}
                . Ceny se obnovují při synchronizaci.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              Bez cen — ceny bereme jen z připojených brokerů (
              <Link href="/nastaveni" className="font-medium text-ruzova">
                připoj API
              </Link>
              ), žádný externí zdroj.
            </p>
          )}
        </Card>
        <Card>
          <CardTitle>Bez daně už dnes</CardTitle>
          {/* zelená jen pro skutečně pozitivní stav — 0 % není úspěch */}
          <p
            className={cn(
              'mt-2 font-display text-3xl font-bold',
              exemptShareToday !== null && exemptShareToday > 0 && 'text-zelena',
            )}
          >
            {exemptShareToday !== null ? `${exemptShareToday.toLocaleString('cs-CZ')} %` : '—'}
          </p>
          <p className="mt-1 text-xs text-inkoust-tlumeny">
            Podíl portfolia ({outlook?.basis === 'value' ? 'podle hodnoty' : 'podle kusů'}) po
            3letém časovém testu — prodej je osvobozený.
          </p>
        </Card>
        <Card>
          <CardTitle>Dividendy {year}</CardTitle>
          <p className="mt-2 font-display text-3xl font-bold">{czk(dividends.totalCzk)}</p>
          <p className="mt-1 text-xs text-inkoust-tlumeny">
            Brutto před srážkou, přepočet kurzem pro přiznání.
          </p>
        </Card>
        {allocation && (
          <Card>
            <CardTitle>Alokace portfolia</CardTitle>
            <AllocationDonut allocation={allocation} />
          </Card>
        )}
      </section>

      {/* H4: taby „Pozice | Grafy" — grafy už nejsou tisíce pixelů pod tabulkou */}
      <ViewSwitch
        ariaLabel="Pohled na portfolio"
        defaultKey="pozice"
        views={[
          {
            key: 'pozice',
            label: 'Pozice',
            content: (
              <div className="space-y-8">
                <Card className="space-y-2">
                  <CardTitle>Pozice</CardTitle>
                  {valuation.unpricedCount > 0 && valuation.pricedCount > 0 && (
                    <p className="text-xs text-jantar">
                      U {valuation.unpricedCount}{' '}
                      {plural(valuation.unpricedCount, 'pozice', 'pozic', 'pozic')} chybí cena od
                      brokera nebo kurz měny — hodnota a zisk/ztráta tam nejsou.
                    </p>
                  )}
                  {/* mobil: karty místo tabulky (H4) */}
                  <div className="space-y-2 md:hidden">
                    {valuation.rows.map((row) => {
                      const nearest = nearestExemption.get(row.isin) ?? null;
                      return (
                        <PositionCard
                          key={row.isin}
                          isin={row.isin}
                          label={row.label}
                          name={row.name}
                          primaryText={row.valueCzk ? czk(row.valueCzk) : `${qty(row.quantity)} ks`}
                          secondaryText={row.valueCzk ? `${qty(row.quantity)} ks` : undefined}
                          pl={
                            row.unrealized
                              ? {
                                  text:
                                    row.unrealizedPct !== undefined
                                      ? `${row.unrealizedPct >= 0 ? '+' : ''}${row.unrealizedPct.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
                                      : money(row.unrealized, row.currency!, true),
                                  positive: row.unrealized.gte(0),
                                }
                              : null
                          }
                          exemptText={nearest ? `bez daně od ${czDate(nearest)}` : 'vše bez daně'}
                          exemptDone={!nearest}
                        />
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                          <th className="py-2 pr-4">Instrument</th>
                          <th className="py-2 pr-4 text-right">Kusů</th>
                          <th className="py-2 pr-4 text-right">Cena/ks</th>
                          <th className="py-2 pr-4 text-right">Hodnota (Kč)</th>
                          <th
                            className="py-2 pr-4 text-right"
                            title="Rozdíl aktuální hodnoty a nabývací ceny — zisk/ztráta, kdybys prodal teď (před zdaněním)"
                          >
                            Nerealizovaný zisk/ztráta
                          </th>
                          {anyExempt && <th className="py-2 text-right">Bez daně</th>}
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {valuation.rows.map((row) => (
                          <tr key={row.isin} className="border-t border-linka">
                            <td className="py-2 pr-4">
                              <Link
                                href={`/portfolio/${row.isin}`}
                                className="font-medium text-inkoust hover:text-ruzova"
                              >
                                {row.label}
                              </Link>
                              <span className="block text-xs text-inkoust-tlumeny">
                                {row.name ? `${row.name} · ` : ''}
                                {row.isin}
                              </span>
                            </td>
                            <td className="py-2 pr-4 text-right">{qty(row.quantity)}</td>
                            <td className="whitespace-nowrap py-2 pr-4 text-right">
                              {row.price ? money(row.price, row.currency!) : '—'}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-4 text-right">
                              {row.valueCzk ? czk(row.valueCzk) : '—'}
                            </td>
                            <td
                              className={`whitespace-nowrap py-2 pr-4 text-right ${
                                row.unrealized
                                  ? row.unrealized.gte(0)
                                    ? 'text-zelena'
                                    : 'text-cervena'
                                  : ''
                              }`}
                            >
                              {row.unrealized
                                ? `${money(row.unrealized, row.currency!, true)}${
                                    row.unrealizedPct !== undefined
                                      ? ` (${row.unrealizedPct >= 0 ? '+' : ''}${row.unrealizedPct.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %)`
                                      : ''
                                  }`
                                : '—'}
                            </td>
                            {anyExempt && (
                              <td className="py-2 text-right">
                                {row.exemptQuantity.gt(0) ? (
                                  <span className="text-zelena">{qty(row.exemptQuantity)} ks</span>
                                ) : (
                                  '—'
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {valuation.rows.length === 0 && (
                    <p className="text-sm text-inkoust-tlumeny">Žádné otevřené pozice.</p>
                  )}
                </Card>

                {result.derivatives.openPositions.length > 0 && (
                  <Card className="space-y-2">
                    <CardTitle>Otevřené derivátové pozice</CardTitle>
                    <p className="text-xs text-inkoust-tlumeny">
                      Opce, futures a CFD — samostatný druh příjmu bez osvobození (deriváty se daní
                      vždy, bez ohledu na dobu držení i výši tržeb). Záporný počet = vypsaná (short)
                      pozice.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                            <th className="py-2 pr-4">Instrument</th>
                            <th className="py-2 pr-4 text-right">Kontraktů</th>
                            <th className="py-2 text-right">Otevřeno</th>
                          </tr>
                        </thead>
                        <tbody className="font-mono">
                          {result.derivatives.openPositions.map((position) => (
                            <tr key={position.isin} className="border-t border-linka">
                              <td className="py-2 pr-4 font-sans font-medium">
                                {labels.get(position.isin) ?? position.isin}
                              </td>
                              <td
                                className={`py-2 pr-4 text-right ${position.quantity.lt(0) ? 'text-jantar' : ''}`}
                              >
                                {qty(position.quantity)}
                              </td>
                              <td className="py-2 text-right">{czDate(position.openedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </div>
            ),
          },
          {
            key: 'grafy',
            label: 'Grafy',
            content: (
              <section className="grid gap-4 lg:grid-cols-2">
                {outlook && outlook.points.length > 1 && (
                  <Card>
                    <CardTitle>Osvobozování portfolia v čase</CardTitle>
                    <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                      Výhled: kolik % portfolia ({outlook.basis === 'value' ? 'hodnoty' : 'kusů'})
                      půjde prodat bez daně, když nic nepřikoupíš ani neprodáš.
                    </p>
                    <ExemptionOutlookChart outlook={outlook} />
                  </Card>
                )}
                {dividends.totalCzk > 0 && (
                  <Card>
                    <CardTitle>Dividendy {year} po měsících a státech</CardTitle>
                    <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                      Brutto v Kč; podle státu, kde byla dividenda zdaněna u zdroje (srážková daň).
                    </p>
                    <DividendsByMonthChart data={dividends} />
                  </Card>
                )}
                {realized.some((bar) => bar.valueCzk !== 0) && (
                  <Card>
                    <CardTitle>Realizovaný zisk/ztráta po letech</CardTitle>
                    <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                      Skutečný výsledek prodejů (tržby − náklady vč. poplatků) — bez ohledu na to,
                      jestli byly daňově osvobozené.
                    </p>
                    <RealizedByYearChart bars={realized} />
                  </Card>
                )}
                {fees.bars.length > 0 && (
                  <Card>
                    <CardTitle>Poplatky brokerům po letech</CardTitle>
                    <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
                      Obchodní i účetní poplatky, orientační přepočet jednotnými kurzy.
                      {fees.skippedCurrencies.length > 0 &&
                        ` Bez kurzu: ${fees.skippedCurrencies.join(', ')} (nezapočteno).`}
                    </p>
                    <FeesByYearChart bars={fees.bars} />
                  </Card>
                )}
              </section>
            ),
          },
        ]}
      />

      <p className="text-xs text-inkoust-tlumeny">
        Popisky instrumentů: {labelsAll.size} známých. Hodnoty jsou orientační a neslouží jako
        podklad pro obchodní rozhodnutí — daňové výpočty najdeš v{' '}
        <Link href="/report" className="font-medium text-ruzova">
          reportu
        </Link>
        .
      </p>
    </div>
  );
}
