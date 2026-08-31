import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAlternates } from 'next/dist/lib/metadata/resolvers/resolve-basics.js';
import { resolveOpenGraph } from 'next/dist/lib/metadata/resolvers/resolve-opengraph.js';
import type { MetadataContext } from 'next/dist/lib/metadata/types/resolvers.js';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import * as ogImage from '@/app/opengraph-image';
import { FAQ } from '@/app/caste-otazky/faq';
import { OPERATOR } from '@/lib/contact';
import { faqPageJsonLd, organizationJsonLd } from '@/lib/json-ld';
import { SITE_METADATA, SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * Jak Danero vypadá, když ho někdo sdílí nebo indexuje (K8-04 a K8-09).
 *
 * Do 31. 8. 2026 neměla ani jedna veřejná stránka `og:*`, `twitter:*`, kanonickou
 * adresu ani strukturovaná data — sdílený odkaz byl holý text. Zrádné na tom je,
 * že se to z aplikace samotné nepozná: stránka vypadá pořád stejně, rozdíl je
 * jen v hlavičce, kterou čte Facebook, LinkedIn nebo Slack.
 */

const APP_DIR = join(import.meta.dirname, '..', 'app');
const CONTEXT: MetadataContext = { trailingSlash: false, isStaticMetadataRouteFile: false };

/** Všechny soubory stránek — ať se na novou stránku nezapomene. */
function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return entry === 'page.tsx' ? [full] : [];
  });
}

describe('metadata sdíleného odkazu (K8-04)', () => {
  it('kanonická adresa i og:url míří na právě renderovanou stránku, ne na úvodní', async () => {
    const base = SITE_METADATA.metadataBase as URL | undefined;
    expect(base, '`metadataBase` chybí — relativní adresy se nemají o co opřít').toBeTruthy();

    for (const pathname of ['/', '/cenik', '/pruvodce/limit-100-000-kc']) {
      // schválně proti skutečným resolverům Nextu: `canonical` jako instance
      // `URL` a `og:url: './'` se skládají s cestou stránky, což je chování
      // implementace, ne dokumentované API — upgrade Nextu ho může utnout
      const alternates = await resolveAlternates(
        SITE_METADATA.alternates,
        base!,
        Promise.resolve(pathname),
        CONTEXT,
      );
      const openGraph = await resolveOpenGraph(
        SITE_METADATA.openGraph,
        base!,
        Promise.resolve(pathname),
        CONTEXT,
        null,
      );
      const expected = pathname === '/' ? SITE_URL : `${SITE_URL}${pathname}`;
      expect(alternates?.canonical?.url.toString()).toBe(expected);
      expect(openGraph?.url?.toString()).toBe(expected);
    }
  });

  it('kořenový openGraph nemá vlastní titulek ani popis — zdědily by ho všechny stránky', () => {
    const openGraph = SITE_METADATA.openGraph ?? {};
    expect(Object.hasOwn(openGraph, 'title')).toBe(false);
    expect(Object.hasOwn(openGraph, 'description')).toBe(false);
    expect(SITE_METADATA.openGraph?.siteName).toBe(SITE_NAME);
    expect(SITE_METADATA.openGraph?.locale).toBe('cs_CZ');
  });

  it('náhled se sdílí jako velká karta', () => {
    // `Twitter` v typech Nextu je sjednocení podle druhu karty, proto přetypování
    const twitter = SITE_METADATA.twitter as { card?: string } | undefined;
    expect(twitter?.card).toBe('summary_large_image');
  });

  it('žádná stránka si nepřepisuje openGraph — přišla by o náhledový obrázek', () => {
    // `app/opengraph-image.tsx` se do stránky propíše jen tehdy, když si na své
    // úrovni nedeklaruje `openGraph.images`; a protože vlastní `openGraph`
    // nahradí zděděný celý, stačí k té ztrátě jediný řádek v podstránce.
    const offenders = pageFiles(APP_DIR).filter((file) =>
      readFileSync(file, 'utf8').includes('openGraph'),
    );
    expect(offenders).toEqual([]);
  });
});

describe('náhledový obrázek (K8-04)', () => {
  it('má rozměr, který sociální sítě nezoříznou, a popis pro čtečky', () => {
    expect(ogImage.size).toEqual({ width: 1200, height: 630 });
    expect(ogImage.contentType).toBe('image/png');
    expect(ogImage.alt.length).toBeGreaterThan(10);
  });

  it('se opravdu vykreslí jako PNG', async () => {
    const response = ogImage.default();
    const bytes = Buffer.from(await response.arrayBuffer());
    // PNG magic: 89 50 4E 47
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(bytes.length).toBeGreaterThan(5_000);
  }, 30_000);
});

