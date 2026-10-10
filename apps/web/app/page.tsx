import type { Metadata } from 'next';
import Link from 'next/link';
import { compareVariants, type VariantComparison } from '@danero/engine';
import { HorizonStrip } from '@/components/horizon-strip';
import { JsonLd } from '@/components/json-ld';
import { Logo } from '@/components/logo';
import { CONTAINER, MarketingFooter, MarketingHeader } from '@/components/marketing-page';
import { DEMO_NAV_ITEMS } from '@/components/nav-items';
import { SidebarNav } from '@/components/nav-rail';
import { PlatformGrid } from '@/components/platform-catalog';
import { buttonVariants } from '@/components/ui/button';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { OverviewView } from '@/components/views/overview-view';
import { PLATFORM_COUNTS } from '@/lib/brokers-catalog';
import { exemptionOutlook, horizonDots } from '@/lib/charts-data';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { czk, FX_LABEL, METHOD_LABEL } from '@/lib/format';
import { organizationJsonLd } from '@/lib/json-ld';
import { computeNotificationCandidates } from '@/lib/notifications';
import { availableYears, engineInputForUser } from '@/lib/portfolio';
import { currentUser } from '@/lib/session';
import { plainTitle, tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';

// „dnešek“ dema se odvíjí od skutečného data (horizont, upozornění) —
// žádný prerender při buildu; engine výsledek drží sdílená cache s /demo
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Danero — daně z investic pohlídané celý rok',
  description:
    'Danero pohlídá, jestli a kolik máš z investic danit: limit 100 000 Kč, limit paušální daně i tříleté časové testy. V březnu podklady k přiznání včetně XML. Plné demo bez registrace.',
};

/* ── stavební prvky ───────────────────────────────────────────────────────── */

/**
 * Okno aplikace na úvodní stránce. Uvnitř není obrázek, ale tytéž komponenty,
 * které vykreslují přehled v aplikaci — postranní panel se skutečnými odkazy
 * do dema a pracovní plocha nad ukázkovými daty, na kterou se dá klikat.
 * Stín má jen tohle okno: je to jediná věc na stránce, která se vznáší.
 */
function AppWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface text-left shadow-window">
      <div className="flex">
        <div className="material-sidebar hidden w-52 shrink-0 flex-col border-r border-(--material-edge) px-3 pb-5 pt-4 lg:flex">
          {/* ovládání okna v klidové (šedé) podobě — okno je ukázka, ne cíl kliknutí */}
          <div aria-hidden className="flex gap-2 px-2">
            <span className="size-3 rounded-full bg-line" />
            <span className="size-3 rounded-full bg-line" />
            <span className="size-3 rounded-full bg-line" />
          </div>
          <div className="mb-5 mt-6 px-2">
            <Logo className="text-[1.0625rem]" />
          </div>
          <SidebarNav items={DEMO_NAV_ITEMS} activeHref="/demo/prehled" />
        </div>
        <div className="min-w-0 flex-1 px-(--page-gutter) pb-8 pt-(--page-top)">{children}</div>
      </div>
    </div>
  );
}

/** Varianty párování pro úvodní stránku — živý engine nad demo datasetem za
    poslední uzavřený rok (tam se metody skutečně liší). Memo per „dnešek“ dema:
    dataset je pro daný den deterministický a 8 přepočtů stačí jednou denně;
    rok se odvozuje z `today` UVNITŘ, aby klíč memo nemohl lhát. */
let variantsMemoDay: string | undefined;
let variantsMemoValue: VariantComparison | undefined;
function demoVariants(
  today: string,
  dataset: Pick<ReturnType<typeof demoDataset>, 'txs' | 'profile' | 'dailyRates'>,
): VariantComparison {
  if (variantsMemoDay !== today || !variantsMemoValue) {
    const variantYear = Number(today.slice(0, 4)) - 1;
    variantsMemoValue = compareVariants(
      engineInputForUser(dataset.txs, dataset.profile, variantYear, dataset.dailyRates),
    );
    variantsMemoDay = today;
  }
  return variantsMemoValue;
}

type Variant = VariantComparison['variants'][number];

const variantKey = (row: Variant): string => `${row.matchingMethod}-${row.fxMethod}`;

