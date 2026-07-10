import Link from 'next/link';
import { ZERO, type Transaction } from '@danero/shared';
import {
  analyzeTaxYear,
  compareVariants,
  UNIFIED_RATE_SOURCES,
  type EngineInput,
} from '@danero/engine';
import { Button } from '@/components/ui/button';
import { PrintButton } from '@/components/print-button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { czDate, czk, METHOD_LABEL, plural } from '@/lib/format';
import { isRateVerified, UNIFIED_RATES } from '@/lib/tax-config';
import { engineInputForUser, instrumentLabels, type ProfileRow } from '@/lib/portfolio';
import { cn } from '@/lib/utils';

/**
 * Sdílené tělo daňového reportu: kompletní podklady k přiznání z čistého
 * enginu. Reálná stránka dodá data z DB (a denní kurzy ČNB), demo ukázkový
 * dataset. V demu se export XML nahrazuje teaserem — soubor by nesl smyšlená
 * data a bez účtu nemá kam vést.
 */
export function ReportView({
  txs,
  profile,
  year,
  years,
  dailyRates,
  basePath = '',
  demo = false,
}: {
  txs: Transaction[];
  profile: ProfileRow;
  year: number;
  years: number[];
  dailyRates?: EngineInput['dailyRates'];
  basePath?: string;
  demo?: boolean;
}) {
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const result = analyzeTaxYear(input);
  const { variants, recommended } = compareVariants(input);
  const labels = instrumentLabels(txs);

  const activeTax =
    result.tax.recommended === 'GENERAL' ? result.tax.general : result.tax.separate16a;

  // rozpis prodejů: CP + krypto v jedné tabulce (druh u řádku), řazeno dle data
  const allDisposals = [
    ...result.securities.disposals.map((disposal) => ({ disposal, isCrypto: false })),
    ...result.crypto.disposals.map((disposal) => ({ disposal, isCrypto: true })),
  ].sort((a, b) => a.disposal.saleDate.localeCompare(b.disposal.saleDate));

  // roky jednotných kurzů pro kartu „Použité kurzy“ (výdaj = kurz roku nákupu)
  const rateYears = Array.from({ length: Math.max(0, year - 2020 + 1) }, (_, i) => 2020 + i)
    .filter((y) => UNIFIED_RATES[y] !== undefined);
  const epoMinYear = Math.min(...EPO_SUPPORTED_YEARS);

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
          <YearSwitcher years={years} active={year} hrefBase={`${basePath}/report`} />
          <PrintButton />
        </div>
      </header>

      {/* jen v tisku: identifikace podkladů (průkaznost výpočtu) */}
      <p className="hidden text-xs text-inkoust-tlumeny print:block">
        Podklady k přiznání za zdaňovací období {year} · vygenerováno {czDate(new Date().toISOString().slice(0, 10))}{' '}
        aplikací Danero · {txs.length} {plural(txs.length, 'transakce', 'transakce', 'transakcí')} ·
        párování {METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod} ·{' '}
        {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'} ·
        výklad limitu 100k: {result.options.limit100kIncludesTimeTestExempt ? 'striktní' : 'mírnější'} ·
        časový test od {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'}.
        Kurzy: pokyny GFŘ D-49…D-75 (2020–2025), viz dokumentace metodiky.
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-1">
          <CardTitle>Dílčí základ § 10 (součet druhů)</CardTitle>
          <p className="font-mono text-xl font-semibold">
            {czk(
              result.securities.base10Czk
                .plus(result.crypto.base10Czk)
                .plus(result.derivatives.base10Czk),
            )}
          </p>
          <p className="text-xs text-inkoust-tlumeny">
            CP: tržby {czk(result.securities.totalGrossProceedsCzk)}, základ{' '}
            {czk(result.securities.base10Czk)}
            {result.securities.exemptUnder100k && ' (vše osvobozeno, úhrn do 100k)'}
            {result.crypto.disposals.length > 0 && (
              <>
                {' '}· krypto: tržby {czk(result.crypto.totalGrossProceedsCzk)}, základ{' '}
                {czk(result.crypto.base10Czk)}
              </>
            )}
            {result.derivatives.items.length > 0 && (
              <>
                {' '}· deriváty: plnění {czk(result.derivatives.taxableIncomeCzk)}, základ{' '}
                {czk(result.derivatives.base10Czk)}
              </>
            )}
            {(result.crypto.disposals.length > 0 || result.derivatives.items.length > 0) &&
              ' — druhy se nekompenzují (R-10c/R-12l)'}
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
            {/* uplatněný zápočet = rozdíl zaokrouhlených členů, ať rovnice sedí i po
                zaokrouhlení na celé Kč (jinak by X − Y mohlo o korunu minout titulek) */}
            Daň před zápočtem {czk(activeTax.taxBeforeCreditCzk)} − uplatněný zápočet{' '}
            {czk(
              activeTax.taxBeforeCreditCzk
                .toDecimalPlaces(0)
                .sub(activeTax.taxCzk.toDecimalPlaces(0)),
            )}
            . Prostý zápočet (§ 38f) je stropovaný podílem zahraničních příjmů na
            základu — může být nižší než započitatelná srážka z tabulky států.
          </p>
          <p className="text-xs text-inkoust-tlumeny">
            {result.tax.recommended === 'SEPARATE_16A'
              ? 'Výhodnější je samostatný základ § 16a (Příloha č. 4).'
              : 'Výhodnější je obecný základ (15/23 %).'}{' '}
            {result.tax.note}
          </p>
        </Card>
      </section>

      <Card className="space-y-3">
        <CardTitle title="Pravidlo R-05c v metodice Danero">Porovnání variant párování</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                <th className="py-2 pr-4 font-medium">Metoda</th>
                <th className="py-2 pr-4 font-medium">Kurzy</th>
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
                    <td className="py-2 pr-4 font-sans text-inkoust-tlumeny">
                      {variant.fxMethod === 'UNIFIED' ? 'jednotný' : 'denní ČNB'}
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
                          nejvýhodnější
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
        {demo ? (
          <p className="text-xs text-inkoust-tlumeny">
            Denní kurzy jsou v demu ukázkové (odvozené z jednotného kurzu roku) — s vlastním
            účtem počítáme se skutečnými denními kurzy ČNB; nejvýhodnější kombinace je
            zvýrazněná.
          </p>
        ) : dailyRates ? (
          <p className="text-xs text-inkoust-tlumeny">
            Denní kurzy ČNB jsou načtené z oficiálního zdroje — tabulka srovnává jednotný
            kurz GFŘ i denní kurzy s reálnými čísly; nejvýhodnější kombinace je zvýrazněná.
          </p>
        ) : (
          <p className="text-xs text-jantar">
            Denní kurzy ČNB se zatím nepodařilo načíst — srovnání zahrnuje jen jednotný
            kurz. Zkus stránku otevřít později.
          </p>
        )}
        <p className="text-xs text-inkoust-tlumeny">
          Metodu změníš v Nastavení. FIFO je bezpečný standard; jinou metodu párování lze
          obhájit jen průkaznou identifikací konkrétních prodávaných kusů — a zvolená
          metoda se drží konzistentně celý rok (kombinovat nelze).
        </p>
      </Card>

      {allDisposals.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Prodeje v roce {year} ({allDisposals.length})</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4 font-medium">Instrument</th>
                  <th className="py-2 pr-4 text-right font-medium">Datum</th>
                  <th className="py-2 pr-4 text-right font-medium">Tržba</th>
                  <th className="py-2 pr-4 text-right font-medium">Výdaje</th>
                  <th className="py-2 pr-4 text-right font-medium">Osvobozeno</th>
                  <th className="py-2 text-right font-medium">Zdanitelná tržba</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {allDisposals.map(({ disposal, isCrypto }) => {
                  // osvobození úhrnem do 100k platí pro celý druh — výdaje se pak
                  // daňově neuplatňují (R-05b), ale nabývací cena nulová nebyla
                  const under100k = isCrypto
                    ? result.crypto.exemptUnder100k
                    : result.securities.exemptUnder100k;
                  const expensesCzk = disposal.allocations.reduce(
                    (acc, alloc) => acc.plus(alloc.expenseCzk),
                    ZERO,
                  );
                  return (
                    <tr key={disposal.sellTxId} className="border-b border-linka/60">
                      <td className="py-2 pr-4">
                        {/* nativní <details> — server component bez JS; rozpad = auditní stopa párování */}
                        <details>
                          <summary className="cursor-pointer">
                            <span className="font-sans">{labels.get(disposal.isin) ?? disposal.isin}</span>
                            {isCrypto && (
                              <span className="ml-2 rounded bg-linka/60 px-1.5 py-0.5 font-sans text-xs text-inkoust-tlumeny">
                                krypto
                              </span>
                            )}
                          </summary>
                          <ul className="mt-1 space-y-0.5 font-sans text-xs text-inkoust-tlumeny">
                            {disposal.allocations.map((alloc) => (
                              <li key={alloc.lotId}>
                                {alloc.quantity.toString()} ks · nabyto {czDate(alloc.acquisitionDate)} ·{' '}
                                {alloc.timeTestExempt
                                  ? 'osvobozeno 3letým testem (výdaj se neuplatňuje)'
                                  : under100k
                                    ? 'osvobozeno úhrnem do 100 000 Kč (výdaj se neuplatňuje)'
                                    : `výdaj ${czk(alloc.expenseCzk)}`}
                              </li>
                            ))}
                            <li className="text-[11px]">Výdaj je přepočten kurzem roku nákupu.</li>
                          </ul>
                        </details>
                      </td>
                      <td className="py-2 pr-4 text-right">{czDate(disposal.saleDate)}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(disposal.grossProceedsCzk)}</td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right">
                        {expensesCzk.isZero() && disposal.exemptProceedsCzk.gt(0)
                          ? '—'
                          : czk(expensesCzk)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4 text-right text-zelena">
                        {czk(disposal.exemptProceedsCzk)}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">{czk(disposal.taxableProceedsCzk)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {result.derivatives.items.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Derivátové obchody v roce {year} ({result.derivatives.items.length})</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4 font-medium">Instrument</th>
                  <th className="py-2 pr-4 text-right font-medium">Datum</th>
                  <th className="py-2 pr-4 font-medium">Událost</th>
                  <th className="py-2 pr-4 text-right font-medium">Příjem</th>
                  <th className="py-2 text-right font-medium">Výdaj</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.derivatives.items.map((item) => (
                  <tr key={`${item.txId}-${item.kind}`} className="border-b border-linka/60">
                    <td className="py-2 pr-4">
                      <span className="font-sans">{labels.get(item.isin) ?? item.isin}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{czDate(item.date)}</td>
                    <td className="py-2 pr-4 font-sans text-xs text-inkoust-tlumeny">
                      {item.kind === 'LONG_CLOSE'
                        ? 'uzavření nakoupené pozice'
                        : item.kind === 'SHORT_OPEN'
                          ? 'výpis (prémie = příjem přijetí)'
                          : 'zpětný odkup výpisu'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(item.incomeCzk)}</td>
                    <td className="whitespace-nowrap py-2 text-right">{czk(item.expenseCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.derivatives.deniedExpensesCzk.gt(0) && (
            <p className="text-xs text-jantar">
              Prémie bezcenně expirovaných opcí {czk(result.derivatives.deniedExpensesCzk)} počítáme
              podle opatrného výkladu jako neuznatelný výdaj (R-12i) — mírnější výklad „výdaje za celý
              druh" by základ daně snížil; přepínač najdeš v Nastavení.
            </p>
          )}
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
                  <th className="py-2 pr-4 text-right font-medium">Sraženo</th>
                  <th className="py-2 text-right font-medium">Započitatelná srážka</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {Object.entries(result.dividends.creditableByCountry).map(([country, data]) => (
                  <tr key={country} className="border-b border-linka/60">
                    <td className="py-2 pr-4 font-sans font-medium">{country}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(data.grossCzk)}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(data.withholdingCzk)}</td>
                    <td className="whitespace-nowrap py-2 text-right">{czk(data.creditableCzk)}</td>
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
          <CardTitle>Kontroly výpočtu ({result.warnings.length})</CardTitle>
          <WarningsList
            warnings={result.warnings}
            labels={labels}
            forfeitedWithholdingCzk={result.dividends.foreignWithholdingCzk.sub(
              result.dividends.creditableWithholdingCzk,
            )}
          />
        </Card>
      )}

      <Card className="space-y-3">
        <CardTitle>Export pro mojedane.cz</CardTitle>
        {demo ? (
          // teaser: XML s ukázkovými daty nemá kam vést — CTA na vlastní účet
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-inkoust-tlumeny">
              V demu nedostupné — založ si účet a stáhni XML písemnosti DPFDP7 pro
              podatelnu mojedane.cz s vlastními čísly z tohoto reportu.
            </p>
            <Link
              href="/registrace"
              className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Založit účet zdarma
            </Link>
          </div>
        ) : EPO_SUPPORTED_YEARS.includes(year) ? (
          <>
            <p className="text-sm text-inkoust-tlumeny">
              Stáhneš XML písemnosti DPFDP7 s investičními čísly z tohoto reportu a na
              mojedane.cz ho v přiznání nahraješ přes <strong>„Načtení souboru“</strong>.
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
        ) : year < epoMinYear ? (
          <p className="text-sm text-inkoust-tlumeny">
            Roky před {epoMinYear} v XML nepodporujeme — použij čísla níže a vyplň
            formulář ručně.
          </p>
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
              <strong>Prodeje CP (§ 10):</strong> Příloha č. 2, řádek tabulky s druhem{' '}
              <span className="font-mono">D — prodej cenných papírů</span>: příjmy{' '}
              <span className="font-mono">{czk(result.securities.taxableIncomeCzk)}</span>,
              výdaje <span className="font-mono">{czk(result.securities.expensesCzk)}</span>. U
              zahraničních brokerů zaškrtni kód „Z“.
            </li>
            {result.crypto.disposals.length > 0 && (
              <li>
                <strong>Prodeje a směny krypta (§ 10):</strong> samostatný řádek téže tabulky
                s druhem <span className="font-mono">C — prodej movitých věcí</span> (kryptoaktiva
                se daní jako movitá věc): příjmy{' '}
                <span className="font-mono">{czk(result.crypto.taxableIncomeCzk)}</span>, výdaje{' '}
                <span className="font-mono">{czk(result.crypto.expensesCzk)}</span>. S řádkem CP
                se nekompenzují — ztráta z jednoho druhu nesnižuje zisk druhého.
              </li>
            )}
            {result.derivatives.items.length > 0 && (
              <li>
                <strong>Deriváty — opce, futures, CFD (§ 10):</strong> samostatný řádek téže
                tabulky s druhem <span className="font-mono">F — jiné ostatní příjmy</span>:
                příjmy <span className="font-mono">{czk(result.derivatives.taxableIncomeCzk)}</span>,
                výdaje <span className="font-mono">{czk(result.derivatives.expensesCzk)}</span>.
                Deriváty nemají žádné osvobození a s ostatními druhy se nekompenzují.
              </li>
            )}
            <li>
              <strong>Součty Přílohy č. 2:</strong> ř. 207 a 208 = součet příjmů a výdajů za
              všechny druhy, rozdíl (ř. 209) → <strong>ř. 40</strong> přiznání.
            </li>
            <li>
              <strong>Dividendy a úroky ze zahraničí (§ 8):</strong>{' '}
              {result.tax.recommended === 'SEPARATE_16A' ? (
                <>
                  výhodnější je samostatný základ (§ 16a): Příloha č. 4, ř. 401a{' '}
                  <span className="font-mono">{czk(result.dividends.base8Czk)}</span>, daň 15 %
                  ř. 410, zápočet zahraniční srážky ř. 412–413, výsledek ř. 414 →{' '}
                  <strong>ř. 74a</strong> přiznání (ř. 38 zůstává prázdný). V samostatném
                  základu ale nelze uplatnit slevy na dani ani nezdanitelné části —
                  porovnání je orientační, před slevami.
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
            Dílčí základ § 10 patří do Přílohy č. 2 — každý druh na vlastní řádek tabulky
            (D — cenné papíry{result.crypto.disposals.length > 0 && ', C — kryptoaktiva'}
            {result.derivatives.items.length > 0 && ', F — deriváty'}; druhy se nekompenzují)
            — a součet rozdílů na ř. 40,
            zahraniční dividendy do § 8 (ř. 38, zápočet přes Přílohu č. 3), varianta § 16a přes
            Přílohu č. 4. Přesná čísla řádků pro období {year} ověříme, až finanční správa
            zveřejní strukturu — čísla výše platí pro tiskopis 2024/2025.
          </p>
        )}
        <p className="text-xs text-inkoust-tlumeny">
          Konfigurace výpočtu: párování{' '}
          {METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod} ·{' '}
          {result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz GFŘ' : 'denní kurzy ČNB'} ·
          limit 100k {result.options.limit100kIncludesTimeTestExempt ? 'striktně' : 'mírněji'} ·
          časový test od data {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'}.
          Jednotné kurzy 2020–2025 jsou ověřené z pokynů GFŘ řady D; kurz běžného roku je
          orientační do vydání pokynu. Danero je výpočetní nástroj, nikoli daňové poradenství.
        </p>
      </Card>

      {rateYears.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Použité kurzy (jednotný kurz GFŘ, Kč za jednotku)</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Výdaj (nákup) se přepočítává jednotným kurzem roku nákupu, tržba (prodej)
            kurzem roku prodeje. Tabulka ukazuje hlavní měny; další měny (CHF, PLN,
            JPY…) používáme z týchž pokynů. Nákupy před rokem 2020 se přepočítávají
            denními kurzy ČNB.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th className="py-2 pr-4 font-medium">Rok</th>
                  <th className="py-2 pr-4 text-right font-medium">USD</th>
                  <th className="py-2 pr-4 text-right font-medium">EUR</th>
                  <th className="py-2 pr-4 text-right font-medium">GBP</th>
                  <th className="py-2 font-medium">Zdroj</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {rateYears.map((rateYear) => (
                  <tr key={rateYear} className="border-b border-linka/60">
                    <td className="py-2 pr-4">{rateYear}</td>
                    {(['USD', 'EUR', 'GBP'] as const).map((ccy) => (
                      <td key={ccy} className="py-2 pr-4 text-right">
                        {(UNIFIED_RATES[rateYear]?.[ccy] ?? '—').replace('.', ',')}
                      </td>
                    ))}
                    <td className="py-2 font-sans text-xs text-inkoust-tlumeny">
                      {isRateVerified(rateYear) && UNIFIED_RATE_SOURCES[rateYear]
                        ? `pokyn ${UNIFIED_RATE_SOURCES[rateYear]}`
                        : 'orientační (do vydání pokynu)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