describe('robots a sitemapa (K8-09)', () => {
  it('robots nepouští roboty na ověřovací odkaz z e-mailu', () => {
    const disallow = robots().rules;
    const rule = Array.isArray(disallow) ? disallow[0] : disallow;
    // jediná stránka z app/(auth), která anonymovi vrátí 200 — a v adrese nese token
    expect(rule?.disallow).toContain('/overeni-emailu');
  });

  it('robots ukazuje na sitemapu na téže doméně', () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it('každá adresa v sitemapě nese datum poslední změny', () => {
    const dnes = new Date().toISOString().slice(0, 10);
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url.startsWith(SITE_URL), `cizí doména: ${entry.url}`).toBe(true);
      const lastModified = entry.lastModified;
      expect(typeof lastModified, `bez lastmod: ${entry.url}`).toBe('string');
      expect(String(lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // datum z budoucnosti je pro vyhledávač signál, že `lastmod` nemá věřit
      expect(String(lastModified) <= dnes, `datum v budoucnu: ${entry.url}`).toBe(true);
    }
  });

  it('sitemapa nemá žádnou adresu dvakrát', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('strukturovaná data (K8-04)', () => {
  it('Organization popisuje značku a ukazuje na existující logo', () => {
    const data = organizationJsonLd();
    expect(data['@type']).toBe('Organization');
    expect(data.name).toBe(SITE_NAME);
    expect(data.url).toBe(SITE_URL);
    const logo = String(data.logo).replace(SITE_URL, '');
    expect(existsSync(join(import.meta.dirname, '..', 'public', logo))).toBe(true);
  });

  it('strukturovaná data nenesou identifikaci provozovatele (pravidlo 8)', () => {
    // repozitář je veřejný a pod AGPL — jméno, IČO, adresu ani kontakty by si
    // cizí self-hoster neměl vozit s sebou; JSON-LD je na to ideální propašovací cesta
    const json = JSON.stringify([organizationJsonLd(), faqPageJsonLd(FAQ)]);
    const identity = [
      OPERATOR.name,
      OPERATOR.ico,
      OPERATOR.address,
      OPERATOR.email,
      ...(OPERATOR.phone ? [OPERATOR.phone] : []),
    ];
    for (const value of identity) {
      expect(json).not.toContain(value);
    }
  });

  it('FAQPage nese všechny otázky ze stránky v prostém textu', () => {
    const data = faqPageJsonLd(FAQ) as {
      '@type': string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(FAQ.length);
    for (const question of data.mainEntity) {
      expect(question.name.length).toBeGreaterThan(0);
      expect(question.acceptedAnswer.text.length).toBeGreaterThan(20);
      // JSX by se do JSON-LD propsalo jako [object Object]
      expect(question.acceptedAnswer.text).not.toContain('object Object');
    }
  });

  it('odpověď v JSX bez prostého textu padá hlasitě, ne tiše bez otázky', () => {
    expect(() => faqPageJsonLd([{ q: 'Otázka?', a: ['JSX'] }])).toThrow(/plain/);
  });

  it('stránky strukturovaná data opravdu vykreslují', () => {
    const landing = readFileSync(join(APP_DIR, 'page.tsx'), 'utf8');
    expect(landing).toContain('organizationJsonLd()');
    const faq = readFileSync(join(APP_DIR, 'caste-otazky', 'page.tsx'), 'utf8');
    expect(faq).toContain('faqPageJsonLd(FAQ)');
  });
});

describe('FAQ: hlášení obchodů úřadu od roku 2026 (#42)', () => {
  const item = FAQ.find((faq) => faq.q.includes('2026') && faq.q.includes('hlásí'));

  it('otázka ve FAQ je', () => {
    expect(item, 'blok o DAC8/CARF ve FAQ chybí').toBeDefined();
  });

  it('pojmenuje pravidla, přizná nehotovou českou transpozici a nestraší', () => {
    const text = typeof item?.a === 'string' ? item.a : (item?.plain ?? '');
    expect(text).toContain('DAC8');
    expect(text).toContain('CARF');
    // K7a-06: sněmovní tisk 98 zatím neprošel, lhůta uplynula 31. 12. 2025 —
    // tvrdit „od ledna to platí" by bylo přes prameny
    expect(text).toContain('sněmovně');
  });

  it('řekne, že se ohlašovací povinnost netýká Danera (K7a-06)', () => {
    const text = typeof item?.a === 'string' ? item.a : (item?.plain ?? '');
    expect(text).toContain('Danero samo nikam nic nehlásí');
  });
});
