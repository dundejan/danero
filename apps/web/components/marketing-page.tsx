import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/logo';
import { MarketingNav, type MarketingNavKey } from '@/components/marketing-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentUser } from '@/lib/session';
import { OPERATOR } from '@/lib/contact';
import { SOURCE_URL } from '@/lib/legal';
import { tidy } from '@/lib/typography';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Skořápka veřejných stránek v redakčním jazyce: přilepená průsvitná lišta,
 * obsah skládaný z pásů přes celou šířku okna (`Band`), černá závěrečná výzva
 * a patička. Hierarchii nese velikost titulků a střídání ploch (bílá / šedá /
 * černá), ne rámečky.
 *
 * Šířky: `wrap` (980 px) je čtecí sloupec pásu, `wrap-wide` (1056 px) drží
 * lištu, patičku a živé kusy rozhraní. Čitelnou šířku odstavce nese `measure`.
 */

/**
 * Jednotný kontejner veřejných stránek (lišta, patička, obsah mimo pásy).
 * Starší jméno pro třídu `wrap-wide` — v novém kódu piš třídu rovnou.
 */
export const CONTAINER = 'wrap-wide';

export async function MarketingHeader({ active }: { active?: MarketingNavKey }) {
  // Přihlášenému nemá hlavička nabízet registraci — veřejné stránky zůstávají
  // přístupné oběma, mění se jen akce účtu. currentUser() sahá na DB jen když
  // je přítomná session cookie, takže anonymní provoz nic nestojí.
  const user = await currentUser();
  // Materiál lišty leží ve VLASTNÍ vrstvě pod obsahem, ne na <header>:
  // backdrop-filter dělá z prvku kontejner pro `position: fixed`, takže by
  // scrim mobilního menu (potomek hlavičky) měl nulovou výšku.
  return (
    <header className="sticky top-0 z-40 pt-[env(safe-area-inset-top,0px)]">
      <div aria-hidden className="material-bar scroll-edge absolute inset-0 -z-10" />
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-floating"
      >
        Přeskočit na obsah
      </a>
      <div className="wrap-wide flex h-(--nav-height) items-center justify-between">
        <Link
          href="/"
          aria-label="Danero — úvodní stránka"
          className="-my-2 flex min-h-11 items-center"
        >
          <Logo className="text-[1.0625rem]" />
        </Link>
        <MarketingNav active={active} signedIn={Boolean(user)} />
      </div>
    </header>
  );
}

type BandTone = 'surface' | 'canvas' | 'black';

const BAND_TONE: Record<BandTone, string> = {
  surface: 'bg-surface',
  canvas: 'bg-canvas',
  // třída `dark` přepne tokeny uvnitř pásu, takže v něm platí tmavá paleta
  // bez ohledu na režim stránky (text, tlačítka i odkazy se přebarví samy)
  black: 'dark bg-black text-ink',
};

/**
 * Pás veřejné stránky: oddíl přes celou šířku okna s obsahem ve sloupci.
 * Stránka je sled pásů a sousední pásy střídají plochu — bílá (`surface`),
 * šedá (`canvas`), výjimečně černá (`black`, nejvýš jednou až dvakrát na
 * stránku: silný moment a závěrečná výzva). Dva pásy stejné plochy za sebou
 * splynou v jeden — to je v pořádku, když k sobě patří.
 *
 * Pás smí stát přímo v `<main>` stránky i uvnitř sloupce (`full-bleed` ho
 * roztáhne); obal stránky musí mít `overflow-x-clip` (`MarketingPage` má).
 * `wide` dá obsahu širší sloupec (živé kusy rozhraní, tabulky).
 */
export function Band({
  tone = 'surface',
  size = 'md',
  wide = false,
  className,
  children,
  ...props
}: React.ComponentProps<'section'> & {
  tone?: BandTone;
  /** Svislý rytmus: `md` běžný pás, `lg` pás s jedinou velkou myšlenkou. */
  size?: 'md' | 'lg';
  wide?: boolean;
}) {
  return (
    <section
      className={cn(
        'full-bleed',
        BAND_TONE[tone],
        size === 'lg' ? 'py-(--band-y-lg)' : 'py-(--band-y)',
        className,
      )}
      {...props}
    >
      <div className={wide ? 'wrap-wide' : 'wrap'}>{children}</div>
    </section>
  );
}

/**
 * Hlavička pásu: tichý řádek nad titulkem (běžná věta, žádné verzálky),
 * velký titulek a nejvýš jeden perex. `align="center"` jen u pásu s jedinou
 * myšlenkou; pás s obsahem vedle titulku nechává hlavičku vlevo.
 */
