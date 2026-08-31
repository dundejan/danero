import { OPERATOR } from '@/lib/contact';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FAQ } from './faq';
import { FaqList } from '@/components/faq-list';
import { JsonLd } from '@/components/json-ld';
import { faqPageJsonLd } from '@/lib/json-ld';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Časté otázky — Danero',
  description:
    'Musím kvůli investicím podávat přiznání? Které brokery Danero načte? Jak je to s bezpečností, kryptem a deriváty? Odpovědi na nejčastější otázky k hlídání daní z investic.',
};

export default function CasteOtazkyPage() {
  return (
    <MarketingPage active="caste-otazky">
      <JsonLd data={faqPageJsonLd(FAQ)} />
      <PageHero
        eyebrow="FAQ"
        title="Časté otázky"
        lede={`Co lidi nejčastěji zajímá, než pustí Danero ke svým daním. Nenašel jsi odpověď? Napiš na ${OPERATOR.email} — odpovídám osobně.`}
      />

      <div className="mt-12">
        <FaqList items={FAQ} />
      </div>

      <p className="mt-8 max-w-3xl text-sm text-inkoust-tlumeny">
        Otázky přímo k ceně najdeš na stránce{' '}
        <Link
          href="/cenik"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          Ceník
        </Link>
        .
      </p>

      <MarketingCta
        title="Nejrychlejší odpověď: prostě si to vyzkoušej"
        lede="Plné demo běží nad vzorovým portfoliem — ukazatele limitů, horizont osvobození i report. Bez registrace, nic se neukládá."
      />
    </MarketingPage>
  );
}
