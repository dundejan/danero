import Link from 'next/link';
import type { LimitStatus } from '@danero/engine';
import type { Transaction } from '@danero/shared';
import { AppToolbar } from '@/components/app-toolbar';
import { LimitDrawdownChart } from '@/components/charts';
import {
  FilingDeadlineStat,
  filingLimitFor,
  FilingVerdictHeading,
} from '@/components/filing-verdict';
import { HorizonInfo, HorizonStrip } from '@/components/horizon-strip';
import { LimitBar, ZONE_LABEL, ZONE_TEXT } from '@/components/limit-gauge';
import { LimitsInspector, type LimitEntry } from '@/components/limits-inspector';
import { PositionsTable } from '@/components/positions-table';
import { DividendTaxationRow, TaxFigure, TaxResultRows } from '@/components/tax-figure';
import { TaxYearConfigNotice } from '@/components/tax-year-config-notice';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { Section, SectionHeader } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { TextLink } from '@/components/ui/link';
import { ViewSwitch } from '@/components/view-switch';
import { groupByCode, WarningsList } from '@/components/warnings-list';
import { YearSwitcher } from '@/components/year-switcher';
import {
  exemptionOutlook,
  flatTax50kSeries,
  horizonDots,
  limit100kSeries,
} from '@/lib/charts-data';
import { czDate, czk, METHOD_LABEL, pct, plural } from '@/lib/format';
import { LIMIT_NAME, limitTitle } from '@/lib/limit-names';
import { taxSummary } from '@/lib/payable-tax';
import { wholeBasesCzk } from '@/lib/priloha2';
import { instrumentNames, type YearAnalysis } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { plainTitle, tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';

/** Upozornění pro seznam „Poslední upozornění“ — DB řádek i demo kandidát. */
export interface PrehledNotification {
  dedupeKey: string;
  title: string;
  body: string;
  createdAt: Date;
}

/**
 * Řádek seznamu limitů: název a procento, pod nimi odměrka a čerpání.
 * V úzkém okně řádek otevírá detail v sheetu — šipka to naznačuje.
 */
function LimitRow({ name, status }: { name: string; status: LimitStatus }) {
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{name}</span>
        <span className={cn('font-semibold tabular-nums', ZONE_TEXT[status.zone])}>
          {pct(status.ratio * 100)}
          <span aria-hidden className="ml-2 font-normal text-ink-muted @3xl:hidden">
            ›
          </span>
        </span>
      </span>
      <LimitBar ratio={status.ratio} zone={status.zone} className="mt-2.5" />
      <span className="type-footnote mt-2 flex items-baseline justify-between gap-4 text-ink-muted">
        <span className="tabular-nums">
          {czk(status.usedCzk)} z {czk(status.limitCzk)}
        </span>
        <span className={ZONE_TEXT[status.zone]}>{ZONE_LABEL[status.zone]}</span>
      </span>
    </span>
  );
}

/** Řádek pro případ, kdy limit neexistuje a daní se každý prodej. */
function NoExemptionRow({ name, proceeds }: { name: string; proceeds: string }) {
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{name}</span>
        <span className="font-semibold text-danger">
          bez limitu
          <span aria-hidden className="ml-2 font-normal text-ink-muted @3xl:hidden">
            ›
          </span>
        </span>
      </span>
      <span className="type-footnote mt-2 flex items-baseline justify-between gap-4 text-ink-muted">
        <span className="tabular-nums">{proceeds} zdanitelných tržeb</span>
        <span className="text-danger">daní se každý prodej</span>
      </span>
    </span>
  );
}

/**
 * Hlavička detailu a jeho výklad. V inspektoru (široké okno) je vidět název
 * limitu a výklad se schová za „i“; v sheetu (telefon) název nese titulek
 * sheetu a výklad stojí pod obsahem rovnou — sheet sám je ta vrstva „na
 * požádání“ a bublina v dialogu by byla dialog v dialogu.
 *
 * Detail bez grafu (limit, který se letos ještě nehýbal) má výklad vidět
 * i v inspektoru: inspektor drží stálou výšku, aby se při přepínání řádků
 * nehýbala stránka pod ním (R1B-17), a prázdné místo po grafu je lepší
 * zaplnit tím, co by si člověk stejně rozklikl.
 */