export function BandHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  as: Heading = 'h2',
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
  as?: 'h1' | 'h2';
  className?: string;
}) {
  const centered = align === 'center';
  return (
    <div className={cn(centered && 'flex flex-col items-center text-center', className)}>
      {eyebrow && <p className="type-callout mb-3 font-semibold text-ink-muted">{eyebrow}</p>}
      <Heading
        className={cn(
          Heading === 'h1' ? 'type-display' : 'type-headline',
          'text-balance',
          centered ? 'max-w-[20ch]' : 'max-w-[18ch]',
        )}
      >
        {tidy(title)}
      </Heading>
      {lede && (
        <p className="type-lede measure mt-5 text-pretty text-ink-muted md:mt-6">
          {typeof lede === 'string' ? tidy(lede) : lede}
        </p>
      )}
    </div>
  );
}

/**
 * Hlavička podstránky: tichý řádek, kde čtenář je → titulek → perex. Stojí
 * na bílé ploše nahoře stránky; pod ní pokračují pásy nebo článek.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="pt-14 md:pt-24">
      <p className="type-callout font-semibold text-ink-muted">{eyebrow}</p>
      <h1 className="type-headline mt-3 max-w-[20ch] text-balance">{tidy(title)}</h1>
      {lede && (
        <p className="type-lede measure mt-5 text-pretty text-ink-muted md:mt-6">{tidy(lede)}</p>
      )}
    </div>
  );
}

/**
 * Závěrečná výzva — stejný oddíl na všech veřejných stránkách: černý pás přes
 * celou šířku okna, jedna věta a nejvýš dvě tlačítka. Patička na něj doléhá
 * bez mezery.
 */
export async function MarketingCta({
  title,
  lede,
  primary = 'demo',
}: {
  title: string;
  lede: string;
  /** Co je plné tlačítko: demo (default) nebo registrace (ceník, kalkulačka). */
  primary?: 'demo' | 'registrace';
}) {
  // „Založit účet zdarma" pod článkem, který si čte přihlášený uživatel, je
  // slepá ulička — registrace ho jen pošle zpátky. Demo na cizích datech taky
  // ne, když má vlastní.
  const user = await currentUser();
  const filled = buttonVariants({ variant: 'primary', size: 'lg' });
  const quiet = buttonVariants({ variant: 'secondary', size: 'lg' });
  return (
    <Band tone="black" size="lg" className="mt-(--band-y)">
      <div className="flex flex-col items-center text-center">
        <h2 className="type-headline max-w-[20ch] text-balance">{tidy(title)}</h2>
        <p className="type-lede measure mt-5 text-pretty text-ink-muted">
          {user ? 'Účet už máš — stačí se do něj vrátit.' : tidy(lede)}
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {user ? (
            <Link href="/prehled" className={filled}>
              Přejít do aplikace
            </Link>
          ) : (
            <>
              <Link href="/demo/prehled" className={primary === 'demo' ? filled : quiet}>
                Vyzkoušet demo — bez registrace
              </Link>
              <Link href="/registrace" className={primary === 'registrace' ? filled : quiet}>
                Založit účet zdarma
              </Link>
            </>
          )}
        </div>
      </div>
    </Band>
  );
}

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

