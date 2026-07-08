import { redirect } from 'next/navigation';
import { analyzeTaxYear, compareVariants } from '@danero/engine';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/print-button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { YearSwitcher } from '@/components/year-switcher';
import { getDb } from '@/db';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { czDate, czk } from '@/lib/format';
import {
  availableYears,
  engineInputForUser,
  getProfile,
  instrumentLabels,
  loadDailyRates,
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

  // denní kurzy ČNB (R-06b): s nimi srovnání variant zahrnuje jednotný × denní
  const dailyRates = await loadDailyRates(db, txs, currentYear);
  const input = engineInputForUser(txs, profile, year, dailyRates);
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
        <div className="flex items-center gap-3">
          <YearSwitcher years={years} active={year} hrefBase="/report" />
          <PrintButton />
        </div>
      </header>

      {/* jen v tisku: identifikace podkladů (průkaznost výpočtu) */}
      <p className="hidden text-xs text-inkoust-tlumeny print:block">
        Podklady k přiznání za zdaňovací období {year} · vygenerováno {czDate(new Date().toISOString().slice(0, 10))}{' '}
        aplikací Danero · {txs.length} transakcí · párování {result.options.matchingMethod} ·{' '}
        {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'} ·
        výklad limitu 100k: {result.options.limit100kIncludesTimeTestExempt ? 'striktní' : 'mírnější'} ·
        časový test od {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'}.
        Kurzy: pokyny GFŘ D-49…D-75 (2020–2025), viz dokumentace metodiky.
      </p>

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
        {dailyRates ? (
          <p className="text-xs text-inkoust-tlumeny">
            Denní kurzy ČNB jsou načtené z oficiálního zdroje — tabulka srovnává jednotný
            kurz GFŘ i denní kurzy s reálnými čísly; doporučená kombinace je zvýrazněná.
          </p>
        ) : (
          <p className="text-xs text-jantar">
            Denní kurzy ČNB se zatím nepodařilo načíst — srovnání zahrnuje jen jednotný
            kurz. Zkus stránku otevřít později.
          </p>
        )}
        <p className="text-xs text-inkoust-tlumeny">
          Metodu změníš v nastavení — zvolená metoda se musí držet konzistentně a průkazně
          za celý rok (kombinovat v jednom roce nelze).
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

      <Card className="space-y-3">
        <CardTitle>Export pro mojedane.cz</CardTitle>
        {EPO_SUPPORTED_YEARS.includes(year) ? (
          <>
            <p className="text-sm text-inkoust-tlumeny">
              Stáhneš XML písemnosti DPFDP7 s investičními čísly z tohoto reportu a na
              mojedane.cz ho v přiznání nahraješ přes <strong>„Načtení souboru"</strong>.
              Osobní údaje můžeš vyplnit rovnou tady, nebo až v EPO — nic z nich
              neukládáme, jen protečou do staženého souboru.
            </p>
            <form method="post" action="/api/epo" className="space-y-3">
              <input type="hidden" name="rok" value={year} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="epo-jmeno">Jméno</Label>
                  <Input id="epo-jmeno" name="jmeno" autoComplete="given-name" />
                </div>
                <div>
                  <Label htmlFor="epo-prijmeni">Příjmení</Label>
                  <Input id="epo-prijmeni" name="prijmeni" autoComplete="family-name" />
                </div>
                <div>
                  <Label htmlFor="epo-rodneCislo">Rodné číslo</Label>
                  <Input id="epo-rodneCislo" name="rodneCislo" placeholder="bez lomítka" />
                </div>
                <div>
                  <Label htmlFor="epo-dic">DIČ</Label>
                  <Input id="epo-dic" name="dic" placeholder="jen číslo, bez „CZ“" />
                </div>
                <div>
                  <Label htmlFor="epo-obec">Obec</Label>
                  <Input id="epo-obec" name="obec" autoComplete="address-level2" />
                </div>
                <div>
                  <Label htmlFor="epo-ulice">Ulice</Label>
                  <Input id="epo-ulice" name="ulice" />
                </div>
                <div>
                  <Label htmlFor="epo-cisloPopisne">Číslo popisné</Label>
                  <Input id="epo-cisloPopisne" name="cisloPopisne" />
                </div>
                <div>
                  <Label htmlFor="epo-psc">PSČ</Label>
                  <Input id="epo-psc" name="psc" autoComplete="postal-code" />
                </div>
                <div>
                  <Label htmlFor="epo-ufoCil">Kód finančního úřadu</Label>
                  <Input id="epo-ufoCil" name="ufoCil" placeholder="např. 451 (Praha)" />
                </div>
              </div>
              <p className="text-xs text-inkoust-tlumeny">
                Kód svého finančního úřadu najdeš v{' '}
                <a
                  href="https://mojedane.gov.cz/pmd/dokumentace/ciselniky/ukazka/ufo"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-inkoust"
                >
                  číselníku územních finančních orgánů
                </a>
                . Všechna pole jsou volitelná — co nevyplníš, doplníš po načtení v EPO.
              </p>
              <Button type="submit">Stáhnout XML pro EPO</Button>
            </form>
            <p className="text-xs text-inkoust-tlumeny">
              XML obsahuje jen investiční příjmy (§ 8 a § 10
              {result.tax.recommended === 'SEPARATE_16A' ? ', Příloha č. 4' : ''}) z tohoto
              reportu. Máš-li i jiné příjmy (zaměstnání, podnikání, nájem), doplň je v EPO —
              výpočet daně se tam přepočítá. Ber to jako podklad, ne hotové přiznání.
            </p>
          </>
        ) : (
          <p className="text-sm text-inkoust-tlumeny">
            Pro rok {year} oficiální struktura XML přiznání zatím neexistuje — finanční
            správa ji zveřejňuje až začátkem následujícího roku. Export tu bude, jakmile
            vyjde; zatím poslouží čísla níže.
          </p>
        )}
      </Card>

      <Card className="space-y-2">
        <CardTitle>Průvodce: co kam zapsat v přiznání</CardTitle>
        {EPO_SUPPORTED_YEARS.includes(year) ? (
          <ul className="space-y-2 text-sm">
            <li>
              <strong>Prodeje CP (§ 10):</strong> Příloha č. 2, tabulka druh{' '}
              <span className="font-mono">D — prodej cenných papírů</span>: příjmy{' '}
              <span className="font-mono">{czk(result.securities.taxableIncomeCzk)}</span> (ř.
              207), výdaje <span className="font-mono">{czk(result.securities.expensesCzk)}</span>{' '}
              (ř. 208), rozdíl (ř. 209) → <strong>ř. 40</strong> přiznání. U zahraničních
              brokerů zaškrtni kód „Z".
            </li>
            <li>
              <strong>Dividendy a úroky ze zahraničí (§ 8):</strong>{' '}
              {result.tax.recommended === 'SEPARATE_16A' ? (
                <>
                  výhodnější je samostatný základ (§ 16a): Příloha č. 4, ř. 401a{' '}
                  <span className="font-mono">{czk(result.dividends.base8Czk)}</span>, daň 15 %
                  ř. 410, zápočet zahraniční srážky ř. 412–413, výsledek ř. 414 →{' '}
                  <strong>ř. 74a</strong> přiznání (ř. 38 zůstává prázdný).
                </>
              ) : (
                <>
                  brutto <span className="font-mono">{czk(result.dividends.base8Czk)}</span> →{' '}
                  <strong>ř. 38</strong> přiznání; zápočet sražené daně po státech přes
                  Přílohu č. 3 (ř. 321–330; uznatelný zápočet{' '}
                  <span className="font-mono">{czk(result.dividends.creditableWithholdingCzk)}</span>
                  ) → ř. 58 + povinný Seznam dle § 38f odst. 10.
                </>
              )}
            </li>
            <li>
              <strong>Sleva na poplatníka:</strong> ř. 64 přesně{' '}
              <span className="font-mono">30 840 Kč</span>. Osvobozené příjmy (časový test,
              úhrn do 100k) se do přiznání <strong>neuvádějí</strong>
              {result.limits.reporting38v.length > 0 &&
                ' — ale jednotlivé osvobozené příjmy nad 5 mil. Kč máš povinnost oznámit (§ 38v)'}
              .
            </li>
            <li>
              <strong>Paušální režim:</strong> zaplacené zálohy z paušálního režimu patří na
              ř. 86. Termín podání: 1. 4. {year + 1} papírově / elektronicky 4 měsíce od
              konce roku (2. 5., připadne-li na víkend, tak nejbližší pracovní den).
            </li>
            <li className="text-inkoust-tlumeny">
              Čísla řádků odpovídají struktuře elektronického podání DPFDP7 (období
              2024–2025; papírový tiskopis 25 5405) — všechno výše předvyplní export XML
              o kousek výš.
            </li>
          </ul>
        ) : (
          <p className="text-sm text-inkoust-tlumeny">
            Dílčí základ § 10 patří do Přílohy č. 2 (druh D — prodej cenných papírů) na ř. 40,
            zahraniční dividendy do § 8 (ř. 38, zápočet přes Přílohu č. 3), varianta § 16a přes
            Přílohu č. 4. Přesná čísla řádků pro období {year} ověříme, až finanční správa
            zveřejní strukturu — čísla výše platí pro tiskopis 2024/2025.
          </p>
        )}
        <p className="text-xs text-inkoust-tlumeny">
          Konfigurace výpočtu: párování {result.options.matchingMethod} ·{' '}
          {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'} ·
          limit 100k {result.options.limit100kIncludesTimeTestExempt ? 'striktně' : 'mírněji'} ·
          časový test od data {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'}.
          Jednotné kurzy 2020–2025 jsou ověřené z pokynů GFŘ řady D; kurz běžného roku je
          orientační do vydání pokynu. Danero je výpočetní nástroj, nikoli daňové poradenství.
        </p>
      </Card>
    </div>
  );
}