function DetailHeading({
  label,
  explanation,
  inline,
}: {
  label: string;
  explanation: string;
  /** Výklad stojí pod číslem rovnou — vysvětlivka by ho jen opakovala. */
  inline: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 in-[.material-sheet]:hidden">
      <h3 className="type-title-3 text-balance">{label}</h3>
      {!inline && (
        <InfoPopover label={label} title="Co se do limitu počítá" align="end">
          <p>{tidy(explanation)}</p>
        </InfoPopover>
      )}
    </div>
  );
}

function DetailExplanation({ children, inline }: { children: string; inline: boolean }) {
  return (
    <p
      className={cn(
        'type-footnote mt-5 px-1 text-pretty text-ink-muted @3xl:px-0',
        !inline && 'hidden in-[.material-sheet]:block',
      )}
    >
      {tidy(children)}
    </p>
  );
}

/**
 * Detail limitu: kolik zbývá (nebo o kolik je limit překročený) a průběh
 * čerpání v roce. Graf nemá popisek — osa, křivka a čára limitu stačí.
 */
function LimitDetail({
  label,
  status,
  explanation,
  chart,
}: {
  label: string;
  status: LimitStatus;
  explanation: string;
  chart?: React.ReactNode;
}) {
  const difference = status.limitCzk.sub(status.usedCzk).abs();
  const inline = !chart;
  return (
    <div>
      <DetailHeading label={label} explanation={explanation} inline={inline} />
      <p className="mt-3 px-1 in-[.material-sheet]:mt-0 @3xl:px-0">
        <span className={cn('type-figure', status.exceeded && 'text-danger')}>
          {czk(difference)}
        </span>{' '}
        <span className="type-callout text-ink-muted">
          {status.exceeded ? 'nad limitem' : 'zbývá do limitu'}
        </span>
      </p>
      {chart && <div className="mt-5">{chart}</div>}
      <DetailExplanation inline={inline}>{explanation}</DetailExplanation>
    </div>
  );
}

/** Detail řádku, u kterého žádný limit neplatí — jen výklad proč. */
function NoExemptionDetail({ label, explanation }: { label: string; explanation: string }) {
  return (
    <div>
      <h3 className="type-title-3 in-[.material-sheet]:hidden">{label}</h3>
      <p className="type-footnote mt-3 px-1 text-pretty text-ink-muted in-[.material-sheet]:mt-0 @3xl:px-0">
        {tidy(explanation)}
      </p>
    </div>
  );
}

/**
 * Sdílené tělo přehledu: reálná stránka mu předá data z DB, demo stránka
 * ukázkový dataset. Vše uvnitř jsou čisté výpočty nad hotovou analýzou —
 * žádné I/O. `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 *
 * Přehled je vzor textové diety (docs/07): na obrazovce je číslo, stav,
 * termín a akce; „proč“ a „jak se to počítá“ bydlí ve vysvětlivkách.
 *
 * Skladba shora dolů:
 * 1. verdikt — stav jednou větou, odpověď na „musím letos něco řešit?“
 *    a vedle ní nejvýš dvě čísla (termín podání, částka),
 * 2. limity — seznam a detail vybraného (inspektor / na telefonu sheet),
 * 3. horizont osvobození,
 * 4. vedle sebe: z čeho se daň počítá | upozornění a kontroly výpočtu.
 *
 * `preview` vykreslí jen lištu, verdikt a limity — tak přehled stojí v okně
 * na úvodní stránce (skutečná komponenta nad ukázkovými daty, ne obrázek).
 */
