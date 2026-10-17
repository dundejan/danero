import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import {
  resolveAlternates,
  resolveRobots,
  resolveVerification,
} from 'next/dist/lib/metadata/resolvers/resolve-basics.js';
import { resolveOpenGraph } from 'next/dist/lib/metadata/resolvers/resolve-opengraph.js';
import type { MetadataContext } from 'next/dist/lib/metadata/types/resolvers.js';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import * as ogImage from '@/app/opengraph-image';
import { FAQ } from '@/app/caste-otazky/faq';
import { ArticleUpdated } from '@/components/guide-article';
import { PlatformCatalog } from '@/components/platform-catalog';
import { ARTICLES, type ArticlePath } from '@/lib/articles';
import { PLATFORMS } from '@/lib/brokers-catalog';
import { OPERATOR } from '@/lib/contact';
import {
  articleJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  websiteJsonLd,
} from '@/lib/json-ld';
import {
  NOINDEX,
  SITE_METADATA,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_TAGLINE_HOW,
  SITE_TITLE,
  SITE_URL,
  siteVerification,
} from '@/lib/site';
import nextConfig from '@/next.config';

/**
 * Jak Danero vypadá, když ho někdo sdílí nebo indexuje (K8-04 a K8-09).
 *
 * Do 31. 8. 2026 neměla ani jedna veřejná stránka `og:*`, `twitter:*`, kanonickou
 * adresu ani strukturovaná data — sdílený odkaz byl holý text. Zrádné na tom je,
 * že se to z aplikace samotné nepozná: stránka vypadá pořád stejně, rozdíl je
 * jen v hlavičce, kterou čte Facebook, LinkedIn nebo Slack.
 */

/** `connection()` mimo požadavek padá — tady jen zaznamená, že ho stránka zavolala. */
const { connection } = vi.hoisted(() => ({ connection: vi.fn(async () => undefined) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection,
}));

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

  /**
   * Nález R1A-02: úvodní stránka dostala při redesignu nové znění, ale obrázek
   * pro sdílení a výchozí titulek dál nesly starý slogan — z webu samotného se
   * to nepozná, rozdíl vidí až ten, komu někdo pošle odkaz. Obojí proto bere
   * věty z `lib/site.ts` („Hlídač daní z investic. Bezpečně a zdarma.“).
   */
  it('obrázek říká totéž co titulek úvodní stránky', () => {
    const image = readFileSync(join(APP_DIR, 'opengraph-image.tsx'), 'utf8');
    const landing = readFileSync(join(APP_DIR, 'page.tsx'), 'utf8');
    for (const source of [image, landing]) {
      expect(source).toMatch(/[({]SITE_TAGLINE[)}]/);
      expect(source).toMatch(/[({]SITE_TAGLINE_HOW[)}]/);
    }
    expect(SITE_TAGLINE).toBe('Hlídač daní z investic.');
    expect(SITE_TAGLINE_HOW).toBe('Bezpečně a zdarma.');
    // ve zdroji obrázku nesmí zůstat věta napsaná natvrdo vedle těch sdílených
    expect(image).not.toMatch(/hlídáme za tebe|v březnu podklady/);
  });

  it('výchozí titulek i popis obrázku jmenují službu stejně jako úvod', () => {
    expect(SITE_METADATA.title).toBe(SITE_TITLE);
    expect(ogImage.alt).toBe(SITE_TITLE);
    expect(SITE_TITLE).toBe(`${SITE_NAME} — ${SITE_TAGLINE.replace(/\.$/, '').toLowerCase()}`);
    expect(SITE_TITLE).not.toMatch(/pohlídané/);
  });
});

/**
 * Písmo obrázku pro sdílení. Písmo, které má `next/og` v sobě, nemá „č“ ani
 * „ě“: knihovna si je za běhu stahovala ze sítě z jiného písma a mezery mezi
 * slovy vycházely nestejně („Bezpečně␣a“ 29 px, „a␣zdarma“ 21 px). Od
 * 11. 10. 2026 je u obrázku přibalená podmnožina Interu s plnou češtinou.
 */
