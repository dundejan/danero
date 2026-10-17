import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NOT_TAX_ADVICE } from '@/components/shell-disclaimer';

/**
 * Tón veřejných stránek po revizi redesignu (10. 10. 2026).
 *
 * Zadání majitele: úvod nesmí znít marketingově, že je Danero zdarma, má říct
 * hned a věcně, a text, který nic nepřidává, patří pryč. Recenze přesto našla
 * šest reklamních sloganů v závěru stránek, „zdarma“ sedmkrát na úvodu a
 * trojici „bez placené verze, bez zkušební doby a bez karty“ na třech
 * stránkách. Tyhle testy drží to, co se dá spočítat — aby se to při další
 * úpravě textů potichu nevrátilo.
 */
vi.mock('@/lib/session', () => ({ currentUser: async () => null }));
// metadata úvodu čekají na požadavek (`connection()`), který test nemá
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  connection: async () => undefined,
}));
// rám stránky (lišta, patička) je asynchronní a k obsahu úvodu nepatří
vi.mock('@/components/marketing-page', async () => {
  const actual = await vi.importActual<typeof import('@/components/marketing-page')>(
    '@/components/marketing-page',
  );
  return {
    ...actual,
    MarketingPage: ({ children }: { children: ReactNode }) =>
      createElement('main', null, children),
    PageClosing: () => null,
  };
});
// živé komponenty aplikace mají vlastní texty i testy — tady jde o to, co
// kolem nich píše úvodní stránka
vi.mock('@/components/views/overview-view', () => ({ OverviewView: () => null }));
vi.mock('@/components/horizon-strip', () => ({ HorizonStrip: () => null }));
vi.mock('@/components/nav-rail', () => ({ SidebarNav: () => null }));
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

