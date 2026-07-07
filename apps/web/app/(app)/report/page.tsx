import { redirect } from 'next/navigation';
import { analyzeTaxYear, compareVariants } from '@danero/engine';
import { Card, CardTitle } from '@/components/ui/card';
import { YearSwitcher } from '@/components/year-switcher';
import { getDb } from '@/db';
import { czDate, czk } from '@/lib/format';
import {
  availableYears,
  engineInputForUser,
  getProfile,
  instrumentLabels,
  loadTransactions,
} from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';

const METHOD_LABEL: Record<string, string> = {
  FIFO: 'FIFO',
  LIFO: 'LIFO',
  MAX_PROFIT: 'Max. zisk',
  MAX_LOSS: 'Max. ztráta',
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  if (!profile) redirect('/nastaveni');

  const txs = await loadTransactions(db, user.id);
  if (txs.length === 0) redirect('/prehled');

  const currentYear = new Date().getFullYear();
  const years = availableYears(txs, currentYear);
  const { rok } = await searchParams;
  const year = years.includes(Number(rok)) ? Number(rok) : currentYear;

  const input = engineInputForUser(txs, profile, year);
  const result = analyzeTaxYear(input);
  const { variants, recommended } = compareVariants(input);
  const labels = instrumentLabels(txs);

  const activeTax =
    result.tax.recommended === 'GENERAL' ? result.tax.general : result.tax.separate16a;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Daňový report {year}</h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Podklady pro přiznání — orientační, s aktuální konfigurací profilu.
          </p>
        </div>
        <YearSwitcher years={years} active={year} hrefBase="/report" />
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-1">
          <CardTitle>Dílčí základ § 10 (prodeje CP)</CardTitle>
          <p className="font-mono text-xl font-semibold">{czk(result.securities.base10Czk)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            Tržby {czk(result.securities.totalGrossProceedsCzk)} · výdaje{' '}
            {czk(result.securities.expensesCzk)}
            {result.securities.exemptUnder100k && ' · vše osvobozeno (úhrn do 100k)'}
          </p>
        </Card>
        <Card className="space-y-1">
          <CardTitle>Dílčí základ § 8 (dividendy, úroky)</CardTitle>
          <p className="font-mono text-xl font-semibold">{czk(result.dividends.base8Czk)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            Srážková daň v zahraničí {czk(result.dividends.foreignWithholdingCzk)}, započitatelná{' '}
            {czk(result.dividends.creditableWithholdingCzk)}
          </p>
        </Card>
        <Card className="space-y-1">
          <CardTitle>Orientační daň z investic</CardTitle>
          <p className="font-mono text-xl font-semibold">{czk(activeTax.taxCzk)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            {result.tax.recommended === 'SEPARATE_16A'
              ? 'Výhodnější je samostatný základ § 16a (Příloha č. 4).'
              : 'Výhodnější je obecný základ (15/23 %).'}{' '}
            {result.tax.note}
          </p>
        </Card>
      </section>

      <Card className="space-y-3">
        <CardTitle>Porovnání variant párování (R-05c)</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                <th className="py-2 pr-4 font-medium">Metoda</th>
                <th className="py-2 pr-4 text-right font-medium">Základ § 10</th>
                <th className="py-2 pr-4 text-right font-medium">Daň</th>
                <th className="py-2 pr-4 text-right font-medium">Limit 50k</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="font-mono">
              {variants.map((variant) => {
                const isRecommended =
                  variant.matchingMethod === recommended.matchingMethod &&
                  variant.fxMethod === recommended.fxMethod;
                const isActive = variant.matchingMethod === result.options.matchingMethod;
                return (
                  <tr key={`${variant.matchingMethod}-${variant.fxMethod}`} className="border-b border-linka/60">
                    <td className="py-2 pr-4 font-sans font-medium">
                      {METHOD_LABEL[variant.matchingMethod]}
                    </td>
                    <td className="py-2 pr-4 text-right">{czk(variant.base10Czk)}</td>
                    <td className="py-2 pr-4 text-right">{czk(variant.taxCzk)}</td>
                    <td
                      className={cn(
                        'py-2 pr-4 text-right',
                        variant.flatTax50kExceeded ? 'text-cervena' : 'text-zelena',
                      )}
                    >
                      {variant.flatTax50kExceeded ? 'prolomen' : czk(variant.flatTax50kUsedCzk)}
                    </td>
                    <td className="py-2 font-sans text-xs">
                      {isRecommended && (
                        <span className="rounded bg-ruzova/10 px-2 py-0.5 font-semibold text-ruzova">
                          doporučeno
                        </span>
                      )}{' '}
                      {isActive && <span className="text-inkoust-tlumeny">aktivní</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-inkoust-tlumeny">
          Metodu změníš v nastavení — zvolená metoda se musí držet konzistentně a průkazně.
        </p>
      </Card>

      {result.securities.disposals.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Prodeje v roce {year} ({result.securities.disposals.length})</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4 font-medium">Instrument</th>
                  <th className="py-2 pr-4 text-right font-medium">Datum</th>
                  <th className="py-2 pr-4 text-right font-medium">Tržba</th>
                  <th className="py-2 pr-4 text-right font-medium">Osvobozeno</th>
                  <th className="py-2 text-right font-medium">Zdanitelné</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.securities.disposals.map((disposal) => (
                  <tr key={disposal.sellTxId} className="border-b border-linka/60">
                    <td className="py-2 pr-4">
                      <span className="font-sans">{labels.get(disposal.isin) ?? disposal.isin}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{czDate(disposal.saleDate)}</td>
                    <td className="py-2 pr-4 text-right">{czk(disposal.grossProceedsCzk)}</td>
                    <td className="py-2 pr-4 text-right text-zelena">
                      {czk(disposal.exemptProceedsCzk)}
                    </td>
                    <td className="py-2 text-right">{czk(disposal.taxableProceedsCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {result.dividends.items.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Dividendy podle států (zápočet dle § 38f, Příloha č. 3)</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4 font-medium">Stát</th>
                  <th className="py-2 pr-4 text-right font-medium">Brutto</th>
                  <th className="py-2 text-right font-medium">Započitatelná srážka</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {Object.entries(result.dividends.creditableByCountry).map(([country, data]) => (
                  <tr key={country} className="border-b border-linka/60">
                    <td className="py-2 pr-4 font-sans font-medium">{country}</td>
                    <td className="py-2 pr-4 text-right">{czk(data.grossCzk)}</td>
                    <td className="py-2 text-right">{czk(data.creditableCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.dividends.czechGrossCzk.gt(0) && (
            <p className="text-xs text-inkoust-tlumeny">
              České dividendy {czk(result.dividends.czechGrossCzk)} jsou zdaněny srážkou u
              zdroje — do přiznání se neuvádějí.
            </p>
          )}
        </Card>
      )}

      {result.warnings.length > 0 && (
        <Card className="space-y-2">
          <CardTitle>Upozornění a výkladové poznámky ({result.warnings.length})</CardTitle>
          {result.warnings.map((warning, i) => (
            <p
              key={`${warning.code}-${i}`}
              className={cn(
                'text-sm',
                warning.level === 'ERROR' && 'text-cervena',
                warning.level === 'WARNING' && 'text-jantar',
                warning.level === 'INFO' && 'text-inkoust-tlumeny',
              )}
            >
              <span className="font-mono text-xs">[{warning.code}]</span> {warning.message}
            </p>
          ))}
        </Card>
      )}

      <Card className="space-y-2">
        <CardTitle>Kam s tím v přiznání</CardTitle>
        <p className="text-sm text-inkoust-tlumeny">
          Dílčí základ § 10 patří do <strong>Přílohy č. 2</strong> přiznání (ostatní příjmy —
          úplatný převod cenných papírů). Zahraniční dividendy a úroky jdou do § 8; zápočet
          zahraniční srážkové daně přes <strong>Přílohu č. 3</strong> (po jednotlivých
          státech), varianta samostatného základu § 16a přes <strong>Přílohu č. 4</strong>.
          Osvobozené příjmy se do přiznání neuvádějí. XML export pro mojedane.cz připravujeme.
        </p>
        <p className="text-xs text-inkoust-tlumeny">
          Konfigurace výpočtu: párování {result.options.matchingMethod} ·{' '}
          {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'} ·
          limit 100k {result.options.limit100kIncludesTimeTestExempt ? 'striktně' : 'mírněji'} ·
          časový test od data {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'}.
          ⚠️ Historické jednotné kurzy jsou zatím orientační — před podáním přiznání je
          doplníme z pokynů řady D. Danero je výpočetní nástroj, nikoli daňové poradenství.
        </p>
      </Card>
    </div>
  );
}
