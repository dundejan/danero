import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

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

      <section aria-label="Příběh projektu" className="mt-12">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="max-w-3xl space-y-4 leading-relaxed text-inkoust-tlumeny">
            <p>
              Investuju přes několik platforem najednou a jako OSVČ v paušálním režimu
              mám každý rok stejný úkol: poskládat prodeje, dividendy a úroky ze všech
              účtů dohromady a uhlídat, ať nikde nepřeteče limit — 50 000 Kč pro paušál,
              100 000 Kč pro osvobozené prodeje, a k tomu tříletý test u každého nákupu
              zvlášť. Dělal jsem to v tabulkách a stejně jsem si nikdy nebyl jistý, že
              na něco nezapomínám. Ten nejistý pocit mě štval víc než samotná daň.
            </p>
            <p>
              Tak jsem si napsal nástroj, který to hlídá za mě — průběžně, celý rok, nad
              skutečnými daty ze všech mých účtů. Danero dodnes ladím na vlastním
              portfoliu: jsem jeho první uživatel, a když něco nesedí, bolí to nejdřív
              mě. Proto taky sporné daňové výklady nezametám pod koberec — aplikace je
              označí, spočítá bezpečnou variantu a ukáže, co by znamenala ta výhodnější.
            </p>
            <p>
              Není za tím firma s marketingovým oddělením. Jen jeden člověk, kterého
              tenhle problém opravdu štval. Když ti něco nebude sedět, napiš mi na{' '}
              <a
                href="mailto:dunder.jan@gmail.com"
                className="font-medium text-ruzova-text underline underline-offset-2"
              >
                dunder.jan@gmail.com
              </a>{' '}
              — odpovídám osobně. A víc o mně najdeš na{' '}
              <a
                href="https://jandunder.dev"
                className="font-medium text-ruzova-text underline underline-offset-2"
                target="_blank"
                rel="noreferrer"
              >
                jandunder.dev
              </a>
              .
            </p>
          </div>
          <figure className="mx-auto w-56 max-w-full lg:mx-0 lg:w-full">
            <Image
              src="/jan-foto.jpg"
              alt="Jan Dunder — autor Danera"
              width={800}
              height={840}
              sizes="(min-width: 1024px) 320px, 224px"
              className="rotate-1 rounded-lg border border-linka shadow-lg shadow-inkoust/10"
            />
          </figure>
        </div>
      </section>

      {/* věcná identifikace provozovatele — u daní a API klíčů se hodí vědět,
          s kým máš tu čest; detail je v podmínkách užití */}
      <section aria-label="Provozovatel" className="mt-16">
        <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
            Provozovatel
          </p>
          <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">
            Danero provozuje <strong className="text-inkoust">Jan Dunder</strong>, IČO
            19642661, fyzická osoba podnikající se sídlem v Praze. Úplné údaje a pravidla
            najdeš v{' '}
            <Link
              href="/podminky"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              podmínkách užití
            </Link>{' '}
            a v{' '}
            <Link
              href="/soukromi"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              ochraně soukromí
            </Link>
            .
          </p>
        </div>
      </section>

      <MarketingCta
        title="Nejlíp to poznáš zevnitř"
        lede="Plné demo běží nad vzorovým portfoliem s 50+ pozicemi — bez registrace, nic se neukládá."
      />
    </MarketingPage>
  );
}
