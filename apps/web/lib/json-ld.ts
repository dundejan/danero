import type { FaqItem } from '@/components/faq-list';
import { SOURCE_URL } from '@/lib/legal';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Strukturovaná data (schema.org) pro vyhledávače — K8-04.
 *
 * ⚠️ **Žádná identifikace provozovatele.** Jméno, IČO, adresa, e-mail ani
 * telefon sem nepatří (pravidlo 8 v CLAUDE.md): repozitář je veřejný a JSON-LD
 * by je rozvezlo do každého forku. `Organization` popisuje **značku Danero**,
 * ne člověka za ní; identifikaci podle § 435 OZ nese `/podminky` a potvrzení
 * objednávky, kam se plní z `DANERO_OPERATOR_*`. Hlídá `test/seo-metadata.test.ts`.
 */

/** Značka Danero jako entita: jméno, adresa, logo, odkaz na zdrojový kód. */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/znacka/danero-logo-1024x256.png`,
    description: SITE_DESCRIPTION,
    // zdrojový kód pod AGPL je veřejný a fork si adresu přepíše přes NEXT_PUBLIC_SOURCE_URL
    sameAs: [SOURCE_URL],
  };
}

/**
 * Prostý text odpovědi pro JSON-LD. Odpovědi v UI můžou být JSX (odkazy,
 * zvýraznění) — z něj se text spolehlivě nevytáhne, takže ho takové položky
 * musí nést v `plain`. Chybějící `plain` schválně padá: tichým vynecháním
 * otázky by se strukturovaná data rozešla se stránkou a nikdo by si nevšiml.
 */
function faqAnswerText(item: FaqItem): string {
  if (typeof item.a === 'string') return item.a;
  if (item.plain) return item.plain;
  throw new Error(
    `FAQ „${item.q}“: odpověď je JSX, doplň k ní pole \`plain\` s prostým textem pro JSON-LD.`,
  );
}

/** Seznam otázek a odpovědí jako `FAQPage`. */
export function faqPageJsonLd(items: FaqItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: faqAnswerText(item) },
    })),
  };
}