describe('písmo náhledového obrázku', () => {
  const FONT_DIR = join(APP_DIR, '..', 'assets', 'og');
  const fontFiles = (): string[] =>
    readdirSync(FONT_DIR).filter((name) => /\.(ttf|otf|woff2?)$/i.test(name));

  /** Znaky, které písmo umí — z tabulky `cmap` (formát 4, základní rovina Unicode). */
  function supportedCodePoints(font: Buffer): Set<number> {
    const tableCount = font.readUInt16BE(4);
    let cmap = -1;
    for (let index = 0; index < tableCount; index++) {
      const record = 12 + index * 16;
      if (font.toString('latin1', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
    }
    expect(cmap, 'písmo nemá tabulku cmap').toBeGreaterThan(0);
    const points = new Set<number>();
    for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
      const subtable = cmap + font.readUInt32BE(cmap + 4 + index * 8 + 4);
      if (font.readUInt16BE(subtable) !== 4) continue;
      const segments = font.readUInt16BE(subtable + 6) / 2;
      const ends = subtable + 14;
      const starts = ends + segments * 2 + 2;
      for (let segment = 0; segment < segments; segment++) {
        const end = font.readUInt16BE(ends + segment * 2);
        const start = font.readUInt16BE(starts + segment * 2);
        for (let point = start; point <= end && point !== 0xffff; point++) points.add(point);
      }
    }
    return points;
  }

  it('jsou to statické soubory, které satori přečte, a licence leží vedle nich', () => {
    const files = fontFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      // TrueType 00 01 00 00, OpenType „OTTO“, WOFF „wOFF“ — WOFF2 („wOF2“) satori neumí
      const magic = readFileSync(join(FONT_DIR, name)).subarray(0, 4).toString('hex');
      expect(['00010000', '4f54544f', '774f4646'], name).toContain(magic);
    }
    const license = readFileSync(join(FONT_DIR, 'OFL.txt'), 'utf8');
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(license).toContain('The Inter Project Authors');
    // obrázek čte právě tyhle soubory a žádné jiné
    const image = readFileSync(join(APP_DIR, 'opengraph-image.tsx'), 'utf8');
    for (const name of files) expect(image, name).toContain(`'${name}'`);
  });

  it('jsou to podmnožiny, ne celé písmo — do repozitáře i do funkce jde pár desítek kB', () => {
    const sizes = fontFiles().map((name) => statSync(join(FONT_DIR, name)).size);
    for (const size of sizes) expect(size).toBeLessThan(60_000);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(120_000);
  });

  it('každý řez umí celou českou abecedu i všechno, co na obrázku stojí', () => {
    const czech = 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
    const onImage = `${SITE_NAME}${SITE_TAGLINE}${SITE_TAGLINE_HOW}${new URL(SITE_URL).host}`;
    for (const name of fontFiles()) {
      const points = supportedCodePoints(readFileSync(join(FONT_DIR, name)));
      const missing = [...new Set(`${czech}${onImage} „“–—\u00a0`)].filter(
        (char) => !points.has(char.codePointAt(0)!),
      );
      expect(missing, name).toEqual([]);
    }
  });

  it('vykreslení nesahá na síť — žádné písmo se nedotahuje za běhu', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input instanceof Request ? input.url : input));
      return Promise.reject(new Error('síť je v testu vypnutá'));
    }) as typeof fetch;
    try {
      await ogImage.default().arrayBuffer();
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toEqual([]);
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
    // Datum píše člověk podle pražského kalendáře; `toISOString()` je UTC, takže
    // by dnešní datum zapsané krátce po půlnoci vyšlo až do dvou do rána jako
    // „z budoucnosti" (na CI, které běží v UTC, stejně tak).
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(
      new Date(),
    );
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url.startsWith(SITE_URL), `cizí doména: ${entry.url}`).toBe(true);
      const lastModified = entry.lastModified;
      expect(typeof lastModified, `bez lastmod: ${entry.url}`).toBe('string');
      expect(String(lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // datum z budoucnosti je pro vyhledávač signál, že `lastmod` nemá věřit
      expect(String(lastModified) <= today, `datum v budoucnu: ${entry.url}`).toBe(true);
    }
  });

  it('lastmod není starší než doložená změna obsahu stránky (L1-11)', () => {
    // Datum se drží ručně (viz komentář v `app/sitemap.ts`) a zastará potichu:
    // /platformy tvrdily 12. 7. 2026, přestože se návody v `lib/brokers-catalog.ts`
    // — ze kterých stránka bere skoro celý obsah — od té doby měnily pětkrát.
    // Tabulka drží poslední DOLOŽENOU změnu viditelného obsahu; kdo obsah
    // veřejné stránky změní, přepíše datum v sitemapě a řádek tady.
    const lastContentChange: Record<string, string> = {
      // 10. 10. 2026: redesign přepsal texty všech veřejných stránek kromě právních
      '/': '2026-10-10',
      '/platformy': '2026-10-10',
      '/bezpecnost': '2026-10-10',
      '/cenik': '2026-10-11', // výčet funkcí obyčejnými slovy, titulek „Proč je Danero zdarma“
      '/demo/prehled': '2026-10-08', // demo bez naváděcího pruhu
      '/caste-otazky': '2026-10-10',
      '/jak-pocitame': '2026-10-10',
      '/kalkulacka': '2026-10-17', // odkazy na články průvodce pod pravidly (K6)
      '/pruvodce': '2026-10-10',
      '/pruvodce/limit-100-000-kc': '2026-10-10',
      '/pruvodce/pausalni-rezim-a-investice': '2026-10-10',
      '/o-projektu': '2026-10-10',
      '/podminky': '2026-10-11', // čl. 3 jmenuje stránku „Proč zdarma“ (znění 3.0 beze změny)
      '/soukromi': '2026-10-08',
    };
    const byPath = new Map(
      sitemap().map((entry) => [
        entry.url.replace(SITE_URL, '') || '/',
        String(entry.lastModified),
      ]),
    );
    const stale = Object.entries(lastContentChange)
      .filter(([path, changed]) => (byPath.get(path) ?? '') < changed)
      .map(
        ([path, changed]) => `${path}: sitemapa ${byPath.get(path) ?? 'chybí'}, obsah ${changed}`,
      );
    expect(stale).toEqual([]);
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
    const json = JSON.stringify([
      organizationJsonLd(),
      websiteJsonLd(),
      faqPageJsonLd(FAQ),
      ...(Object.keys(ARTICLES) as ArticlePath[]).map((path) => articleJsonLd(path)),
    ]);
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
    expect(landing).toContain('websiteJsonLd()');
    const faq = readFileSync(join(APP_DIR, 'caste-otazky', 'page.tsx'), 'utf8');
    expect(faq).toContain('faqPageJsonLd(FAQ)');
  });
});