export function OverviewView({
  txs,
  analysis,
  prices,
  years,
  year,
  today,
  notifications,
  basePath = '',
  preview = false,
}: {
  txs: Transaction[];
  analysis: YearAnalysis;
  prices: Map<string, InstrumentPrice>;
  years: number[];
  year: number;
  today: string;
  notifications: PrehledNotification[];
  basePath?: string;
  preview?: boolean;
}) {
  const { result, positions, labels } = analysis;
  const currentYear = Number(today.slice(0, 4));
  const limit100kChart = limit100kSeries(result);
  const flatTax50kChart = flatTax50kSeries(result);
  // graf dává smysl až od dvou bodů (jeden prodej = svislá čára v prázdnu)
  const showLimit100kChart = limit100kChart.points.length > 1;
  const showFlatTax50kChart = (flatTax50kChart?.points.length ?? 0) > 1;

  const importantWarnings = result.warnings.filter((w) => w.level !== 'INFO');
  // kontroly úrovně „informace“ má jen report — kolik jich tam je navíc
  const infoGroups =
    groupByCode(result.warnings).length - groupByCode(importantWarnings).length;
  const hasCrypto =
    result.crypto.disposals.length > 0 ||
    positions.some((p) => p.assetClass === 'CRYPTO' && p.totalRemaining.gt(0));
  const forfeitedWithholdingCzk = result.dividends.foreignWithholdingCzk.sub(
    result.dividends.creditableWithholdingCzk,
  );

  // Částky limitů § 38g se rok od roku liší (R-09a, R-09b: do ZO 2026
  // 50 000 / 20 000 Kč, od ZO 2027 100 000 / 40 000 Kč), takže je popisky
  // berou z téhož stavu jako odměrka — tedy z konfigurace počítaného roku.
  // S částkou natvrdo by nadpis a čerpání pod ním jmenovaly dvě různá čísla.
  const generalLimit = czk(result.limits.generalFiling50k.status.limitCzk);

  // Verdikt: limit, jehož prolomení znamená povinnost podat přiznání — výběr
  // podle režimu i znění nadpisu sdílí přehled s reportem (L5-02);
  // OSVČ mimo paušál podává přiznání tak jako tak, verdikt tam nedává smysl.
  const filingLimit = filingLimitFor(result);
  /**
   * Limit 50k pro paušální daň je aplikovatelný právě u režimu PAUSAL
   * (`limits.ts`), takže tenhle příznak = „uživatel je OSVČ“. OSVČ má od
   * 1. 1. 2023 datovou schránku zřízenou ze zákona a § 72 odst. 6 daňového řádu
   * jí ukládá podat přiznání jen elektronicky; písemné podání je vada podání
   * (§ 74 DŘ) s pokutou dle § 247a odst. 2 DŘ. Nabízet jí papírový termín tedy
   * znamená poslat ji do pokuty a zbytečně jí zkrátit lhůtu o měsíc (E-23).
   * OSVČ mimo paušál se sem nedostane — verdikt se jí nevykresluje vůbec.
   */
  const filesElectronicallyOnly = result.limits.flatTax50k.applicable;
  // „nejblíž prolomení“ = nejvyšší čerpání ze sledovaných limitů
  const watchedLimits = [
    ...(filingLimit ? [filingLimit] : []),
    { status: result.limits.limit100k, name: LIMIT_NAME.SECURITIES },
  ];
  const nearestLimit = watchedLimits.reduce((a, b) => (b.status.ratio > a.status.ratio ? b : a));
  // Jedno pojetí daně pro přehled, report i simulátor: orientační daň, a kde se
  // odečítají zálohy z paušálního režimu (R-08f), tak doplatek (`taxSummary`)
  const tax = taxSummary(result);
  const exceeded = filingLimit?.status.exceeded ?? false;

  // Rozpad základu § 10 po druzích — souhrnné „(prodeje)“ mátlo: daň může být
  // jen z derivátů (bez osvobození, R-12c), zatímco prodeje CP/krypto jsou pod limity
  // Částky v celých korunách, jak je nese tiskopis — stejné číslo jako v reportu
  // u Přílohy č. 2 a ř. 38, ne o korunu jiné (R-14h).
  const wholeBases = wholeBasesCzk(result, tax.variant);
  const base10Parts = [
    { label: 'cenné papíry', value: wholeBases.securitiesCzk },
    { label: 'kryptoaktiva', value: wholeBases.cryptoCzk },
    { label: 'deriváty', value: wholeBases.derivativesCzk },
  ].filter((part) => part.value.gt(0));

  // prodeje proběhly, ale jsou celé osvobozené → řekni to, jinak čtenář hledá
  // chybu; rozhoduje taxableIncome (base10 = 0 může vzniknout i kompenzací
  // zisků a ztrát — to NENÍ osvobození)
  const exemptNotes = [
    result.securities.taxableIncomeCzk.lte(0) && result.limits.limit100k.usedCzk.gt(0)
      ? 'Prodeje cenných papírů jsou letos plně osvobozené.'
      : null,
    result.crypto.taxableIncomeCzk.lte(0) && result.limits.cryptoLimit100k.usedCzk.gt(0)
      ? 'Krypto je plně osvobozené.'
      : null,
  ].filter((note): note is string => note !== null);

  /* ── seznam limitů a jejich detaily ─────────────────────────────────────
     Výklad („co se do limitu počítá“) nese vysvětlivka v detailu; v řádku je
     jen název, čerpání a stav. */

  const limitEntries: LimitEntry[] = [];
  if (result.limits.flatTax50k.applicable) {
    const { status } = result.limits.flatTax50k;
    const title = limitTitle('FLAT_TAX', status.limitCzk);
    limitEntries.push({
      key: 'flat-tax',
      title,
      row: <LimitRow name={LIMIT_NAME.FLAT_TAX} status={status} />,
      detail: (
        <LimitDetail
          label={title}
          status={status}
          explanation="Platí jen pro paušální daň (§ 7a): úhrn zdanitelných příjmů mimo samostatnou činnost (podnikání) — neosvobozené tržby z prodejů cenných papírů i kryptoaktiv, plnění z derivátů, zahraniční dividendy (brutto), úroky, nájem. Osvobozené prodeje se nepočítají. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
          chart={
            flatTax50kChart && showFlatTax50kChart ? (
              <LimitDrawdownChart series={flatTax50kChart} name="Zdanitelné příjmy" />
            ) : undefined
          }
        />
      ),
    });
  }
  if (result.limits.employee20k.applicable) {
    const { status } = result.limits.employee20k;
    const title = limitTitle('EMPLOYEE_SIDE_INCOME', status.limitCzk);
    limitEntries.push({
      key: 'employee',
      title,
      row: <LimitRow name={LIMIT_NAME.EMPLOYEE_SIDE_INCOME} status={status} />,
      detail: (
        <LimitDetail
          label={title}
          status={status}
          explanation="Zdanitelné příjmy vedle zaměstnání — investice, nájmy i vlastní výdělek ze samostatné činnosti (§ 7 až 10). Odměrka ukazuje jen to, co Danero vidí z výpisů a z tvého nastavení; příjmy z podnikání do limitu patří taky, ale my o nich nevíme. Při překročení podáváš přiznání."
        />
      ),
    });
  }
  // režim „jiné“: obecný limit § 38g — verdikt s ním počítá, takže má i řádek
  if (result.limits.generalFiling50k.applicable) {
    const { status } = result.limits.generalFiling50k;
    const title = limitTitle('GENERAL_FILING', status.limitCzk);
    limitEntries.push({
      key: 'general',
      title,
      row: <LimitRow name={LIMIT_NAME.GENERAL_FILING} status={status} />,
      detail: (
        <LimitDetail
          label={title}
          status={status}
          explanation={`Obecný limit (§ 38g): zdanitelné příjmy do ${generalLimit} za rok bez povinnosti podat přiznání. Při překročení přiznání podáváš.`}
        />
      ),
    });
  }
  if (result.limits.limit100k.applicable) {
    const status = result.limits.limit100k;
    const title = limitTitle('SECURITIES', status.limitCzk);
    limitEntries.push({
      key: 'securities',
      title,
      row: <LimitRow name={LIMIT_NAME.SECURITIES} status={status} />,
      detail: (
        <LimitDetail
          label={title}
          status={status}
          explanation="Do 100 000 Kč tržeb z prodeje cenných papírů za rok (§ 4 odst. 1 písm. t) jsou osvobozené všechny prodeje, i bez 3 let držení. Nad limit se daní prodeje bez splněného časového testu. Neplatí pro cenné papíry zahrnuté v obchodním majetku."
          chart={
            showLimit100kChart ? (
              <LimitDrawdownChart series={limit100kChart} name="Tržby z prodejů" />
            ) : undefined
          }
        />
      ),
    });
  } else {
    /* R-02f: s cennými papíry v obchodním majetku osvobození neexistuje —
       pool je nulový, takže odměrka hlásila „0 / 100 000, v pořádku“ přesně
       tam, kde se daní každý prodej (nález A1-3-04) */
    const title = 'Obchodní majetek: osvobození neexistuje';
    limitEntries.push({
      key: 'securities',
      title,
      row: (
        <NoExemptionRow
          name="Cenné papíry v obchodním majetku"
          proceeds={czk(result.securities.totalGrossProceedsCzk)}
        />
      ),
      detail: (
        <NoExemptionDetail
          label={title}
          explanation="Máš v nastavení uvedeno, že cenné papíry patří do tvého obchodního majetku. Roční limit 100 000 Kč ani tříletý časový test se na ně nevztahují (§ 4 odst. 1 písm. t a u) — a neplatí ani tři roky po ukončení činnosti."
        />
      ),
    });
  }
  if (hasCrypto) {
    if (result.limits.cryptoLimit100k.applicable) {
      const status = result.limits.cryptoLimit100k;
      const title = limitTitle('CRYPTO', status.limitCzk);
      limitEntries.push({
        key: 'crypto',
        title,
        row: <LimitRow name={LIMIT_NAME.CRYPTO} status={status} />,
        detail: (
          <LimitDetail
            label={title}
            status={status}
            explanation="Samostatný limit pro kryptoaktiva (§ 4 odst. 1 písm. zj zákona o daních z příjmů), nezávislý na limitu pro cenné papíry: jsou-li tržby z prodejů a směn krypta za rok do 100 000 Kč, jsou osvobozené. Neplatí pro stablecoiny (elektronické peněžní tokeny) a pro příjmy před 15. 2. 2025."
          />
        ),
      });
    } else {
      /* R-10b: do roku 2024 krypto žádné osvobození nemá — odměrka
         „0 / 100 000, v pořádku“ by tvrdila pravý opak toho, co platí */
      const title = `Krypto ${year}: osvobození neexistuje`;
      limitEntries.push({
        key: 'crypto',
        title,
        row: (
          <NoExemptionRow
            name={`Krypto ${year}`}
            proceeds={czk(result.crypto.totalGrossProceedsCzk)}
          />
        ),
        detail: (
          <NoExemptionDetail
            label={title}
            explanation={`Roční limit 100 000 Kč ani tříletý časový test pro kryptoaktiva za rok ${year} neplatí — zavedl je až zákon č. 32/2025 Sb. s účinností od 15. 2. 2025. Zdanitelný je proto každý prodej i směna, bez ohledu na výši tržeb a dobu držení.`}
          />
        ),
      });
    }
  }

  /* ── verdikt ────────────────────────────────────────────────────────────
     Jedna věta o stavu, jedna odpověď a vedle ní nejvýš dvě čísla. Žádný
     odstavec: termín je číslo, výhrada u částky je pár slov a zbytek
     (proč elektronicky, co do doplatku nepatří) je ve vysvětlivkách.

     Verdikt stojí v levém sloupci, čísla v pravém — na stejné mřížce jako
     dvojice sekcí níž, takže čísla lícují s pravým sloupcem pod sebou
     (R1B-26). V užším okně se čísla zalomí pod odpověď.

     Číslo daně kreslí `TaxFigure` — tentýž prvek jako v reportu, takže pod
     stejným verdiktem stojí na obou stránkách stejná částka pod stejným
     jménem (R1B-03). */
  const verdict = (
    <div className="@container">
      <div className="grid gap-x-(--column-gap) gap-y-7 @3xl:grid-cols-2 @3xl:items-end">
        <div>
          {filingLimit ? (
            <FilingVerdictHeading year={year} limit={filingLimit} closed={year < currentYear} />
          ) : (
            <h2 className="type-title-1 max-w-[22ch] text-balance">
              {tidy(`Daně z investic za rok ${year}`)}
            </h2>
          )}
        </div>
        <dl className="flex flex-wrap items-start gap-x-12 gap-y-6">
          {filingLimit && exceeded && (
            <FilingDeadlineStat year={year} electronicOnly={filesElectronicallyOnly} />
          )}
          <TaxFigure result={result} />
          {filingLimit && !exceeded && (
            <Stat
              size="lg"
              label="Nejbližší limit"
              value={pct(nearestLimit.status.ratio * 100)}
              note={nearestLimit.name}
            />
          )}
        </dl>
      </div>
    </div>
  );

  const toolbar = (
    <AppToolbar
      title="Přehled"
      titleContext={String(year)}
      pinned={!preview}
      actions={
        exceeded && (
          <Link
            href={`${basePath}/report`}
            // V náhledu na úvodní stránce je hlavní akcí stránky „Vyzkoušet
            // demo“ — třetí plné modré tlačítko v prvním okně by s ní soupeřilo
            // (R1A-26).
            className={buttonVariants({ variant: preview ? 'secondary' : 'primary', size: 'sm' })}
          >
            Otevřít report
          </Link>
        )
      }
    >
      <YearSwitcher years={years} active={year} hrefBase={`${basePath}/prehled`} />
    </AppToolbar>
  );

  const limits = (
    <section>
      <SectionHeader title="Limity" />
      <LimitsInspector entries={limitEntries} className="mt-2" />
    </section>
  );

  if (preview) {
    return (
      <>
        {toolbar}
        <div className="space-y-12">
          {verdict}
          {limits}
        </div>
      </>
    );
  }

  // CLAUDE.md, pravidlo 2: počítáme bezpečným výkladem, ale ukážeme,
  // co by znamenal ten výhodnější — a poctivě řekneme, že je sporný.
  const lenientProceeds = result.securities.totalGrossProceedsCzk.sub(
    result.securities.timeTestExemptProceedsCzk,
  );
  const showLenientReading =
    result.options.limit100kIncludesTimeTestExempt &&
    !result.securities.exemptUnder100k &&
    lenientProceeds.lte(result.limits.limit100k.limitCzk);

  const dots = horizonDots(positions, labels, prices, currentYear);
  const fxLabel = result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB';
  const methodLabel = METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod;

  return (
    <>
      {toolbar}
      <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4">
        {/* R-15e: rok, pro který stát ještě nevyhlásil čísla (typicky hned
            1. ledna) — sdělení musí být nad odhadem daně, ne pod ním */}
        <TaxYearConfigNotice year={year} pausal={result.limits.flatTax50k.applicable} />

        {verdict}

        {limits}

        {showLenientReading && (
          <Notice
            title="Podle mírnějšího výkladu by letošní prodeje byly osvobozené"
            action={
              // v demu Nastavení není — odkaz by vedl na přihlášení
              basePath === '' ? (
                <TextLink href="/nastaveni" chevron>
                  Nastavení
                </TextLink>
              ) : undefined
            }
          >
            <Disclosure summary="Proč to tak nepočítáme">
              <p>
                Počítáme bezpečným výkladem: do limitu 100 000 Kč pro osvobození prodejů cenných
                papírů se počítají i prodeje osvobozené časovým testem. Podle mírnějšího (sporného)
                výkladu by se do něj počítalo jen{' '}
                <span className="tabular-nums text-ink">{czk(lenientProceeds)}</span> a všechny
                letošní prodeje by byly osvobozené. Výklad si můžeš přepnout v Nastavení —
                rozhodnutí (a riziko) je na tobě.
              </p>
            </Disclosure>
          </Notice>
        )}

        {/* H4: graf a tabulka jsou dvě zobrazení téže informace — jednotný
            nadpis, přepínač pohledu; default graf (bez JS se vykreslí ten).
            Bez otevřených pozic by přepínač stál nad prázdnem — místo něj
            poctivý prázdný stav. */}
        <section>
          {positions.length > 0 ? (
            <ViewSwitch
              title="Horizont osvobození"
              info={<HorizonInfo basis={dots[0]?.weightBasis} />}
              ariaLabel="Zobrazení horizontu osvobození"
              defaultKey="graf"
              views={[
                {
                  key: 'graf',
                  label: 'Graf',
                  content: (
                    <HorizonStrip
                      dots={dots}
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
                      basePath={basePath}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <>
              <SectionHeader title="Horizont osvobození" />
              <EmptyState compact title="Žádné otevřené pozice" className="mt-4">
                Jakmile něco koupíš, uvidíš tady, kdy se nákup osvobodí od daně.
              </EmptyState>
            </>
          )}
        </section>

        <div className="@container">
          <div className="grid gap-x-(--column-gap) gap-y-14 @3xl:grid-cols-2">
            <Section
              title="Daň z investic"
              info={
                <InfoPopover label="Daň z investic" title="Jak se daň počítá" align="start">
                  <p>{tidy(result.tax.note)}</p>
                  <p>
                    Spočítáno z {txs.length}{' '}
                    {plural(txs.length, 'transakce', 'transakcí', 'transakcí')} · {methodLabel} ·{' '}
                    {fxLabel}.
                  </p>
                  <p>
                    <TextLink href="/jak-pocitame" chevron>
                      Jak Danero počítá
                    </TextLink>
                  </p>
                </InfoPopover>
              }
            >
              <Group
                footer={exemptNotes.length > 0 ? exemptNotes.join(' ') : undefined}
                aria-label="Z čeho se orientační daň z investic počítá"
              >
                <Row
                  label="Základ daně z prodejů"
                  hint={
                    base10Parts.length > 0
                      ? `z toho ${base10Parts.map((part) => `${part.label} ${czk(part.value)}`).join(', ')}`
                      : undefined
                  }
                  value={czk(wholeBases.base10Czk)}
                />
                <Row
                  label="Základ daně z dividend a úroků"
                  value={czk(wholeBases.base8Czk)}
                />
                {/* E-27: variantu zdanění dividend nedoporučujeme (docs/13 V-4) —
                    řádek říká, se kterou počítáme, a kolik by vyšla ta druhá.
                    Dvě varianty jako dva řádky nad tučným výsledkem se četly
                    jako sčítance a součet (R1B-02). */}
                <DividendTaxationRow summary={tax} />
                <TaxResultRows summary={tax} />
              </Group>
            </Section>

            {(importantWarnings.length > 0 || notifications.length > 0) && (
              <div className="space-y-14">
                {notifications.length > 0 && (
                  <Section title="Poslední upozornění">
                    <Group>
                      {notifications.map((notification) => (
                        <DisclosureRow
                          key={notification.dedupeKey}
                          title={plainTitle(notification.title)}
                          meta={czDate(notification.createdAt)}
                        >
                          {/* text upozornění je i tělo e-mailu — zdroj se nemění,
                              jen se při zobrazení neláme uprostřed částky (R2-12) */}
                          <p>{tidy(notification.body)}</p>
                        </DisclosureRow>
                      ))}
                    </Group>
                  </Section>
                )}

                {importantWarnings.length > 0 && (
                  /* počet = zobrazené skupiny, ne surová varování — „10“ nad
                     třemi řádky mátlo; násobnost nese řádek skupiny („8×“) */
                  <Section
                    title="Kontroly výpočtu"
                    count={groupByCode(importantWarnings).length}
                  >
                    <WarningsList
                      warnings={importantWarnings}
                      labels={labels}
                      forfeitedWithholdingCzk={forfeitedWithholdingCzk}
                      // přehled ukazuje jen to, co chce pozornost; report všechno —
                      // odkaz říká, proč tam je kontrol víc (R1B-20)
                      more={
                        infoGroups > 0
                          ? {
                              label: `${infoGroups} ${plural(infoGroups, 'další informace', 'další informace', 'dalších informací')} v reportu`,
                              href: `${basePath}/report?rok=${year}`,
                            }
                          : undefined
                      }
                    />
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
