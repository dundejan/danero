import Link from 'next/link';
import { ZERO, type Transaction } from '@danero/shared';
import {
  analyzeTaxYear,
  compareVariants,
  filingDeadlines,
  UNIFIED_RATE_SOURCES,
  type DerivativeItem,
  type EngineInput,
} from '@danero/engine';
import { Button, buttonVariants } from '@/components/ui/button';
import { PrintButton } from '@/components/print-button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
import { groupByCode, WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import { EPO_SUPPORTED_YEARS, prijmyZeStatuProZapocet } from '@/lib/epo';
import { czDate, czk, FX_METHOD_LABEL, limit100kLabel, METHOD_LABEL, plural } from '@/lib/format';
import { isRateVerified, UNIFIED_RATES } from '@/lib/tax-config';
import {
  engineInputForUser,
  instrumentLabels,
  type PinnedTaxYearOptions,
  type ProfileRow,
} from '@/lib/portfolio';
import { cn } from '@/lib/utils';

/** Kolik prodejů se vejde na jednu stranu reportu. */
export const DISPOSALS_PER_PAGE = 200;

/**
 * Stránkování tabulky prodejů. Vytaženo jako čistá funkce, aby šlo otestovat
 * bez renderu — na tom totiž záleží: rozpad na jednotlivé nákupy je součást
 * placeného tarifu, takže se řádky smí rozdělit, ale nikdy ztratit.
 * Strana mimo rozsah se ořízne, ne aby vyšla prázdná tabulka.
 */
export function disposalPage(
  total: number,
  page: number,
  perPage = DISPOSALS_PER_PAGE,
): { totalPages: number; currentPage: number; fromRow: number } {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  return { totalPages, currentPage, fromRow: (currentPage - 1) * perPage };
}

/**
 * Věta, kterou nese VYTIŠTĚNÝ podklad, když se tabulka prodejů stránkuje.
 *
 * Stránkovací lišta je `print:hidden`, takže bez tohohle odstavce vypadal
 * výtisk kompletně, přestože u 25 000 prodejů obsahoval 200 řádků a 24 800
 * chybělo — a v aplikaci nad ním stálo „Tisk i XML pro podatelnu obsahují
 * všechny prodeje“, což neplatilo ani u tisku (`window.print()` tiskne DOM),
 * ani u XML (to nese úhrny do řádků přiznání, ne rozpis prodejů). Nález
 * H-3-01: neúplný podklad odnesený na finanční úřad v domnění, že je úplný.
 *
 * Čistá funkce kvůli testu — na papír se nedá nahlédnout jinak.
 */
export function printedRangeNote({
  fromRow,
  onPage,
  total,
  page,
  totalPages,
}: {
  fromRow: number;
  onPage: number;
  total: number;
  page: number;
  totalPages: number;
}): string {
  return (
    `Tento výtisk obsahuje prodeje ${fromRow + 1}–${fromRow + onPage} z ${total} ` +
    `(strana ${page} z ${totalPages}). Zbylé strany vytiskneš postupně z aplikace; ` +
    'úhrny výš jsou spočítané ze všech prodejů.'
  );
}

/**
 * Popis derivátové události ve výpisu obchodů. Musí pokrýt všechny čtyři druhy,
 * které engine rozlišuje — dřív to byl ternář se dvěma větvemi a `MARGIN_CLOSE`
 * padal do zbytkové větve „zpětný odkup výpisu“, takže každý CFD, future
 * i MT4/MT5 obchod se v daňovém podkladu popsal jako zpětný odkup vypsané opce
 * (nález A2-11). Mapa přes `kind` má tu výhodu, že další druh z enginu neprojde
 * typovou kontrolou, dokud se sem nedoplní text.
 */
export const DERIVATIVE_KIND_LABEL: Record<DerivativeItem['kind'], string> = {
  LONG_CLOSE: 'uzavření nakoupené pozice',
  SHORT_OPEN: 'výpis (prémie = příjem přijetí)',
  SHORT_CLOSE: 'zpětný odkup výpisu',
  MARGIN_CLOSE: 'uzavření CFD/futures (daní se vypořádaný rozdíl)',
};

/**
 * Věta o zafixované konfiguraci roku — laicky, proč se rok nepřepočítá podle
 * aktuálního nastavení. Fixuje se celá trojice, která mění už podaný rok
 * zpětně: párování (R-05c), kurzová soustava (R-06c) i výklad limitu 100k
 * (R-02c). Dřív se jmenovalo jen párování, přestože kurzy hýbou daní víc.
 * Exportováno kvůli testu znění.
 */
export function pinnedMethodNote(year: number, pinned: PinnedTaxYearOptions): string {
  const method = METHOD_LABEL[pinned.matchingMethod] ?? pinned.matchingMethod;
  const fx = FX_METHOD_LABEL[pinned.fxMethod] ?? pinned.fxMethod;
  return (
    `Rok ${year} se počítá takhle: párování ${method}, ${fx}, ` +
    `${limit100kLabel(pinned.limit100kIncludesTimeTestExempt)}. Zafixovali jsme to, ` +
    'když sis za tenhle rok poprvé vygeneroval podklady, aby se ti čísla v už podaném ' +
    'přiznání zpětně nezměnila — změna v Nastavení se proto do tohohle roku nepromítne. ' +
    'Kvůli dodatečnému přiznání jde fixace zrušit v Nastavení.'
  );
}

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
  precomputed,
  strana = 1,
}: {
  txs: Transaction[];
  profile: ProfileRow;
  year: number;
  years: number[];
  dailyRates?: EngineInput['dailyRates'];
  basePath?: string;
  demo?: boolean;
  /** Stránka tabulky prodejů (od 1) — velké portfolio se jinak nevykreslí. */
  strana?: number;
  /** Výsledky z page-guardu (EngineError) — bez nich by se engine počítal 2×. */
  precomputed?: {
    result: ReturnType<typeof analyzeTaxYear>;
    comparison: ReturnType<typeof compareVariants>;
  };
}) {
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const result = precomputed?.result ?? analyzeTaxYear(input);
  // R-05c: metoda zafixovaná pro tenhle rok (podklady už se za něj generovaly)
  const pinned = profile.pinnedTaxYears?.[year];
  const { variants, recommended } = precomputed?.comparison ?? compareVariants(input);
  const labels = instrumentLabels(txs);

  const activeTax =
    result.tax.recommended === 'GENERAL' ? result.tax.general : result.tax.separate16a;

  // rozpis prodejů: CP + krypto v jedné tabulce (druh u řádku), řazeno dle data
  const allDisposals = [
    ...result.securities.disposals.map((disposal) => ({ disposal, isCrypto: false })),
    ...result.crypto.disposals.map((disposal) => ({ disposal, isCrypto: true })),
  ].sort((a, b) => a.disposal.saleDate.localeCompare(b.disposal.saleDate));

  // Tabulka prodejů se stránkuje: u day-tradera je to desetitisíce řádků i s
  // alokacemi a stránka se nevykreslila vůbec (proces vyrostl na 3,9 GB).
  // Rozpad na jednotlivé nákupy je součást placeného tarifu, takže se nesmí
  // oříznout — jen rozdělit. Tisk i XML zůstávají úplné.
  const { totalPages, currentPage, fromRow } = disposalPage(allDisposals.length, strana);
  const disposalsOnPage = allDisposals.slice(fromRow, fromRow + DISPOSALS_PER_PAGE);

  // roky jednotných kurzů pro kartu „Použité kurzy“ (výdaj = kurz roku nákupu)
  const rateYears = Array.from({ length: Math.max(0, year - 2020 + 1) }, (_, i) => 2020 + i)
    .filter((y) => UNIFIED_RATES[y] !== undefined);
  const epoMinYear = Math.min(...EPO_SUPPORTED_YEARS);
  // § 16a je reálná alternativa jen se zahraničními dividendami/úroky v § 8
  const hasDividendBase = result.dividends.base8Czk.gt(0);
  const deadlines = filingDeadlines(year);
  /**
   * OSVČ (paušál i běžná) má od 1. 1. 2023 datovou schránku zřízenou ze zákona,
   * takže § 72 odst. 6 daňového řádu jí ukládá podat přiznání jen elektronicky;
   * písemné podání je vada podání (§ 74 DŘ). Nabízet jí papírový termín znamená
   * poslat ji do pokuty a zbytečně jí zkrátit lhůtu o měsíc (nález E-23).
   */
  const filesElectronicallyOnly = profile.regime === 'PAUSAL' || profile.regime === 'OSVC';

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
        výklad limitu 100k: {result.options.limit100kIncludesTimeTestExempt ? 'striktní' : 'mírnější'}
        {pinned && ' (všechny tři zafixovány pro tento rok)'} ·
        časový test od {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'} ·
        stablecoiny (EMT): {result.options.emtTimeTestExempt ? 'časový test uplatněn (mírnější výklad)' : 'bez osvobození (opatrný výklad)'}.
        Kurzy: pokyny GFŘ D-49…D-75 (2020–2025), viz dokumentace metodiky.
      </p>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-1">
          <CardTitle>Dílčí základ § 10 (součet druhů)</CardTitle>
          <p className="font-mono text-lg font-semibold sm:text-xl">
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
              ' — druhy se nekompenzují'}
          </p>
        </Card>
        <Card className="space-y-1">
          <CardTitle>Dílčí základ § 8 (dividendy, úroky)</CardTitle>
          <p className="font-mono text-lg font-semibold sm:text-xl">{czk(result.dividends.base8Czk)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            Srážková daň v zahraničí {czk(result.dividends.foreignWithholdingCzk)}, započitatelná{' '}
            {czk(result.dividends.creditableWithholdingCzk)}
          </p>
        </Card>
        <Card className="space-y-1">
          <CardTitle>Orientační daň z investic</CardTitle>
          <p className="font-mono text-lg font-semibold sm:text-xl">{czk(activeTax.taxCzk)}</p>
          <p className="text-xs text-inkoust-tlumeny">
            {/* uplatněný zápočet = rozdíl zaokrouhlených členů, ať rovnice sedí i po
                zaokrouhlení na celé Kč (jinak by X − Y mohlo o korunu minout titulek) */}
            Daň před zápočtem {czk(activeTax.taxBeforeCreditCzk)} − uplatněný zápočet{' '}
            {czk(
              activeTax.taxBeforeCreditCzk
                .toDecimalPlaces(0)
                .sub(activeTax.taxCzk.toDecimalPlaces(0)),
            )}
            .{' '}
            {hasDividendBase &&
              `Číslo je z varianty ${
                result.tax.recommended === 'SEPARATE_16A'
                  ? '§ 16a (samostatný základ)'
                  : 'obecného základu (15/23 %)'
              }.`}
          </p>
        </Card>
      </section>

      {/* delší výklad k číslům v kartách — jednou pod gridem, ne v každé kartě */}
      <p className="text-xs text-inkoust-tlumeny">
        Prostý zápočet (§ 38f) je stropovaný podílem zahraničních příjmů na základu — může
        být nižší než započitatelná srážka z tabulky států. {result.tax.note}
      </p>

      {/* E-27: obě varianty vedle sebe, bez slova „výhodnější“ — kterou v přiznání
          uplatníš, je tvoje volba, stejně jako u metod párování (docs/13 V-4) */}
      {hasDividendBase && (
        <p className="text-xs text-inkoust-tlumeny">
          Zahraniční dividendy a úroky (§ 8) lze zdanit dvěma způsoby a volba je na tobě:
          orientační daň z investic v <strong>obecném základu</strong> je{' '}
          <span className="font-mono">{czk(result.tax.general.taxCzk)}</span>, v{' '}
          <strong>samostatném základu § 16a</strong>{' '}
          <span className="font-mono">{czk(result.tax.separate16a.taxCzk)}</span> — obojí před
          slevami na dani. V samostatném základu nelze uplatnit slevy na dani ani nezdanitelné
          části základu, takže o výsledné dani rozhoduje i tvůj zbytek přiznání, který Danero nevidí.
        </p>
      )}

      <Card className="space-y-3">
        <CardTitle>Porovnání variant párování</CardTitle>
        <ScrollArea label="Porovnání variant párování">
          {/* název tabulky pro čtečku; vizuálně ho nese nadpis karty nad ní */}
          <table aria-label="Srovnání variant výpočtu daně" className="w-full text-sm">
            <thead>
              <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                <th scope="col" className="py-2 pr-4 font-medium">Metoda</th>
                <th scope="col" className="py-2 pr-4 font-medium">Kurzy</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Základ § 10</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Daň</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Limit 50k</th>
                {/* sloupec s odznakem doporučení — název jen pro čtečku; `sr-only` span
                    uvnitř posuvné tabulky přetékal na mobilu, atribut ne */}
                <th scope="col" aria-label="Doporučení" className="py-2 font-medium" />
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
                        variant.flatTax50kExceeded ? 'text-cervena' : 'text-zelena-text',
                      )}
                    >
                      {variant.flatTax50kExceeded ? 'prolomen' : czk(variant.flatTax50kUsedCzk)}
                    </td>
                    <td className="py-2 font-sans text-xs">
                      {isRecommended && (
                        <span className="rounded bg-ruzova/10 px-2 py-0.5 font-semibold text-ruzova-text">
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
        </ScrollArea>
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
          <p className="text-xs text-jantar-text">
            Denní kurzy ČNB se zatím nepodařilo načíst — srovnání zahrnuje jen jednotný
            kurz. Zkus stránku otevřít později.
          </p>
        )}
        <p className="text-xs text-inkoust-tlumeny">
          {demo ? (
            <>
              V plné verzi metodu přepneš v Nastavení —{' '}
              <Link href="/registrace" className="font-medium text-ruzova">
                založ si účet
              </Link>
              .
            </>
          ) : pinned ? (
            pinnedMethodNote(year, pinned)
          ) : (
            'Metodu změníš v Nastavení.'
          )}{' '}
          FIFO je bezpečný standard; jinou metodu párování lze obhájit jen průkaznou
          identifikací konkrétních prodávaných kusů — a zvolená metoda se drží
          konzistentně celý rok (kombinovat nelze).
        </p>
      </Card>

      {allDisposals.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Prodeje v roce {year} ({allDisposals.length})</CardTitle>
          <ScrollArea label={`Prodeje v roce ${year}`}>
            {/* název tabulky pro čtečku; vizuálně ho nese nadpis karty nad ní */}
            <table aria-label="Rozpis prodejů cenných papírů a kryptoaktiv" className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th scope="col" className="py-2 pr-4 font-medium">Instrument</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Datum</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Tržba</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Výdaje</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Osvobozeno</th>
                  <th scope="col" className="py-2 text-right font-medium">Zdanitelná tržba</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {disposalsOnPage.map(({ disposal, isCrypto }) => {
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
                      <td className="whitespace-nowrap py-2 pr-4 text-right text-zelena-text">
                        {czk(disposal.exemptProceedsCzk)}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">{czk(disposal.taxableProceedsCzk)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
          {/* Na papíře musí být vidět, že tabulka pokračuje — stránkovací lišta
              je `print:hidden`, takže bez téhle věty odnese uživatel na finanční
              úřad neúplný rozpis v domnění, že je kompletní (H-3-01). */}
          {totalPages > 1 && (
            <p className="hidden border-t border-linka pt-3 text-xs text-inkoust-tlumeny print:block">
              {printedRangeNote({
                fromRow,
                onPage: disposalsOnPage.length,
                total: allDisposals.length,
                page: currentPage,
                totalPages,
              })}
            </p>
          )}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linka pt-3 text-sm print:hidden">
              {/* Dřív tu stálo „Tisk i XML pro podatelnu obsahují všechny
                  prodeje.“ — nebyla to pravda ani v jedné půlce (nález H-3-01).
                  `window.print()` tiskne DOM, a v něm je jen tahle strana;
                  XML pro podatelnu nese úhrny do řádků přiznání, ne rozpis
                  jednotlivých prodejů. Vytištěný podklad tak vypadal úplně,
                  a přitom mu u 25 000 prodejů chybělo 24 800 řádků. */}
              <p className="text-inkoust-tlumeny">
                Prodeje {fromRow + 1}–{fromRow + disposalsOnPage.length} z{' '}
                {allDisposals.length} · strana {currentPage} z {totalPages}. Vytiskne
                se vždy jen zobrazená strana; úhrny do řádků přiznání i XML pro
                podatelnu jsou spočítané ze všech prodejů.
              </p>
              <nav className="flex items-center gap-2" aria-label="Stránkování prodejů">
                {currentPage > 1 && (
                  <Link
                    href={`${basePath}/report?rok=${year}&strana=${currentPage - 1}`}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Předchozí
                  </Link>
                )}
                {currentPage < totalPages && (
                  <Link
                    href={`${basePath}/report?rok=${year}&strana=${currentPage + 1}`}
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Další
                  </Link>
                )}
              </nav>
            </div>
          )}
        </Card>
      )}

      {result.derivatives.items.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Derivátové obchody v roce {year} ({result.derivatives.items.length})</CardTitle>
          <ScrollArea label={`Derivátové obchody v roce ${year}`}>
            {/* název tabulky pro čtečku; vizuálně ho nese nadpis karty nad ní */}
            <table aria-label="Rozpis derivátových obchodů" className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th scope="col" className="py-2 pr-4 font-medium">Instrument</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Datum</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Událost</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Příjem</th>
                  <th scope="col" className="py-2 text-right font-medium">Výdaj</th>
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
                      {DERIVATIVE_KIND_LABEL[item.kind]}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(item.incomeCzk)}</td>
                    <td className="whitespace-nowrap py-2 text-right">{czk(item.expenseCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          {result.derivatives.deniedExpensesCzk.gt(0) && (
            <p className="text-xs text-jantar-text">
              Prémie bezcenně expirovaných opcí {czk(result.derivatives.deniedExpensesCzk)} počítáme
              podle opatrného výkladu jako neuznatelný výdaj. Mírnější výklad „výdaje za
              celý druh“ by{' '}
              {/* skutečný dopad, ne hrubá prémie: výdaje druhu jsou stropované
                  jeho příjmy (§ 10/4), takže rozdíl bývá výrazně menší */}
              {result.derivatives.deniedExpensesImpactCzk.gt(0) ? (
                <>
                  základ daně snížil o{' '}
                  <span className="font-mono">
                    {czk(result.derivatives.deniedExpensesImpactCzk)}
                  </span>{' '}
                  (méně než celá prémie — výdaje druhu se uplatní nejvýš do výše jeho příjmů,
                  § 10/4)
                </>
              ) : (
                <>na základu daně letos nic nezměnil — výdaje druhu už teď dosáhly stropu jeho
                příjmů (§ 10/4)</>
              )}
              ;{' '}
              {demo
                ? 'v plné verzi si výklad přepneš v Nastavení — založ si účet.'
                : 'přepínač najdeš v Nastavení.'}
            </p>
          )}
        </Card>
      )}

      {result.dividends.items.length > 0 && (
        <Card className="space-y-3">
          <CardTitle>Příjmy podle států (zápočet dle § 38f, Příloha č. 3)</CardTitle>
          <ScrollArea label="Příjmy podle států">
            {/* název tabulky pro čtečku; vizuálně ho nese nadpis karty nad ní */}
            <table aria-label="Zahraniční příjmy a sražená daň po státech" className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th scope="col" className="py-2 pr-4 font-medium">Stát</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Příjem do zápočtu</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Sraženo</th>
                  <th scope="col" className="py-2 text-right font-medium">Započitatelná srážka</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {Object.entries(result.dividends.creditableByCountry).map(([country, data]) => (
                  <tr key={country} className="border-b border-linka/60">
                    <td className="py-2 pr-4 font-sans font-medium">{country}</td>
                    {/* přesně to, co půjde na ř. 321 Přílohy 3 — jedno číslo, jedna pravda */}
                    <td className="whitespace-nowrap py-2 pr-4 text-right">
                      {czk(prijmyZeStatuProZapocet(country, data, result.options))}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{czk(data.withholdingCzk)}</td>
                    <td className="whitespace-nowrap py-2 text-right">{czk(data.creditableCzk)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          {/* hlavička § 8 zahrnuje i úroky — bez tohoto řádku by rozpis neseděl na souhrn */}
          {result.dividends.taxableInterestCzk.gt(0) && (
            <p className="text-xs text-inkoust-tlumeny">
              Úroky (zdanitelné):{' '}
              <span className="font-mono text-inkoust">
                {czk(result.dividends.taxableInterestCzk)}
              </span>{' '}
              — vstupují do dílčího základu § 8 vedle dividend z tabulky. Do sloupce
              „příjem do zápočtu“ se počítají jen úroky, které smlouva o zamezení dvojího
              zdanění dovoluje zdanit i státu zdroje (§ 38f odst. 3); u většiny států
              včetně USA a Německa smí úrok zdanit jen země, kde bydlíš, takže do zápočtu
              nevstupuje a případnou srážku vrací zahraniční správce daně.
            </p>
          )}
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
          {/* počet = zobrazené skupiny (viz prehled-view) */}
          <CardTitle>Kontroly výpočtu ({groupByCode(result.warnings).length})</CardTitle>
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
          // teaser: XML s vlastními čísly až s účtem — ukázkový soubor ale
          // ukáže přesně, co z Danera padá na podatelnu
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-inkoust-tlumeny">
                V demu nedostupné — založ si účet a stáhni XML písemnosti DPFDP7 pro
                podatelnu mojedane.cz s vlastními čísly z tohoto reportu.
              </p>
              <Link
                href="/registrace"
                className={buttonVariants({ variant: 'primary' })}
              >
                Založit účet zdarma
              </Link>
            </div>
            <p className="text-sm">
              <a
                href="/marketing/ukazka-dpfdp7-2025.xml"
                download
                className="font-medium text-ruzova"
              >
                Stáhni ukázkové XML (2025)
              </a>{' '}
              <span className="text-inkoust-tlumeny">
                — přesně tohle nahraješ na podatelnu (fiktivní osobní údaje, čísla z demo
                portfolia).
              </span>
            </p>
          </>
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
              {/* E-27: variantu zdanění § 8 nevybíráme za uživatele — ukážeme obě
                  čísla a rozhodnutí necháme na něm, stejně jako u metod párování.
                  Endpoint /api/epo pole `varianta` přijímal už dřív. */}
              {hasDividendBase && (
                <div className="max-w-md">
                  <Label htmlFor="epo-varianta">Zdanění zahraničních dividend a úroků (§ 8)</Label>
                  <Select
                    id="epo-varianta"
                    name="varianta"
                    defaultValue={result.tax.recommended}
                  >
                    <option value="GENERAL">
                      Obecný základ (ř. 38) — daň {czk(result.tax.general.taxCzk)}
                    </option>
                    <option value="SEPARATE_16A">
                      Samostatný základ § 16a (Příloha č. 4) — daň{' '}
                      {czk(result.tax.separate16a.taxCzk)}
                    </option>
                  </Select>
                  <p className="mt-1 text-xs text-inkoust-tlumeny">
                    Obě částky jsou před slevami na dani; v samostatném základu § 16a nelze
                    uplatnit slevy na dani ani nezdanitelné části základu.
                  </p>
                </div>
              )}
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
              XML obsahuje jen investiční příjmy (§ 8 a § 10{hasDividendBase ? '; ve variantě § 16a navíc Přílohu č. 4' : ''}) z tohoto
              reportu; ostatní příjmy (zaměstnání, podnikání, nájem) v něm nejsou a EPO
              výpočet daně přepočítá až po jejich zadání. Je to podklad, ne hotové přiznání.
            </p>
          </>
        ) : year < epoMinYear ? (
          <p className="text-sm text-inkoust-tlumeny">
            Roky před {epoMinYear} v XML nepodporujeme. Čísla pro ruční vyplnění formuláře
            jsou níže.
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
              výdaje <span className="font-mono">{czk(result.securities.expensesCzk)}</span>.
              Řádek u zahraničního brokera nese kód „Z“ (příjem ze zdrojů v zahraničí).
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
              {/* E-27: obě cesty popsané vedle sebe, bez „výhodnější je“ — variantu
                  vybírá uživatel (i ve formuláři pro XML výš) */}
              <strong>Dividendy a úroky ze zahraničí (§ 8):</strong> dvě možné cesty, mezi
              kterými volíš ty:
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>Obecný základ:</strong> brutto{' '}
                  <span className="font-mono">{czk(result.dividends.base8Czk)}</span> →{' '}
                  <strong>ř. 38</strong> přiznání; zápočet sražené daně po státech přes
                  Přílohu č. 3 (ř. 321–330; uznatelný zápočet{' '}
                  <span className="font-mono">{czk(result.dividends.creditableWithholdingCzk)}</span>
                  ) → ř. 58 + povinný Seznam dle § 38f odst. 10.
                </li>
                <li>
                  <strong>Samostatný základ § 16a:</strong> Příloha č. 4, ř. 401a{' '}
                  <span className="font-mono">{czk(result.dividends.base8Czk)}</span>, daň 15 %
                  ř. 410, zápočet zahraniční srážky ř. 412–413, výsledek ř. 414 →{' '}
                  <strong>ř. 74a</strong> přiznání (ř. 38 zůstává prázdný). Slevy na dani ani
                  nezdanitelné části základu v něm uplatnit nelze.
                </li>
              </ul>
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
              ř. 86.
            </li>
            <li>
              <strong>Termín podání za rok {year}:</strong>{' '}
              {filesElectronicallyOnly ? (
                <>
                  <strong>{czDate(deadlines.electronic)}</strong>. OSVČ má od 1. 1. 2023
                  datovou schránku zřízenou ze zákona, a přiznání se proto podává jen
                  elektronicky (§ 72 odst. 6 daňového řádu) — platí pro ni čtyřměsíční lhůta,
                  ne tříměsíční lhůta pro písemné podání. S daňovým poradcem{' '}
                  {czDate(deadlines.advisor)}.
                </>
              ) : (
                <>
                  <strong>{czDate(deadlines.paper)}</strong> písemně /{' '}
                  <strong>{czDate(deadlines.electronic)}</strong> elektronicky (3 a 4 měsíce
                  od konce roku dle § 136 daňového řádu; svátek a víkend termín posouvají na
                  nejbližší pracovní den). S daňovým poradcem {czDate(deadlines.advisor)}.
                </>
              )}
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
          časový test od data {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'} ·
          stablecoiny (EMT) {result.options.emtTimeTestExempt ? 's časovým testem (mírnější výklad)' : 'bez osvobození (opatrný výklad)'}.
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
          <ScrollArea label="Použité jednotné kurzy GFŘ">
            {/* název tabulky pro čtečku; vizuálně ho nese nadpis karty nad ní */}
            <table aria-label="Použité jednotné kurzy podle roku" className="w-full text-sm">
              <thead>
                <tr className="border-b border-linka text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <th scope="col" className="py-2 pr-4 font-medium">Rok</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">USD</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">EUR</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">GBP</th>
                  <th scope="col" className="py-2 font-medium">Zdroj</th>
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
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
