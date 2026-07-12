import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import {
  AllocationPie,
  DividendsByMonthChart,
  ExemptionOutlookChart,
  FeesByYearChart,
  RealizedByYearChart,
} from '@/components/charts';
import { PositionsExplorer, type ExplorerRow } from '@/components/positions-explorer';
import { ViewSwitch } from '@/components/view-switch';
import { YearSwitcher } from '@/components/year-switcher';
import {
  dividendsByMonth,
  exemptionOutlook,
  feesByYear,
  portfolioAllocation,
  realizedGainsByYear,
} from '@/lib/charts-data';
import { czDate, czk, money, pct, plural, qty, signedPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  engineInputForUser,
  instrumentLabels,
  instrumentNames,
  type ProfileRow,
  type YearAnalysis,
} from '@/lib/portfolio';
import { valuePositions } from '@/lib/portfolio-value';
import type { InstrumentPrice } from '@/lib/prices';
import type { Transaction } from '@danero/shared';
import { analyzeTaxYear, EngineError, type EngineInput, type TaxYearResult } from '@danero/engine';

/**
 * Sdílené tělo portfolia: čisté výpočty (ocenění, grafy, řádky tabulky) nad
 * hotovou analýzou — data dodá reálná stránka z DB, demo z ukázkového datasetu.
 * `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 */
