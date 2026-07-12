import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Průvodce daněmi z investic — Danero',
  description:
    'Srozumitelné články o daních z investic pro české investory: limit 100 000 Kč z objemu prodejů, tříletý časový test a OSVČ v paušálním režimu. Bez žargonu, s příklady.',
};

const CLANKY: { slug: string; stitek: string; title: string; popis: string }[] = [
  {
    slug: 'limit-100-000-kc',
    stitek: 'Limity a pravidla',
    title: 'Limit 100 000 Kč: počítá se objem prodejů, ne zisk',
    popis:
      'Nejrozšířenější omyl českých investorů. Kdy se prodeje akcií a ETF nedaní vůbec, co udělá jediná koruna nad limit a proč má krypto vlastní stovku.',
  },
  {
    slug: 'pausalni-rezim-a-investice',
    stitek: 'OSVČ v paušálu',
    title: 'OSVČ v paušálu: jak ti investice můžou vrátit přiznání',
    popis:
      'Limit 50 000 Kč jiných příjmů se počítá z hrubých částek — pár zahraničních dividend ho naplní i bez jediného prodeje. Co se počítá, co ne a co znamená prolomení.',
  },
];

export default function PruvodcePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="Průvodce daněmi z investic"
        lede="Pravidla a limity bez žargonu. Každý článek začíná krátkou odpovědí a pokračuje konkrétními příklady s čísly — podle stejné metodiky, kterou počítá aplikace."
      />

      <ul className="mt-12 grid gap-4 sm:grid-cols-2">
        {CLANKY.map((clanek) => (
          <li key={clanek.slug}>
            <Link
              href={`/pruvodce/${clanek.slug}`}
              className="flex h-full flex-col rounded-lg border border-linka bg-plocha p-6 transition-colors hover:border-ruzova"
            >
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
                {clanek.stitek}
              </p>
              <h2 className="mt-3 font-display text-xl font-bold tracking-tight">
                {clanek.title}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-inkoust-tlumeny">
                {clanek.popis}
              </p>
              <p className="mt-4 text-sm font-medium text-ruzova-text">Číst článek →</p>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 max-w-3xl text-sm text-inkoust-tlumeny">
        Chceš rovnou odpověď na vlastní situaci? Zkus zdarma a bez registrace{' '}
        <Link
          href="/kalkulacka"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          kalkulačku „Musím podat přiznání?"
        </Link>{' '}
        — a jak přesně počítáme, popisuje stránka{' '}
        <Link
          href="/jak-pocitame"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          Jak počítáme
        </Link>
        .
      </p>

      <MarketingCta
        title="Číst je fajn, počítat je lepší"
        lede="Všechno z průvodce Danero počítá automaticky nad tvými daty — limity, časové testy, dividendy i kurzy. Prohlédni si to v demu nad vzorovým portfoliem."
      />
    </MarketingPage>
  );
}