/**
 * Změny z technického SEO auditu (15. 10. 2026, K1–K8). Většina z nich se
 * na stránce neprojeví vůbec — rozdíl je v hlavičce, v HTTP stavu nebo ve
 * strukturovaných datech — takže by se při další úpravě ztratily potichu.
 */
describe('ověření vyhledávačů z prostředí (K1)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez proměnných se žádný ověřovací tag nevypíše', () => {
    expect(siteVerification({})).toBeUndefined();
    // prázdná nebo jen mezerová hodnota je totéž co žádná
    expect(
      siteVerification({
        DANERO_SITE_VERIFICATION_GOOGLE: '',
        DANERO_SITE_VERIFICATION_BING: '  ',
        DANERO_SITE_VERIFICATION_SEZNAM: '\n',
      }),
    ).toBeUndefined();
  });

  it('každý vyhledávač dostane svůj tag: google-site-verification, msvalidate.01, seznam-wmt', () => {
    const verification = siteVerification({
      DANERO_SITE_VERIFICATION_GOOGLE: ' kod-google ',
      DANERO_SITE_VERIFICATION_BING: 'kod-bing',
      DANERO_SITE_VERIFICATION_SEZNAM: 'kod-seznam',
    });
    // přes resolver Nextu: tvar, ze kterého se skládají meta tagy hlavičky
    expect(resolveVerification(verification)).toEqual({
      google: ['kod-google'],
      other: { 'msvalidate.01': ['kod-bing'], 'seznam-wmt': ['kod-seznam'] },
    });
  });

  it('jen Seznam: žádný prázdný tag pro Google', () => {
    expect(siteVerification({ DANERO_SITE_VERIFICATION_SEZNAM: 'kod-seznam' })).toEqual({
      other: { 'seznam-wmt': 'kod-seznam' },
    });
  });

  it('kódy patří jen na úvodní stránku a čtou se za běhu, ne při buildu', async () => {
    expect(SITE_METADATA.verification, 'kořenová metadata platí pro každou stránku').toBeUndefined();
    const { generateMetadata } = await import('@/app/page');
    connection.mockClear();
    expect((await generateMetadata()).verification).toBeUndefined();
    // `connection()` drží metadata u požadavku, i kdyby úvod přestal být dynamický
    expect(connection).toHaveBeenCalled();
    // stejný modul, jiné prostředí: hodnota se nečte při načtení modulu
    vi.stubEnv('DANERO_SITE_VERIFICATION_SEZNAM', 'kod-seznam');
    expect((await generateMetadata()).verification).toEqual({
      other: { 'seznam-wmt': 'kod-seznam' },
    });
  }, 60_000);

  it('proměnné jsou zdokumentované pro vlastní instance', () => {
    const docs = ['.env.example', '../../docs/08-provoz.md', '../../docs/16-selfhosting.md'].map(
      (path) => readFileSync(join(import.meta.dirname, '..', path), 'utf8'),
    );
    for (const name of ['GOOGLE', 'BING', 'SEZNAM']) {
      for (const doc of docs) expect(doc).toContain(`DANERO_SITE_VERIFICATION_${name}`);
    }
  });
});

