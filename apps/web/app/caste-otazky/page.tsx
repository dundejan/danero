import { OPERATOR } from '@/lib/contact';
import type { Metadata } from 'next';
import { FAQ, FAQ_SECTIONS } from './faq';
import { FaqList } from '@/components/faq-list';
import { JsonLd } from '@/components/json-ld';
import { MarketingPage, PageClosing, PageHero } from '@/components/marketing-page';
import { typeset } from '@/components/typeset';
import { TextLink } from '@/components/ui/link';
import { faqPageJsonLd } from '@/lib/json-ld';
import { cn } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Časté otázky — Danero',
  description:
    'Musím kvůli investicím podávat přiznání? Které brokery Danero načte? Jak je to s bezpečností, kryptem a deriváty? Odpovědi na nejčastější otázky k hlídání daní z investic.',
};

/** Název oddílu vlevo, otázky vpravo — stejné sloupce drží i řádek s kontaktem. */
const COLUMNS =
  'grid gap-x-(--column-gap) gap-y-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]';

export default function CasteOtazkyPage() {
  return (
    <MarketingPage active="caste-otazky">
      <JsonLd data={faqPageJsonLd(FAQ)} />
      {/* titulek říká, kde čtenář je; tichý řádek nad ním by ho jen opakoval */}
      <PageHero title="Časté otázky" />

      {/* oddíl = název vlevo, otázky vpravo; na telefonu název nad otázkami */}
      <div className="mt-12 space-y-12 md:mt-16 md:space-y-16">
        {FAQ_SECTIONS.map((section) => (
          <section
            key={section.title}
            aria-label={section.title}
            className={COLUMNS}
          >
            <h2 className="type-title-2 lg:pt-4">{section.title}</h2>
            <FaqList items={section.items} />
          </section>
        ))}
      </div>

      <div className={cn(COLUMNS, 'mt-10')}>
        <p className="type-body text-pretty text-ink-muted lg:col-start-2">
          {typeset(
            <>
              Nenašel jsi odpověď? Napiš na{' '}
              <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink> — autor
              odpovídá osobně.
            </>,
          )}
        </p>
      </div>

      <PageClosing />
    </MarketingPage>
  );
}