/** Sloupec odkazů v patičce. Na telefonu má každý řádek 44 px na prst. */
function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  const linkClass = 'flex min-h-11 items-center hover:text-ink md:min-h-0 md:py-1';
  return (
    <div>
      <p className="font-semibold text-ink">{title}</p>
      <ul className="mt-1 md:mt-2.5">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className={cn(linkClass, 'break-all')}
                // e-mail otevírá poštovního klienta, nové okno k tomu nepotřebuje
                {...(link.href.startsWith('mailto:')
                  ? {}
                  : { target: '_blank', rel: 'noreferrer' })}
              >
                {link.label}
              </a>
            ) : (
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Patička vypisuje kontakt provozovatele z prostředí (`DANERO_CONTACT_EMAIL`).
 * Proměnné označené ve Vercelu jako citlivé při `next build` k dispozici
 * NEJSOU — ověřeno čtyřmi nasazeními, na kterých nepomohlo ani odebrání
 * příznaku Sensitive, ani build bez cache. Staticky předrenderovaná stránka si
 * tak zapekla prázdnou hodnotu a údaj na ní nebyl vidět, i když byl nastavený.
 *
 * `connection()` zastaví předrenderování, takže se patička vykreslí až při
 * požadavku, kdy proměnná existuje. Je schválně TADY a ne jako
 * `export const dynamic` na stránkách: patičku má každá marketingová stránka,
 * takže by ten příznak musel být na dvanácti místech a u třinácté by se na něj
 * zapomnělo. Cena je, že se veřejné stránky renderují při požadavku — u statických
 * marketingových stránek zanedbatelné, správnost povinného údaje je přednější.
 */
export async function MarketingFooter() {
  await connection();
  return (
    <footer className="type-footnote bg-canvas text-ink-muted">
      <div className="wrap-wide pb-[max(2rem,env(safe-area-inset-bottom))] pt-10 md:pt-14">
        <div className="grid grid-cols-2 gap-x-8 gap-y-8 md:grid-cols-[minmax(0,5fr)_repeat(3,minmax(0,3fr))]">
          <div className="col-span-2 max-w-xs md:col-span-1">
            <Logo className="text-[1.0625rem] text-ink" />
            <p className="mt-4">
              Danero hlídá českým investorům daně z investic — limity, časové testy
              i podklady k přiznání.
            </p>
          </div>
          <FooterColumn
            title="Danero"
            links={[
              { href: '/platformy', label: 'Platformy' },
              { href: '/kalkulacka', label: 'Kalkulačka' },
              { href: '/cenik', label: 'Ceník' },
              { href: '/demo/prehled', label: 'Demo' },
            ]}
          />
          <FooterColumn
            title="Jak to funguje"
            links={[
              { href: '/pruvodce', label: 'Průvodce' },
              { href: '/caste-otazky', label: 'Časté otázky' },
              { href: '/jak-pocitame', label: 'Jak počítáme' },
              { href: '/bezpecnost', label: 'Bezpečnost' },
            ]}
          />
          {/* § 1820 odst. 1 písm. c) OZ: adresa, telefon i e-mail musí být
              k dispozici PŘED uzavřením smlouvy, tedy na veřejných stránkách —
              ne až v potvrzovacím e-mailu (nález E-3-02). E-mail je tady.
              Telefon tu schválně NENÍ: povinnost plní `/podminky` (odkaz je
              o řádek níž) a potvrzení objednávky na trvalém nosiči. Vypisovat
              ho na všech dvanácti veřejných stránkách povinnost nepřidává, jen
              zve k volání, které nikdo nezvedne. Preferovaný kanál je e-mail. */}
          <FooterColumn
            title="Autor"
            links={[
              { href: '/o-projektu', label: 'O projektu' },
              { href: 'https://jandunder.dev', label: 'jandunder.dev', external: true },
              { href: SOURCE_URL, label: 'Zdrojový kód', external: true },
              {
                href: 'https://www.linkedin.com/in/jan-dunder',
                label: 'LinkedIn',
                external: true,
              },
              { href: `mailto:${OPERATOR.email}`, label: OPERATOR.email, external: true },
            ]}
          />
        </div>

        <div className="mt-10 border-t border-line pt-6">
          <p className="max-w-[52rem]">
            Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu zákona
            č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
          </p>
          {/* Do 8. 10. 2026 tu stálo upozornění, že loga brokerů jsou známky
              jejich vlastníků a Danero s nimi není propojené (nález E-3-06).
              Zákon ho nevyžaduje, byla to pojistka — provozovatel ji vědomě
              vypustil. Nevracej ji jen proto, že ji další audit navrhne znovu. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <p className="flex flex-wrap gap-x-6">
              <Link href="/podminky" className="flex min-h-11 items-center hover:text-ink">
                Podmínky užití
              </Link>
              <Link href="/soukromi" className="flex min-h-11 items-center hover:text-ink">
                Ochrana soukromí
              </Link>
            </p>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Obal celé veřejné stránky: lišta + obsah ve sloupci + patička. */
export function MarketingPage({
  active,
  children,
}: {
  active?: MarketingNavKey;
  children: React.ReactNode;
}) {
  return (
    // overflow-x-clip: pásy jdou přes celou šířku okna (`full-bleed`)
    <div className="flex min-h-svh flex-col overflow-x-clip bg-surface">
      <MarketingHeader active={active} />
      {/* stránka bez závěrečné výzvy (podmínky, soukromí, 404) si pod obsahem
          drží odstup od patičky; pás (i černá výzva) na ni naopak doléhá */}
      <main
        id="obsah"
        className="wrap-wide flex-1 [&>:last-child:not(.full-bleed)]:mb-(--band-y-lg)"
      >
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
