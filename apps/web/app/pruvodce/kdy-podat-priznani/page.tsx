import type { Metadata } from 'next';
import { MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
import {
  ArticleBody,
  ArticleFooter,
  ArticleIntro,
  ArticleLink,
  ArticleList,
  ArticleSection,
  ArticleUpdated,
  Example,
} from '@/components/guide-article';
import type { ContentsItem } from '@/components/long-read';
import { ARTICLES } from '@/lib/articles';
import { czDate, czk } from '@/lib/format';
import {
  CURRENT_FILING_YEAR as NOW,
  currentFilingDeadlines,
  filingExample,
  filingLimits,
  mustFile,
  RAISED_LIMITS_YEAR as NEXT,
  type FilingExample,
} from '@/lib/guide-examples';

const PATH = '/pruvodce/kdy-podat-priznani';

// popis pro vyhledávače z téže konfigurace jako text — ruční čísla by zastarala
const CURRENT = filingLimits(NOW);
const RAISED = filingLimits(NEXT);

export const metadata: Metadata = {
  title: 'Kdy podat přiznání kvůli investicím — Danero',
  description: `Zaměstnanec podává přiznání nad ${czk(CURRENT.employee)} příjmů mimo zaměstnání, ostatní nad ${czk(CURRENT.general)}. Od roku ${NEXT} se limity zdvojnásobí, OSVČ v paušálu zůstává ${czk(RAISED.flatTax)}. Co se do limitu počítá, příklady a termíny za rok ${NOW}.`,
};

const CONTENTS: ContentsItem[] = [
  { id: 'ktery-limit', title: 'Který limit je tvůj' },
  { id: 'co-se-pocita', title: 'Co se do limitu počítá' },
  { id: 'priklady', title: 'Stejné dividendy, jiný rok' },
  { id: 'od-2027', title: `Vyšší limity až od roku ${NEXT}` },
  { id: 'pausal', title: 'OSVČ v paušálu' },
  { id: 'nad-limitem', title: 'Pod limitem a nad ním' },
  { id: 'oznameni', title: 'Oznámení nad 5 milionů' },
  { id: 'terminy', title: `Termíny za rok ${NOW}` },
];

/** „přiznání podává: 30 000 Kč je víc než limit 20 000 Kč“ — verdikt z čísel, ne z textu. */
function Verdict({ example, year }: { example: FilingExample; year: number }) {
  const limit = czk(example.limit(filingLimits(year)));
  const amount = czk(example.dividendsCzk);
  return mustFile(example, year) ? (
    <>
      přiznání <strong>podává</strong>: {amount} je víc než limit {limit}
    </>
  ) : (
    <>
      přiznání <strong>nepodává</strong>: {amount} limit {limit} nepřesahuje
    </>
  );
}

/**
 * Článek průvodce A z plánu propagace (40, kap. 3): kdo a kdy kvůli investicím
 * podává přiznání a co mění zák. č. 180/2026 Sb. Pravidla R-09a, R-09b, R-08b,
 * R-09d, R-09e, R-09f a R-02 z docs/02 — žádné vlastní. Částky, verdikty
 * a lhůty se počítají (`lib/guide-examples.ts`), protože jinde na webu se
 * právě tyhle údaje rozešly s konfigurací roku (L3-01, K7a-03).
 */
export default function KdyPodatPriznaniPage() {
  const now = CURRENT;
  const next = RAISED;
  const deadlines = currentFilingDeadlines();
  const employee = filingExample('employee');
  const other = filingExample('other');
  const flatTax = filingExample('flatTax');

  return (
    <MarketingPage>
      <PageHero eyebrow="Průvodce" title={ARTICLES[PATH].headline} />
      <ArticleUpdated path={PATH} />

      <ArticleBody contents={CONTENTS}>
        <ArticleIntro>
          <strong>
            Kvůli investicím podáváš přiznání, když tvoje zdanitelné příjmy přesáhnou za rok
            limit: za rok {NOW} je to {czk(now.employee)} příjmů mimo zaměstnání
            u zaměstnance a {czk(now.general)} u člověka bez zaměstnání i podnikání. Od roku{' '}
            {NEXT} se oba limity zdvojnásobí, OSVČ v paušálu ale zůstává {czk(next.flatTax)}.
          </strong>{' '}
          Počítají se hrubé částky, ne zisk. Prodeje osvobozené od daně se nepočítají vůbec.
        </ArticleIntro>

        <ArticleSection id="ktery-limit" title="Který limit je tvůj">
          <ArticleList>
            <li>
              <strong>Zaměstnanec:</strong> zdanitelné příjmy mimo zaměstnání nad{' '}
              {czk(now.employee)} za rok, od roku {NEXT} nad {czk(next.employee)}.
            </li>
            <li>
              <strong>Bez zaměstnání i podnikání:</strong> zdanitelné příjmy nad{' '}
              {czk(now.general)} za rok, od roku {NEXT} nad {czk(next.general)}.
            </li>
            <li>
              <strong>OSVČ v paušálním režimu:</strong> příjmy z kapitálu, z nájmu a ostatní
              příjmy nad {czk(now.flatTax)} za rok. Tenhle limit novela nezměnila.
            </li>
            <li>
              <strong>OSVČ mimo paušál:</strong> přiznání podáváš kvůli podnikání tak jako
              tak a patří do něj každý zdanitelný příjem z investic.
            </li>
          </ArticleList>
          <p>
            Limit se musí <strong>přesáhnout</strong>. Kdo má za rok {NOW} příjmy mimo
            zaměstnání přesně {czk(now.employee)}, přiznání ještě nepodává.
          </p>
        </ArticleSection>

        <ArticleSection id="co-se-pocita" title="Co se do limitu počítá">
          <p>Počítají se hrubé částky:</p>
          <ArticleList>
            <li>
              <strong>zahraniční dividendy před srážkou</strong>, tedy víc, než ti přišlo na
              účet (
              <ArticleLink href="/pruvodce/dividendy-ze-zahranici">
                jak se dividendy daní
              </ArticleLink>
              ),
            </li>
            <li>
              <strong>úroky od brokera</strong> a další zdanitelné úroky,
            </li>
            <li>
              <strong>celá tržba z prodejů, které nejsou osvobozené</strong>, ne zisk
              z nich,
            </li>
            <li>
              kladné výsledky obchodů s deriváty, tedy nástroji odvozenými od ceny něčeho
              jiného (CFD, opce, futures).
            </li>
          </ArticleList>
          <p>Nepočítají se:</p>
          <ArticleList>
            <li>
              prodeje osvobozené tříletým časovým testem nebo{' '}
              <ArticleLink href="/pruvodce/limit-100-000-kc">limitem 100 000 Kč</ArticleLink>,
            </li>
            <li>
              české dividendy a úroky z českých bank, ze kterých daň už srazil ten, kdo je
              vyplácí.
            </li>
          </ArticleList>
          <Example title="Prodej, který rozhodne sám">
            <p>
              Prodáš za víc než 100 000 Kč a nic z toho jsi nedržel přes tři roky. Osvobození
              padá a zdanitelná tržba je vyšší než 100 000 Kč, takže přesahuje všechny limity
              uvedené výš, i ty platné od roku {NEXT}. Přiznání podáváš, i když jsi prodával
              se ztrátou.
            </p>
          </Example>
        </ArticleSection>

        <ArticleSection id="priklady" title="Stejné dividendy, jiný rok">
          <p>
            Tři lidé, žádný prodej, jen zahraniční dividendy za rok (brutto, přepočtené na
            koruny):
          </p>
          <Example title={`Zaměstnanec s dividendami ${czk(employee.dividendsCzk)}`}>
            <p>
              Za rok {NOW} <Verdict example={employee} year={NOW} />.
            </p>
            <p>
              Se stejnou částkou za rok {NEXT} <Verdict example={employee} year={NEXT} />.
            </p>
          </Example>
          <Example title={`Bez zaměstnání i podnikání, dividendy ${czk(other.dividendsCzk)}`}>
            <p>
              Za rok {NOW} <Verdict example={other} year={NOW} />.
            </p>
            <p>
              Se stejnou částkou za rok {NEXT} <Verdict example={other} year={NEXT} />.
            </p>
          </Example>
          <Example title={`OSVČ v paušálu, dividendy ${czk(flatTax.dividendsCzk)}`}>
            <p>
              Za rok {NOW} <Verdict example={flatTax} year={NOW} />.
            </p>
            <p>
              Za rok {NEXT} <Verdict example={flatTax} year={NEXT} />. Limit paušálu se
              nemění a k přiznání se přidávají i přehledy pro ČSSZ a zdravotní pojišťovnu.
            </p>
          </Example>
        </ArticleSection>

        <ArticleSection id="od-2027" title={`Vyšší limity platí až pro příjmy roku ${NEXT}`}>
          <p>
            Limity zvedá zákon č. 180/2026 Sb., který je hlavně o evidenci tržeb. Pro limity
            přiznání je v něm podstatná změna § 38g zákona o daních z příjmů:{' '}
            {czk(now.employee)} se mění na{' '}
            {czk(next.employee)} a {czk(now.general)} na {czk(next.general)}. Účinnost má od
            1. 1. {NEXT}.
          </p>
          <p>
            Přechodné ustanovení přitom říká, že za období začaté před účinností platí dosavadní
            pravidla. <strong>Přiznání za rok {NOW}, které se podává na jaře {NEXT}, se tedy
            řídí ještě starými částkami.</strong> Vyšší limity se poprvé projeví u přiznání za
            rok {NEXT}, podávaného v roce {NEXT + 1}.
          </p>
        </ArticleSection>

        <ArticleSection id="pausal" title={`OSVČ v paušálu hlídá od roku ${NEXT} poloviční částku`}>
          <p>
            Limit {czk(next.flatTax)} pro paušální daň stojí v jiném paragrafu (§ 7a) a jeho
            výši novela nezměnila. Od roku {NEXT} tak paušalista hlídá polovinu toho, co
            člověk bez zaměstnání i podnikání.
          </p>
          <p>
            Když ho překročíš, daň za ten rok není rovna paušální dani: podáváš přiznání
            i přehledy, v paušálním režimu ale zůstáváš. Podrobně v článku{' '}
            <ArticleLink href="/pruvodce/pausalni-rezim-a-investice">
              OSVČ v paušálu a investice
            </ArticleLink>
            .
          </p>
        </ArticleSection>

        <ArticleSection id="nad-limitem" title="Pod limitem nic, nad ním všechno">
          <p>
            Kdo limit nepřesáhne a jiný důvod k přiznání nemá, přiznání nepodává a daň
            z těchhle příjmů neplatí. Kdo ho přesáhne, <strong>daní v přiznání všechny
            zdanitelné příjmy</strong>, ne jen část nad limitem. Limit je práh, ne odpočet.
            A kdo přiznání podává tak jako tak, uvádí v něm i příjmy z investic pod
            limitem.
          </p>
          <p>
            Daň z investic ti přitom může vyjít nulová, třeba když jsi prodával se ztrátou.
            Povinnost podat přiznání se řídí hrubými příjmy, ne výslednou daní.
          </p>
        </ArticleSection>

        <ArticleSection id="oznameni" title="Oznámení nad 5 milionů Kč i bez přiznání">
          <p>
            Zvlášť stojí <strong>oznámení osvobozeného příjmu nad {czk(now.exemptReporting)}</strong>
            , typicky velkého prodeje akcií po třech letech držby. Daň z něj není, přiznání
            kvůli němu nevzniká, ale finanční správě se ta částka oznámit musí.
          </p>
          <p>
            Kdo přiznání podává, oznamuje ve stejné lhůtě. Kdo ho nepodává, má na oznámení jen
            tři měsíce: za rok {NOW} do {czDate(deadlines.paper)}. Víc v{' '}
            <ArticleLink href="/jak-pocitame#limity-podani">metodice</ArticleLink>.
          </p>
        </ArticleSection>

        <ArticleSection id="terminy" title={`Termíny za rok ${NOW}`}>
          <ArticleList>
            <li>
              papírově do <strong>{czDate(deadlines.paper)}</strong>,
            </li>
            <li>
              elektronicky do <strong>{czDate(deadlines.electronic)}</strong>,
            </li>
            <li>
              s daňovým poradcem do <strong>{czDate(deadlines.advisor)}</strong>.
            </li>
          </ArticleList>
          <p>
            Když lhůta skončí o víkendu nebo ve svátek, posouvá se na nejbližší pracovní den.
            Data výš to už zohledňují.
          </p>
          <p>
            Jestli se tě přiznání týká, zjistíš orientačně za minutu v{' '}
            <ArticleLink href="/kalkulacka">kalkulačce „Musím podat přiznání?“</ArticleLink>
            . Počítá s limity běžného roku; pro přiznání za rok {NOW}, podávané na jaře{' '}
            {NEXT}, platí částky z přehledu výš. V aplikaci pak Danero sčítá dividendy, úroky
            a prodeje ze všech tvých účtů průběžně a napíše, když se blížíš k limitu.
          </p>
        </ArticleSection>

        <ArticleFooter
          periods={`${NOW} a ${NEXT}`}
          next={[
            {
              href: '/pruvodce/dividendy-ze-zahranici',
              title: ARTICLES['/pruvodce/dividendy-ze-zahranici'].headline,
            },
            {
              href: '/pruvodce/pausalni-rezim-a-investice',
              title: ARTICLES['/pruvodce/pausalni-rezim-a-investice'].headline,
            },
            { href: '/kalkulacka', title: 'Kalkulačka: Musím podat přiznání?' },
          ]}
        />
      </ArticleBody>

      <PageClosing />
    </MarketingPage>
  );
}
