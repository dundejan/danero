import Link from 'next/link';
import { d, ZERO, type Money, type Transaction } from '@danero/shared';
import {
  analyzeTaxYear,
  compareVariants,
  filingDeadlines,
  taxpayerCreditCzk,
  UNIFIED_RATE_SOURCES,
  type DerivativeItem,
  type EngineInput,
  type TaxYearResult,
} from '@danero/engine';
import { AppToolbar } from '@/components/app-toolbar';
import { EpoExportForm } from '@/components/epo-export-form';
import {
  ExemptIncomeReportingNotice,
  FilingDeadlineInfo,
  FilingDeadlineStat,
  filingLimitFor,
  ReportFilingVerdict,
} from '@/components/filing-verdict';
import { PrintButton } from '@/components/print-button';
import {
  DIVIDEND_TAXATION_LABEL,
  DividendTaxationInfo,
  DividendTaxationRow,
  DUE_NAME,
  TAX_NAME,
  TaxFigure,
  TaxFigureInfo,
  TaxResultRows,
} from '@/components/tax-figure';
import { TaxYearConfigNotice } from '@/components/tax-year-config-notice';
import { ViewSwitch } from '@/components/view-switch';
import { Button, buttonVariants } from '@/components/ui/button';
import { Chevron, Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { InfoPrint } from '@/components/ui/info-print';
import { TextLink } from '@/components/ui/link';
import { Group, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Section, SectionHeader } from '@/components/ui/section';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { groupByCode, WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import { today as todayInPrague } from '@/lib/clock';
import {
  creditIncomeByCountry,
  EPO_SUPPORTED_YEARS,
  prijmyZeStatuProZapocet,
  attachment4Lines,
} from '@/lib/epo';
import { EPO_FORM_ID } from '@/lib/epo-form';
import { fxMethodLabel } from '@/lib/fx-method';
import { LIMIT_NAME } from '@/lib/limit-names';
import { taxSummary } from '@/lib/payable-tax';
import {
  base8WholeCzk,
  lossBeyondIncomeCzk,
  priloha2,
  wholeBasesCzk,
  wholeCzkDown,
} from '@/lib/priloha2';
import { regimeLimitFor } from '@/lib/simulator-verdict';
import { variantDifference, variantHint, variantHintTitle } from '@/lib/variant-hint';
import {
  czDate,
  czk,
  FX_METHOD_LABEL,
  limit100kLabel,
  METHOD_LABEL,
  plural,
  yearList,
} from '@/lib/format';
import {
  configForYear,
  FIRST_UNIFIED_RATE_YEAR,
  isRateVerified,
  UNIFIED_RATES,
  unifiedRateYearsUpTo,
  verifiedRateSourceNote,
} from '@/lib/tax-config';
import {
  engineInputForUser,
  instrumentLabels,
  type PinnedTaxYearOptions,
  type ProfileRow,
} from '@/lib/portfolio';
import { tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';

/** Kolik prodejů se vejde na jednu stranu reportu. */
export const DISPOSALS_PER_PAGE = 200;

/**
 * Stránkování tabulky prodejů. Vytaženo jako čistá funkce, aby šlo otestovat
 * bez renderu — na tom totiž záleží: rozpad na jednotlivé nákupy je podklad
 * k přiznání, takže se řádky smí rozdělit, ale nikdy ztratit.
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
 * K7a-02 (§ 7a odst. 5): paušalistovi, který limit 50 000 Kč NEPROLOMIL, se
 * zápočet zahraniční srážky nesmí nabízet bez výhrady — uplatněním v přiznání
 * mu za celý rok přestane být daň rovna paušální dani. Kdo limit prolomil,
 * přiznání podává tak jako tak, odst. 5 na něj nedopadá a zápočet uplatní
 * v plné výši, takže tomu se výhrada neukazuje.
 *
 * Výhrada stojí nad řádky, kterými se zápočet do přiznání zapisuje: hlavní
 * věta je vidět, zdůvodnění se rozbalí pod ní (v tisku je rozbalené). Totéž
 * nese hláška enginu `FLAT_TAX_FOREIGN_CREDIT_UNAVAILABLE` a stránka
 * `/jak-pocitame`.
 */
export function PausalCreditCaveat({ amount }: { amount: string }) {
  return (
    <Notice
      tone="caution"
      title={`Sraženou daň ze zahraničí (${amount}) si letos v Česku nezapočteš — a je to tak v pořádku`}
    >
      <Disclosure summary="Proč a co místo toho">
        <p>
          V paušálním režimu je tvoje daň rovna paušální dani (§ 7a), takže z těchhle dividend a
          úroků tu žádnou daň neplatíš. Není proti čemu srážku započítat. Kdybys ji{' '}
          <strong className="text-ink">v přiznání uplatnil</strong>, přestala by ti daň být rovna
          paušální dani za celý rok (§ 7a odst. 5). Kromě přiznání by přišly přehledy pro ČSSZ i
          zdravotní pojišťovnu a doplatek pojistného ze skutečných příjmů. V paušálním režimu bys
          přitom zůstal a zálohy platil dál.
        </p>
        <p className="mt-2">
          Co dává smysl místo toho: hlídat, ať ti v zahraničí nesrazí víc, než dovoluje smlouva — u
          amerických dividend bez formuláře W-8BEN je to 30 % místo 15 %. Rozdíl se žádá zpět ve
          státě zdroje, ne v českém přiznání.
        </p>
      </Disclosure>
    </Notice>
  );
}

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
    'když jsi report za tenhle skončený rok poprvé otevřel (nebo za něj stáhl XML), aby se ' +
    'ti čísla v už podaném přiznání zpětně nezměnila — změna v Nastavení se proto do ' +
    'tohohle roku nepromítne. Kvůli dodatečnému přiznání jde fixace zrušit v Nastavení.'
  );
}

/**
 * Pár slov o fixaci hned u verdiktu: které volby rok drží. Celé znění
 * (`pinnedMethodNote`) je ve vysvětlivce vedle a v tisku.
 */
export function pinnedSummary(pinned: PinnedTaxYearOptions): string {
  const method = METHOD_LABEL[pinned.matchingMethod] ?? pinned.matchingMethod;
  const fx = FX_METHOD_LABEL[pinned.fxMethod] ?? pinned.fxMethod;
  return `párování ${method}, ${fx}`;
}

/**
 * Tichá věta pod nadpisem „Co zapsat do přiznání“ pro rok, jehož tiskopis
 * Danero nezná — čísla řádků jsou z nejbližšího známého (částky platí vždy).
 *
 * Do 10. 10. 2026 měla jedno znění pro všechny takové roky: „pro rok 2022 je
 * finanční správa ještě nezveřejnila“. To platí jen pro rok, který teprve
 * přijde; u dávno uzavřeného roku je to nepravda v dokumentu, který má být
 * průkazný (nález R2-04). Starší rok má svůj tiskopis dávno vydaný — jen ho
 * Danero nemá, a čísla řádků se v něm mohou lišit.
 *
 * Vrací `null` pro rok, jehož strukturu známe.
 */
export function formLinesNote(year: number): { short: string; full: string } | null {
  if (EPO_SUPPORTED_YEARS.includes(year)) return null;
  const known = yearList(EPO_SUPPORTED_YEARS);
  const base = `Částky platí pro rok ${year}, čísla řádků jsou z tiskopisu ${known} (DPFDP7; papírově 25 5405).`;
  return year > Math.max(...EPO_SUPPORTED_YEARS)
    ? {
        short: `Čísla řádků jsou z tiskopisu ${known} — pro rok ${year} je finanční správa ještě nezveřejnila.`,
        full: `${base} Přesná čísla řádků pro období ${year} ověříme, až finanční správa zveřejní strukturu — struktura přílohy se ale mezi lety mění jen výjimečně.`,
      }
    : {
        short: `Čísla řádků jsou z tiskopisu ${known} — v tiskopisu pro rok ${year} se mohou lišit.`,
        full: `${base} Tiskopis pro rok ${year} je starší vzor a jeho čísla řádků Danero nezná; při vyplňování se řiď názvem řádku, ne jeho číslem.`,
      };
}

/**
 * Částka pro řádek tiskopisu, který se vyplňuje na haléře (ř. 413): celé
 * koruny jako všude jinde, s haléři jen když nějaké jsou.
 */
const czkExact = (value: Money): string =>
  value.isInteger()
    ? czk(value)
    : new Intl.NumberFormat('cs-CZ', {
        style: 'currency',
        currency: 'CZK',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value.toNumber());

/**
 * Místo částky u řádku tiskopisu, který z dat nejde vyplnit: tichá slova, kdo
 * číslo doplní („spočítá formulář“). Prázdná buňka vypadala jako chybějící
 * data — na stránce, ze které se opisuje do formuláře, nesmí být řádek,
 * u kterého není jasné, jestli tam patří nula, nic, nebo je to vada (R1B-01).
 */
function NoAmount({ children }: { children: string }) {
  return <span className="type-footnote font-normal text-ink-muted">{children}</span>;
}

/**
 * První dvě buňky řádku dokladu: instrument a událost. V širokém okně dva
 * sloupce; v úzkém se událost složí pod název, aby se tabulka vešla bez
 * vodorovného rolování — „Derivátové obchody“ na telefonu přetékaly o 41 px
 * a sloupec Výdaj byl vidět jako „5“ (R1B-13). Text je v obou podobách, vidět
 * je vždy jedna.
 */
function InstrumentCell({ name, event }: { name: string; event: string }) {
  return (
    <>
      <Td>
        <span className="font-medium">{name}</span>
        <span className="type-footnote block text-ink-muted sm:hidden">{event}</span>
      </Td>
      <Td className="text-ink-muted max-sm:hidden">{event}</Td>
    </>
  );
}

/**
 * Řádek „řádek formuláře → částka“: vlevo tiché číslo řádku přiznání, vedle něj
 * co se na něj píše, vpravo částka. Řádek, jehož částku Danero nezná, říká
 * místo ní, kdo ji doplní (`NoAmount`) — prázdný nezůstává žádný.
 */
function LineRow({
  line,
  label,
  hint,
  info,
  value,
  strong = false,
}: {
  /** Číslo řádku tiskopisu („ř. 38“). */
  line: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  info?: React.ReactNode;
  /** Částka, nebo `NoAmount` — povinná, řádek bez hodnoty se nekreslí. */
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <Row
      strong={strong}
      value={value}
      label={
        <span className="flex flex-col sm:flex-row sm:items-baseline sm:gap-x-3">
          <span className="shrink-0 font-normal tabular-nums text-ink-muted max-sm:type-footnote sm:w-[5.25rem]">
            {line}
          </span>
          <span className="min-w-0">
            <span className="inline-flex items-center gap-1">
              {label}
              {info}
            </span>
            {hint && <span className="type-footnote block font-normal text-ink-muted">{hint}</span>}
          </span>
        </span>
      }
    />
  );
}

/**
 * Je rok bez jediné transakce — a který rok s daty je mu nejblíž?
 *
 * Přepínač roků nabízí souvislou řadu od prvního obchodu po běžný rok, takže
 * rok bez transakce je běžná věc (v lednu běžný rok, jindy mezera mezi nákupem
 * a prodejem). Report za něj nemá co ukázat: vykreslit osnovu plnou nul
 * a formulář exportu XML je horší než říct to jednou větou (nález R2-14).
 *
 * „Transakce“ je cokoli s datem v tom roce — i samotný nákup: rok, ve kterém
 * se jen nakupovalo, osnovu dostane (věta „nemáš žádné obchody“ by neplatila).
 * Nejbližší rok se hledá nejdřív mezi staršími: kdo v lednu otevře report,
 * přišel nejspíš pro ten loňský. Čistá funkce kvůli testu.
 *
 * Tohle je jen první polovina otázky „je rok prázdný“ — druhou odpovídá
 * engine (`engineHasNothingFor`): rok bez transakce může nést prodej
 * vypořádaný po Novém roce.
 */
export function emptyYearFallback(
  txs: Transaction[],
  year: number,
): { empty: boolean; nearestYear: number | null } {
  const yearsWithData = new Set(
    txs.map((tx) =>
      Number((tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date).slice(0, 4)),
    ),
  );
  if (yearsWithData.has(year)) return { empty: false, nearestYear: null };
  const older = [...yearsWithData].filter((other) => other < year);
  const newer = [...yearsWithData].filter((other) => other > year);
  return {
    empty: true,
    nearestYear:
      older.length > 0 ? Math.max(...older) : newer.length > 0 ? Math.min(...newer) : null,
  };
}

/**
 * Nemá engine za rok nic — žádný příjem, žádnou položku, žádné sdělení ani
 * povinnost?
 *
 * Datum transakce na to nestačí (nález revize R6): prodej z 30. 12. řadí
 * engine do roku VYPOŘÁDÁNÍ, derivát do roku události, a limit pro podání
 * přiznání čerpají i „další zdanitelné příjmy“ z profilu, které v transakcích
 * nejsou vůbec. Rok podle dat prázdný tak může nést základ daně i povinnost
 * podat přiznání. O prázdném stavu proto rozhoduje výsledek: cokoli engine
 * pro rok má, report ukáže celý.
 *
 * V pochybnosti „něco má“ — zbytečná osnova je menší škoda než schovaná daň.
 */
export function engineHasNothingFor(result: TaxYearResult): boolean {
  const { securities, crypto, shortSales, derivatives, dividends, limits, warnings } = result;
  const filingLimits = [limits.flatTax50k, limits.employee20k, limits.generalFiling50k];
  const hasSomething =
    securities.disposals.length > 0 ||
    crypto.disposals.length > 0 ||
    shortSales.items.length > 0 ||
    shortSales.openAtYearEnd.length > 0 ||
    derivatives.items.length > 0 ||
    derivatives.openPositions.length > 0 ||
    dividends.items.length > 0 ||
    dividends.interestItems.length > 0 ||
    // povinnost podat přiznání i bez jediné transakce (příjmy z profilu)
    filingLimits.some((limit) => limit.applicable && limit.status.exceeded) ||
    limits.reporting38v.length > 0 ||
    // kontrola výpočtu je sdělení, které se má dočíst
    warnings.length > 0;
  return !hasSomething;
}

/**
 * Sdílené tělo daňového reportu: kompletní podklady k přiznání z čistého
 * enginu. Reálná stránka dodá data z DB (a denní kurzy ČNB), demo ukázkový
 * dataset. V demu se export XML nahrazuje pozvánkou — soubor by nesl smyšlená
 * data a bez účtu nemá kam vést.
 *
 * Rok bez jediné transakce, pro který nic nemá ani engine, osnovu nedostane —
 * jen prázdný stav s cestou dál (`emptyYearFallback`, `engineHasNothingFor`).
 *
 * Skladba shora dolů (docs/07, textová dieta):
 * 1. verdikt — musím podat přiznání, do kdy a kolik to bude; vedle akce
 *    (stáhnout XML, vytisknout),
 * 2. co zapsat do přiznání — po částech formuláře „řádek → částka“,
 * 3. kontroly výpočtu,
 * 4. export XML pro mojedane.cz,
 * 5. doklady: prodeje, prodeje nakrátko, deriváty (auditní stopa),
 * 6. jak je to spočítáno: rozpad daně, porovnání variant, metoda a kurzy.
 *
 * Výklad je na obrazovce ve vysvětlivkách a rozbalovacích detailech; v tisku
 * stojí všechno rozepsané (`InfoPrint`, `details` otevírá globals.css).
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
  justPinned = false,
  today = todayInPrague(),
}: {
  txs: Transaction[];
  profile: ProfileRow;
  year: number;
  years: number[];
  /**
   * Dnešek v české zóně (ISO) — podle něj se pozná skončený rok a nese ho
   * razítko výtisku. Stránka předává tentýž okamžik, ze kterého bere běžný rok
   * (demo svůj „dnešek“ dema); výchozí hodnota jsou hodiny aplikace.
   */
  today?: string;
  dailyRates?: EngineInput['dailyRates'];
  basePath?: string;
  demo?: boolean;
  /** Stránka tabulky prodejů (od 1) — velké portfolio se jinak nevykreslí. */
  strana?: number;
  /**
   * Rok se zafixoval právě tímhle otevřením reportu (R-05c). Uživatel se to má
   * dozvědět ve chvíli, kdy se to stane, ne z poznámky na konci stránky.
   */
  justPinned?: boolean;
  /** Výsledky z page-guardu (EngineError) — bez nich by se engine počítal 2×. */
  precomputed?: {
    result: ReturnType<typeof analyzeTaxYear>;
    comparison: ReturnType<typeof compareVariants>;
  };
}) {
  // R2-14: rok bez jediné transakce, pro který ani engine nic nemá — žádná
  // osnova, žádný export, jen cesta dál. Samotná data nestačí: prodej
  // vypořádaný po Novém roce nebo příjmy z profilu dávají roku obsah i bez
  // transakce s jeho datem (`engineHasNothingFor`).
  // Lišta s přepínačem roků zůstává, jinak by se z prázdného roku nedalo odejít.
  const emptyYear = emptyYearFallback(txs, year);
  const input = engineInputForUser(txs, profile, year, dailyRates);
  const result = precomputed?.result ?? analyzeTaxYear(input);
  if (emptyYear.empty && engineHasNothingFor(result)) {
    return (
      <>
        <AppToolbar title="Report" titleContext={String(year)}>
          <YearSwitcher years={years} active={year} hrefBase={`${basePath}/report`} />
        </AppToolbar>
        <EmptyState
          title={tidy(`V roce ${year} nemáš žádné obchody ani dividendy`)}
          action={
            <>
              {emptyYear.nearestYear !== null && (
                <Link
                  href={`${basePath}/report?rok=${emptyYear.nearestYear}`}
                  className={buttonVariants()}
                >
                  Otevřít report {emptyYear.nearestYear}
                </Link>
              )}
              {/* v demu Zdroje dat nejsou — odkaz by vedl na přihlášení */}
              {!demo && (
                <TextLink href="/import" chevron>
                  Nahrát výpisy
                </TextLink>
              )}
            </>
          }
        />
      </>
    );
  }

  // skončený rok: verdikt už není „zatím“ (R2-14)
  const yearClosed = year < Number(today.slice(0, 4));
  // R-05c: metoda zafixovaná pro tenhle rok (podklady už se za něj generovaly)
  const pinned = profile.pinnedTaxYears?.[year];
  const { variants, recommended } = precomputed?.comparison ?? compareVariants(input);
  const labels = instrumentLabels(txs);

  // Jedno pojetí daně pro přehled, report i simulátor (`taxSummary`): hlavní
  // číslo je doplatek, kde se odečítají zálohy z paušálního režimu, jinak daň.
  const tax = taxSummary(result);
  const activeTax = tax.variant === 'GENERAL' ? result.tax.general : result.tax.separate16a;
  // daňová část měsíční paušální zálohy z konfigurace roku (R-08f) — pro ř. 86
  const monthlyAdvanceTaxCzk = configForYear(year).flatTaxAdvance?.monthlyTaxCzk ?? null;
  // ř. 64 (R-14g)
  const taxpayerCredit = taxpayerCreditCzk(year);

  // rozpis prodejů: CP + krypto v jedné tabulce (druh u řádku), řazeno dle data
  const allDisposals = [
    ...result.securities.disposals.map((disposal) => ({ disposal, isCrypto: false })),
    ...result.crypto.disposals.map((disposal) => ({ disposal, isCrypto: true })),
  ].sort((a, b) => a.disposal.saleDate.localeCompare(b.disposal.saleDate));

  // Tabulka prodejů se stránkuje: u day-tradera je to desetitisíce řádků i s
  // alokacemi a stránka se nevykreslila vůbec (proces vyrostl na 3,9 GB).
  // Rozpad na jednotlivé nákupy je podklad k přiznání, takže se nesmí
  // oříznout — jen rozdělit.
  const { totalPages, currentPage, fromRow } = disposalPage(allDisposals.length, strana);
  const disposalsOnPage = allDisposals.slice(fromRow, fromRow + DISPOSALS_PER_PAGE);

  // roky jednotných kurzů pro tabulku „Použité kurzy“ (výdaj = kurz roku nákupu);
  // rozsah se čte z tabulky kurzů, ne z ručně zapsaného roku (K1-03/K1-04)
  const rateYears = unifiedRateYearsUpTo(year);
  // roky, jejichž kurz je zatím odhad (pokyn GFŘ vyjde až v lednu)
  const estimatedRateYears = rateYears.filter((rateYear) => !isRateVerified(rateYear));
  const epoMinYear = Math.min(...EPO_SUPPORTED_YEARS);
  const epoYear = EPO_SUPPORTED_YEARS.includes(year);
  // Čísla pro Přílohu č. 2 bere report ze STEJNÉHO zdroje jako generátor XML
  // (K3-03) — dokud měl každý svoje, radila jedna stránka zapsat nezastropované
  // výdaje, které podatelna odmítá.
  const p2 = priloha2(result);
  // Totéž platí pro § 8: ř. 38 a ř. 401a v celých korunách (L5-05) a příjmy po
  // státech pro ř. 321 (L5-01) — řádky i tabulka je opisují z generátoru XML.
  const base8Whole = base8WholeCzk(result);
  const creditIncome = creditIncomeByCountry(result);
  // … a Příloha č. 4 (ř. 410–414): tytéž řádky, které generátor píše do XML
  const p4 = attachment4Lines(result);
  // Ztráta nad rámec příjmů v celých korunách, jak ji věta pod tabulkou vypíše —
  // z nezaokrouhlených rozdílů po druzích, ne z haléřů odříznutých řádkům
  // přílohy (L5-06). Ztráta pod půl koruny se nehlásí: věta by zněla „0 Kč“.
  const lossBeyondIncome = lossBeyondIncomeCzk(result).toDecimalPlaces(0);
  // § 16a je reálná alternativa jen se zahraničními dividendami/úroky v § 8
  const hasDividendBase = result.dividends.base8Czk.gt(0);
  // oddíl o dividendách má smysl, jen když nějaké (nebo úroky) v roce byly
  const showDividends = hasDividendBase || result.dividends.items.length > 0;
  const hasCrypto = result.crypto.disposals.length > 0;
  const hasDerivatives = result.derivatives.items.length > 0;
  const deadlines = filingDeadlines(year);
  const filingLimit = filingLimitFor(result);
  const exceeded = filingLimit?.status.exceeded ?? false;
  // R-09d: oznámení dle § 38v má nepodávající do tří měsíců po konci roku
  // (stejné datum jako písemné podání), ne do lhůty elektronického přiznání
  const reportsExemptIncome = result.limits.reporting38v.length > 0;
  /** OSVČ (paušál i běžná) podává jen elektronicky — viz `FilingDeadlineInfo`. */
  const filesElectronicallyOnly = profile.regime === 'PAUSAL' || profile.regime === 'OSVC';

  /**
   * K7a-02 (§ 7a odst. 5): paušalistovi, který limit 50 000 Kč NEPROLOMIL, se
   * zápočet zahraniční srážky nabízet nesmí bez výhrady — uplatnění zápočtu
   * v přiznání mu za celý rok ruší rovnost daně paušální dani. Kdo limit
   * prolomil, přiznání podává tak jako tak a zápočet mu patří celý, takže tomu
   * se výhrada neukazuje. Stejná podmínka jako u varování enginu.
   */
  const flatTaxCreditCaveat =
    result.limits.flatTax50k.applicable &&
    !result.limits.flatTax50k.status.exceeded &&
    result.dividends.foreignWithholdingCzk.gt(0);

  const methodLabel = METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod;
  const fxLabel = FX_METHOD_LABEL[result.options.fxMethod] ?? result.options.fxMethod;
  // Rozpad daně ukazuje základy v celých korunách, jak je nese tiskopis — tytéž
  // částky jako Příloha č. 2 a ř. 38 výš na stránce, ne o korunu jiné (R-14h).
  const wholeBases = wholeBasesCzk(result, tax.variant);
  // uplatněný zápočet = rozdíl zaokrouhlených členů, ať rovnice sedí i po
  // zaokrouhlení na celé Kč (jinak by X − Y mohlo o korunu minout součet)
  const appliedCreditCzk = activeTax.taxBeforeCreditCzk
    .toDecimalPlaces(0)
    .sub(activeTax.taxCzk.toDecimalPlaces(0));

  /* ── texty vysvětlivek ──────────────────────────────────────────────────
     Každý stojí dvakrát: na obrazovce za „i“, v tisku rozepsaný (InfoPrint).
     Jeden zdroj, ať se obě podoby nerozejdou. Termín podání a hlavní číslo
     daně mají výklad společný s přehledem (`FilingDeadlineInfo`,
     `TaxFigureInfo`). */

  const linesNote = formLinesNote(year);
  const rowNumbersInfo = linesNote ? (
    <p>{tidy(linesNote.full)}</p>
  ) : (
    <p>
      Čísla řádků odpovídají struktuře elektronického podání DPFDP7 (období{' '}
      {yearList(EPO_SUPPORTED_YEARS)}; papírový tiskopis 25 5405).
      {!demo && ' Všechno, co je tady, předvyplní export XML.'}
    </p>
  );

  const interestInfo = (
    <p>
      Úroky vstupují do základu daně vedle dividend z tabulky. Do sloupce „příjem do zápočtu“ se
      počítají jen úroky, které smlouva o zamezení dvojího zdanění dovoluje zdanit i státu zdroje (§
      38f odst. 3); u většiny států včetně USA a Německa smí úrok zdanit jen země, kde bydlíš, takže
      do zápočtu nevstupuje a případnou srážku vrací zahraniční správce daně.
    </p>
  );

  // Paragraf seznamu k Příloze č. 3 patří do vysvětlivky, ne do řádku pod
  // skupinou (docs/07 §5.2, nález R1B-19) — a řádek říká, kde seznam je.
  const statesInfo = (
    <>
      <p>
        {tidy(
          'Tabulka je zároveň podklad pro povinný Seznam k Příloze č. 3 (§ 38f odst. 10): za každý stát příjem a daň sraženou v zahraničí.',
        )}
      </p>
      {result.dividends.taxableInterestCzk.gt(0) && interestInfo}
    </>
  );

  const xmlContentInfo = (
    <>
      <p>
        Stáhneš XML písemnosti DPFDP7 s investičními čísly z tohoto reportu a na mojedane.cz ho v
        přiznání nahraješ přes „Načtení souboru“.
      </p>
      <p>
        XML obsahuje jen investiční příjmy (dividendy, úroky a prodeje
        {hasDividendBase ? '; při zdanění dividend zvlášť navíc Přílohu č. 4' : ''}); ostatní příjmy
        (zaměstnání, podnikání, nájem) v něm nejsou a EPO výpočet daně přepočítá až po jejich
        zadání.
      </p>
    </>
  );

  const expenseRateNote = 'Výdaj je přepočten kurzem roku nákupu.';

  const shortSalesInfo = (
    <>
      <p>
        Prodej vypůjčených akcií se počítá do stejného druhu příjmu jako běžné prodeje — čerpá tedy
        i osvobození prodejů cenných papírů (100 000 Kč). Tržbu daníme v roce prodeje, zpětný nákup je výdaj v roce, kdy
        ho zaplatíš. Zpětné nákupy párujeme s otevřeními od nejstaršího.
      </p>
      <p>
        Značka „prodej nakrátko“ jde jen z výpisů Interactive Brokers a Tastytrade (a z univerzální
        šablony) — u výpisů nahraných před 13. 8. 2026 v datech chybí, takže je potřeba ve Zdrojích
        dat vrátit import zpět a nahrát znovu.
      </p>
    </>
  );

  const variantsInfo = (
    <>
      <p>
        Zvolená metoda párování se drží konzistentně celý rok — kombinovat nelze.{' '}
        {demo ? (
          <>
            S účtem metodu přepneš v Nastavení — <Link href="/registrace">založ si ho</Link>.
          </>
        ) : pinned ? (
          pinnedMethodNote(year, pinned)
        ) : (
          'Metodu změníš v Nastavení.'
        )}
      </p>
      {demo ? (
        <p>
          Denní kurzy jsou v demu ukázkové (odvozené z jednotného kurzu roku) — s vlastním účtem
          počítáme se skutečnými denními kurzy ČNB.
        </p>
      ) : (
        dailyRates && (
          <p>
            Denní kurzy ČNB jsou načtené z oficiálního zdroje — srovnání počítá s reálnými čísly pro
            jednotný kurz GFŘ i pro denní kurzy.
          </p>
        )
      )}
    </>
  );

  const ratesInfo = (
    <>
      <p>
        Výdaj (nákup) se přepočítává jednotným kurzem roku nákupu, tržba (prodej) kurzem roku
        prodeje. Tabulka ukazuje hlavní měny; další měny (CHF, PLN, JPY…) používáme z týchž pokynů.
        Nákupy před rokem {FIRST_UNIFIED_RATE_YEAR} se přepočítávají denními kurzy ČNB.
      </p>
      <p>
        Ověřené jednotné kurzy: {verifiedRateSourceNote()}
        {/* Orientační kurz se zmiňuje jen tam, kde do podkladu opravdu vstupuje:
            v reportu za rok 2022 věta „kurz běžného roku je orientační“ tvrdila
            něco o roce, který se v něm vůbec nepoužil (k nálezu R2-04). */}
        {estimatedRateYears.length > 0
          ? `; kurz za rok ${yearList(estimatedRateYears)} je orientační do vydání pokynu.`
          : '.'}
      </p>
    </>
  );

  /* ── varianty výpočtu: jedna tabulka na kurzovou soustavu ──────────────── */

  const pausal = result.limits.flatTax50k.applicable;
  // „nejvýhodnější“ má smysl jen tam, kde se varianty liší: u roku, kde vyjdou
  // všechny stejně (i u roku bez jediného prodeje), by štítek u první z nich
  // tvrdil rozdíl, který není (k nálezu R2-14)
  const variantsDiffer = variants.some(
    (variant) =>
      !variant.taxCzk.eq(variants[0]!.taxCzk) ||
      !variant.flatTax50kUsedCzk.eq(variants[0]!.flatTax50kUsedCzk),
  );
  const variantsTable = (fx: string) => (
    <ScrollArea label={`Varianty párování, ${FX_METHOD_LABEL[fx] ?? fx}`}>
      <Table aria-label={`Srovnání variant výpočtu daně, ${FX_METHOD_LABEL[fx] ?? fx}`}>
        <thead>
          <tr>
            <Th>Metoda</Th>
            {/* dvouslovná záhlaví se smí zalomit: na 390 px jinak tabulka
                přetekla o pár pixelů a vypadalo to jako chyba (R1B-13) */}
            <Th align="right" className="whitespace-normal">
              Základ z prodejů
            </Th>
            <Th align="right">Daň</Th>
            <Th align="right" className="whitespace-normal">
              {pausal ? LIMIT_NAME.FLAT_TAX : 'Zdanitelné příjmy'}
            </Th>
          </tr>
        </thead>
        <tbody>
          {variants
            .filter((variant) => variant.fxMethod === fx)
            .map((variant) => {
              const isRecommended =
                variant.matchingMethod === recommended.matchingMethod &&
                variant.fxMethod === recommended.fxMethod;
              const isActive =
                variant.matchingMethod === result.options.matchingMethod &&
                variant.fxMethod === result.options.fxMethod;
              const marks = [
                isActive ? 'používáš' : null,
                isRecommended && variantsDiffer ? 'nejvýhodnější' : null,
              ].filter((mark): mark is string => mark !== null);
              return (
                <Tr key={variant.matchingMethod}>
                  <Td>
                    <span className={cn(isActive && 'font-semibold')}>
                      {METHOD_LABEL[variant.matchingMethod]}
                    </span>
                    {marks.length > 0 && (
                      <span className="type-footnote block text-ink-muted">
                        {marks.join(' · ')}
                      </span>
                    )}
                  </Td>
                  {/* celé koruny dolů jako ř. 209 — u používané varianty je to
                      přesně číslo z Přílohy č. 2 výš (R-14h) */}
                  <Td align="right">{czk(wholeCzkDown(variant.base10Czk))}</Td>
                  <Td align="right">{czk(variant.taxCzk)}</Td>
                  <Td align="right">
                    {czk(variant.flatTax50kUsedCzk)}
                    {pausal && (
                      <span
                        className={cn(
                          'type-footnote block',
                          variant.flatTax50kExceeded ? 'text-danger' : 'text-success-text',
                        )}
                      >
                        {variant.flatTax50kExceeded ? 'přes limit' : 'pod limitem'}
                      </span>
                    )}
                  </Td>
                </Tr>
              );
            })}
        </tbody>
      </Table>
    </ScrollArea>
  );
  const fxMethods = [...new Set(variants.map((variant) => variant.fxMethod))];

  // Pravidlo 2: počítáme zvolenou (bezpečnou) variantou, ale když jiná vychází
  // znatelně líp, řekneme to hned pod verdiktem — i s tím, co obnáší. Co je
  // „líp“ (zůstat pod limitem režimu × nižší daň, která se opravdu platí),
  // rozhoduje čistá funkce `variantHint`.
  const activeVariant = variants.find(
    (variant) =>
      variant.matchingMethod === result.options.matchingMethod &&
      variant.fxMethod === result.options.fxMethod,
  );
  const hint = variantHint(activeVariant, recommended, regimeLimitFor(result.limits));

  /* ── zápis dividend: dvě cesty, mezi kterými volí uživatel (E-27) ────────
     Řádek bez částky tu není žádný (R1B-01): co Danero zná, ukáže; co počítá
     až tiskopis z celého přiznání (ř. 58), řekne slovy. */

  const generalVariant = (
    <Group
      aria-label="Dividendy a úroky zdaněné s ostatními příjmy"
      footer="K Příloze č. 3 patří seznam příjmů a sražené daně podle států — tabulka níž."
    >
      <LineRow
        line="ř. 38"
        label="Dividendy a úroky ze zahraničí, brutto"
        value={<span className="tabular-nums">{czk(base8Whole.generalCzk)}</span>}
      />
      <LineRow
        line="ř. 321–330"
        label="Zápočet sražené daně po státech"
        hint="Příloha č. 3, za každý stát zvlášť"
        value={czk(result.dividends.creditableWithholdingCzk)}
      />
      <LineRow
        line="ř. 58"
        label="Výsledek zápočtu z Přílohy č. 3"
        hint="vychází z daně ze všech tvých příjmů"
        value={<NoAmount>spočítá formulář</NoAmount>}
      />
      <Row label={TAX_NAME} hint="před slevami na dani" value={czk(result.tax.general.taxCzk)} />
    </Group>
  );
  const separateVariant = (
    <Group
      aria-label="Dividendy a úroky zdaněné zvlášť sazbou 15 %"
      footer="Při zdanění zvlášť nejdou uplatnit slevy na dani ani nezdanitelné části základu."
    >
      <LineRow
        line="ř. 401a"
        label="Dividendy a úroky ze zahraničí"
        hint="Příloha č. 4"
        value={<span className="tabular-nums">{czk(base8Whole.separate16aCzk)}</span>}
      />
      <LineRow line="ř. 410" label="Daň 15 %" value={czk(p4?.r410 ?? ZERO)} />
      <LineRow
        line="ř. 412"
        label="Daň sražená v zahraničí"
        hint="nejvýš do výše podle smluv"
        value={czk(p4?.r412 ?? ZERO)}
      />
      <LineRow
        line="ř. 413"
        label="Z toho lze započíst"
        hint="nejvýš 15 % z příjmů"
        value={czkExact(p4?.r413 ?? ZERO)}
      />
      <LineRow
        line="ř. 414"
        label="Výsledek, přenáší se na ř. 74a přiznání"
        hint="ř. 38 zůstává prázdný"
        value={czk(p4?.r414 ?? ZERO)}
      />
      <Row
        label={TAX_NAME}
        hint="před slevami na dani"
        value={czk(result.tax.separate16a.taxCzk)}
      />
    </Group>
  );

  const xmlAvailable = !demo && epoYear;
  const mainFigureName = tax.dueCzk !== null ? DUE_NAME : TAX_NAME;

  return (
    <>
      <AppToolbar
        title="Report"
        titleContext={String(year)}
        actions={
          <>
            <PrintButton className="max-sm:hidden" />
            {xmlAvailable && (
              <Button type="submit" form={EPO_FORM_ID} size="sm">
                Stáhnout XML
              </Button>
            )}
          </>
        }
      >
        <YearSwitcher years={years} active={year} hrefBase={`${basePath}/report`} />
      </AppToolbar>

      <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4 print:space-y-8 print:pt-0">
        {/* jen v tisku: titulek dokumentu a identifikace podkladů (průkaznost výpočtu) */}
        <div className="hidden print:block">
          <p className="type-title-2">Podklady k daňovému přiznání {year}</p>
          <p className="type-caption mt-2 text-ink-muted">
            Podklady k přiznání za zdaňovací období {year} · vygenerováno {czDate(today)}{' '}
            aplikací Danero · {txs.length}{' '}
            {plural(txs.length, 'transakce', 'transakce', 'transakcí')} · párování {methodLabel} ·{' '}
            {fxMethodLabel(result)} · výklad limitu 100 000 Kč pro osvobození prodejů cenných
            papírů: {result.options.limit100kIncludesTimeTestExempt ? 'striktní' : 'mírnější'}
            {pinned && ' (všechny tři zafixovány pro tento rok)'} · časový test od{' '}
            {result.options.timeTestDateBasis === 'settlement' ? 'vypořádání' : 'obchodu'} ·
            stablecoiny (EMT):{' '}
            {result.options.emtTimeTestExempt
              ? 'časový test uplatněn (mírnější výklad)'
              : 'bez osvobození (bezpečný výklad)'}{' '}
            · vratka kapitálu:{' '}
            {result.options.returnOfCapitalReducesBasis
              ? 'snižuje nabývací cenu (mírnější výklad)'
              : 'daněna jako dividenda (bezpečný výklad)'}
            . Kurzy: {verifiedRateSourceNote()}
            {UNIFIED_RATES[year] !== undefined &&
              !isRateVerified(year) &&
              `; kurz roku ${year} je orientační do vydání pokynu`}
            {UNIFIED_RATES[year] === undefined &&
              `; za rok ${year} jednotný kurz nemáme, cizí měny se přepočítávají denními kurzy ČNB`}
            , viz dokumentace metodiky. Danero je výpočetní nástroj, nikoli daňové poradenství.
          </p>
        </div>

        {/* R-15e: rok, pro který stát ještě nevyhlásil čísla — vysvětlení nahoře,
            ať ho uživatel vidí dřív než odhad daně, který se o ně opírá */}
        <TaxYearConfigNotice year={year} pausal={profile.regime === 'PAUSAL'} />

        {/* ── 1. verdikt ────────────────────────────────────────────────────
            L5-02: tentýž verdikt jako na přehledu, na obrazovce i v tisku — bez
            něj report ukazoval termín podání a export i tomu, komu povinnost
            nevznikla. Vedle něj termín a částka — stejné číslo pod stejným
            jménem jako na přehledu (`TaxFigure`, R1B-03) a na stejné mřížce
            jako dvojice sekcí níž (R1B-26); výklad je ve vysvětlivkách. */}
        <div className="space-y-6">
          <div className="@container">
            <div className="grid gap-x-(--column-gap) gap-y-7 @3xl:grid-cols-2 @3xl:items-end">
              {filingLimit ? (
                <ReportFilingVerdict
                  year={year}
                  limit={filingLimit}
                  closed={yearClosed}
                  reportsExemptIncome={reportsExemptIncome}
                />
              ) : (
                <h2 className="type-title-1 max-w-[22ch] text-balance">
                  {tidy(`Podklady k přiznání za rok ${year}`)}
                </h2>
              )}
              <dl className="flex flex-wrap items-start gap-x-12 gap-y-6">
                <FilingDeadlineStat
                  year={year}
                  electronicOnly={filesElectronicallyOnly}
                  onlyIfFiling={filingLimit !== null && !exceeded}
                />
                <TaxFigure result={result} />
              </dl>
            </div>
          </div>
          <InfoPrint className="mt-0">
            <p>
              <strong>Termín podání.</strong>{' '}
              <FilingDeadlineInfo year={year} electronicOnly={filesElectronicallyOnly} />
            </p>
            <p>
              <strong>{mainFigureName}.</strong>
            </p>
            <TaxFigureInfo result={result} />
          </InfoPrint>
          {filingLimit && !exceeded && reportsExemptIncome && (
            <ExemptIncomeReportingNotice deadline={deadlines.paper} />
          )}
          {/* R1B-12: skončený rok se zafixuje prvním otevřením reportu (R-05c).
              Ve chvíli, kdy se to stane, to stojí nahoře jako sdělení; při
              dalších návštěvách zbydou tři slova a vysvětlivka. Dřív o tom
              mluvila jen poznámka na konci stránky. */}
          {pinned && !demo && justPinned && (
            <Notice
              role="status"
              title={tidy(`Rok ${year} jsme právě zafixovali: ${pinnedSummary(pinned)}`)}
              action={
                <TextLink href="/nastaveni#fixace" chevron>
                  Zrušit fixaci
                </TextLink>
              }
            >
              {tidy(
                'Stalo se to otevřením reportu za skončený rok — čísla v podaném přiznání se tak zpětně nezmění. Změna v Nastavení už tenhle rok nepřepočítá.',
              )}
            </Notice>
          )}
          {pinned && !demo && !justPinned && (
            <div className="type-footnote flex items-center gap-1 text-ink-muted print:hidden">
              {tidy(`Rok ${year} je zafixovaný: ${pinnedSummary(pinned)}.`)}
              <InfoPopover label="Zafixovaný rok" align="start">
                <p>{tidy(pinnedMethodNote(year, pinned))}</p>
                <p>
                  <TextLink href="/nastaveni#fixace" chevron>
                    Zafixované roky v Nastavení
                  </TextLink>
                </p>
              </InfoPopover>
            </div>
          )}
          {hint && activeVariant && (
            <Notice
              title={tidy(variantHintTitle(hint, activeVariant))}
              action={
                // v demu Nastavení není — odkaz by vedl na přihlášení
                demo ? undefined : pinned ? (
                  <TextLink href="/nastaveni#fixace" chevron>
                    Zafixované roky
                  </TextLink>
                ) : (
                  <TextLink href="/nastaveni" chevron>
                    Nastavení
                  </TextLink>
                )
              }
            >
              <Disclosure summary="Proč to tak nepočítáme">
                <p>
                  {/* R4-02: v zafixovaném roce „jak máš zvoleno“ neplatí — volba
                      v Nastavení může být dávno jiná a rada vedla do slepé uličky */}
                  {pinned
                    ? tidy(
                        `Rok ${year} je zafixovaný a počítá se s tím, co platilo při prvním otevření reportu: párování ${methodLabel}, ${fxLabel}. Změna v Nastavení se do něj promítne, až fixaci zrušíš (Nastavení › Zafixované roky).`,
                      )
                    : tidy(`Počítáme tak, jak máš zvoleno: párování ${methodLabel}, ${fxLabel}.`)}{' '}
                  {hint.reason === 'STAYS_UNDER_LIMIT'
                    ? tidy(
                        `S ${variantDifference(activeVariant, hint.variant)} vycházejí zdanitelné příjmy na ${czk(hint.variant.flatTax50kUsedCzk)} místo ${czk(activeVariant.flatTax50kUsedCzk)}. Pod limitem přiznání kvůli investicím nepodáváš a daň z nich neplatíš — limit ale vidí jen příjmy, o kterých Danero ví.`,
                      )
                    : tidy(
                        `S ${variantDifference(activeVariant, hint.variant)} vychází daň z investic na ${czk(hint.variant.taxCzk)} místo ${czk(activeVariant.taxCzk)}.`,
                      )}{' '}
                  {hint.variant.matchingMethod !== activeVariant.matchingMethod &&
                    'FIFO je bezpečný standard; jinou metodu párování lze obhájit jen průkaznou identifikací konkrétních prodávaných kusů. '}
                  Zvolená metoda i kurzy se drží konzistentně celý rok. Rozhodnutí (a riziko) je na
                  tobě; všechny varianty jsou vedle sebe v porovnání níž.
                </p>
              </Disclosure>
            </Notice>
          )}
        </div>

        {/* ── 2. co zapsat do přiznání ──────────────────────────────────────
            K3-05: čísla se ukazují VŽDY, i pro roky bez XML — u většiny
            prodejných let se do XML nedostaneš a tyhle řádky jsou jediný zdroj.
            Rok od roku se mění jen ČÍSLA ŘÁDKŮ tiskopisu, ne částky — proto
            se přepíná jen poznámka pod nadpisem. */}
        <section>
          <SectionHeader
            title="Co zapsat do přiznání"
            info={
              <InfoPopover label="Co zapsat do přiznání" title="Čísla řádků" align="start">
                {rowNumbersInfo}
              </InfoPopover>
            }
          />
          {linesNote && (
            <p className="type-footnote mt-1 text-ink-muted print:hidden">
              {tidy(linesNote.short)}
            </p>
          )}
          <InfoPrint className="mt-1">{rowNumbersInfo}</InfoPrint>

          <div className="@container mt-8">
            <div
              className={cn(
                'grid grid-cols-[minmax(0,1fr)] gap-x-(--column-gap) gap-y-12 print:block print:space-y-8',
                showDividends && '@3xl:grid-cols-2',
              )}
            >
              <div className="space-y-12 print:space-y-8">
                <div>
                  <SectionHeader as="h3" title="Prodeje — Příloha č. 2" />
                  <div className="mt-3">
                    <ScrollArea label="Příloha č. 2: příjmy a výdaje podle druhu">
                      <Table aria-label="Příloha č. 2: příjmy a výdaje podle druhu">
                        <thead>
                          <tr>
                            <Th>Druh příjmu</Th>
                            <Th align="right">Příjmy</Th>
                            <Th align="right">Výdaje</Th>
                            <Th align="right">Rozdíl</Th>
                          </tr>
                        </thead>
                        <tbody>
                          <Tr>
                            <Td>
                              <span className="font-medium">Cenné papíry</span>
                              <span className="type-footnote block text-ink-muted">
                                druh D — prodej cenných papírů
                              </span>
                            </Td>
                            <Td align="right">{czk(p2.rows[0]!.prijmyCzk)}</Td>
                            <Td align="right">{czk(p2.rows[0]!.vydajeCzk)}</Td>
                            <Td align="right">{czk(p2.rows[0]!.rozdilCzk)}</Td>
                          </Tr>
                          {hasCrypto && (
                            <Tr>
                              <Td>
                                <span className="font-medium">Kryptoaktiva</span>
                                <span className="type-footnote block text-ink-muted">
                                  druh C — prodej movitých věcí
                                </span>
                              </Td>
                              <Td align="right">{czk(p2.rows[1]!.prijmyCzk)}</Td>
                              <Td align="right">{czk(p2.rows[1]!.vydajeCzk)}</Td>
                              <Td align="right">{czk(p2.rows[1]!.rozdilCzk)}</Td>
                            </Tr>
                          )}
                          {hasDerivatives && (
                            <Tr>
                              <Td>
                                <span className="font-medium">Deriváty</span>
                                <span className="type-footnote block text-ink-muted">
                                  druh F — jiné ostatní příjmy
                                </span>
                              </Td>
                              <Td align="right">{czk(p2.rows[2]!.prijmyCzk)}</Td>
                              <Td align="right">{czk(p2.rows[2]!.vydajeCzk)}</Td>
                              <Td align="right">{czk(p2.rows[2]!.rozdilCzk)}</Td>
                            </Tr>
                          )}
                          <Tr className="font-semibold">
                            <Td>Součty přílohy</Td>
                            <Td align="right">
                              {czk(p2.prijmyCzk)}
                              <span className="type-caption block font-normal text-ink-muted">
                                ř. 207
                              </span>
                            </Td>
                            <Td align="right">
                              {czk(p2.vydajeCzk)}
                              <span className="type-caption block font-normal text-ink-muted">
                                ř. 208
                              </span>
                            </Td>
                            <Td align="right">
                              {czk(p2.rozdilCzk)}
                              <span className="type-caption block font-normal text-ink-muted">
                                ř. 209
                              </span>
                            </Td>
                          </Tr>
                        </tbody>
                      </Table>
                    </ScrollArea>
                  </div>
                  <Group
                    className="mt-2 border-t border-line/70"
                    aria-label="Přenos z Přílohy č. 2 do přiznání"
                  >
                    <LineRow
                      strong
                      line="ř. 40"
                      label="Rozdíl z ř. 209 Přílohy č. 2"
                      value={czk(p2.rozdilCzk)}
                    />
                  </Group>
                  {lossBeyondIncome.gt(0) && (
                    <p className="type-footnote mt-3 text-ink-muted">
                      Ztrátu {czk(lossBeyondIncome)} nad rámec příjmů do přiznání zapsat nejde a do
                      dalšího roku se nepřevádí.
                    </p>
                  )}
                  <Disclosure summary="Jak přílohu vyplnit" className="mt-1">
                    <ul className="list-disc space-y-1 pl-4">
                      <li>
                        Každý druh je samostatný řádek tabulky v Příloze č. 2. Řádek u zahraničního
                        brokera nese kód „Z“ (příjem ze zdrojů v zahraničí).
                      </li>
                      {hasCrypto && (
                        <li>
                          Kryptoaktiva se daní jako movitá věc, proto druh C — prodej movitých věcí.
                          S řádkem cenných papírů se nekompenzují: ztráta z jednoho druhu nesnižuje
                          zisk druhého.
                        </li>
                      )}
                      {hasDerivatives && (
                        <li>
                          Deriváty (opce, futures, CFD) patří pod druh F — jiné ostatní příjmy.
                          Nemají žádné osvobození a s ostatními druhy se nekompenzují.
                        </li>
                      )}
                      <li>
                        Výdaje jsou u každého druhu uvedené jen do výše jeho příjmů — tak to žádá §
                        10 odst. 4 a tak je kontroluje i podatelna (ř. 208 nesmí být vyšší než ř.
                        207).
                      </li>
                    </ul>
                  </Disclosure>
                </div>

                <div>
                  <SectionHeader as="h3" title="Další řádky" />
                  <Group className="mt-2" aria-label="Další řádky přiznání">
                    <LineRow
                      line="ř. 64"
                      label="Sleva na poplatníka"
                      value={
                        taxpayerCredit === null ? (
                          <NoAmount>najdeš v pokynech k tiskopisu</NoAmount>
                        ) : (
                          czk(d(taxpayerCredit))
                        )
                      }
                    />
                    {/* ř. 86: po prolomení limitu zálohy známe (R-08f, tytéž, které
                        odečítá doplatek nahoře); jinak záleží na počtu měsíců
                        v režimu, a ten Danero nezná — řekne aspoň pravidlo */}
                    {profile.regime === 'PAUSAL' &&
                      (tax.advances ? (
                        <LineRow
                          line="ř. 86"
                          label="Zaplacené zálohy z paušálního režimu"
                          hint={`${tax.advances.months} × ${czk(tax.advances.monthlyCzk)}, celý rok v 1. pásmu`}
                          value={czk(tax.advances.totalCzk)}
                        />
                      ) : (
                        <LineRow
                          line="ř. 86"
                          label="Zaplacené zálohy z paušálního režimu"
                          hint={
                            monthlyAdvanceTaxCzk
                              ? `${czk(d(monthlyAdvanceTaxCzk))} za každý měsíc v paušálním režimu (1. pásmo)`
                              : undefined
                          }
                          value={<NoAmount>doplníš podle zaplacených záloh</NoAmount>}
                        />
                      ))}
                    <Row
                      label="Osvobozené příjmy"
                      hint={
                        reportsExemptIncome
                          ? 'časový test nebo prodeje do 100 000 Kč za rok — jednotlivé příjmy nad 5 mil. Kč ale máš povinnost oznámit (§ 38v)'
                          : 'časový test nebo prodeje do 100 000 Kč za rok'
                      }
                      value="neuvádějí se"
                    />
                  </Group>
                </div>
              </div>

              {/* E-27: obě cesty zdanění dividend vedle sebe, bez „výhodnější je“ —
                variantu vybírá uživatel (i ve formuláři pro XML níž) */}
              {showDividends && (
                <div>
                  <ViewSwitch
                    headingAs="h3"
                    title="Dividendy a úroky ze zahraničí"
                    info={
                      <InfoPopover label="Dva způsoby zdanění dividend" align="start">
                        <DividendTaxationInfo />
                      </InfoPopover>
                    }
                    ariaLabel="Způsob zdanění dividend a úroků"
                    defaultKey={tax.variant}
                    views={[
                      {
                        key: 'GENERAL',
                        label: DIVIDEND_TAXATION_LABEL.GENERAL,
                        content: generalVariant,
                      },
                      {
                        key: 'SEPARATE_16A',
                        label: DIVIDEND_TAXATION_LABEL.SEPARATE_16A,
                        content: separateVariant,
                      },
                    ]}
                  />
                  <InfoPrint>
                    <DividendTaxationInfo />
                  </InfoPrint>
                  {flatTaxCreditCaveat && (
                    <div className="mt-5">
                      <PausalCreditCaveat amount={czk(result.dividends.foreignWithholdingCzk)} />
                    </div>
                  )}

                  {result.dividends.items.length > 0 && (
                    <div className="mt-8">
                      <SectionHeader
                        as="h3"
                        title="Příjmy podle států — Příloha č. 3"
                        info={
                          <InfoPopover label="Příjmy podle států" align="start">
                            {statesInfo}
                          </InfoPopover>
                        }
                      />
                      <div className="mt-3">
                        <ScrollArea label="Příjmy podle států">
                          <Table aria-label="Zahraniční příjmy a sražená daň po státech">
                            <thead>
                              <tr>
                                <Th>Stát</Th>
                                <Th align="right" className="whitespace-normal">
                                  Příjem do zápočtu
                                </Th>
                                <Th align="right">Sraženo</Th>
                                <Th align="right" className="whitespace-normal">
                                  Započitatelná srážka
                                </Th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(result.dividends.creditableByCountry).map(
                                ([country, data]) => (
                                  <Tr key={country}>
                                    <Td className="font-medium">{country}</Td>
                                    {/* přesně to, co půjde na ř. 321 Přílohy 3 — jedno číslo, jedna pravda;
                                    stát bez započitatelné srážky v příloze není, tam zůstává příjem tak, jak je */}
                                    <Td align="right" className="whitespace-nowrap">
                                      {czk(
                                        creditIncome.get(country) ??
                                          prijmyZeStatuProZapocet(country, data, result.options),
                                      )}
                                    </Td>
                                    <Td align="right" className="whitespace-nowrap">
                                      {czk(data.withholdingCzk)}
                                    </Td>
                                    <Td align="right" className="whitespace-nowrap">
                                      {czk(data.creditableCzk)}
                                    </Td>
                                  </Tr>
                                ),
                              )}
                            </tbody>
                          </Table>
                        </ScrollArea>
                      </div>
                      {(result.dividends.taxableInterestCzk.gt(0) ||
                        result.dividends.czechGrossCzk.gt(0)) && (
                        <Group
                          className="mt-2 border-t border-line/70"
                          aria-label="Úroky a české dividendy"
                        >
                          {/* základ z dividend zahrnuje i úroky — bez tohoto řádku by rozpis neseděl na souhrn */}
                          {result.dividends.taxableInterestCzk.gt(0) && (
                            <Row
                              label="Zdanitelné úroky"
                              hint="v základu daně vedle dividend z tabulky"
                              value={czk(result.dividends.taxableInterestCzk)}
                            />
                          )}
                          {result.dividends.czechGrossCzk.gt(0) && (
                            <Row
                              label="České dividendy"
                              hint="zdaněné srážkou u zdroje, do přiznání se neuvádějí"
                              value={czk(result.dividends.czechGrossCzk)}
                            />
                          )}
                        </Group>
                      )}
                      <InfoPrint>{statesInfo}</InfoPrint>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── 3. kontroly výpočtu ───────────────────────────────────────────── */}
        {result.warnings.length > 0 && (
          /* počet = zobrazené skupiny (viz přehled) */
          <Section title="Kontroly výpočtu" count={groupByCode(result.warnings).length}>
            <WarningsList
              warnings={result.warnings}
              labels={labels}
              forfeitedWithholdingCzk={result.dividends.foreignWithholdingCzk.sub(
                result.dividends.creditableWithholdingCzk,
              )}
            />
          </Section>
        )}

        {/* ── 4. export XML ─────────────────────────────────────────────────
            Formulář na papír nepatří, ale sdělení o exportu ano (R5-12): že za
            tenhle rok XML není, nebo co XML obsahuje a co ne. V původní verzi
            se tiskla celá karta; tady se tiskne jen text. Pozvánka z dema se
            netiskne. */}
        <Section title="Export pro mojedane.cz" className={cn(demo && 'print:hidden')}>
          {demo ? (
            // XML s vlastními čísly až s účtem — ukázkový soubor ale ukáže
            // přesně, co z Danera padá na podatelnu. Jeden řádek, žádná karta
            // s druhou výzvou k registraci: tu už nese pruh nahoře (R1B-22).
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <TextLink href="/marketing/ukazka-dpfdp7-2025.xml" download chevron>
                Stáhnout ukázkové XML (2025)
              </TextLink>
              <p className="type-footnote text-ink-muted">
                S účtem stáhneš XML s vlastními čísly.
              </p>
            </div>
          ) : epoYear ? (
            <>
              <EpoExportForm
                year={year}
                dividendChoice={
                  hasDividendBase
                    ? {
                        // E-27: variantu zdanění § 8 nevybíráme za uživatele —
                        // popisky nesou obě částky a rozhodnutí je na něm
                        defaultValue: result.tax.recommended,
                        general: `${DIVIDEND_TAXATION_LABEL.GENERAL} (ř. 38) — daň ${czk(result.tax.general.taxCzk)}`,
                        separate: `${DIVIDEND_TAXATION_LABEL.SEPARATE_16A} (Příloha č. 4) — daň ${czk(result.tax.separate16a.taxCzk)}`,
                      }
                    : null
                }
                dividendInfo={
                  <InfoPopover label="Dva způsoby zdanění dividend" align="start">
                    <DividendTaxationInfo />
                  </InfoPopover>
                }
                contentInfo={<InfoPopover label="Co XML obsahuje">{xmlContentInfo}</InfoPopover>}
              />
              <InfoPrint className="mt-0">{xmlContentInfo}</InfoPrint>
            </>
          ) : year < epoMinYear ? (
            <Notice title={`Roky před ${epoMinYear} v XML nepodporujeme`}>
              Formulář vyplníš ručně z čísel výš.
            </Notice>
          ) : (
            <Notice title={`Pro rok ${year} oficiální struktura XML přiznání zatím neexistuje`}>
              Finanční správa ji zveřejňuje až začátkem následujícího roku. Export tu bude, jakmile
              vyjde; zatím poslouží čísla výš.
            </Notice>
          )}
        </Section>

        {/* ── 5. doklady: jednotlivé obchody ────────────────────────────────── */}
        {allDisposals.length > 0 && (
          <Section
            title={`Prodeje v roce ${year}`}
            count={allDisposals.length}
            info={
              <InfoPopover label="Prodeje" align="start">
                <p>
                  Rozbalením řádku uvidíš, ze kterých nákupů prodej čerpal a které z nich jsou
                  osvobozené. {expenseRateNote}
                </p>
              </InfoPopover>
            }
          >
            <ScrollArea label={`Prodeje v roce ${year}`}>
              <Table aria-label="Rozpis prodejů cenných papírů a kryptoaktiv">
                <thead>
                  <tr>
                    <Th>Instrument</Th>
                    <Th align="right">Datum</Th>
                    <Th align="right">Tržba</Th>
                    <Th align="right">Výdaje</Th>
                    <Th align="right">Osvobozeno</Th>
                    <Th align="right">Zdanitelná tržba</Th>
                  </tr>
                </thead>
                <tbody>
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
                      <Tr key={disposal.sellTxId}>
                        {/* Sloupec má nejmenší šířku: bez tickeru je popiskem celý
                            název fondu a v úzkém okně se lámal na deset řádků po
                            slově (R2-13) — tabulka kvůli tomu smí rolovat. */}
                        <Td className="min-w-44">
                          {/* nativní <details> — server component bez JS; rozpad = auditní stopa párování.
                              Rozbaluje celá buňka, ne jen ticker: „KO“ byl cíl
                              30 × 24 px (R1B-14, R2-24). */}
                          <details className="disclosure">
                            <summary className="flex min-h-6 w-full cursor-pointer items-center gap-1.5 active:opacity-60 pointer-coarse:min-h-11">
                              <Chevron className="text-ink-muted print:hidden" />
                              <span
                                className="line-clamp-2 font-medium print:line-clamp-none"
                                title={labels.get(disposal.isin) ?? disposal.isin}
                              >
                                {labels.get(disposal.isin) ?? disposal.isin}
                              </span>
                              {isCrypto && <span className="text-ink-muted">krypto</span>}
                            </summary>
                            <ul className="type-footnote mb-1 mt-1 space-y-0.5 pl-3.5 text-ink-muted print:pl-0">
                              {disposal.allocations.map((alloc) => (
                                <li key={alloc.lotId}>
                                  {alloc.quantity.toString()} ks · nabyto{' '}
                                  {czDate(alloc.acquisitionDate)} ·{' '}
                                  {alloc.timeTestExempt
                                    ? 'osvobozeno 3letým testem (výdaj se neuplatňuje)'
                                    : under100k
                                      ? 'osvobozeno, prodeje do 100 000 Kč za rok (výdaj se neuplatňuje)'
                                      : `výdaj ${czk(alloc.expenseCzk)}`}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {czDate(disposal.saleDate)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {czk(disposal.grossProceedsCzk)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {expensesCzk.isZero() && disposal.exemptProceedsCzk.gt(0)
                            ? '—'
                            : czk(expensesCzk)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {czk(disposal.exemptProceedsCzk)}
                        </Td>
                        <Td align="right" className="whitespace-nowrap">
                          {czk(disposal.taxableProceedsCzk)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </ScrollArea>
            <InfoPrint>
              <p>Pod každým prodejem jsou nákupy, ze kterých čerpal. {expenseRateNote}</p>
            </InfoPrint>
            {/* Na papíře musí být vidět, že tabulka pokračuje — stránkovací lišta
                je `print:hidden`, takže bez téhle věty odnese uživatel na finanční
                úřad neúplný rozpis v domnění, že je kompletní (H-3-01). */}
            {totalPages > 1 && (
              <p className="type-footnote mt-3 hidden border-t border-line pt-3 text-ink-muted print:block">
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
                {/* Dřív tu stálo, že tisk i XML obsahují všechny prodeje — nebyla
                    to pravda ani v jedné půlce (nález H-3-01). `window.print()`
                    tiskne DOM, a v něm je jen tahle strana; XML pro podatelnu
                    nese úhrny do řádků přiznání, ne rozpis jednotlivých prodejů. */}
                <div className="type-footnote flex items-center gap-1 text-ink-muted">
                  <span className="tabular-nums">
                    {fromRow + 1}–{fromRow + disposalsOnPage.length} z {allDisposals.length}
                  </span>
                  <InfoPopover label="Stránkování prodejů" align="start">
                    <p>
                      Vytiskne se vždy jen zobrazená strana; úhrny do řádků přiznání i XML pro
                      podatelnu jsou spočítané ze všech prodejů.
                    </p>
                  </InfoPopover>
                </div>
                {/* H-3-21: dřív tu bylo jen „Předchozí/Další“, takže na stranu
                    100 ze 125 vedlo 99 kliknutí — a každé je celý render reportu.
                    Skok na první a poslední stranu plus přímé zadání čísla to
                    zkrátí na jedno. */}
                <nav className="flex flex-wrap items-center gap-2" aria-label="Stránkování prodejů">
                  {currentPage > 1 && (
                    <>
                      <Link
                        href={`${basePath}/report?rok=${year}&strana=1`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        První
                      </Link>
                      <Link
                        href={`${basePath}/report?rok=${year}&strana=${currentPage - 1}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Předchozí
                      </Link>
                    </>
                  )}
                  {totalPages > 2 && (
                    <form
                      method="get"
                      action={`${basePath}/report`}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="rok" value={year} />
                      <label htmlFor="strana" className="type-footnote text-ink-muted">
                        Strana
                      </label>
                      <Input
                        id="strana"
                        name="strana"
                        type="number"
                        min={1}
                        max={totalPages}
                        defaultValue={currentPage}
                        inputMode="numeric"
                        className="h-7 w-16 px-2"
                      />
                      <span className="type-footnote text-ink-muted">z {totalPages}</span>
                      <Button type="submit" variant="secondary" size="sm">
                        Přejít
                      </Button>
                    </form>
                  )}
                  {currentPage < totalPages && (
                    <>
                      <Link
                        href={`${basePath}/report?rok=${year}&strana=${currentPage + 1}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Další
                      </Link>
                      <Link
                        href={`${basePath}/report?rok=${year}&strana=${totalPages}`}
                        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                      >
                        Poslední
                      </Link>
                    </>
                  )}
                </nav>
              </div>
            )}
          </Section>
        )}

        {result.shortSales.items.length > 0 && (
          /* R-13: shorty patří do téhož druhu jako ostatní prodeje CP (kód D),
             ale nemají loty — v rozpisu prodejů výš by neměly co ukázat, takže
             je vypisujeme zvlášť, ať jdou čísla druhu dohledat do řádku. */
          <Section
            title={`Prodeje nakrátko v roce ${year}`}
            count={result.shortSales.items.length}
            info={
              <InfoPopover label="Prodeje nakrátko" align="start">
                {shortSalesInfo}
              </InfoPopover>
            }
          >
            <ScrollArea label={`Prodeje nakrátko v roce ${year}`}>
              <Table aria-label="Rozpis prodejů nakrátko">
                <thead>
                  <tr>
                    <Th>Instrument</Th>
                    <Th className="max-sm:hidden">Událost</Th>
                    <Th align="right">Datum</Th>
                    <Th align="right">Kusů</Th>
                    <Th align="right">Příjem</Th>
                    <Th align="right">Výdaj</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.shortSales.items.map((item, index) => (
                    <Tr key={`${item.isin}-${item.date}-${index}`}>
                      <InstrumentCell
                        name={labels.get(item.isin) ?? item.isin}
                        event={item.kind === 'SHORT_OPEN' ? 'Prodej nakrátko' : 'Zpětný nákup'}
                      />
                      <Td align="right" className="whitespace-nowrap">
                        {czDate(item.date)}
                      </Td>
                      <Td align="right">{item.quantity.toString()}</Td>
                      <Td align="right" className="whitespace-nowrap">
                        {czk(item.incomeCzk)}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {czk(item.expenseCzk)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </ScrollArea>
            <InfoPrint>{shortSalesInfo}</InfoPrint>
          </Section>
        )}

        {hasDerivatives && (
          <Section
            title={`Derivátové obchody v roce ${year}`}
            count={result.derivatives.items.length}
          >
            <ScrollArea label={`Derivátové obchody v roce ${year}`}>
              <Table aria-label="Rozpis derivátových obchodů">
                <thead>
                  <tr>
                    <Th>Instrument</Th>
                    <Th className="max-sm:hidden">Událost</Th>
                    <Th align="right">Datum</Th>
                    <Th align="right">Příjem</Th>
                    <Th align="right">Výdaj</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.derivatives.items.map((item) => (
                    <Tr key={`${item.txId}-${item.kind}`}>
                      <InstrumentCell
                        name={labels.get(item.isin) ?? item.isin}
                        event={DERIVATIVE_KIND_LABEL[item.kind]}
                      />
                      <Td align="right" className="whitespace-nowrap">
                        {czDate(item.date)}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {czk(item.incomeCzk)}
                      </Td>
                      <Td align="right" className="whitespace-nowrap">
                        {czk(item.expenseCzk)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </ScrollArea>
            {/* Pravidlo 2: počítáme bezpečným výkladem, ale ukážeme, co by
                znamenal ten mírnější — a poctivě řekneme, o kolik jde. */}
            {result.derivatives.deniedExpensesCzk.gt(0) && (
              <Notice
                tone="caution"
                className="mt-5"
                title={`Prémie bezcenně expirovaných opcí ${czk(result.derivatives.deniedExpensesCzk)} do výdajů nepočítáme`}
              >
                <Disclosure summary="Co by znamenal mírnější výklad">
                  <p>
                    Počítáme podle bezpečného výkladu jako neuznatelný výdaj. Mírnější výklad
                    „výdaje za celý druh“ by{' '}
                    {/* skutečný dopad, ne hrubá prémie: výdaje druhu jsou stropované
                        jeho příjmy (§ 10/4), takže rozdíl bývá výrazně menší */}
                    {result.derivatives.deniedExpensesImpactCzk.gt(0) ? (
                      <>
                        základ daně snížil o{' '}
                        <span className="tabular-nums text-ink">
                          {czk(result.derivatives.deniedExpensesImpactCzk)}
                        </span>{' '}
                        (méně než celá prémie — výdaje druhu se uplatní nejvýš do výše jeho příjmů,
                        § 10/4)
                      </>
                    ) : (
                      <>
                        na základu daně letos nic nezměnil — výdaje druhu už teď dosáhly stropu jeho
                        příjmů (§ 10/4)
                      </>
                    )}
                    ;{' '}
                    {demo
                      ? 'v plné verzi si výklad přepneš v Nastavení — založ si účet.'
                      : 'přepínač najdeš v Nastavení.'}
                  </p>
                </Disclosure>
              </Notice>
            )}
          </Section>
        )}

        {/* ── 6. jak je to spočítáno ────────────────────────────────────────── */}
        <div className="@container">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-(--column-gap) gap-y-14 @3xl:grid-cols-2 print:block print:space-y-8">
            <Section
              title="Výpočet daně"
              info={
                <InfoPopover label="Výpočet daně" title="Jak se daň počítá" align="start">
                  <p>{tidy(result.tax.note)}</p>
                  <p>
                    Druhy příjmů z prodejů se mezi sebou nekompenzují. Zápočet zahraniční daně (§
                    38f) je stropovaný podílem zahraničních příjmů na základu — může být nižší než
                    započitatelná srážka z tabulky států.
                  </p>
                  <p>
                    <TextLink href="/jak-pocitame" chevron>
                      Jak Danero počítá
                    </TextLink>
                  </p>
                </InfoPopover>
              }
            >
              <Group aria-label="Z čeho se orientační daň z investic počítá">
                <Row
                  label="Cenné papíry"
                  hint={
                    <>
                      tržby {czk(result.securities.totalGrossProceedsCzk)}
                      {result.securities.exemptUnder100k &&
                        ' · vše osvobozeno, prodeje do 100 000 Kč za rok'}
                    </>
                  }
                  value={czk(wholeBases.securitiesCzk)}
                />
                {hasCrypto && (
                  <Row
                    label="Kryptoaktiva"
                    hint={<>tržby {czk(result.crypto.totalGrossProceedsCzk)}</>}
                    value={czk(wholeBases.cryptoCzk)}
                  />
                )}
                {hasDerivatives && (
                  <Row
                    label="Deriváty"
                    hint={<>plnění {czk(result.derivatives.taxableIncomeCzk)}</>}
                    value={czk(wholeBases.derivativesCzk)}
                  />
                )}
                <Row
                  label="Základ daně z prodejů"
                  hint={(hasCrypto || hasDerivatives) && 'součet druhů, nekompenzují se'}
                  value={czk(wholeBases.base10Czk)}
                />
                <Row
                  label="Základ daně z dividend a úroků"
                  hint={
                    <>
                      sraženo v zahraničí {czk(result.dividends.foreignWithholdingCzk)},
                      započitatelné {czk(result.dividends.creditableWithholdingCzk)}
                    </>
                  }
                  value={czk(wholeBases.base8Czk)}
                />
                {/* E-27: variantu zdanění dividend nedoporučujeme — řádek říká, se
                    kterou se počítá dál, a kolik by vyšla ta druhá. Dva řádky
                    „Daň v obecném / samostatném základu“ nad tučným výsledkem
                    se četly jako sčítance a součet (R1B-02). */}
                <DividendTaxationRow summary={tax} />
                <Row label="Daň před zápočtem" value={czk(activeTax.taxBeforeCreditCzk)} />
                <Row label="− Uplatněný zápočet zahraniční daně" value={czk(appliedCreditCzk)} />
                {/* výsledek: orientační daň, po prolomení paušálního limitu
                    i zálohy a doplatek — stejné řádky jako na přehledu */}
                <TaxResultRows summary={tax} />
              </Group>
              <InfoPrint>
                <p>{tidy(result.tax.note)}</p>
                <p>
                  Druhy příjmů z prodejů se mezi sebou nekompenzují. Zápočet zahraniční daně (§ 38f)
                  je stropovaný podílem zahraničních příjmů na základu — může být nižší než
                  započitatelná srážka z tabulky států.
                </p>
              </InfoPrint>
            </Section>

            <div>
              <ViewSwitch
                headingAs="h2"
                title="Porovnání variant párování"
                info={
                  <InfoPopover label="Porovnání variant párování" align="start">
                    {variantsInfo}
                  </InfoPopover>
                }
                ariaLabel="Kurzy ve srovnání variant"
                defaultKey={result.options.fxMethod}
                views={fxMethods.map((fx) => ({
                  key: fx,
                  label: fx === 'UNIFIED' ? 'Jednotný kurz' : 'Denní kurzy ČNB',
                  content: variantsTable(fx),
                }))}
              />
              <p className="type-footnote mt-3 text-pretty text-ink-muted">
                FIFO je bezpečný standard; jinou metodu párování lze obhájit jen průkaznou
                identifikací konkrétních prodávaných kusů.
                {/* R4-02: fixace stojí hned pod tabulkou variant, jako na `main` —
                    kdo si tu vybírá jinou metodu, musí vědět, že ji rok nepřevezme */}
                {pinned &&
                  !demo &&
                  ` ${tidy(`Rok ${year} je zafixovaný (${pinnedSummary(pinned)}) — jinou variantu převezme, až fixaci v Nastavení zrušíš.`)}`}
              </p>
              <InfoPrint>{variantsInfo}</InfoPrint>
              {!demo && !dailyRates && (
                <Notice
                  tone="caution"
                  className="mt-4"
                  title="Denní kurzy ČNB se zatím nepodařilo načíst"
                >
                  Srovnání zahrnuje jen jednotný kurz. Zkus stránku otevřít později.
                </Notice>
              )}
            </div>

            <Section title="Metoda výpočtu">
              <Group>
                {[
                  ['Párování prodejů', methodLabel],
                  ['Kurzy', fxMethodLabel(result)],
                  [
                    LIMIT_NAME.SECURITIES,
                    limit100kLabel(result.options.limit100kIncludesTimeTestExempt),
                  ],
                  [
                    'Časový test',
                    result.options.timeTestDateBasis === 'settlement'
                      ? 'od data vypořádání'
                      : 'od data obchodu',
                  ],
                  [
                    'Stablecoiny',
                    result.options.emtTimeTestExempt
                      ? 's časovým testem (mírnější výklad)'
                      : 'bez osvobození (bezpečný výklad)',
                  ],
                  [
                    'Vratka kapitálu',
                    result.options.returnOfCapitalReducesBasis
                      ? 'snižuje nabývací cenu (mírnější výklad)'
                      : 'daněna jako dividenda (bezpečný výklad)',
                  ],
                ].map(([term, value]) => (
                  // hodnoty jsou věty („daněna jako dividenda…“) a musí se umět zalomit
                  <Row key={term} wrap label={term} value={value} />
                ))}
              </Group>
              {/* Celé znění fixace je nahoře u verdiktu (vysvětlivka); sem patří
                  jen to, kde se metoda mění. Na papír jde znění celé. */}
              {!demo && (
                <p className="type-caption pt-2 text-pretty text-ink-muted print:hidden">
                  {pinned
                    ? tidy(`Rok ${year} je zafixovaný — fixaci zrušíš v Nastavení.`)
                    : 'Metodu a výklady změníš v Nastavení.'}
                </p>
              )}
              {!demo && pinned && (
                <InfoPrint>
                  <p>{tidy(pinnedMethodNote(year, pinned))}</p>
                </InfoPrint>
              )}
            </Section>

            {/* K1-04: sekce se ukazuje VŽDY — u roku před prvním jednotným kurzem je
                její prázdnota sama o sobě informace, kterou má podklad doložit */}
            <Section
              title="Použité kurzy"
              info={
                rateYears.length > 0 && (
                  <InfoPopover label="Použité kurzy" align="start">
                    {ratesInfo}
                  </InfoPopover>
                )
              }
            >
              {rateYears.length === 0 ? (
                <p className="type-callout text-pretty text-ink-muted">
                  Za rok {year} jednotný kurz GFŘ nemáme — ověřená tabulka pokynů řady D začíná
                  rokem {FIRST_UNIFIED_RATE_YEAR}. Částky v cizí měně se v tomhle podkladu proto
                  přepočítávají denními kurzy ČNB k datu obchodu; obchody v korunách se
                  nepřepočítávají vůbec.
                </p>
              ) : (
                <>
                  <ScrollArea label="Použité jednotné kurzy GFŘ">
                    <Table aria-label="Použité jednotné kurzy podle roku, Kč za jednotku">
                      <thead>
                        <tr>
                          <Th>Rok</Th>
                          <Th align="right">USD</Th>
                          <Th align="right">EUR</Th>
                          <Th align="right">GBP</Th>
                          <Th>Zdroj</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rateYears.map((rateYear) => (
                          <Tr key={rateYear}>
                            <Td>{rateYear}</Td>
                            {(['USD', 'EUR', 'GBP'] as const).map((ccy) => (
                              <Td key={ccy} align="right">
                                {(UNIFIED_RATES[rateYear]?.[ccy] ?? '—').replace('.', ',')}
                              </Td>
                            ))}
                            {/* zdroj se smí zalomit („orientační / do vydání pokynu“),
                                číslo pokynu ne — na 390 px tabulka jinak
                                přetékala o 37 px (R1B-13) */}
                            <Td className="type-footnote text-ink-muted">
                              {isRateVerified(rateYear) && UNIFIED_RATE_SOURCES[rateYear] ? (
                                <span className="whitespace-nowrap">
                                  pokyn {UNIFIED_RATE_SOURCES[rateYear]}
                                </span>
                              ) : (
                                'orientační (do vydání pokynu)'
                              )}
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </ScrollArea>
                  <p className="type-caption mt-2 text-ink-muted">
                    Jednotný kurz GFŘ, Kč za jednotku měny.
                  </p>
                  <InfoPrint>{ratesInfo}</InfoPrint>
                </>
              )}
            </Section>
          </div>
        </div>
      </div>
      {/* Konec stránky: tisk na telefonu. V liště se tam vedle exportu nevejde
          a pod verdiktem zabíral nejcennější místo pro akci, kterou tam skoro
          nikdo neudělá (R1B-27). Stojí mimo sloupec sekcí — skrytý poslední
          prvek by pod poslední sekcí nechal na širokém okně prázdný odstup.

          Výhradu „není daňové poradenství“ report na obrazovce vlastní nemá:
          nese ji patička aplikace i dema na každé stránce (`NOT_TAX_ADVICE`,
          R5-01). Celá věta zůstává v tiskové hlavičce — tisk z aplikace
          odchází jako dokument a patička se netiskne. */}
      <div className="mt-10 print:hidden sm:hidden">
        <PrintButton long />
      </div>
    </>
  );
}
