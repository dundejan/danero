import type { Metadata } from 'next';
import Link from 'next/link';
import { compareVariants, type VariantComparison } from '@danero/engine';
import { HorizonStrip } from '@/components/horizon-strip';
import { JsonLd } from '@/components/json-ld';
import { Logo } from '@/components/logo';
import { SpecList, SpecRow, Split } from '@/components/marketing-blocks';
import { Band, BandHeading, MarketingPage, PageClosing } from '@/components/marketing-page';
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
import { availableYears, engineInputForUser } from '@/lib/portfolio';
import { currentUser } from '@/lib/session';
import { typeset } from '@/components/typeset';
import { SITE_TAGLINE, SITE_TAGLINE_HOW } from '@/lib/site';
import { tidy } from '@/lib/typography';

// „dnešek“ dema se odvíjí od skutečného data (horizont, limity) —
// žádný prerender při buildu; engine výsledek drží sdílená cache s /demo
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Danero — hlídač daní z investic, bezpečně a zdarma',
  description:
    'Danero z tvých obchodů počítá, jestli z investic platíš daň a kolik: limit 100 000 Kč, limit paušální daně i tříleté časové testy. Připraví podklady k přiznání včetně XML. K brokerovi se připojuje jen pro čtení; celé zdarma, bez karty.',
};

/* ── stavební prvky ───────────────────────────────────────────────────────── */

/**
 * Okno aplikace na úvodní stránce. Uvnitř není obrázek, ale tytéž komponenty,
 * které vykreslují přehled v aplikaci — postranní panel se skutečnými odkazy
 * do dema a pracovní plocha nad ukázkovými daty.
 * Stín má jen tohle okno: je to jediná věc na stránce, která se vznáší.
 * Falešné ovládání okna (tři tečky) tu není — je to rekvizita šablonových
 * úvodních stránek, ne část rozhraní.
 */