const WEB_DIR = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(WEB_DIR, path), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(join(WEB_DIR, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(WEB_DIR, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Veřejné stránky a to, z čeho se skládají — bez aplikace, dema a přihlášení. */
const PUBLIC_PAGES = [
  'app/page.tsx',
  'app/cenik/page.tsx',
  'app/o-projektu/page.tsx',
  'app/platformy/page.tsx',
  'app/caste-otazky/page.tsx',
  'app/kalkulacka/page.tsx',
  'app/pruvodce/page.tsx',
  'app/pruvodce/limit-100-000-kc/page.tsx',
  'app/pruvodce/pausalni-rezim-a-investice/page.tsx',
  'app/jak-pocitame/page.tsx',
  'app/bezpecnost/page.tsx',
  'app/podminky/page.tsx',
  'app/soukromi/page.tsx',
  'app/not-found.tsx',
];
const PUBLIC_SOURCES = [
  ...PUBLIC_PAGES,
  'app/caste-otazky/faq.tsx',
  'app/opengraph-image.tsx',
  'lib/site.ts',
  'components/marketing-page.tsx',
  'components/marketing-nav.tsx',
  'components/marketing-blocks.tsx',
  'components/guide-article.tsx',
  'components/filing-calculator.tsx',
  'components/platform-catalog.tsx',
];

/** Zdroj bez komentářů — komentář smí starý slogan citovat, stránka ne. */
const withoutComments = (source: string): string =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('závěr stránky je všude stejný a tichý (R1A-01, R1A-05)', () => {
  it('veřejná stránka si vlastní výzvu nepíše — závěr nemá žádný parametr', () => {
    const offenders = PUBLIC_PAGES.filter((page) => {
      const source = withoutComments(read(page));
      // jediný povolený tvar: <PageClosing /> — bez titulku, textu i volby tlačítka
      return /<PageClosing(?!\s*\/>)/.test(source) || /<(MarketingCta|DemoCta)\b/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('závěr je jedna věta a dvě akce: demo a založení účtu', () => {
    const shell = read('components/marketing-page.tsx');
    const closing = shell.slice(
      shell.indexOf('export async function PageClosing'),
      shell.indexOf('interface FooterLink'),
    );
    expect(closing.length).toBeGreaterThan(200);
    expect(closing).toContain('CLOSING_SENTENCE');
    expect(closing).toMatch(/href="\/demo\/prehled"[\s\S]*Vyzkoušet demo/);
    expect(closing).toMatch(/href="\/registrace"[\s\S]*Založit účet\s*</);
    // žádný nadpis (titulek velikosti hrdiny) a žádný černý pás, který by
    // v tmavém režimu splynul se stránkou
    expect(closing).not.toMatch(/<h[1-6]\b/);
    expect(closing).not.toMatch(/type-(display|headline|title-1)/);
    expect(closing).not.toMatch(/tone="black"|bg-black/);
    expect(closing).toContain('bg-canvas');
  });

  it('kde závěr nic nepřidává, stránka ho nemá', () => {
    // právní texty a 404 nikoho nikam nezvou; v kalkulačce nese obě akce verdikt
    for (const page of [
      'app/podminky/page.tsx',
      'app/soukromi/page.tsx',
      'app/not-found.tsx',
      'app/kalkulacka/page.tsx',
    ]) {
      expect(withoutComments(read(page)), page).not.toContain('PageClosing');
    }
  });

  it('ostatní veřejné stránky závěr mají — právě jednou', () => {
    const closed = PUBLIC_PAGES.filter(
      (page) =>
        ![
          'app/podminky/page.tsx',
          'app/soukromi/page.tsx',
          'app/not-found.tsx',
          'app/kalkulacka/page.tsx',
        ].includes(page),
    );
    for (const page of closed) {
      expect(withoutComments(read(page)).match(/<PageClosing \/>/g), page).toHaveLength(1);
    }
  });

  it('reklamní slogany se nevrátily', () => {
    const SLOGANS = [
      /hlídáme za tebe/i,
      /pohlídané celý rok/i,
      /Ať to za tebe hlídá/i,
      /Číst je fajn/i,
      /Kolik ze stovky máš/i,
      /hlídá celý rok, ne až v lednu/i,
      /Paragrafy jsme přečetli/i,
      /Vyzkoušej to na vymyšlených/i,
      /Než Danero pustíš k daním/i,
    ];
    const found: string[] = [];
    for (const file of ['app', 'components', 'lib'].flatMap(sourceFiles)) {
      const source = withoutComments(read(file));
      for (const slogan of SLOGANS) {
        if (slogan.test(source)) found.push(`${file}: ${slogan}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('„zdarma“ jednou v úvodu a jednou v pásu (R1A-06)', () => {
  async function landingHtml(): Promise<string> {
    const { default: LandingPage } = await import('@/app/page');
    return renderToStaticMarkup(await LandingPage({ searchParams: Promise.resolve({}) }));
  }
  const textOf = (html: string): string =>
    html
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

  it('úvodní stránka to řekne dvakrát: v titulku a v pásu „Proč je zdarma“', { timeout: 60_000 }, async () => {
    const html = await landingHtml();
    const mentions = textOf(html).match(/zdarma/gi) ?? [];
    expect(mentions).toHaveLength(2);
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Bezpečně a[ \u00a0]zdarma\.[\s\S]*<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Proč je zdarma<\/h2>/);
  });

  /**
   * Zadání majitele z 10. 10. 2026: úvod čte kdokoli, kdo investuje, ne
   * vývojář. Titulek slibuje „bezpečně a zdarma“ a perex obojí hned doloží
   * faktem — jinak by „bezpečně“ bylo prázdné tvrzení.
   */
  it('úvodní obrazovka dokládá „bezpečně“ faktem a odkazem na /bezpecnost', { timeout: 60_000 }, async () => {
    const html = await landingHtml();
    const hero = html.slice(0, html.indexOf('aria-label="Časové testy"'));
    const lede = /<p class="type-lede[^>]*>([\s\S]*?)<\/p>/.exec(hero)?.[1] ?? '';
    expect(lede).toMatch(/<a[^>]*href="\/bezpecnost"[^>]*>jen pro čtení<\/a>/);
    expect(textOf(lede)).toContain('data nikomu neprodává');
    // „zdarma“ dokládá, aniž slovo opakuje
    expect(textOf(lede)).toContain('Placenou verzi nemá');
    expect(textOf(lede)).not.toMatch(/zdarma/i);
  });

  it('úvod, patička, sdílený odkaz ani titulek nemluví jazykem vývojářů', { timeout: 60_000 }, async () => {
    const DEVELOPER_WORDS = /otevřen\S* kód|open[ -]?source|zdrojov\S* kód|osobní\S* projekt/i;
    const html = await landingHtml();
    const hero = textOf(html.slice(0, html.indexOf('aria-label="Časové testy"')));
    const site = await import('@/lib/site');
    const landing = await (await import('@/app/page')).generateMetadata();
    const texts = {
      'úvodní obrazovka': hero,
      'titulek úvodu': String(landing.title),
      'popis úvodu': String(landing.description),
      'výchozí titulek': site.SITE_TITLE,
      'výchozí popis': site.SITE_DESCRIPTION,
      'věty obrázku pro sdílení': `${site.SITE_TAGLINE} ${site.SITE_TAGLINE_HOW}`,
    };
    for (const [where, text] of Object.entries(texts)) {
      expect(text, where).not.toMatch(DEVELOPER_WORDS);
    }
    // patička: věta pod logem je táž jako první věta úvodu; „Zdrojový kód“
    // v ní zůstává jen jako odkaz ve sloupci Projekt
    const footer = read('components/marketing-page.tsx');
    expect(footer).toContain('{tidy(SITE_TAGLINE)}');
    expect(withoutComments(footer)).not.toMatch(/otevřen\S* kód|open[ -]?source|osobní\S* projekt/i);
  });

  it('„osobní projekt“ a „otevřený kód“ nestojí na žádné veřejné stránce mimo právní texty', () => {
    // Právní texty (/podminky čl. 8, /soukromi „Kdo tvoje data spravuje“) větu
    // „Danero je osobní projekt“ nesou dál — jejich znění se bez rozhodnutí
    // majitele nemění. Na „Proč zdarma“ mluví autor sám za sebe a oba výrazy
    // tam výslovně chtěl (s vysvětlením, co open-source znamená).
    const ALLOWED = ['app/podminky/page.tsx', 'app/soukromi/page.tsx', 'app/cenik/page.tsx'];
    const found = PUBLIC_SOURCES.filter((file) => !ALLOWED.includes(file)).filter((file) =>
      /otevřen\S* kód|open[ -]?source|osobní\S* projekt/i.test(withoutComments(read(file))),
    );
    expect(found).toEqual([]);
  });

  it('kalkulačka je v první obrazovce, ne až pod čarou', { timeout: 60_000 }, async () => {
    const html = await landingHtml();
    const hero = html.slice(0, html.indexOf('aria-label="Časové testy"'));
    expect(hero.length).toBeGreaterThan(200);
    expect(hero).toContain('href="/kalkulacka"');
    expect(hero).toContain('href="/demo/prehled"');
    expect(hero).toContain('href="/registrace"');
  });

  it('tabulka variant má jedinou výchozí metodu a žádný sloupec, který se nedá přečíst (R1A-03)', { timeout: 60_000 }, async () => {
    const html = await landingHtml();
    const table = /<table[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
    expect(table).toContain('Daň z investic');
    // „Základ daně 0 Kč → Daň 920 Kč“: základ byl jen z prodejů, daň i z dividend
    expect(table).not.toContain('Základ');
    expect(table.match(/výchozí/g)).toHaveLength(1);
    expect(table.match(/nejvýhodnější/g)).toHaveLength(1);
  });

  it('tlačítka neříkají „zdarma“ — je to přípona, ne informace', () => {
    const found = PUBLIC_SOURCES.filter((file) =>
      /(Založit účet|Vyzkoušet|Registrace) zdarma/.test(withoutComments(read(file))),
    );
    expect(found).toEqual([]);
  });

  it('trojice „bez placené verze, bez zkušební doby a bez karty“ stojí na jediné stránce', () => {
    const found = ['app', 'components']
      .flatMap(sourceFiles)
      .filter((file) => /bez zkušební doby/i.test(withoutComments(read(file))));
    expect(found).toEqual(['app/cenik/page.tsx']);
  });
});

/**
 * „Proč zdarma“ (`/cenik`) je krátká: úvod, nejvýš pět řádků faktů s proklikem,
 * příspěvek na provoz a sbalený výčet toho, co Danero umí. Do 10. 10. 2026
 * měla čtyři dvojice titulek + odstavce a výčet funkcí hned pod titulkem.
 */
describe('/cenik: krátký seznam faktů místo odstavců', () => {
  const source = withoutComments(read('app/cenik/page.tsx'));

  it('fakta jsou nejvýš pět řádků a každý vede někam, kde se dá ověřit', () => {
    const facts = source.slice(source.indexOf('const FACTS'), source.indexOf('];', source.indexOf('const FACTS')));
    const texts = [...facts.matchAll(/text:\s*'([^']+)'/g)].map((match) => match[1]!);
    const links = [...facts.matchAll(/href: ([^,]+),/g)].map((match) => match[1]!.trim());
    expect(texts.length).toBeGreaterThanOrEqual(3);
    expect(texts.length).toBeLessThanOrEqual(5);
    expect(links).toHaveLength(texts.length);
    expect(links).toEqual(expect.arrayContaining(["'/o-projektu'", 'SOURCE_URL', "'/bezpecnost'"]));
    // řádek o reklamách a prodeji dat dokládá „Ochrana soukromí“, řádek
    // o klíči k brokerovi „Bezpečnost“ — do 11. 10. 2026 vedly oba na Bezpečnost
    const target = (pattern: RegExp): string =>
      links[texts.findIndex((text) => pattern.test(text))] ?? '';
    expect(target(/bez reklam/)).toBe("'/soukromi'");
    expect(target(/Klíč k brokerovi/)).toBe("'/bezpecnost'");
    expect(facts).toContain("label: 'Ochrana soukromí'");
    // „open-source“ nesmí stát bez vysvětlení pro toho, kdo není vývojář
    const openSource = texts.find((text) => /open-source/.test(text)) ?? '';
    expect(openSource).toMatch(/kód je veřejný a kdokoli se může podívat/);
    // dvojice titulek + odstavec se nevrátily
    expect(source).not.toMatch(/<Split[^>]*title="(Proč se neplatí|Kde je háček|Zůstane to zdarma\?)"/);
  });

  it('výčet toho, co Danero umí, zůstal — sbalený, ale celý ve stránce', () => {
    // podmínky (čl. 3): „Co všechno služba umí, popisuje stránka Proč zdarma.“
    const details = /<details[\s\S]*?<\/details>/.exec(source)?.[0] ?? '';
    expect(details).toContain('Co všechno Danero umí');
    for (const list of ['WATCHING', 'DATA', 'FILING']) {
      expect(details).toContain(`items={${list}}`);
      const items = source.slice(source.indexOf(`const ${list}`), source.indexOf('];', source.indexOf(`const ${list}`)));
      expect(items.match(/^\s+'/gm)).toHaveLength(4);
    }
    expect(details).toContain('XML pro elektronické podání');
    // výčet nesmí být otevřený napořád — stránku by zase natáhl
    expect(details).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('výčet mluví obyčejnými slovy a části aplikace jmenuje stejně jako aplikace', () => {
    // Do 11. 10. 2026: „IBKR“, „Automatický denní sync“, „FIFO/LIFO, kurzy“,
    // „Simulátor prodeje“ a „neomezeně platforem“ — čte to kdokoli, kdo investuje.
    const items = ['WATCHING', 'DATA', 'FILING'].flatMap((list) => {
      const block = source.slice(source.indexOf(`const ${list}`), source.indexOf('];', source.indexOf(`const ${list}`)));
      return [...block.matchAll(/^\s+'([^']+)',$/gm)].map((match) => match[1]!);
    });
    expect(items).toHaveLength(12);
    for (const item of items) {
      expect(item, item).not.toMatch(/\bIBKR\b|\bsync\b|FIFO|LIFO|\bAPI\b|neomezeně/i);
      // části aplikace mají jedno jméno (docs/07, `nav-items.ts`)
      expect(item, item).not.toMatch(/Simulátor prodeje|Simulace|Daňový report|Výhled osvobození/);
    }
    const all = items.join('\n');
    expect(all).toMatch(/^Simulátor: /m);
    expect(all).toMatch(/^Report: /m);
    expect(all).toMatch(/^Horizont osvobození: /m);
    expect(all).toContain('Interactive Brokers');
  });

  it('příspěvek na provoz stojí hned pod fakty a nic neodemyká', () => {
    expect(source.indexOf('<SupportSplit')).toBeGreaterThan(source.indexOf('FACTS.map'));
    expect(source.lastIndexOf('<SupportSplit')).toBeLessThan(source.indexOf('<details'));
    expect(source).toMatch(/nic neodemkneš/);
    expect(source).toMatch(/dobrovolný příspěvek, ne platba za službu/);
  });
});

describe('patička: vymezení odkazem, ne odstavcem', () => {
  it('místo věty o daňovém poradenství je odkaz na článek 1 podmínek', () => {
    const shell = withoutComments(read('components/marketing-page.tsx'));
    const footer = shell.slice(shell.indexOf('export async function MarketingFooter'));
    // znění i cíl jsou z jedné konstanty, společné s patičkou aplikace a dema
    expect(footer).toMatch(/href=\{NOT_TAX_ADVICE\.href\}[\s\S]{0,160}\{NOT_TAX_ADVICE\.label\}/);
    expect(NOT_TAX_ADVICE).toEqual({
      href: '/podminky#co-danero-je',
      label: 'Není daňové poradenství',
    });
    // dlouhé znění do patičky nepatří…
    expect(footer).not.toMatch(/523\/1992|odpovídá poplatník/);
  });

  it('plné a závazné znění je v podmínkách, na kotvě, kam odkaz míří', () => {
    const terms = read('app/podminky/page.tsx').replace(/\s+/g, ' ');
    expect(terms).toContain('<h2 id="co-danero-je">1. Co Danero je (a co není)</h2>');
    expect(terms).toMatch(/není daňovým poradenstvím<\/strong> ve smyslu zákona č\. 523\/1992 Sb\./);
    expect(terms).toContain('daňového přiznání odpovídá vždy poplatník');
  });
});

describe('navigace a názvy stránek', () => {
  it('lišta má nejvýš čtyři odkazy a kalkulačka je mezi nimi (R1A-11)', () => {
    const nav = read('components/marketing-nav.tsx');
    const links = nav.slice(nav.indexOf('const LINKS'), nav.indexOf('];', nav.indexOf('const LINKS')));
    const hrefs = [...links.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
    expect(hrefs).toContain('/kalkulacka');
    expect(hrefs.length).toBeLessThanOrEqual(4);
    expect(read('app/kalkulacka/page.tsx')).toContain('<MarketingPage active="kalkulacka">');
  });

  it('stránka „Proč zdarma“ se jmenuje stejně v liště, v podmínkách i v titulku (R1A-19)', async () => {
    // čl. 3 podmínek: „Co všechno služba umí, popisuje stránka Proč zdarma.“
    // Do 11. 10. 2026 tam stálo „Ceník“ — jméno, které stránka od redesignu
    // nenese nikde, kam se čtenář podívá.
    const terms = read('app/podminky/page.tsx');
    expect(terms).toMatch(/<Link href="\/cenik">\s*Proč zdarma\s*<\/Link>/);
    expect(withoutComments(terms)).not.toMatch(/Ceník/);
    expect(read('components/marketing-nav.tsx')).toContain("href: '/cenik', label: 'Proč zdarma'");
    const { metadata } = await import('@/app/cenik/page');
    expect(String(metadata.title)).toBe('Proč je Danero zdarma');
    for (const file of PUBLIC_SOURCES) {
      expect(withoutComments(read(file)), file).not.toMatch(/Ceník/);
    }
    // a žádná cena: Danero nic neprodává
    expect(withoutComments(read('app/cenik/page.tsx'))).not.toMatch(/\d\s*Kč\s*(měsíčně|ročně|\/)/);
  });

  it('stránka 404 má vlastní titulek, ne výchozí titulek webu', async () => {
    const { metadata } = await import('@/app/not-found');
    expect(metadata.title).toBe('Stránka nenalezena — Danero');
    // značka <title> ve stránce se vykreslila vedle výchozího titulku a prohrála
    expect(withoutComments(read('app/not-found.tsx'))).not.toContain('<title>');
  });

  it('titulek stránky říká, kde čtenář je (R1A-17)', () => {
    expect(read('app/caste-otazky/page.tsx')).toContain('<PageHero title="Časté otázky" />');
    // „Průvodce“ nad „Průvodce daněmi z investic“ by stálo dvakrát pod sebou
    expect(withoutComments(read('app/pruvodce/page.tsx'))).not.toContain('eyebrow=');
  });
});

describe('dlouhý text se čte barvou textu (R1A-09)', () => {
  it('tělo článku ani právního textu není sázené druhotnou šedou', () => {
    const blocks = read('components/guide-article.tsx');
    for (const component of ['ArticleSection', 'Example', 'DisputedReading', 'Prose']) {
      const start = blocks.indexOf(`export function ${component}(`);
      const body = blocks.slice(start, blocks.indexOf('\nexport function', start + 1));
      // šedá smí zůstat jen popisku („Příklad“) a poznámce pod čarou — ty mají
      // `type-footnote`; text ke čtení (`type-reading`, `type-body`) ji mít nesmí
      const readingLines = body
        .split('\n')
        .filter((line) => /type-(reading|body)/.test(line) && !/type-footnote/.test(line));
      expect(readingLines.length, component).toBeGreaterThan(0);
      for (const line of readingLines) {
        expect(line, component).not.toContain('text-ink-muted');
      }
    }
  });
});
