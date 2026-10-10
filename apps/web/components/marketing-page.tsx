import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/logo';
import { MarketingNav, type MarketingNavKey } from '@/components/marketing-nav';
import { NOT_TAX_ADVICE } from '@/components/shell-disclaimer';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentUser } from '@/lib/session';
import { OPERATOR } from '@/lib/contact';
import { SOURCE_URL } from '@/lib/legal';
import { SITE_TAGLINE } from '@/lib/site';
import { buttonVariants } from '@/components/ui/button';
import { TextLink } from '@/components/ui/link';
import { cn } from '@/lib/utils';
import { tidy } from '@/lib/typography';

/**
 * Skořápka veřejných stránek v redakčním jazyce: přilepená průsvitná lišta,
 * obsah skládaný z pásů přes celou šířku okna (`Band`), tichý závěr stránky
 * (`PageClosing`) a patička. Hierarchii nese velikost titulků a střídání ploch
 * (bílá / šedá), ne rámečky.
 *
 * Šířka: jediný sloupec `wrap-wide` (1056 px) drží lištu, titulek stránky,
 * obsah pásů i patičku — levá hrana je na celé stránce jedna. Čitelnou šířku
 * odstavce nese `measure`.
 */

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
          className="-my-2 flex min-h-11 items-center active:opacity-60"
        >
          <Logo className="text-[1.0625rem]" />
        </Link>
        <MarketingNav active={active} signedIn={Boolean(user)} />
      </div>
    </header>
  );
}

type BandTone = 'surface' | 'canvas';

const BAND_TONE: Record<BandTone, string> = {
  surface: 'bg-surface',
  canvas: 'bg-canvas',
};

/**
 * Pás veřejné stránky: oddíl přes celou šířku okna s obsahem ve sloupci.
 * Stránka je sled pásů a sousední pásy střídají plochu — bílá (`surface`)
 * a šedá (`canvas`). Dva pásy stejné plochy za sebou splynou v jeden — to je
 * v pořádku, když k sobě patří.
 *
 * Černý pás (`black`) tu býval pro závěrečnou výzvu a zanikl s ní
 * (10. 10. 2026): v tmavém režimu měl stejnou plochu jako stránka, takže
 * z něj zbyl jen prázdný pruh a osamocený nadpis (nález R1A-01). Nevracej ho
 * bez plochy, která se od stránky liší v obou režimech.
 *
 * Pás smí stát přímo v `<main>` stránky i uvnitř sloupce (`full-bleed` ho
 * roztáhne); obal stránky musí mít `overflow-x-clip` (`MarketingPage` má).
 * Obsah pásu stojí ve stejném sloupci jako titulek stránky (`PageHero`).
 */
export function Band({
  tone = 'surface',
  className,
  children,
  ...props
}: React.ComponentProps<'section'> & {
  tone?: BandTone;
}) {
  return (
    <section
      className={cn('full-bleed', BAND_TONE[tone], 'py-(--band-y)', className)}
      {...props}
    >
      <div className="wrap-wide">{children}</div>
    </section>
  );
}

/**
 * Hlavička pásu: tichý řádek nad titulkem (běžná věta, žádné verzálky),
 * velký titulek a nejvýš jeden perex. `align="center"` jen u pásu s jedinou
 * myšlenkou; pás s obsahem vedle titulku nechává hlavičku vlevo.
 *
 * `id` dostane nadpis — pás se jím pojmenuje (`<Band aria-labelledby="…">`).
 */
export function BandHeading({
  id,
  eyebrow,
  title,
  lede,
  align = 'left',
  as: Heading = 'h2',
  className,
}: {
  id?: string;
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
        id={id}
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
 * Hlavička podstránky: tichý řádek, kde čtenář je (`eyebrow`, volitelný —
 * stránka, jejíž titulek to říká sám, ho nepotřebuje) → titulek → perex.
 * Stojí na bílé ploše nahoře stránky; pod ní pokračují pásy nebo článek.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="pt-14 md:pt-24">
      {eyebrow && <p className="type-callout mb-3 font-semibold text-ink-muted">{eyebrow}</p>}
      <h1 className="type-headline max-w-[20ch] text-balance">{tidy(title)}</h1>
      {lede && (
        <p className="type-lede measure mt-5 text-pretty text-ink-muted md:mt-6">{tidy(lede)}</p>
      )}
    </div>
  );
}

/** Jediná věta závěru stránky — všude stejná, a proto tady, ne ve stránkách. */
export const CLOSING_SENTENCE =
  'Demo je celá aplikace nad ukázkovým portfoliem. Nic se v něm neukládá.';

