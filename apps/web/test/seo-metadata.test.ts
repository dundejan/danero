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
import {
  SITE_METADATA,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_TAGLINE_HOW,
  SITE_TITLE,
  SITE_URL,
} from '@/lib/site';

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
      '/kalkulacka': '2026-10-10',
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
