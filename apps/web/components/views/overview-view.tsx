import Link from 'next/link';
import type { LimitStatus } from '@danero/engine';
import { filingDeadlines } from '@danero/engine';
import type { Transaction } from '@danero/shared';
import { AppToolbar } from '@/components/app-toolbar';
import { LimitDrawdownChart } from '@/components/charts';
import { filingLimitFor, filingVerdictHeadline } from '@/components/filing-verdict';
import { HorizonStrip } from '@/components/horizon-strip';
import { LimitBar, ZONE_LABEL, ZONE_TEXT } from '@/components/limit-gauge';
import { LimitsInspector, type LimitEntry } from '@/components/limits-inspector';
import { PositionsTable } from '@/components/positions-table';
import { TaxYearConfigNotice } from '@/components/tax-year-config-notice';
import { buttonVariants } from '@/components/ui/button';
import { Table, Td, Th, Tr } from '@/components/ui/table';
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
import { unpaidUnderLimitCzk } from '@/lib/payable-tax';
import { instrumentNames, type YearAnalysis } from '@/lib/portfolio';
import type { InstrumentPrice } from '@/lib/prices';
import { tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';

/** Upozornění pro seznam „Poslední upozornění“ — DB řádek i demo kandidát. */
export interface PrehledNotification {
  dedupeKey: string;
  title: string;
  body: string;
  createdAt: Date;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Titulky upozornění vznikají v hlídači (`lib/notifications`) a jdou i do
 * e-mailu, kde si obrázkový znak nechávají. V přehledu je seznam střízlivý —
 * stav nese text a datum, ne piktogram.
 */
export const plainTitle = (title: string): string =>
  title.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/\s+/g, ' ').trim();

/** Řádek seznamu limitů: název a procento, pod nimi odměrka a čerpání. */
function LimitRow({ name, status }: { name: string; status: LimitStatus }) {
  return (
    <span className="block">
      <span className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{name}</span>
        <span className={cn('font-semibold tabular-nums', ZONE_TEXT[status.zone])}>
          {pct(status.ratio * 100)}
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
        <span className="font-semibold text-danger">bez limitu</span>
      </span>
      <span className="type-footnote mt-2 flex items-baseline justify-between gap-4 text-ink-muted">
        <span className="tabular-nums">{proceeds} zdanitelných tržeb</span>
        <span className="text-danger">daní se každý prodej</span>
      </span>
    </span>
  );
}

/**
 * Detail limitu v inspektoru: celý název s částkou, kolik zbývá (nebo o kolik
 * je limit překročený), průběh čerpání v roce a vysvětlení.
 */
function LimitDetail({
  label,
  status,
  hint,
  chart,
}: {
  label: string;
  status: LimitStatus;
  hint: string;
  chart?: { caption: string; node: React.ReactNode };
}) {
  const difference = status.limitCzk.sub(status.usedCzk).abs();
  return (
    <div>
      {/* V úzkém okně stojí detail hned pod svým řádkem, takže by nadpis jen
          opakoval jeho název — vidět je až v inspektoru vedle seznamu. */}
      <h3 className="type-title-3 sr-only @3xl:not-sr-only">{label}</h3>
      <p className="@3xl:mt-3">
        <span className={cn('type-figure', status.exceeded && 'text-danger')}>
          {czk(difference)}
        </span>{' '}
        <span className="type-callout text-ink-muted">
          {status.exceeded ? 'nad limitem' : 'zbývá do limitu'}
        </span>
      </p>
      {chart && (
        <div className="mt-6">
          <p className="type-footnote text-ink-muted">{chart.caption}</p>
          <div className="mt-2">{chart.node}</div>
        </div>
      )}
      <p className="type-footnote mt-6 text-pretty text-ink-muted">{tidy(hint)}</p>
    </div>
  );
}

/**
 * Sdílené tělo přehledu: reálná stránka mu předá data z DB, demo stránka
 * ukázkový dataset. Vše uvnitř jsou čisté výpočty nad hotovou analýzou —
 * žádné I/O. `basePath` směruje odkazy ('' pro aplikaci, '/demo' pro demo).
 *
 * Rozvržení: nástrojová lišta (titulek, rok, hlavní akce) a pod ní pracovní
 * plocha — vlevo odpověď na „musím letos něco řešit?“ a seznam limitů, vpravo
 * inspektor s klíčovými čísly a detailem vybraného limitu. Dál data, se
 * kterými se dá pracovat: výpočet daně, horizont osvobození, kontroly.
 *
 * `preview` vykreslí jen lištu a pracovní plochu — tak přehled stojí v okně
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
  const employeeLimit = czk(result.limits.employee20k.status.limitCzk);
  const generalLimit = czk(result.limits.generalFiling50k.status.limitCzk);

  // Verdikt: limit, jehož prolomení znamená povinnost podat přiznání — výběr
  // podle režimu i znění nadpisu sdílí přehled s reportem (L5-02);
  // OSVČ mimo paušál podává přiznání tak jako tak, verdikt tam nedává smysl.
  const filingLimit = filingLimitFor(result);
  const deadlines = filingDeadlines(year);
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
    { status: result.limits.limit100k, label: 'limit 100 000 Kč pro osvobození prodejů CP' },
  ];
  const nearestLimit = watchedLimits.reduce((a, b) => (b.status.ratio > a.status.ratio ? b : a));
  const estimatedTaxCzk =
    result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;
  // R-09f: pod limitem režimu se orientační daň neplatí — přehled to musí říct
  const unpaidUnderLimit = unpaidUnderLimitCzk(result);
  // R-08f: vyčíslení dopadu prolomení limitu 50k (jen paušál a jen při prolomení)
  const breachImpact = result.limits.flatTax50k.breachImpact;
  const exceeded = filingLimit?.status.exceeded ?? false;

  // Rozpad základu § 10 po druzích — souhrnné „(prodeje)“ mátlo: daň může být
  // jen z derivátů (bez osvobození, R-12c), zatímco prodeje CP/krypto jsou pod limity
  const base10Total = result.securities.base10Czk
    .plus(result.crypto.base10Czk)
    .plus(result.derivatives.base10Czk);
  const base10Parts = [
    { label: 'cenné papíry', value: result.securities.base10Czk },
    { label: 'kryptoaktiva', value: result.crypto.base10Czk },
    { label: 'deriváty', value: result.derivatives.base10Czk },
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

  /* ── seznam limitů a jejich detaily ───────────────────────────────────── */

  const limitEntries: LimitEntry[] = [];
  if (result.limits.flatTax50k.applicable) {
    const { status } = result.limits.flatTax50k;
    limitEntries.push({
      key: 'flat-tax',
      row: <LimitRow name="Limit paušální daně" status={status} />,
      detail: (
        <LimitDetail
          label="Limit paušální daně — 50 000 Kč"
          status={status}
          hint="Platí jen pro paušální daň (§ 7a): úhrn ZDANITELNÝCH příjmů mimo samostatnou činnost (podnikání) — neosvobozené tržby z prodejů CP i kryptoaktiv, plnění z derivátů, zahraniční dividendy (brutto), úroky, nájem. Osvobozené prodeje se nepočítají. Při překročení podáváš přiznání a přehledy — v paušálním režimu ale zůstáváš."
          chart={
            flatTax50kChart && showFlatTax50kChart
              ? {
                  caption:
                    'Čerpání v průběhu roku: zdanitelné příjmy mimo samostatnou činnost (podnikání) — neosvobozené prodeje, zahraniční dividendy, úroky.',
                  node: <LimitDrawdownChart series={flatTax50kChart} name="Zdanitelné příjmy" />,
                }
              : undefined
          }
        />
      ),
    });
  }
  if (result.limits.employee20k.applicable) {
    const { status } = result.limits.employee20k;
    limitEntries.push({
      key: 'employee',
      row: <LimitRow name="Vedlejší příjmy" status={status} />,
      detail: (
        <LimitDetail
          label={`Vedlejší příjmy — ${employeeLimit}`}
          status={status}
          hint="Zdanitelné příjmy vedle zaměstnání — investice, nájmy i vlastní výdělek ze samostatné činnosti (§ 7 až 10). Odměrka ukazuje jen to, co Danero vidí z výpisů a z tvého nastavení; příjmy z podnikání do limitu patří taky, ale my o nich nevíme. Při překročení podáváš přiznání."
        />
      ),
    });
  }
  // režim „jiné“: obecný limit § 38g — verdikt s ním počítá, takže má i řádek
  if (result.limits.generalFiling50k.applicable) {
    const { status } = result.limits.generalFiling50k;
    limitEntries.push({
      key: 'general',
      row: <LimitRow name="Podání přiznání" status={status} />,
      detail: (
        <LimitDetail
          label={`Podání přiznání — ${generalLimit}`}
          status={status}
          hint={`Obecný limit (§ 38g): zdanitelné příjmy do ${generalLimit} za rok bez povinnosti podat přiznání. Při překročení přiznání podáváš.`}
        />
      ),
    });
  }
  if (result.limits.limit100k.applicable) {
    const status = result.limits.limit100k;
    limitEntries.push({
      key: 'securities',
      row: <LimitRow name="Osvobození prodejů cenných papírů" status={status} />,
      detail: (
        <LimitDetail
          label="Osvobození prodejů cenných papírů — 100 000 Kč"
          status={status}
          hint="Do 100 000 Kč tržeb z prodeje cenných papírů za rok (§ 4 odst. 1 písm. t) jsou VŠECHNY osvobozené, i bez 3 let držení. Nad limit se daní prodeje bez splněného časového testu. Neplatí pro cenné papíry zahrnuté v obchodním majetku."
          chart={
            showLimit100kChart
              ? {
                  caption:
                    'Čerpání v průběhu roku: kumulativní tržby z prodejů CP; přerušované čáry = pásma 60/85/100 %.',
                  node: <LimitDrawdownChart series={limit100kChart} name="Tržby z prodejů" />,
                }
              : undefined
          }
        />
      ),
    });
  } else {
    /* R-02f: s cennými papíry v obchodním majetku osvobození neexistuje —
       pool je nulový, takže odměrka hlásila „0 / 100 000, v pořádku“ přesně
       tam, kde se daní každý prodej (nález A1-3-04) */
    limitEntries.push({
      key: 'securities',
      row: (
        <NoExemptionRow
          name="Cenné papíry v obchodním majetku"
          proceeds={czk(result.securities.totalGrossProceedsCzk)}
        />
      ),
      detail: (
        <div>
          <h3 className="type-title-3">Obchodní majetek: osvobození neexistuje</h3>
          <p className="type-footnote mt-3 text-ink-muted">
            Máš v nastavení uvedeno, že cenné papíry patří do tvého obchodního majetku.
            Roční limit 100 000 Kč ani tříletý časový test se na ně nevztahují (§ 4 odst.
            1 písm. t a u) — a neplatí ani tři roky po ukončení činnosti.
          </p>
        </div>
      ),
    });
  }
  if (hasCrypto) {
    if (result.limits.cryptoLimit100k.applicable) {
      const status = result.limits.cryptoLimit100k;
      limitEntries.push({
        key: 'crypto',
        row: <LimitRow name="Osvobození krypta" status={status} />,
        detail: (
          <LimitDetail
            label="Osvobození krypta — 100 000 Kč"
            status={status}
            hint="Samostatný limit pro kryptoaktiva (§ 4 odst. 1 písm. zj zákona o daních z příjmů), nezávislý na limitu pro cenné papíry: jsou-li tržby z prodejů a směn krypta za rok do 100 000 Kč, jsou osvobozené. Neplatí pro stablecoiny (elektronické peněžní tokeny) a pro příjmy před 15. 2. 2025."
          />
        ),
      });
    } else {
      /* R-10b: do roku 2024 krypto žádné osvobození nemá — odměrka
         „0 / 100 000, v pořádku“ by tvrdila pravý opak toho, co platí */
      limitEntries.push({
        key: 'crypto',
        row: (
          <NoExemptionRow
            name={`Krypto ${year}`}
            proceeds={czk(result.crypto.totalGrossProceedsCzk)}
          />
        ),
        detail: (
          <div>
            <h3 className="type-title-3">Krypto {year}: osvobození neexistuje</h3>
            <p className="type-footnote mt-3 text-ink-muted">
              Roční limit 100 000 Kč ani tříletý časový test pro kryptoaktiva za rok {year}{' '}
              neplatí — zavedl je až zákon č. 32/2025 Sb. s účinností od 15. 2. 2025.
              Zdanitelný je proto každý prodej i směna, bez ohledu na výši tržeb a dobu držení.
            </p>
          </div>
        ),
      });
    }
  }

  /* ── odpověď (vlevo nahoře) ───────────────────────────────────────────── */

  const lead = (
    <div className="pb-10">
      {filingLimit ? (
        <>
          {/* stav jednou větou a barvou — tečka je jen zdvojení barvy textu */}
          <p
            className={cn(
              'type-callout flex items-center gap-2 font-medium',
              ZONE_TEXT[filingLimit.status.zone],
            )}
          >
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />
            {`${capitalize(filingLimit.label)} — ${ZONE_LABEL[filingLimit.status.zone]}`}
          </p>
          <h2 className="type-title-1 mt-3 text-balance">
            {filingVerdictHeadline({ year, exceeded })}
          </h2>
          <p className="mt-4 max-w-[58ch] text-pretty text-ink-muted">
            {exceeded ? (
              filesElectronicallyOnly ? (
                tidy(
                  `Termín podání je ${czDate(deadlines.electronic)}. Jako OSVČ máš datovou schránku zřízenou ze zákona, takže se přiznání podává jen elektronicky (§ 72 odst. 6 daňového řádu) a platí pro tebe čtyřměsíční lhůta.`,
                )
              ) : (
                `Přiznání podáš písemně do ${czDate(deadlines.paper)}, elektronicky do ${czDate(deadlines.electronic)}.`
              )
            ) : (
              // bez `tidy`: znění hlídá test a nezlomitelné mezery by ho změnily
              `Limity hlídáme denně. Nejblíž je ${nearestLimit.label} — čerpáno ${pct(nearestLimit.status.ratio * 100)}.`
            )}
          </p>
          {breachImpact && (
            <p className="type-footnote mt-3 max-w-[62ch] text-pretty text-ink-muted">
              {tidy(
                'Doplatek je orientační a jen z investic — daň z podnikání (§ 7) Danero nevidí. K tomu přibude přehled ČSSZ a zdravotní pojišťovně a doplatek pojistného ze skutečných příjmů; ten spočítat neumíme, protože neznáme tvůj základ z § 7.',
              )}
            </p>
          )}
        </>
      ) : (
        <h2 className="type-title-1 text-balance">Daně z investic za rok {year}</h2>
      )}
    </div>
  );

  /* ── klíčová čísla (vpravo nahoře) ────────────────────────────────────── */

  const figureLabel = 'type-footnote text-ink-muted';
  const aside = (
    <dl className="divide-y divide-line/70 pb-10 [&>div]:py-4 [&>div:first-child]:pt-0">
      {breachImpact ? (
        /* R-08f: „kolik mě to bude stát“ je hlavní otázka za prolomením
           limitu 50k — engine ji vyčíslí, tohle je její místo v UI */
        <div>
          <dt className={figureLabel}>Doplatek daně</dt>
          <dd className="type-figure-lg mt-1">{czk(breachImpact.additionalTaxCzk)}</dd>
          <dd className="type-footnote mt-3 space-y-1 text-ink-muted">
            <span className="flex justify-between gap-4">
              <span>Daň z investic (§ 8 + § 10)</span>
              <span className="tabular-nums text-ink">{czk(breachImpact.taxCzk)}</span>
            </span>
            <span className="flex justify-between gap-4">
              <span>
                − zaplacené zálohy na daň
                {breachImpact.monthlyAdvanceCzk &&
                  ` (z paušální zálohy ${czk(breachImpact.monthlyAdvanceCzk)}/měs.)`}
              </span>
              <span className="tabular-nums text-ink">{czk(breachImpact.advancesCreditCzk)}</span>
            </span>
          </dd>
        </div>
      ) : (
        <div>
          <dt className={figureLabel}>Orientační daň z investic</dt>
          <dd className="type-figure-lg mt-1">{czk(estimatedTaxCzk)}</dd>
          {/* R-09f (L24-02): pod limitem režimu se tahle daň neplatí — bez
              téhle věty stála částka hned vedle verdiktu „povinnost
              nevzniká“ a vypadala jako dluh */}
          {unpaidUnderLimit && estimatedTaxCzk.gt(0) && (
            <dd className="type-footnote mt-2 text-ink">
              Platí se jen při podání přiznání. Dokud jsi pod limitem{' '}
              {czk(unpaidUnderLimit)}, přiznání nepodáváš a tuhle daň neplatíš — počítáme
              jen s příjmy, o kterých Danero ví.
            </dd>
          )}
        </div>
      )}
      {filingLimit && exceeded && (
        <div>
          <dt className={figureLabel}>Termín podání</dt>
          <dd className="type-figure mt-1">{czDate(deadlines.electronic)}</dd>
          <dd className="type-footnote mt-1 text-ink-muted">
            {filesElectronicallyOnly
              ? 'jen elektronicky'
              : `elektronicky; písemně do ${czDate(deadlines.paper)}`}
          </dd>
        </div>
      )}
      {filingLimit && !exceeded && (
        <div>
          <dt className={figureLabel}>Nejbližší limit</dt>
          <dd className="type-figure mt-1">{pct(nearestLimit.status.ratio * 100)}</dd>
          <dd className="type-footnote mt-1 text-ink-muted">
            {czk(nearestLimit.status.usedCzk)} z {czk(nearestLimit.status.limitCzk)}
          </dd>
        </div>
      )}
    </dl>
  );

  const toolbar = (
    <AppToolbar
      title="Přehled"
      subtitle={`${txs.length} ${plural(txs.length, 'transakce', 'transakce', 'transakcí')} · ${
        METHOD_LABEL[result.options.matchingMethod] ?? result.options.matchingMethod
      } · ${result.options.fxMethod === 'UNIFIED' ? 'jednotný kurz' : 'denní kurzy ČNB'}`}
      pinned={!preview}
      actions={
        exceeded && (
          <Link
            href={`${basePath}/report`}
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            Připravit podklady
          </Link>
        )
      }
    >
      <YearSwitcher years={years} active={year} hrefBase={`${basePath}/prehled`} />
    </AppToolbar>
  );

  const workspace = (
    <LimitsInspector
      lead={lead}
      aside={aside}
      heading={<h2 className="type-title-2 pb-3">Limity</h2>}
      entries={limitEntries}
    />
  );

  if (preview) {
    return (
      <>
        {toolbar}
        {workspace}
      </>
    );
  }

  const twoColumns =
    'grid gap-y-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,var(--inspector-width))] @3xl:gap-x-(--column-gap)';

  return (
    <>
      {toolbar}
      <div className="max-w-[72rem] space-y-16">
        {/* R-15e: rok, pro který stát ještě nevyhlásil čísla (typicky hned
            1. ledna) — vysvětlení musí být nad odhadem daně, ne pod ním */}
        <TaxYearConfigNotice year={year} pausal={result.limits.flatTax50k.applicable} />

        {workspace}

        {result.options.limit100kIncludesTimeTestExempt &&
          !result.securities.exemptUnder100k &&
          result.securities.totalGrossProceedsCzk
            .sub(result.securities.timeTestExemptProceedsCzk)
            .lte(result.limits.limit100k.limitCzk) && (
            <section className="max-w-[68ch]">
              <h2 className="type-title-3">Mohlo by tě zajímat</h2>
              <p className="mt-2 text-ink-muted">
                Počítáme bezpečným výkladem: do limitu 100k vstupují i prodeje osvobozené
                časovým testem. Podle mírnějšího (sporného) výkladu by tvůj úhrn byl jen{' '}
                <span className="tabular-nums text-ink">
                  {czk(
                    result.securities.totalGrossProceedsCzk.sub(
                      result.securities.timeTestExemptProceedsCzk,
                    ),
                  )}
                </span>{' '}
                a všechny letošní prodeje by byly osvobozené. Výklad si můžeš přepnout
                v Nastavení — rozhodnutí (a riziko) je na tobě.
              </p>
            </section>
          )}

        <section className="@container">
          <h2 className="type-title-2">Orientační daň z investic</h2>
          <div className={cn('mt-5', twoColumns)}>
            <Table>
              <caption className="sr-only">Z čeho se orientační daň z investic počítá</caption>
              <thead>
                <tr>
                  <Th>Položka</Th>
                  <Th align="right">Částka</Th>
                </tr>
              </thead>
              <tbody>
                <Tr>
                  <Td>Základ daně z prodejů (§ 10)</Td>
                  <Td align="right">{czk(base10Total)}</Td>
                </Tr>
                {base10Parts.map((part) => (
                  <Tr key={part.label} className="border-t-0">
                    <Td className="pb-2.5 pl-4 pt-0 text-ink-muted">z toho {part.label}</Td>
                    <Td align="right" className="pb-2.5 pt-0 text-ink-muted">
                      {czk(part.value)}
                    </Td>
                  </Tr>
                ))}
                <Tr>
                  <Td>Základ daně z dividend a úroků (§ 8)</Td>
                  <Td align="right">{czk(result.dividends.base8Czk)}</Td>
                </Tr>
                {/* E-27: nedoporučujeme variantu zdanění § 8 — ukážeme obě čísla
                    a volbu necháme na uživateli (docs/13 V-4) */}
                {result.dividends.base8Czk.gt(0) && (
                  <>
                    <Tr>
                      <Td>Daň v obecném základu</Td>
                      <Td align="right">{czk(result.tax.general.taxCzk)}</Td>
                    </Tr>
                    <Tr>
                      <Td>Daň v samostatném základu (§ 16a)</Td>
                      <Td align="right">{czk(result.tax.separate16a.taxCzk)}</Td>
                    </Tr>
                  </>
                )}
                <Tr className="border-line-control">
                  <Td className="font-semibold">Orientační daň z investic</Td>
                  <Td align="right" className="font-semibold">
                    {czk(estimatedTaxCzk)}
                  </Td>
                </Tr>
              </tbody>
            </Table>
            <div className="type-footnote max-w-[68ch] space-y-3 text-ink-muted @3xl:border-l @3xl:border-line/70 @3xl:pl-(--column-gap)">
              {exemptNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              <p>{result.tax.note}</p>
              {result.dividends.base8Czk.gt(0) && (
                <p>
                  Obě daně z dividend a úroků jsou před slevami — variantu zdanění volíš
                  v přiznání.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* H4: graf a tabulka jsou dvě zobrazení téže informace — jednotný
            nadpis, přepínač pohledu; default graf (bez JS se vykreslí ten).
            Bez otevřených pozic by přepínač stál nad prázdnem — místo něj
            poctivý prázdný stav. */}
        <section>
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
                      basePath={basePath}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <>
              <h2 className="type-title-2">Horizont osvobození</h2>
              <p className="mt-2 max-w-[58ch] text-ink-muted">
                Žádné otevřené pozice — jakmile nějakou koupíš, uvidíš tady, kdy se
                osvobodí od daně (3letý časový test).
              </p>
            </>
          )}
        </section>

        {(importantWarnings.length > 0 || notifications.length > 0) && (
          <div className="@container">
            <div className="grid gap-x-(--column-gap) gap-y-16 @3xl:grid-cols-2">
              {importantWarnings.length > 0 && (
                <section>
                  {/* počet = zobrazené skupiny, ne surová varování — „10“ nad
                      třemi bloky mátlo; násobnost nese detail skupiny („8×“) */}
                  <h2 className="type-title-2">
                    Kontroly výpočtu{' '}
                    <span className="font-normal text-ink-muted">
                      {groupByCode(importantWarnings).length}
                    </span>
                  </h2>
                  <div className="mt-4">
                    <WarningsList
                      warnings={importantWarnings}
                      labels={labels}
                      forfeitedWithholdingCzk={forfeitedWithholdingCzk}
                    />
                  </div>
                </section>
              )}

              {notifications.length > 0 && (
                <section>
                  <h2 className="type-title-2">Poslední upozornění</h2>
                  <ul className="mt-4 divide-y divide-line/70">
                    {notifications.map((notification) => (
                      <li key={notification.dedupeKey} className="py-3 first:pt-0">
                        <p className="flex items-baseline justify-between gap-4">
                          <span className="font-medium">{plainTitle(notification.title)}</span>
                          <span className="type-caption shrink-0 tabular-nums text-ink-muted">
                            {czDate(notification.createdAt)}
                          </span>
                        </p>
                        <p className="type-callout mt-1 text-ink-muted">{notification.body}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