/** Shoda polí, ne identita objektů — přežije i refactor enginu vracející kopii. */
const isRecommended = (row: Variant, recommended: Variant): boolean =>
  row.matchingMethod === recommended.matchingMethod && row.fxMethod === recommended.fxMethod;

/**
 * Porovnání variant párování jako obyčejná tabulka. Na telefonu ukáže jen
 * výtah (`mobileKeys`) a vypustí sloupec základu daně — zbylé řádky a sloupec
 * se objeví od šířky tabletu. Stav řádku je text, ne barevný štítek.
 */
function VariantTable({
  comparison,
  mobileKeys,
}: {
  comparison: VariantComparison;
  mobileKeys: Set<string>;
}) {
  const { variants, recommended } = comparison;
  return (
    <Table>
      <caption className="sr-only">Porovnání variant párování</caption>
      <thead>
        <tr>
          <Th>Metoda</Th>
          <Th>Kurzy</Th>
          {/* „základ daně“ místo paragrafu — úvodní stránka nesmí chtít znalost zákona */}
          <Th align="right" className="hidden sm:table-cell">
            Základ daně
          </Th>
          <Th align="right">Daň</Th>
          <Th>
            <span className="sr-only">Stav</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {variants.map((row) => (
          <Tr key={variantKey(row)} className={cn(!mobileKeys.has(variantKey(row)) && 'hidden sm:table-row')}>
            <Td className="font-medium">{METHOD_LABEL[row.matchingMethod]}</Td>
            <Td className="text-ink-muted">{FX_LABEL[row.fxMethod]}</Td>
            <Td align="right" className="hidden whitespace-nowrap sm:table-cell">
              {czk(row.base10Czk)}
            </Td>
            <Td align="right" className="whitespace-nowrap">
              {czk(row.taxCzk)}
            </Td>
            <Td className="type-caption whitespace-nowrap">
              {/* oba stavy nezávisle (jako v reportu) — „aktivní“ je vlastnost
                  řádku (výchozí FIFO), ne stav vylučující doporučení */}
              {isRecommended(row, recommended) && (
                <span className="font-semibold text-accent-text">nejvýhodnější</span>
              )}
              {isRecommended(row, recommended) && row.matchingMethod === 'FIFO' && ' · '}
              {row.matchingMethod === 'FIFO' && <span className="text-ink-muted">aktivní</span>}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

const TEXT_LINK = 'font-medium text-accent-text hover:underline';

/** Odkaz s šipkou vpřed — vede dál do dema nebo na podstránku. */
function ForwardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center')}>
      {children}
      <span aria-hidden className="ml-1">
        ›
      </span>
    </Link>
  );
}

/**
 * Hlavní výzva úvodní stránky. Služba běží veřejně — žádný režim „otevřeme někdy“.
 *
 * Přihlášenému nabízí vstup do aplikace: na vlastní úvodní stránku se dá
 * doklikat z patičky, z ceníku i z odkazu v e-mailu a „Založit účet zdarma“
 * by ho poslalo na registraci, kterou už má za sebou.
 */
function SignupCta({ className, signedIn }: { className: string; signedIn: boolean }) {
  return signedIn ? (
    <Link href="/prehled" className={className}>
      Přejít do aplikace
    </Link>
  ) : (
    <Link href="/registrace" className={className}>
      Založit účet zdarma
    </Link>
  );
}

/* ── obsah ────────────────────────────────────────────────────────────────── */

const FACTS = [
  // přesně „XML podání“ — podatelna ověřuje strukturu podání, ne věcnou
  // správnost výpočtů (nález V-5 právního auditu; detail vysvětluje FAQ)
  'XML podání ověřená zkušební podatelnou EPO',
  'Počítáme opatrně — a ukážeme, kolik by šlo ušetřit',
  'API klíče jen pro čtení, šifrované AES-256-GCM',
  'Plné demo bez registrace',
] as const;

const STEPS = [
  {
    title: 'Připoj svého brokera',
    body: `Trading 212, Interactive Brokers i Lynx živě přes API klíč jen pro čtení — žádná hesla, žádné právo obchodovat. Odjinud nahraješ výpis: z ${PLATFORM_COUNTS.file} platforem ho čteme automaticky, od XTB a Degiro po eToro, Schwab, Portu nebo Coinbase; u ${PLATFORM_COUNTS.template} dalších tě provedeme univerzální šablonou.`,
  },
  {
    title: 'Danero hlídá celý rok',
    body: 'Limity a časové testy přepočítáváme denně nad celou historií účtu. Když se něco děje, dáme ti vědět — dřív, než je pozdě.',
  },
  {
    title: 'V březnu stáhneš podklady',
    body: 'Podklady k přiznání s průvodcem, co kam zapsat, a XML pro podatelnu mojedane.cz. Osvobozené příjmy do přiznání nepatří — i to pohlídáme.',
  },
] as const;

const SECTION = 'mt-28 md:mt-40';
const SECTION_TITLE = 'type-title-1 max-w-[22ch] text-balance';
const SECTION_BODY = 'type-lede mt-5 max-w-[52ch] text-pretty text-ink-muted';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ smazano?: string }>;
}) {
  // jediné místo, kam uživatel po nevratném smazání účtu doputuje — bez
  // potvrzení by nevěděl, jestli se smazání povedlo
  const { smazano } = await searchParams;
  // úvodní stránka zůstává přístupná i přihlášenému (odkazy z patičky, ceníku,
  // e-mailů) — jen mu nabízí vstup do aplikace místo registrace
  const signedIn = Boolean(await currentUser());
  // živá data = stejný deterministický dataset a stejný čistý engine jako demo
  // prohlídka — stránka ukazuje skutečné komponenty aplikace
  const today = demoToday();
  const { txs, profile, prices, dailyRates } = demoDataset(today);
  const year = Number(today.slice(0, 4));
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, year, today);
  const { result, positions, labels } = analysis;
  const candidates = computeNotificationCandidates({ result, positions, labels, today });
  // ukázky upozornění: blížící se osvobození + prolomený / těsný limit z hlídače
  const alerts = [
    { candidate: candidates.find((c) => c.dedupeKey.startsWith('tt30|')), dot: 'bg-success' },
    {
      candidate: candidates.find((c) => c.dedupeKey.startsWith('limit|50k|EXCEEDED')),
      dot: 'bg-danger',
    },
    {
      candidate: candidates.find((c) => c.dedupeKey.startsWith('limit|100k|CRITICAL')),
      dot: 'bg-warning',
    },
  ].flatMap(({ candidate, dot }) => (candidate ? [{ candidate, dot }] : []));
  // tabulka variant za poslední uzavřený rok — živě z enginu, žádná zamrzlá čísla
  const variantYear = year - 1;
  const comparison = demoVariants(today, { txs, profile, dailyRates });
  const variantRow = (method: Variant['matchingMethod'], fx: Variant['fxMethod']) =>
    comparison.variants.find((v) => v.matchingMethod === method && v.fxMethod === fx);
  // mobilní výtah: FIFO (aktivní default) v obou kurzech + VŽDY doporučený řádek —
  // jinak by „nejvýhodnější“ mohlo z mobilu tiše zmizet, až se dataset posune
  const mobileRows = [variantRow('FIFO', 'UNIFIED'), variantRow('FIFO', 'CNB_DAILY')].filter(
    (row): row is Variant => row !== undefined,
  );
  if (!mobileRows.some((row) => isRecommended(row, comparison.recommended))) {
    mobileRows.push(comparison.recommended);
  } else {
    const lifo = variantRow('LIFO', 'UNIFIED');
    if (lifo) mobileRows.push(lifo);
  }

  return (
    <div className="flex min-h-svh flex-col bg-surface">
      <JsonLd data={organizationJsonLd()} />
      <MarketingHeader />

      <main id="obsah" className={cn(CONTAINER, 'flex-1 pb-(--band-y-lg)')}>
        {smazano === '1' && (
          <p role="status" className="type-callout mt-6 rounded-xl bg-canvas px-5 py-4">
            <span className="font-semibold">Účet byl smazán.</span> Všechna tvoje data —
            transakce, profily i šifrované API klíče — jsou nenávratně pryč. Díky, žes
            Danero zkusil; kdyby ses vrátil, začneš s čistým štítem.
          </p>
        )}

        {/* ── úvod: jedna věta, jedna akce a pod nimi samotná aplikace ─────── */}
        <section aria-labelledby="hero-nadpis" className="pt-14 text-center md:pt-24">
          {/* dvě věty, dva řádky: druhá je tišší a na širokém okně se neláme */}
          <h1 id="hero-nadpis" className="type-display text-balance">
            {tidy('Daně z investic hlídáme za tebe.')}{' '}
            <span className="block text-ink-muted">
              {/* „ne jen“ a „v březnu“ se nesmí rozpadnout */}
              {'Celý rok, ne\u00a0jen v\u00a0březnu.'}
            </span>
          </h1>
          <p className="type-lede mx-auto mt-6 max-w-[50ch] text-pretty text-ink-muted">
            {tidy(
              'Danero pohlídá, jestli a kolik máš z investic danit — a ozve se dřív, než tě prodej nebo dividenda bude stát daň navíc. V březnu stáhneš hotové podklady k přiznání včetně XML.',
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              href="/demo/prehled"
              className={buttonVariants({ variant: 'primary', size: 'lg' })}
            >
              Vyzkoušet demo — bez registrace
            </Link>
            <SignupCta
              className={cn(TEXT_LINK, 'inline-flex min-h-11 items-center')}
              signedIn={signedIn}
            />
          </div>
          <p className="type-footnote mx-auto mt-4 text-balance text-ink-muted">
            Celé Danero je zdarma. Nevíš, jestli se tě přiznání vůbec týká?{' '}
            <Link href="/kalkulacka" className={TEXT_LINK}>
              Zjisti to za minutu v kalkulačce
            </Link>
            .
          </p>

          {/* skutečný přehled nad ukázkovými daty — žádný snímek obrazovky */}
          <div className="mt-14 md:mt-20">
            <AppWindow>
              <OverviewView
                txs={txs}
                analysis={analysis}
                prices={prices}
                years={availableYears(txs, year)}
                year={year}
                today={today}
                notifications={[]}
                basePath="/demo"
                preview
              />
            </AppWindow>
            <p className="type-footnote mx-auto mt-6 text-balance text-ink-muted">
              {tidy(
                'Tohle není obrázek, ale přehled z dema nad ukázkovým portfoliem. Klikni na kterýkoli limit a uvidíš, jak se během roku plnil.',
              )}
            </p>
          </div>
        </section>

        {/* ── ověřitelná důvěra: žádná velká čísla, jen co si ověříš ───────── */}
        <section aria-label="Ověřitelná důvěra" className="mt-20 md:mt-28">
          <ul className="grid gap-x-10 border-t border-line/70 sm:grid-cols-2 lg:grid-cols-4">
            {FACTS.map((fact) => (
              <li
                key={fact}
                className="type-callout border-b border-line/70 py-4 font-medium text-pretty lg:border-b-0 lg:pb-0 lg:pt-5"
              >
                {tidy(fact)}
              </li>
            ))}
          </ul>
        </section>

        {/* ── hlídání limitů: živá upozornění z hlídače ────────────────────── */}
        <section aria-labelledby="limity-nadpis" className={SECTION}>
          <div className="grid items-start gap-x-16 gap-y-10 lg:grid-cols-2">
            <div>
              <h2 id="limity-nadpis" className={SECTION_TITLE}>
                O limitu se dozvíš, dokud se s ním dá něco dělat
              </h2>
              <p className={SECTION_BODY}>
                {tidy(
                  'Limit 100 000 Kč z prodejů i limit 50 000 Kč pro paušální daň, do kterého se počítají i zahraniční dividendy, na které se zapomíná. Čerpání vidíš celý rok a při 60, 85 a 100 % ti přijde e-mail — další prodej si rozmyslíš, nebo ho necháš na leden.',
                )}
              </p>
            </div>
            {alerts.length > 0 && (
              <div className="lg:pt-2">
                <h3 className="type-footnote font-medium text-ink-muted">
                  Upozornění z hlídače — takhle vypadá e-mail, který ti v tu chvíli pošleme
                </h3>
                <ul className="mt-3 divide-y divide-line/70 border-t border-line/70">
                  {alerts.map(({ candidate, dot }) => (
                    <li key={candidate.dedupeKey} className="flex gap-3 py-4">
                      <span
                        aria-hidden
                        className={cn('mt-[0.45rem] size-2 shrink-0 rounded-full', dot)}
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{tidy(plainTitle(candidate.title))}</p>
                        <p className="type-callout mt-1 line-clamp-3 text-ink-muted">
                          {tidy(candidate.body)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* ── horizont osvobození (živý, přes celou šířku) ─────────────────── */}
        <section aria-labelledby="horizont-nadpis" className={SECTION}>
          <h2 id="horizont-nadpis" className={SECTION_TITLE}>
            Počkej pár týdnů — a prodej bez daně
          </h2>
          <p className={SECTION_BODY}>
            {tidy(
              'Po třech letech držení je prodej osvobozený. Každý tvůj nákup putuje po časové ose k vlastnímu datu osvobození a e-mail ti přijde 30 a 7 dní předem. Vyzkoušej: tečky níže jsou živé.',
            )}
          </p>
          <div className="mt-10 border-t border-line/70 pt-6">
            <HorizonStrip
              dots={horizonDots(positions, labels, prices, year)}
              today={today}
              outlook={exemptionOutlook(positions, prices, today, year)}
              embedded
            />
          </div>
          <p className="mt-4">
            <ForwardLink href="/demo/prehled">Vyzkoušej si živé tečky v demu</ForwardLink>
          </p>
        </section>

        {/* ── podklady k přiznání ───────────────────────────────────────────── */}
        <section aria-labelledby="podklady-nadpis" className={SECTION}>
          <div className="grid items-start gap-x-16 gap-y-10 lg:grid-cols-2">
            <div>
              <h2 id="podklady-nadpis" className={SECTION_TITLE}>
                Žádná černá skříňka
              </h2>
              <p className={SECTION_BODY}>
                {tidy(
                  'FIFO (nejstarší kusy první) i další metody párování vidíš vedle sebe, s daní spočtenou pro každou zvlášť — bezpečný výklad je výchozí a u sporných míst ti ukážeme, co by výhodnější znamenal.',
                )}
              </p>
              <p className="mt-5 max-w-[58ch] text-pretty text-ink-muted">
                {tidy(
                  'V březnu stáhneš průvodce, co kam zapsat, po řádcích přiznání — a XML pro podatelnu mojedane.cz, jehož strukturu ověřujeme vzorovými podáními ve zkušební podatelně EPO (struktura pro rok 2026 vyjde začátkem 2027 — ověřujeme každý rok).',
                )}
              </p>
              <p className="mt-3 max-w-[58ch] text-pretty text-ink-muted">
                {tidy(
                  'Zápočet zahraniční srážky po státech (Příloha č. 3) včetně smluvních stropů — třeba Nizozemsko má 10 %, ne 15. Excel tohle nehlídá.',
                )}
              </p>
            </div>
            {/* živá tabulka — čísla počítá engine z demo datasetu za poslední
                uzavřený rok (žádná zamrzlá) */}
            <div className="lg:pt-2">
              <h3 className="type-footnote font-medium text-ink-muted">
                Porovnání variant párování za rok {variantYear}
              </h3>
              <div className="mt-3">
                <VariantTable
                  comparison={comparison}
                  mobileKeys={new Set(mobileRows.map(variantKey))}
                />
              </div>
              <p className="type-footnote mt-4 text-ink-muted">
                Skutečná čísla z{' '}
                <Link href={`/demo/report?rok=${variantYear}`} className={TEXT_LINK}>
                  demo reportu za rok {variantYear}
                </Link>{' '}
                — celou tabulku (4 metody × 2 kurzy) si projdeš v demu.
              </p>
            </div>
          </div>
        </section>

        {/* ── jak to funguje: skutečná posloupnost → číslování dává smysl ──── */}
        <section id="jak-to-funguje" aria-labelledby="kroky-nadpis" className={SECTION}>
          <h2 id="kroky-nadpis" className={SECTION_TITLE}>
            Tři kroky, pak už jen investuješ
          </h2>
          <ol className="mt-10 border-b border-line/70">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="grid gap-x-10 gap-y-2 border-t border-line/70 py-7 md:grid-cols-[3rem_minmax(0,18rem)_minmax(0,1fr)]"
              >
                <span aria-hidden className="type-title-2 tabular-nums text-ink-muted">
                  {index + 1}
                </span>
                <h3 className="type-title-2">{step.title}</h3>
                <p className="max-w-[60ch] text-pretty text-ink-muted">{tidy(step.body)}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── platformy: plná šířka nabídky ────────────────────────────────── */}
        <section aria-labelledby="brokeri-nadpis" className={SECTION}>
          <h2 id="brokeri-nadpis" className={SECTION_TITLE}>
            Odkud umíme načíst obchody
          </h2>
          <p className={SECTION_BODY}>
            {tidy(
              'Trading 212, Interactive Brokers a Lynx živě přes API. Výpisy z dalších platforem čteme automaticky — a u českých bank a fondů tě provedeme univerzální šablonou. U každé platformy máme návod, kde přesně výpis stáhnout.',
            )}
          </p>
          <div className="mt-10">
            <PlatformGrid limit={9} />
          </div>
          <p className="mt-4">
            <ForwardLink href="/platformy">
              Všechny platformy s návody, kde výpis stáhnout
            </ForwardLink>
          </p>
        </section>

        {/* ── ceník: jedna věta — podrobnosti má vlastní stránka /cenik ────── */}
        <section id="cenik" aria-labelledby="cenik-nadpis" className={SECTION}>
          <div className="grid items-start gap-x-16 gap-y-6 lg:grid-cols-2">
            <h2 id="cenik-nadpis" className={SECTION_TITLE}>
              Danero je zdarma. Celé.
            </h2>
            <div className="lg:pt-2">
              <p className="type-lede max-w-[52ch] text-pretty text-ink-muted">
                {tidy(
                  'Import výpisů, limity a časové testy, podklady k přiznání včetně XML, napojení na brokery i hlídací e-maily — bez placené verze, bez zkušební doby a bez karty. Je to osobní projekt s otevřeným kódem.',
                )}
              </p>
              <p className="mt-3">
                <ForwardLink href="/cenik">Co všechno dostaneš a proč je to zdarma</ForwardLink>
              </p>
            </div>
          </div>
        </section>

        {/* ── závěrečná výzva ───────────────────────────────────────────────── */}
        <section
          aria-labelledby="zaver-nadpis"
          className="mt-28 border-t border-line/70 pt-20 text-center md:mt-40 md:pt-28"
        >
          <h2 id="zaver-nadpis" className="type-title-1 mx-auto max-w-[20ch] text-balance">
            Prohlédni si Danero zevnitř — hned teď
          </h2>
          <p className="type-lede mx-auto mt-5 max-w-[50ch] text-pretty text-ink-muted">
            {/* číslo hlídá test demo datasetu („50+ oceněných pozic v hodnotě
                přes 2,3 mil. Kč“) — dřív tu stál odhad „zhruba 2 miliony“,
                přitom hodnotu jde spočítat (nález E-48) */}
            {tidy(
              'Demo běží nad vzorovým portfoliem s 50+ pozicemi za víc než 2,3 milionu Kč: ukazatele limitů, horizont osvobození, simulátor i report. Bez registrace, nic se neukládá.',
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/demo/prehled"
              className={buttonVariants({ variant: 'primary', size: 'lg' })}
            >
              Vyzkoušet demo — bez registrace
            </Link>
            <SignupCta
              className={buttonVariants({ variant: 'secondary', size: 'lg' })}
              signedIn={signedIn}
            />
          </div>
          <p className="type-footnote mt-6 text-ink-muted">
            Stačí e-mail. Kartu po tobě nikdy chtít nebudeme. Ještě něco nevíš? Projdi si{' '}
            <Link href="/caste-otazky" className={TEXT_LINK}>
              časté otázky
            </Link>{' '}
            nebo se podívej,{' '}
            <Link href="/o-projektu" className={TEXT_LINK}>
              kdo za Danerem stojí
            </Link>
            .
          </p>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
