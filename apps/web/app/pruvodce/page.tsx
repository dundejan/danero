import type { Metadata } from 'next';
import { LinkList } from '@/components/marketing-blocks';
import { MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
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
      {/* bez tichého řádku nad titulkem: „Průvodce“ by stálo dvakrát pod sebou */}
      <PageHero
        title="Průvodce daněmi z investic"
        lede="Každý článek začíná krátkou odpovědí a pokračuje příklady s čísly."
      />

      {/* Rozcestník je seznam, ne mřížka dlaždic: řádek = článek, celý klikací. */}
      <LinkList
        size="lg"
        className="mt-10 md:mt-14"
        items={ARTICLES.map((article) => ({
          href: `/pruvodce/${article.slug}`,
          title: article.title,
          summary: article.summary,
        }))}
      />

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

      <PageClosing />
    </MarketingPage>
  );
}
