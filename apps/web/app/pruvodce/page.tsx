import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';
import { TextLink } from '@/components/ui/link';

export const metadata: Metadata = {
  title: 'Průvodce daněmi z investic — Danero',
  description:
    'Srozumitelné články o daních z investic pro české investory: limit 100 000 Kč z objemu prodejů, tříletý časový test a OSVČ v paušálním režimu. Bez žargonu, s příklady.',
};

/** Články průvodce: titulek a jedna věta, kterou článek zodpovídá. */
const ARTICLES: { slug: string; title: string; summary: string }[] = [
  {
    slug: 'limit-100-000-kc',
    title: 'Limit 100 000 Kč: počítá se objem prodejů, ne zisk',
    summary:
      'Kdy se prodeje akcií a ETF nedaní vůbec, co udělá jediná koruna nad limit a proč má krypto vlastní stovku.',
  },
  {
    slug: 'pausalni-rezim-a-investice',
    title: 'OSVČ v paušálu: jak ti investice můžou vrátit přiznání',
    summary:
      'Limit 50 000 Kč jiných příjmů se počítá z hrubých částek. Co do něj patří, co ne a co znamená prolomení.',
  },
];

export default function PruvodcePage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Průvodce"
        title="Průvodce daněmi z investic"
        lede="Každý článek začíná krátkou odpovědí a pokračuje příklady s čísly."
      />

      {/* Rozcestník je seznam, ne mřížka dlaždic: řádek = článek, celý klikací. */}
      <ul className="measure mt-10 divide-y divide-line/70 border-y border-line/70 md:mt-14">
        {ARTICLES.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/pruvodce/${article.slug}`}
              className="group flex items-center gap-4 py-6 active:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="type-title-2 block text-balance group-hover:underline">
                  {article.title}
                </span>
                <span className="type-body mt-2 block text-pretty text-ink-muted">
                  {article.summary}
                </span>
              </span>
              <span aria-hidden className="type-title-2 text-ink-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <ul className="type-callout measure mt-8 md:mt-10">
        <li>
          <TextLink href="/kalkulacka" chevron>
            Kalkulačka: musím podat přiznání?
          </TextLink>
        </li>
        <li className="md:mt-2">
          <TextLink href="/jak-pocitame" chevron>
            Jak počítáme — celá metodika s paragrafy
          </TextLink>
        </li>
      </ul>

      <MarketingCta
        title="Číst je fajn, počítat je lepší"
        lede="Všechno z průvodce Danero počítá nad tvými daty. Prohlédni si to v demu nad vzorovým portfoliem."
      />
    </MarketingPage>
  );
}
