import { OPERATOR } from '@/lib/contact';
import type { Metadata } from 'next';
import Image from 'next/image';
import { SECTION_TITLE, SpecList, SpecRow, Split } from '@/components/marketing-blocks';
import { Band, MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
import { typeset } from '@/components/typeset';
import { TextLink } from '@/components/ui/link';
import { SOURCE_URL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Kdo za tím stojí — Danero',
  description:
    'Danero není anonymní firma. Napsal ho Jan Dunder, vývojář z Prahy a investor přes několik platforem, původně pro vlastní daně — a dodnes ho ladí na svém portfoliu.',
};

export default function OProjektuPage() {
  return (
    <MarketingPage active="o-projektu">
      <PageHero
        eyebrow="O projektu"
        title="Kdo za tím stojí"
        lede="Jmenuju se Jan Dunder, jsem vývojář z Prahy — a Danero jsem původně napsal pro sebe."
      />

      <section
        aria-label="Příběh projektu"
        className="mt-12 grid items-start gap-x-(--column-gap) gap-y-10 md:mt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
      >
        {/* příběh je text ke čtení, ne popisek — barvou textu, ne druhotnou šedou */}
        <div className="type-reading measure space-y-4 text-pretty">
          {typeset(
            <>
              <p>
                Investuju přes několik platforem a jako OSVČ v paušálním režimu mám každý rok stejný
                úkol: poskládat prodeje, dividendy a úroky ze všech účtů a uhlídat limity —
                50 000 Kč pro paušál, 100 000 Kč pro osvobozené prodeje a tříletý test u každého
                nákupu zvlášť. Dělal jsem to v tabulkách a nikdy jsem si nebyl jistý, že na něco
                nezapomínám.
              </p>
              <p>
                Tak jsem si napsal nástroj, který to hlídá průběžně nad skutečnými daty ze všech
                mých účtů. Jsem jeho první uživatel a dodnes ho ladím na vlastním portfoliu. Sporné
                daňové výklady aplikace označí, spočítá bezpečnou variantu a ukáže, co by znamenala
                ta výhodnější.
              </p>
              <p>
                Není za tím firma. Když ti něco nebude sedět, napiš mi na{' '}
                <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink> — odpovídám
                osobně.
              </p>
            </>,
          )}
          <p className="type-body flex flex-wrap gap-x-6">
            <TextLink href="https://jandunder.dev" chevron external>
              jandunder.dev
            </TextLink>
            <TextLink href="https://www.linkedin.com/in/jan-dunder" chevron external>
              LinkedIn
            </TextLink>
          </p>
        </div>
        {/* Fotka má bílé ateliérové pozadí: ve světlém režimu splyne se
            stránkou, v tmavém by byla nejjasnější plochou na obrazovce
            a přebila titulek — proto je tam menší a ztlumená. */}
        <Image
          src="/jan-foto.jpg"
          alt="Jan Dunder — autor Danera"
          width={800}
          height={840}
          sizes="(min-width: 1024px) 400px, 288px"
          className="w-72 max-w-full rounded-2xl lg:w-full dark:w-56 dark:brightness-75 dark:lg:w-72"
        />
      </section>

      {/* veřejný kód je u daňového nástroje odpověď na „proč mám věřit, že to
          počítáš správně“, ne technikálie — proto obyčejnými slovy (kdokoli se
          může podívat), ne heslem; co platí, kdyby projekt končil, říká „Proč
          zdarma“ a podmínky — tady se to neopakuje */}
      <Band tone="canvas" className="mt-(--band-y)">
        <Split title="Danero si můžeš přečíst">
          <p>
            Celý kód i pravidla, podle kterých počítá — s odkazy na paragrafy zákona a pokyny
            GFŘ — jsou veřejné. Kdokoli se může podívat, jak Danero počítá a co dělá s daty.
            U nástroje, který ti počítá daň, mi to přišlo jako jediná poctivá odpověď na otázku
            „proč ti mám věřit“.
          </p>
          <p className="type-body flex flex-wrap gap-x-6">
            <TextLink href={SOURCE_URL} chevron external>
              Zdrojový kód na GitHubu
            </TextLink>
            <TextLink
              href={`${SOURCE_URL}/blob/main/docs/02-danova-pravidla.md`}
              chevron
              external
            >
              Pravidla výpočtu
            </TextLink>
          </p>
        </Split>
      </Band>

      {/* věcná identifikace provozovatele — u daní a API klíčů se hodí vědět,
          s kým máš tu čest; úplné údaje jsou v podmínkách užití */}
      <section aria-labelledby="provozovatel-nadpis" className="mt-(--band-y)">
        <h2 id="provozovatel-nadpis" className={SECTION_TITLE}>
          Provozovatel
        </h2>
        <SpecList className="mt-8">
          <SpecRow label="Kdo">
            <span className="text-ink">{OPERATOR.name}</span>, IČO {OPERATOR.ico}, fyzická osoba
            podnikající
          </SpecRow>
          {/* kontakt tu schválně není podruhé — e-mail stojí v příběhu výš i v patičce */}
          <SpecRow label="Pravidla služby">
            <TextLink href="/podminky">Podmínky užití</TextLink> a{' '}
            <TextLink href="/soukromi">ochrana soukromí</TextLink>
          </SpecRow>
        </SpecList>
      </section>

      <PageClosing />
    </MarketingPage>
  );
}