function AppWindow({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface text-left shadow-window">
      <div className="flex">
        <div className="material-sidebar hidden w-52 shrink-0 flex-col border-r border-(--material-edge) px-3 pb-5 pt-5 lg:flex">
          <div className="mb-5 px-2">
            <Logo className="text-[1.0625rem]" />
          </div>
          <SidebarNav
            items={DEMO_NAV_ITEMS}
            activeHref="/demo/prehled"
            ariaLabel="Sekce dema"
          />
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

/** Metoda a kurz, se kterými počítá profil (v databázi obyčejné řetězce). */
interface MethodChoice {
  matchingMethod: string;
  fxMethod: string;
}

/** Totéž pro výchozí kombinaci — tu, kterou má nastavenou ukázkový profil. */
const isDefault = (row: Variant, profile: MethodChoice): boolean =>
  row.matchingMethod === profile.matchingMethod && row.fxMethod === profile.fxMethod;

/**
 * Výtah z porovnání variant: výchozí metoda v obou kurzech a nejvýhodnější
 * řádek. Celou tabulku (4 metody × 2 kurzy) má demo report — tady stačí
 * ukázat, že tatáž data dají podle metody jinou daň.
 *
 * Tabulka musí být srozumitelná sama: tři sloupce (metoda, kurz, daň) a nic,
 * co by si čtenář musel dopočítat. Sloupec „Základ daně“ tu býval a mátl —
 * nesl jen základ z prodejů, kdežto daň obsahuje i dividendy, takže řádek
 * „základ 0 Kč, daň 920 Kč“ vypadal jako chyba v počtech (nález R1A-03).
 * „Výchozí“ je jediný řádek: kombinace, se kterou Danero počítá, dokud ji
 * člověk nezmění. Stav řádku je text, ne barevný štítek.
 */
function VariantTable({
  rows,
  recommended,
  defaults,
}: {
  rows: Variant[];
  recommended: Variant;
  defaults: MethodChoice;
}) {
  return (
    <Table>
      <caption className="sr-only">Daň z investic podle metody párování a kurzu</caption>
      <thead>
        <tr>
          <Th>Metoda</Th>
          <Th>Kurz</Th>
          <Th align="right">Daň z investic</Th>
          <Th>
            <span className="sr-only">Poznámka</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={variantKey(row)}>
            <Td className="font-medium">{METHOD_LABEL[row.matchingMethod]}</Td>
            <Td className="text-ink-muted">{FX_LABEL[row.fxMethod]}</Td>
            <Td align="right" className="whitespace-nowrap">
              {czk(row.taxCzk)}
            </Td>
            <Td className="type-caption whitespace-nowrap">
              {isRecommended(row, recommended) && (
                <span className="font-semibold text-accent-text">nejvýhodnější</span>
              )}
              {isRecommended(row, recommended) && isDefault(row, defaults) && ' · '}
              {isDefault(row, defaults) && <span className="text-ink-muted">výchozí</span>}
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
    // co demo je, říká závěr stránky hned pod kroky — tady stačí, že nic nechce
    body: 'Bez registrace.',
  },
  {
    title: 'Založ si účet a načti obchody',
    body: 'Stačí e-mail. Brokera připojíš klíčem jen pro čtení, nebo nahraješ výpis.',
  },
  {
    title: 'Dál hlídá Danero',
    body: 'Limity a tříleté lhůty přepočítává denně. E-mail pošle při 60, 85 a 100 % limitu a 30 a 7 dní před osvobozením.',
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

      {/* ── úvod: co to je, bezpečně a zdarma, a pod tím samotná aplikace ────
          Čtenář je kdokoli, kdo investuje, ne vývojář: titulek slibuje dvě věci
          obyčejnými slovy a perex obě hned doloží faktem („jen pro čtení“
          s odkazem na /bezpecnost, „placenou verzi nemá“). Výrazy jako
          „otevřený kód“ nebo „osobní projekt“ sem nepatří — majitel je
          10. 10. 2026 vyřadil jako nesrozumitelné.
          Slovo „zdarma“ říká stránka dvakrát a víc ne: tady v titulku a v pásu
          „Proč je zdarma“ (hlídá `test/public-pages.test.ts`). Dřív tu stálo
          sedmkrát, včetně přípony každého tlačítka — to je prodejní vzorec,
          ne informace (nález R1A-06). */}
      <section
        aria-labelledby="hero-nadpis"
        // spodní odsazení nese stín okna: pás pod úvodem má vlastní plochu
        // a stín by jinak uřízl rovnou hranou
        className="pb-(--band-y) pt-14 text-center md:pt-24"
      >
        {/* dvě věty, dva řádky (na telefonu dva a dva): druhá je tišší. Tytéž
            dvě věty nese obrázek pro sdílení, proto jsou v `lib/site.ts`. */}
        <h1 id="hero-nadpis" className="type-display text-balance">
          {tidy(SITE_TAGLINE)}{' '}
          <span className="block text-ink-muted">{tidy(SITE_TAGLINE_HOW)}</span>
        </h1>
        <p className="type-lede measure mx-auto mt-6 text-pretty text-ink-muted">
          {typeset(
            <>
              Danero z tvých obchodů průběžně počítá, jestli z investic platíš daň a kolik,
              a připraví podklady k přiznání. K brokerovi se připojuje{' '}
              <TextLink href="/bezpecnost" className="whitespace-nowrap">
                jen pro čtení
              </TextLink>{' '}
              a tvoje data nikomu neprodává.
              Placenou verzi nemá a kartu po tobě nechce.
            </>,
          )}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/demo/prehled" className={primaryButton}>
            Vyzkoušet demo
          </Link>
          {signedIn ? (
            <TextLink href="/prehled" chevron>
              Přejít do aplikace
            </TextLink>
          ) : (
            <TextLink href="/registrace" chevron>
              Založit účet
            </TextLink>
          )}
        </div>
        {/* kalkulačka odpoví bez účtu i bez dema — patří do první obrazovky,
            ne do poznámky na konci stránky (nález R1A-11) */}
        <p className="type-callout mt-5 text-pretty text-ink-muted md:mt-4">
          Nevíš, jestli se tě přiznání vůbec týká?{' '}
          <TextLink href="/kalkulacka">Kalkulačka to řekne za minutu</TextLink>.
        </p>

        {/* skutečný přehled nad ukázkovými daty — žádný snímek obrazovky */}
        <div className="mt-12 md:mt-16">
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
            {tidy('Přehled z dema nad ukázkovým portfoliem.')}
          </p>
        </div>
      </section>

      {/* ── časové testy: živý horizont ─────────────────────────────────────── */}
      <Band aria-label="Časové testy" className="pt-0">
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
      <Band tone="canvas" aria-label="Podklady k přiznání">
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
              <VariantTable
                rows={variantRows}
                recommended={comparison.recommended}
                defaults={profile}
              />
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
      <Band aria-labelledby="platformy-nadpis">
        <BandHeading id="platformy-nadpis" title="Odkud načte obchody" />
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

      {/* ── proč zdarma: jedna odpověď a dva odkazy, kde ji ověřit ────────────
          Zbytek (kde je háček, co s daty, kdo za tím stojí) říkají stránky,
          na které se odkazuje — tady se neopakuje (nález R1A-08). Odkaz na
          zdrojový kód je v patičce; veřejný kód je důkaz pro toho, kdo ho
          hledá, ne argument pro každého. */}
      <Band tone="canvas" aria-label="Proč je zdarma">
        <Split title="Proč je zdarma" size="headline">
          <p>
            Danero dělá jeden člověk, ne firma. Vzniklo pro vlastní daně, dodnes se ladí na
            vlastním portfoliu a nic neprodává.
          </p>
          <p className="type-body flex flex-wrap gap-x-6 text-ink">
            <TextLink href="/cenik" chevron>
              Podrobněji
            </TextLink>
            <TextLink href="/o-projektu" chevron>
              Kdo za tím stojí
            </TextLink>
          </p>
        </Split>
      </Band>

      {/* ── jak začít: tři kroky ───────────────────────────────────────────────
          Akce (demo, založení účtu) nese závěr stránky hned pod kroky — stejný
          jako na všech ostatních stránkách. Do 10. 10. 2026 tu byl černý pás
          s vlastními tlačítky přes šestinu stránky. */}
      <Band aria-labelledby="jak-zacit-nadpis">
        <div className="grid gap-x-(--column-gap) gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <h2 id="jak-zacit-nadpis" className="type-headline">
            Jak začít
          </h2>
          <ol className="divide-y divide-line/70 border-y border-line/70">
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
        </div>
      </Band>

      <PageClosing />
    </MarketingPage>
  );
}