describe('/demo je skutečné přesměrování (K2)', () => {
  it('next.config přesměruje /demo na vstup do prohlídky dočasně (307)', async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    expect(rules).toContainEqual({
      source: '/demo',
      destination: '/demo/prehled',
      permanent: false,
    });
  });

  it('stránka /demo s redirect() se nevrátila — za loading.tsx z ní byla 200 s meta refresh', () => {
    expect(existsSync(join(APP_DIR, 'demo', 'page.tsx'))).toBe(false);
  });
});

describe('noindex pro demo a stránky hesel (K3)', () => {
  /** Stránky, které do vyhledávání nepatří, a jejich adresa. */
  const NOINDEX_PAGES: { path: string; metadata: () => Promise<Metadata> }[] = [
    {
      path: '/demo/portfolio',
      metadata: async () => (await import('@/app/demo/portfolio/page')).metadata,
    },
    {
      path: '/demo/portfolio/US0378331005',
      metadata: async () =>
        (await import('@/app/demo/portfolio/[isin]/page')).generateMetadata({
          params: Promise.resolve({ isin: 'US0378331005' }),
        }),
    },
    { path: '/demo/report', metadata: async () => (await import('@/app/demo/report/page')).metadata },
    {
      path: '/demo/simulator',
      metadata: async () => (await import('@/app/demo/simulator/page')).metadata,
    },
    {
      path: '/zapomenute-heslo',
      metadata: async () => (await import('@/app/(auth)/zapomenute-heslo/page')).metadata,
    },
    {
      path: '/nove-heslo',
      metadata: async () => (await import('@/app/(auth)/nove-heslo/page')).metadata,
    },
    {
      path: '/overeni-emailu',
      metadata: async () => (await import('@/app/(auth)/overeni-emailu/page')).metadata,
    },
    {
      path: '/overeni-emailu/hotovo',
      metadata: async () => (await import('@/app/(auth)/overeni-emailu/hotovo/page')).metadata,
    },
  ];

  it('NOINDEX je „noindex, follow“ — odkazy z těch stránek se dál počítají', () => {
    expect(resolveRobots(NOINDEX)?.basic).toBe('noindex, follow');
  });

  it('demo podstránky a stránky hesel a ověření mají noindex', { timeout: 60_000 }, async () => {
    for (const page of NOINDEX_PAGES) {
      const { robots } = await page.metadata();
      expect(resolveRobots(robots ?? null)?.basic, page.path).toBe('noindex, follow');
    }
  });

  it('žádná z nich není v sitemapě a nic ze sitemapy noindex nemá', () => {
    const paths = sitemap().map((entry) => entry.url.replace(SITE_URL, '') || '/');
    for (const page of NOINDEX_PAGES) expect(paths, page.path).not.toContain(page.path);
    for (const path of paths) {
      // robots zdědí stránka i z layoutu nad sebou, takže se kontroluje celá cesta
      const segments = path.split('/').filter(Boolean);
      const files = [join(APP_DIR, path, 'page.tsx')];
      for (let depth = 0; depth <= segments.length; depth++) {
        files.push(join(APP_DIR, ...segments.slice(0, depth), 'layout.tsx'));
      }
      for (const file of files.filter((candidate) => existsSync(candidate))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/NOINDEX|\brobots\s*:/);
      }
    }
  });

  it('metadata jdou do <head> všem robotům, i Seznamu a robotům AI bez JavaScriptu', () => {
    // bez toho Next streamuje metadata z generateMetadata na konec <body>
    // a ověřovací tag `seznam-wmt` na úvodu Seznam nenajde
    const limitedBots = nextConfig.htmlLimitedBots;
    expect(limitedBots).toBeInstanceOf(RegExp);
    for (const userAgent of [
      'Mozilla/5.0 (compatible; SeznamBot/4.0; +https://o-seznam.cz/napoveda/vyhledavani/seznambot-crawler/)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
    ]) {
      expect((limitedBots as RegExp).test(userAgent), userAgent).toBe(true);
    }
  });

  it('vstup do dema zůstává ve vyhledávání s vlastním popisem, ne s obecným popisem webu', async () => {
    const { metadata } = await import('@/app/demo/prehled/page');
    expect(Object.hasOwn(metadata, 'robots')).toBe(false);
    expect(metadata.description).toMatch(/smyšlen/);
    expect(metadata.description).not.toBe(SITE_METADATA.description);
  }, 60_000);
});

