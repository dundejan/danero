import type { Metadata } from 'next';
import Link from 'next/link';
import { compareVariants, type VariantComparison } from '@danero/engine';
import { HorizonStrip } from '@/components/horizon-strip';
import { JsonLd } from '@/components/json-ld';
import { Logo } from '@/components/logo';
import { SpecList, SpecRow, Split } from '@/components/marketing-blocks';
import { Band, BandHeading, MarketingPage } from '@/components/marketing-page';
import { DEMO_NAV_ITEMS } from '@/components/nav-items';
import { SidebarNav } from '@/components/nav-rail';
import { buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { Notice } from '@/components/ui/notice';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { OverviewView } from '@/components/views/overview-view';
import { PLATFORM_COUNTS, PLATFORMS, type PlatformInfo } from '@/lib/brokers-catalog';
import { exemptionOutlook, horizonDots } from '@/lib/charts-data';
import { demoDataset, demoToday, DEMO_USER_ID } from '@/lib/demo-data';
import { analyzeForUserCached } from '@/lib/engine-cache';
import { czk, FX_LABEL, METHOD_LABEL } from '@/lib/format';
import { organizationJsonLd } from '@/lib/json-ld';
import { SOURCE_URL } from '@/lib/legal';
import { availableYears, engineInputForUser } from '@/lib/portfolio';
import { currentUser } from '@/lib/session';
import { tidy } from '@/lib/typography';

// „dnešek“ dema se odvíjí od skutečného data (horizont, limity) —
// žádný prerender při buildu; engine výsledek drží sdílená cache s /demo
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Danero — hlídač daní z investic, zdarma a s otevřeným kódem',
  description:
    'Danero z tvých obchodů počítá, jestli a kolik máš z investic danit: limit 100 000 Kč, limit paušální daně i tříleté časové testy. Připraví podklady k přiznání včetně XML. Celé zdarma, bez karty; demo bez registrace.',
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
 * Výtah z porovnání variant: výchozí metoda v obou kurzech a nejvýhodnější
 * řádek. Celou tabulku (4 metody × 2 kurzy) má demo report — tady stačí
 * ukázat, že tatáž data dají podle metody jinou daň. Stav řádku je text,
 * ne barevný štítek.
 */
function VariantTable({ rows, recommended }: { rows: Variant[]; recommended: Variant }) {
  return (
    <Table>
      <caption className="sr-only">Daň podle metody párování a kurzu</caption>
      <thead>
        <tr>
          <Th>Metoda</Th>
          <Th>Kurz</Th>
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
        {rows.map((row) => (
          <Tr key={variantKey(row)}>
            <Td className="font-medium">{METHOD_LABEL[row.matchingMethod]}</Td>
            <Td className="text-ink-muted">{FX_LABEL[row.fxMethod]}</Td>
            <Td align="right" className="hidden whitespace-nowrap sm:table-cell">
              {czk(row.base10Czk)}
            </Td>
            <Td align="right" className="whitespace-nowrap">
              {czk(row.taxCzk)}
            </Td>
            <Td className="type-caption whitespace-nowrap">
              {/* oba stavy nezávisle (jako v reportu) — „výchozí“ je vlastnost
                  řádku (FIFO), ne stav vylučující doporučení */}
              {isRecommended(row, recommended) && (
                <span className="font-semibold text-accent-text">nejvýhodnější</span>
              )}
              {isRecommended(row, recommended) && row.matchingMethod === 'FIFO' && ' · '}
              {row.matchingMethod === 'FIFO' && <span className="text-ink-muted">výchozí</span>}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/* ── obsah ────────────────────────────────────────────────────────────────── */

const names = new Intl.ListFormat('cs', { style: 'long', type: 'conjunction' });

/** Jména platforem podle způsobu načtení — z katalogu, ať výčet nezastará. */
const platformNames = (method: PlatformInfo['method']): string =>
  names.format(PLATFORMS.filter((platform) => platform.method === method).map((p) => p.name));

const STEPS = [
  {
    title: 'Projdi si demo',
    body: 'Celá aplikace nad ukázkovým portfoliem. Bez registrace, nic se v něm neukládá.',
  },
  {
    title: 'Založ si účet a načti obchody',
    body: 'Stačí e-mail. Brokera připojíš klíčem jen pro čtení, nebo nahraješ výpis.',
  },
  {
    title: 'Dál hlídá Danero',
    body: 'Limity a časové testy přepočítává denně. E-mail pošle při 60, 85 a 100 % limitu a 30 a 7 dní před osvobozením.',
  },
] as const;

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ smazano?: string }>;
}) {
  // jediné místo, kam uživatel po nevratném smazání účtu doputuje — bez
  // potvrzení by nevěděl, jestli se smazání povedlo
  const { smazano } = await searchParams;
  // úvodní stránka zůstává přístupná i přihlášenému (odkazy z patičky,
  // e-mailů) — jen mu nabízí vstup do aplikace místo registrace
  const signedIn = Boolean(await currentUser());
  // živá data = stejný deterministický dataset a stejný čistý engine jako demo
  // prohlídka — stránka ukazuje skutečné komponenty aplikace
  const today = demoToday();
  const { txs, profile, prices, dailyRates } = demoDataset(today);
  const year = Number(today.slice(0, 4));
  const analysis = analyzeForUserCached(DEMO_USER_ID, txs, profile, year, today);
  const { positions, labels } = analysis;
  // tabulka variant za poslední uzavřený rok — živě z enginu, žádná zamrzlá čísla
  const variantYear = year - 1;
  const comparison = demoVariants(today, { txs, profile, dailyRates });
  const variantRow = (method: Variant['matchingMethod'], fx: Variant['fxMethod']) =>
    comparison.variants.find((v) => v.matchingMethod === method && v.fxMethod === fx);
  // výtah: FIFO (výchozí) v obou kurzech + VŽDY doporučený řádek — jinak by
  // „nejvýhodnější“ mohlo z tabulky tiše zmizet, až se dataset posune
  const variantRows = [variantRow('FIFO', 'UNIFIED'), variantRow('FIFO', 'CNB_DAILY')].filter(
    (row): row is Variant => row !== undefined,
  );
  if (!variantRows.some((row) => isRecommended(row, comparison.recommended))) {
    variantRows.push(comparison.recommended);
  } else {
    const lifo = variantRow('LIFO', 'UNIFIED');
    if (lifo) variantRows.push(lifo);
  }

  const primaryButton = buttonVariants({ variant: 'primary', size: 'lg' });

  return (
    <MarketingPage>
      <JsonLd data={organizationJsonLd()} />

      {smazano === '1' && (
        <Notice role="status" title="Účet byl smazán." className="mt-6">
          Transakce, profily i šifrované API klíče jsou nenávratně pryč.
        </Notice>
      )}

      {/* ── úvod: co to je, že je to zdarma, a pod tím samotná aplikace ────── */}
      <section aria-labelledby="hero-nadpis" className="pt-14 text-center md:pt-24">
        {/* dvě věty, dva řádky (na telefonu dva a dva): druhá je tišší */}
        <h1 id="hero-nadpis" className="type-display text-balance">
          {tidy('Hlídač daní z investic.')}{' '}
          <span className="block text-ink-muted">{tidy('Je zdarma a má otevřený kód.')}</span>
        </h1>
        <p className="type-lede measure mx-auto mt-6 text-pretty text-ink-muted">
          {tidy(
            'Danero z tvých obchodů průběžně počítá, jestli a kolik máš z investic danit, a připraví podklady k přiznání. Je to osobní projekt: bez placené verze, bez zkušební doby a bez karty.',
          )}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/demo/prehled" className={primaryButton}>
            Vyzkoušet demo — bez registrace
          </Link>
          {signedIn ? (
            <TextLink href="/prehled" chevron>
              Přejít do aplikace
            </TextLink>
          ) : (
            <TextLink href="/registrace" chevron>
              Založit účet zdarma
            </TextLink>
          )}
        </div>

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
            {tidy('Přehled z dema nad ukázkovým portfoliem. Není to obrázek — dá se na něj klikat.')}
          </p>
        </div>
      </section>

      {/* ── časové testy: živý horizont ─────────────────────────────────────── */}
      <Band wide aria-label="Časové testy">
        <BandHeading
          title="Kdy bude prodej bez daně"
          lede="Po třech letech držení se z prodeje daň neplatí. Tečka je den, kdy ta lhůta doběhne dalším kusům z ukázkového portfolia."
        />
        <div className="mt-10">
          <HorizonStrip
            dots={horizonDots(positions, labels, prices, year)}
            today={today}
            outlook={exemptionOutlook(positions, prices, today, year)}
            embedded
          />
        </div>
      </Band>

      {/* ── podklady k přiznání: živý výtah z porovnání variant ─────────────── */}
      <Band tone="canvas" wide aria-label="Podklady k přiznání">
        <div className="grid items-start gap-x-(--column-gap) gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <BandHeading
            title="Podklady k přiznání"
            lede="Průvodce, co kam zapsat po řádcích formuláře, a XML pro elektronické podání. Daň je spočítaná pro každou metodu zvlášť, takže vidíš, kolik která stojí."
          />
          <div className="lg:pt-3">
            <div className="flex items-center gap-1.5">
              <h3 className="type-footnote font-medium text-ink-muted">
                Ukázkové portfolio, rok {variantYear}: stejné obchody, jiná metoda
              </h3>
              {/* nahoru: pod tlačítkem je tabulka, kterou bublina vysvětluje */}
              <InfoPopover label="Metody a kurzy" title="Co je metoda a kurz" side="top" align="end">
                <p>
                  {tidy(
                    'Metoda určuje, které kusy se při prodeji části pozice berou jako prodané: FIFO nejstarší, LIFO nejnovější. Zákon ji nepředepisuje; výchozí je FIFO.',
                  )}
                </p>
                <p>
                  {tidy(
                    'Kurz je buď jednotný (jeden za celý rok, vyhlašuje ho finanční správa), nebo denní kurz ČNB. V jednom roce se nesmí kombinovat.',
                  )}
                </p>
                <p>
                  <TextLink href="/jak-pocitame">Jak Danero počítá</TextLink>
                </p>
              </InfoPopover>
            </div>
            <div className="mt-2">
              <VariantTable rows={variantRows} recommended={comparison.recommended} />
            </div>
            <p className="mt-3">
              <TextLink href={`/demo/report?rok=${variantYear}`} chevron>
                Celé porovnání v demo reportu
              </TextLink>
            </p>
          </div>
        </div>
      </Band>

      {/* ── odkud data: výčet podle způsobu načtení, jména z katalogu ───────── */}
      <Band wide aria-label="Podporované platformy">
        <BandHeading title="Odkud načte obchody" />
        <SpecList className="mt-10">
          <SpecRow label="Živě přes API">
            {tidy(
              `${platformNames('api')}. Klíč je jen pro čtení a ukládá se šifrovaný.`,
            )}
          </SpecRow>
          <SpecRow label={`Z výpisu (${PLATFORM_COUNTS.file} platforem)`}>
            {tidy(`${platformNames('file')}. Formát souboru pozná Danero samo.`)}
          </SpecRow>
          <SpecRow label="Přes šablonu">
            {tidy(
              `${platformNames('template')} — a kterýkoli jiný broker. Výpis přepíšeš do připravené tabulky.`,
            )}
          </SpecRow>
        </SpecList>
        <p className="mt-4">
          <TextLink href="/platformy" chevron>
            Návod, kde výpis stáhnout, pro každou platformu
          </TextLink>
        </p>
      </Band>

      {/* ── proč zdarma: odpověď a tři odkazy, kde ji ověřit ────────────────── */}
      <Band tone="canvas" wide aria-label="Proč je zdarma">
        <Split title="Proč je zdarma" size="headline">
          <p>
            {tidy(
              'Danero je osobní projekt jednoho vývojáře, ne firma. Vzniklo pro vlastní daně a dodnes se ladí na vlastním portfoliu.',
            )}
          </p>
          <p>
            {tidy(
              'Nejsou v něm reklamy ani sledovací skripty a data nikomu neprodává. Kód je veřejný, takže si to můžeš ověřit — nebo si Danero rozjet na vlastním serveru.',
            )}
          </p>
          <p className="type-body flex flex-wrap gap-x-6 text-ink">
            <TextLink href="/cenik" chevron>
              Co všechno dostaneš
            </TextLink>
            <TextLink href="/o-projektu" chevron>
              Kdo za tím stojí
            </TextLink>
            <TextLink href={SOURCE_URL} chevron external>
              Zdrojový kód
            </TextLink>
          </p>
        </Split>
      </Band>

      {/* ── jak začít: tři kroky a dvě akce ─────────────────────────────────── */}
      <Band tone="black" size="lg" wide aria-label="Jak začít">
        {/* v kódu titulek → kroky → akce (tak se čte na telefonu); na širokém
            okně stojí akce hned pod titulkem a kroky vedle nich */}
        <div className="grid gap-x-(--column-gap) gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_1fr]">
          <h2 className="type-headline lg:col-start-1 lg:row-start-1">Jak začít</h2>
          <ol className="divide-y divide-line/70 border-y border-line/70 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-5 py-5">
                <span aria-hidden className="type-title-3 w-4 shrink-0 tabular-nums text-ink-muted">
                  {index + 1}
                </span>
                <div>
                  <h3 className="type-title-3">{step.title}</h3>
                  <p className="type-body mt-1 text-pretty text-ink-muted">{tidy(step.body)}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap gap-3">
              <Link href="/demo/prehled" className={primaryButton}>
                Vyzkoušet demo
              </Link>
              <Link
                href={signedIn ? '/prehled' : '/registrace'}
                className={buttonVariants({ variant: 'secondary', size: 'lg' })}
              >
                {signedIn ? 'Přejít do aplikace' : 'Založit účet zdarma'}
              </Link>
            </div>
            <p className="type-footnote mt-5 text-pretty text-ink-muted">
              Nevíš, jestli se tě přiznání vůbec týká?{' '}
              <TextLink href="/kalkulacka">Kalkulačka to řekne za minutu</TextLink>.
            </p>
          </div>
        </div>
      </Band>
    </MarketingPage>
  );
}