/**
 * Závěr stránky — na všech veřejných stránkách tentýž a tichý: jedna věcná
 * věta a dvě akce na stejném místě (demo, založení účtu). Nemá titulek ani
 * vlastní text podle stránky; do 10. 10. 2026 měla každá stránka svůj slogan
 * velikostí titulku na černém pásu přes třetinu okna a v tmavém režimu pás
 * splýval se stránkou (nálezy R1A-01 a R1A-05). Proto žádné parametry.
 *
 * Plocha je `canvas` — od stránky se liší ve světlém i tmavém režimu
 * a navazuje na patičku, od které ji dělí vlásová linka. Pás před závěrem má
 * proto být bílý (`surface`), jinak by s ním splynul. Na předchozí pás doléhá;
 * odstup si drží jen od obsahu, který pásem není (článek).
 *
 * Kde závěr nic nepřidává, stránka ho nemá: právní texty, 404 a kalkulačka
 * (tam obě akce nese verdikt).
 */
export async function PageClosing() {
  // „Založit účet“ pod článkem, který si čte přihlášený uživatel, je slepá
  // ulička — registrace ho jen pošle zpátky. Demo na cizích datech taky ne,
  // když má vlastní.
  const user = await currentUser();
  const action = buttonVariants({ variant: 'tinted' });
  return (
    <section
      aria-label={user ? 'Zpátky do aplikace' : 'Vyzkoušet Danero'}
      className="full-bleed bg-canvas [:not(.full-bleed)+&]:mt-(--band-y)"
    >
      <div className="wrap-wide">
        <div className="flex flex-col gap-x-10 gap-y-4 border-b border-line py-10 md:flex-row md:items-center md:justify-between md:py-12">
          <p className="type-reading measure text-pretty">
            {tidy(user ? 'Účet už máš — stačí se do něj vrátit.' : CLOSING_SENTENCE)}
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2">
            {user ? (
              <Link href="/prehled" className={action}>
                Přejít do aplikace
              </Link>
            ) : (
              <>
                <Link href="/demo/prehled" className={action}>
                  Vyzkoušet demo
                </Link>
                <TextLink href="/registrace" chevron>
                  Založit účet
                </TextLink>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

/** Sloupec odkazů v patičce. Na telefonu má každý řádek 44 px na prst. */
function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  // `active:` je odezva na dotyku — zvýraznění prohlížeče je vypnuté globálně
  const linkClass =
    'flex min-h-11 items-center hover:text-ink active:opacity-60 md:min-h-0 md:py-1';
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
            {/* jen co Danero je: že je zdarma, říká titulek úvodu a stránka
                „Proč zdarma“ (odkaz vedle), a o kódu mluví až odkaz „Zdrojový
                kód“ — patička na každé stránce neopakuje ani jedno */}
            <p className="mt-4">{tidy(SITE_TAGLINE)}</p>
          </div>
          <FooterColumn
            title="Danero"
            links={[
              { href: '/platformy', label: 'Platformy' },
              { href: '/kalkulacka', label: 'Kalkulačka' },
              { href: '/cenik', label: 'Proč zdarma' },
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
          {/* Osobní odkazy autora (web, LinkedIn) jsou na `/o-projektu`; demo je
              v liště každé stránky — patička je neopakuje. */}
          <FooterColumn
            title="Projekt"
            links={[
              { href: '/o-projektu', label: 'O projektu' },
              { href: SOURCE_URL, label: 'Zdrojový kód', external: true },
              { href: `mailto:${OPERATOR.email}`, label: OPERATOR.email, external: true },
            ]}
          />
        </div>

        <div className="mt-10 border-t border-line pt-4">
          {/* Do 10. 10. 2026 tu stála celá věta „Danero je výpočetní a evidenční
              nástroj, nikoli daňové poradenství ve smyslu zákona č. 523/1992 Sb.
              …“. Majitel ji z patičky vyřadil (právní texty na webu jen v míře,
              kterou zákon chce): vymezení teď nese krátký odkaz na článek 1
              podmínek, kde je závazné znění. Hlídá `test/public-pages.test.ts`.

              Do 8. 10. 2026 tu stálo i upozornění, že loga brokerů jsou známky
              jejich vlastníků a Danero s nimi není propojené (nález E-3-06).
              Zákon ho nevyžaduje, byla to pojistka — provozovatel ji vědomě
              vypustil. Nevracej ji jen proto, že ji další audit navrhne znovu. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <p className="flex flex-wrap gap-x-6">
              <Link
                href="/podminky"
                className="flex min-h-11 items-center hover:text-ink active:opacity-60"
              >
                Podmínky užití
              </Link>
              <Link
                href="/soukromi"
                className="flex min-h-11 items-center hover:text-ink active:opacity-60"
              >
                Ochrana soukromí
              </Link>
              <Link
                href={NOT_TAX_ADVICE.href}
                className="flex min-h-11 items-center hover:text-ink active:opacity-60"
              >
                {NOT_TAX_ADVICE.label}
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
      {/* stránka bez závěru (podmínky, soukromí, 404, kalkulačka) si pod
          obsahem drží odstup od patičky; pás i závěr na ni naopak doléhají */}
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