describe('WebSite na úvodní stránce (K4)', () => {
  it('nese jméno webu, adresu instance a jazyk', () => {
    expect(websiteJsonLd()).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      alternateName: new URL(SITE_URL).host,
      url: `${SITE_URL}/`,
      inLanguage: 'cs',
    });
  });
});

describe('datum a Article u článků a metodiky (K5)', () => {
  const PAGE_FILES: Record<ArticlePath, string> = {
    '/pruvodce/limit-100-000-kc': 'pruvodce/limit-100-000-kc/page.tsx',
    '/pruvodce/pausalni-rezim-a-investice': 'pruvodce/pausalni-rezim-a-investice/page.tsx',
    '/jak-pocitame': 'jak-pocitame/page.tsx',
  };
  const paths = Object.keys(ARTICLES) as ArticlePath[];

  it('každý článek má datum vzniku a poslední změny, ne z budoucnosti', () => {
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(
      new Date(),
    );
    for (const path of paths) {
      const { published, modified } = ARTICLES[path];
      expect(published, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(modified, path).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(published <= modified, path).toBe(true);
      expect(modified <= today, path).toBe(true);
    }
  });

  it('sitemapa bere datum ze stejného zdroje jako článek', () => {
    const byPath = new Map(
      sitemap().map((entry) => [entry.url.replace(SITE_URL, ''), String(entry.lastModified)]),
    );
    for (const path of paths) expect(byPath.get(path), path).toBe(ARTICLES[path].modified);
  });

  it('Article: titulek ze stránky, data, autor je projekt Danero s odkazem na /o-projektu', () => {
    for (const path of paths) {
      const data = articleJsonLd(path);
      expect(data['@type']).toBe('Article');
      expect(data.headline).toBe(ARTICLES[path].headline);
      expect(data.datePublished).toBe(ARTICLES[path].published);
      expect(data.dateModified).toBe(ARTICLES[path].modified);
      expect(data.mainEntityOfPage).toBe(`${SITE_URL}${path}`);
      // žádná osoba: jméno člověka do kódu nepatří (pravidlo 8)
      expect(data.author).toEqual({
        '@type': 'Organization',
        name: SITE_NAME,
        url: `${SITE_URL}/o-projektu`,
      });
      expect(JSON.stringify(data)).not.toContain('Person');
    }
  });

  it('pod titulkem stojí viditelné datum a vedle něj táž data pro vyhledávače', () => {
    for (const path of paths) {
      const html = renderToStaticMarkup(createElement(ArticleUpdated, { path }));
      const { modified } = ARTICLES[path];
      const [year, month, day] = modified.split('-').map(Number);
      expect(html).toContain(`<time dateTime="${modified}">`);
      expect(html.replace(/\u00a0/g, ' ')).toContain(
        `Aktualizováno <time dateTime="${modified}">${day}. ${month}. ${year}</time>`,
      );
      expect(html).toContain('application/ld+json');
      expect(html).toContain(`"dateModified":"${modified}"`);
    }
  });

  it('stránky datum vykreslují a titulek berou z téhož záznamu', () => {
    for (const path of paths) {
      const source = readFileSync(join(APP_DIR, PAGE_FILES[path]), 'utf8');
      expect(source, path).toMatch(/<ArticleUpdated path=\{?["']?(PATH|\/[^"'}]+)["']?\}? \/>/);
      expect(source, path).toMatch(/title=\{ARTICLES\[(PATH|'[^']+')\]\.headline\}/);
    }
  });
});

describe('odkazy z obsahu na články průvodce (K6)', () => {
  const read = (path: string): string => readFileSync(join(APP_DIR, path), 'utf8');
  const LIMIT = '/pruvodce/limit-100-000-kc';
  const PAUSAL = '/pruvodce/pausalni-rezim-a-investice';

  it('časté otázky, kalkulačka, metodika i úvod odkazují na články', () => {
    const expected: Record<string, string[]> = {
      'caste-otazky/faq.tsx': [LIMIT, PAUSAL],
      'kalkulacka/page.tsx': [LIMIT, PAUSAL],
      'jak-pocitame/page.tsx': [LIMIT, PAUSAL],
      'page.tsx': [LIMIT],
    };
    for (const [file, links] of Object.entries(expected)) {
      for (const link of links) {
        // JSX `href="…"` i pole `href: '…'` v datech stránky
        expect(read(file), `${file} → ${link}`).toMatch(new RegExp(`href(="|: ')${link}["']`));
      }
    }
  });

  it('cíle odkazů jsou skutečné stránky', () => {
    for (const path of [LIMIT, PAUSAL]) {
      expect(existsSync(join(APP_DIR, path, 'page.tsx')), path).toBe(true);
    }
  });

  it('odpověď FAQ s odkazy má v JSON-LD přesně tentýž text jako na stránce', () => {
    const item = FAQ.find((faq) => faq.q.startsWith('Musím kvůli investicím'));
    expect(item?.plain).toBeDefined();
    const text = renderToStaticMarkup(createElement('div', null, item!.a))
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text).toBe(item!.plain);
  });
});

describe('titulky nesou téma a vejdou se do výsledku vyhledávání (K7)', () => {
  // Google titulek delší než zhruba 60 znaků usekne
  it('metodika, časté otázky a kalkulačka', { timeout: 60_000 }, async () => {
    const titles = {
      '/jak-pocitame': (await import('@/app/jak-pocitame/page')).metadata.title,
      '/caste-otazky': (await import('@/app/caste-otazky/page')).metadata.title,
      '/kalkulacka': (await import('@/app/kalkulacka/page')).metadata.title,
    };
    for (const [path, title] of Object.entries(titles)) {
      expect(typeof title, path).toBe('string');
      expect(String(title).length, path).toBeLessThanOrEqual(60);
      expect(String(title), path).toMatch(/— Danero$/);
    }
    expect(String(titles['/jak-pocitame'])).toContain('daně z investic');
    expect(String(titles['/caste-otazky'])).toContain('Daně z investic');
  });
});

describe('kotvy u platforem (K8)', () => {
  it('každá platforma má na /platformy kotvu ze svého id a žádné id se neopakuje', () => {
    const html = renderToStaticMarkup(createElement(PlatformCatalog));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size, 'duplicitní id na stránce').toBe(ids.length);
    for (const platform of PLATFORMS) {
      expect(platform.id, platform.name).toMatch(/^[a-z0-9-]+$/);
      expect(ids, platform.name).toContain(platform.id);
    }
  });

  it('kotvy, na které se už odkazuje, zůstávají', () => {
    // veřejné adresy (fóra, odpovědi) — přejmenovat id znamená rozbít odkazy
    const ids = PLATFORMS.map((platform) => platform.id);
    for (const anchor of ['xtb', 'trading212', 'degiro', 'ibkr', 'revolut', 'portu']) {
      expect(ids).toContain(anchor);
    }
  });
});

describe('/bezpecnost a SECURITY.md slibují totéž (L1-04)', () => {
  // Stránka nálezce sama posílá hlásit „podle SECURITY.md" — kdo odkaz rozklikne,
  // nesmí vedle sebe vidět dvě různé lhůty. Do 9. 10. 2026 stálo na webu
  // „zpravidla do 24 hodin", v SECURITY.md 72 hodin a v sezóně pomaleji.
  const policy = readFileSync(join(import.meta.dirname, '..', '..', '..', 'SECURITY.md'), 'utf8');
  const page = readFileSync(join(APP_DIR, 'bezpecnost', 'page.tsx'), 'utf8').replace(/\s+/g, ' ');

  it('lhůta na potvrzení hlášení je na stránce stejná jako v SECURITY.md', () => {
    const hours = /Potvrzení přijetí do (\d+) hodin/.exec(policy)?.[1];
    expect(hours, 'SECURITY.md už lhůtu na potvrzení neuvádí — srovnej i stránku').toBeDefined();
    const promised = [...page.matchAll(/do (\d+) hodin/g)].map((match) => match[1]);
    expect(promised).toEqual([hours]);
  });

  it('stránka nezamlčí, že v sezóně přiznání trvá odpověď déle', () => {
    // `includes` místo `toContain`: při pádu by se jinak vypsal celý zdroj stránky
    expect(policy.includes('únor–duben'), 'SECURITY.md už sezónu nezmiňuje').toBe(true);
    expect(page.includes('únor–duben'), 'na /bezpecnost chybí zmínka o sezóně').toBe(true);
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