export function PortfolioView({
  txs,
  profile,
  analysis,
  prices,
  years,
  year,
  today,
  dailyRates,
  basePath = '',
}: {
  txs: Transaction[];
  profile: ProfileRow;
  analysis: YearAnalysis;
  prices: Map<string, InstrumentPrice>;
  years: number[];
  year: number;
  today: string;
  dailyRates?: EngineInput['dailyRates'];
  basePath?: string;
}) {
  const { result, positions, labels } = analysis;
  const currentYear = Number(today.slice(0, 4));
  const names = instrumentNames(txs);
  const valuation = valuePositions(positions, labels, names, prices, currentYear);

  // realizované P/L: engine per rok (čistá funkce nad týmiž transakcemi);
  // chybějící kurz v NEvybraném roce nesmí shodit stránku mimo page-guard —
  // rok se z grafu vynechá (vybraný rok hlídá guard stránky)
  const resultsByYear = new Map<number, TaxYearResult>();
  for (const y of years) {
    if (y === year) {
      resultsByYear.set(y, result);
      continue;
    }
    try {
      resultsByYear.set(y, analyzeTaxYear(engineInputForUser(txs, profile, y, dailyRates)));
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
    }
  }
  const realized = realizedGainsByYear(resultsByYear);
  const dividends = dividendsByMonth(result);
  const fees = feesByYear(txs);
  const outlook = exemptionOutlook(positions, prices, today, currentYear);
  const labelsAll = instrumentLabels(txs);
  const allocation = portfolioAllocation(valuation);
  const exemptShareToday = outlook?.points[0]?.exemptShare ?? null;

  // E2: sloupec „Bez daně“ jen když má co říct — informaci o nule nese KPI
  // „Bez daně už dnes“
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

  // KPI „Nejbližší osvobození“: minimum přes všechny pozice s nesplněným testem
  let nextExemption: { isin: string; exemptFrom: string } | null = null;
  for (const [isin, exemptFrom] of nearestExemption) {
    if (exemptFrom && (!nextExemption || exemptFrom < nextExemption.exemptFrom)) {
      nextExemption = { isin, exemptFrom };
    }
  }
  const daysToNextExemption = nextExemption
    ? Math.ceil((Date.parse(nextExemption.exemptFrom) - Date.parse(today)) / 86_400_000)
    : null;

  // řádky pro interaktivní tabulku — server předpočítá texty i čísla pro
  // řazení, přes hranici klienta nejde žádný Decimal
  const explorerRows: ExplorerRow[] = valuation.rows.map((row) => {
    const nearest = nearestExemption.get(row.isin) ?? null;
    const pctText =
      row.unrealizedPct !== undefined
        ? signedPct(row.unrealizedPct, 1)
        : undefined;
    return {
      isin: row.isin,
      label: row.label,
      name: row.name,
      qtyText: qty(row.quantity),
      priceText: row.price ? money(row.price, row.currency!) : undefined,
      valueText: row.valueCzk ? czk(row.valueCzk) : undefined,
      plText: row.unrealized
        ? `${money(row.unrealized, row.currency!, true)}${pctText ? ` (${pctText})` : ''}`
        : undefined,
      plPct: row.unrealizedPct,
      plPositive: row.unrealized ? row.unrealized.gte(0) : undefined,
      exemptText: nearest ? `bez daně od ${czDate(nearest)}` : 'vše bez daně',
      exemptDone: !nearest,
      exemptQtyText: row.exemptQuantity.gt(0) ? `${qty(row.exemptQuantity)} ks` : undefined,
      sort: {
        label: row.label,
        qty: row.quantity.toNumber(),
        value: row.valueCzk ? row.valueCzk.toNumber() : null,
        pl: row.unrealizedPct ?? null,
        exempt: row.exemptQuantity.toNumber(),
      },
    };
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Portfolio</h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Hodnota z posledních cen od brokera, grafy z tvých transakcí.
          </p>
        </div>
        <YearSwitcher years={years} active={year} hrefBase={`${basePath}/portfolio`} />
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle>Hodnota portfolia</CardTitle>
          {valuation.pricedCount > 0 ? (
            <>
              <p className="mt-2 font-display text-3xl font-bold">{czk(valuation.totalCzk)}</p>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Orientační přepočet jednotným kurzem {valuation.fxYear}
                {valuation.oldestPriceAt &&
                  `, ceny k ${czDate(valuation.oldestPriceAt)}`}
                {valuation.unpricedCount > 0 &&
                  ` · ${valuation.unpricedCount} ${plural(valuation.unpricedCount, 'pozice', 'pozice', 'pozic')} bez ceny či kurzu (nezapočteno)`}
                . Ceny se obnovují při synchronizaci.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-inkoust-tlumeny">
              Bez cen — ceny bereme jen z připojených brokerů (
              {/* v demu /import nevede nikam — pozvat k registraci */}
              <Link
                href={basePath ? '/registrace' : '/import'}
                className="font-medium text-ruzova-text"
              >
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
            {exemptShareToday !== null ? pct(exemptShareToday, 1) : '—'}
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
        <Card>
          <CardTitle>Nejbližší osvobození</CardTitle>
          {nextExemption && daysToNextExemption !== null ? (
            <>
              <p className="mt-2 font-display text-3xl font-bold">
                {czDate(nextExemption.exemptFrom)}
              </p>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                {labels.get(nextExemption.isin) ?? nextExemption.isin} — za {daysToNextExemption}{' '}
                {plural(daysToNextExemption, 'den', 'dny', 'dní')} doběhne 3letý test, prodej pak
                bude bez daně.
              </p>
            </>
          ) : positions.length > 0 ? (
            <>
              <p className="mt-2 font-display text-3xl font-bold text-zelena">vše bez daně</p>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Všechny držené kusy už mají splněný časový test.
              </p>
            </>
          ) : (
            <p className="mt-2 font-display text-3xl font-bold">—</p>
          )}
        </Card>
      </section>

      {/* Pozice: tabulka a koláč alokace jsou dvě zobrazení téže informace —
          jednotný nadpis a přepínač pohledu (default tabulka) */}
      <Card>
        <ViewSwitch
          title="Pozice"
          ariaLabel="Pohled na pozice"
          defaultKey="tabulka"
          views={[
            {
              key: 'tabulka',
              label: 'Tabulka',
              content: (
                <div className="space-y-2">
                  {valuation.unpricedCount > 0 && valuation.pricedCount > 0 && (
                    <p className="text-xs text-jantar-text">
                      U {valuation.unpricedCount}{' '}
                      {plural(valuation.unpricedCount, 'pozice', 'pozic', 'pozic')} chybí cena od
                      brokera nebo kurz měny — hodnota a zisk/ztráta tam nejsou.
                    </p>
                  )}
                  {explorerRows.length > 0 ? (
                    <PositionsExplorer
                      rows={explorerRows}
                      showExempt={anyExempt}
                      basePath={basePath}
                    />
                  ) : (
                    <p className="text-sm text-inkoust-tlumeny">Žádné otevřené pozice.</p>
                  )}
                </div>
              ),
            },
            {
              key: 'graf',
              label: 'Graf',
              content: allocation ? (
                <AllocationPie allocation={allocation} />
              ) : (
                // poctivý prázdný stav — bez cen od brokera koláč nesestavíme
                <p className="text-sm text-inkoust-tlumeny">
                  Bez cen od brokera graf nesestavíme — připoj API{' '}
                  <Link
                    href={basePath ? '/registrace' : '/import'}
                    className="font-medium text-ruzova-text"
                  >
                    {basePath ? 'po registraci' : 'na stránce Zdroje dat'}
                  </Link>
                  .
                </p>
              ),
            },
          ]}
        />
      </Card>

      {result.derivatives.openPositions.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Otevřené derivátové pozice</CardTitle>
          <p className="text-xs text-inkoust-tlumeny">
            Opce, futures a CFD — samostatný druh příjmu bez osvobození (deriváty se daní vždy, bez
            ohledu na dobu držení i výši tržeb). Záporný počet = vypsaná (short) pozice.
          </p>
          <div className="scroll-stiny overflow-x-auto">
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
                      className={`py-2 pr-4 text-right ${position.quantity.lt(0) ? 'text-jantar-text' : ''}`}
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

      {/* grafy jsou vidět vždy — žádné schovávání do tabu */}
      <section className="grid gap-4 lg:grid-cols-2">
        {outlook && outlook.points.length > 1 && (
          <Card>
            <CardTitle>Osvobozování portfolia v čase</CardTitle>
            <p className="mb-2 mt-1 text-xs text-inkoust-tlumeny">
              Výhled: kolik % portfolia ({outlook.basis === 'value' ? 'hodnoty' : 'kusů'}) půjde
              prodat bez daně, když nic nepřikoupíš ani neprodáš.
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
              Skutečný výsledek prodejů (tržby − náklady vč. poplatků) — bez ohledu na to, jestli
              byly daňově osvobozené.
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

      <p className="text-xs text-inkoust-tlumeny">
        Popisky instrumentů: {labelsAll.size} známých. Hodnoty jsou orientační a neslouží jako
        podklad pro obchodní rozhodnutí — daňové výpočty najdeš v{' '}
        <Link href={`${basePath}/report`} className="font-medium text-ruzova">
          reportu
        </Link>
        .
      </p>
    </div>
  );
}
