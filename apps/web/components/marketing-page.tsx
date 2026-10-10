import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/logo';
import { MarketingNav, type MarketingNavKey } from '@/components/marketing-nav';
import { currentUser } from '@/lib/session';
import { OPERATOR } from '@/lib/contact';
import { SOURCE_URL } from '@/lib/legal';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Jednotný kontejner veřejných stránek: stejná šířka i okraje pro hlavičku,
 * obsah a patičku, takže logo, text a patička drží jednu svislou osu.
 */
export const CONTAINER = 'mx-auto w-full max-w-[70rem] px-5 md:px-8';

/** Odkaz v patičce: na dotyku 44 px vysoký cíl, s myší běžný řádek. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center hover:text-ink md:min-h-0 md:py-1';

/**
 * Jednotný shell veřejných (marketingových) stránek: sticky hlavička s plnou
 * navigací, stejná šířka kontejneru (max-w-6xl) a plná patička — VŠUDE stejné,
 * landing i podstránky. Obsah stránek si čitelnost řeší vnitřními max-w.
 */

export async function MarketingHeader({ active }: { active?: MarketingNavKey }) {
  // Přihlášenému nemá hlavička nabízet registraci — marketingové stránky
  // zůstávají přístupné oběma, mění se jen akce účtu. currentUser() sahá na DB
  // jen když je přítomná session cookie, takže anonymní provoz nic nestojí.
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
      <div className={cn(CONTAINER, 'flex h-12 items-center justify-between')}>
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

/**
 * Hlavička podstránky: tichý řádek s názvem sekce → H1 → perex. Řádek nad
 * titulkem je běžná věta v šedé, ne verzálkový štítek (úvodní stránka má
 * hlavičku vlastní).
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
    <div className="pt-14 md:pt-20">
      <p className="type-callout font-medium text-ink-muted">{eyebrow}</p>
      <h1 className="type-title-1 mt-2 max-w-[22ch] text-balance md:text-[3rem] md:leading-[1.07] md:tracking-[-0.028em]">
        {title}
      </h1>
      {lede && <p className="type-lede mt-5 max-w-[54ch] text-pretty text-ink-muted">{lede}</p>}
    </div>
  );
}

/**
 * Závěrečná výzva — stejný blok na úvodní stránce i podstránkách. Bez rámečku
 * a bez tónované plochy: odděluje ji vzduch a vlásová linka, jediná sytá
 * barva je na hlavním tlačítku.
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
    <section className="mt-28 border-t border-line/70 pt-20 text-center md:mt-36 md:pt-24">
      <h2 className="type-title-1 mx-auto max-w-[20ch] text-balance">{title}</h2>
      <p className="type-lede mx-auto mt-4 max-w-[46ch] text-pretty text-ink-muted">
        {user ? 'Účet už máš — stačí se do něj vrátit.' : lede}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
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
    </section>
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
    <footer className="mt-28 bg-canvas md:mt-36">
      <div className={cn(CONTAINER, 'type-caption py-10 text-ink-muted')}>
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs space-y-3">
            <Logo className="text-[0.9375rem] text-ink" />
            <p>
              Danero hlídá českým investorům daně z investic — limity, časové testy
              i podklady k přiznání.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-8">
            <div>
              <p className="font-semibold text-ink">
                Danero
              </p>
              <ul className="mt-2">
                <li>
                  <Link href="/platformy" className={FOOTER_LINK}>
                    Platformy
                  </Link>
                </li>
                <li>
                  <Link href="/kalkulacka" className={FOOTER_LINK}>
                    Kalkulačka
                  </Link>
                </li>
                <li>
                  <Link href="/pruvodce" className={FOOTER_LINK}>
                    Průvodce
                  </Link>
                </li>
                <li>
                  <Link href="/cenik" className={FOOTER_LINK}>
                    Ceník
                  </Link>
                </li>
                <li>
                  <Link href="/demo/prehled" className={FOOTER_LINK}>
                    Demo
                  </Link>
                </li>
                <li>
                  <Link href="/caste-otazky" className={FOOTER_LINK}>
                    Časté otázky
                  </Link>
                </li>
                <li>
                  <Link href="/jak-pocitame" className={FOOTER_LINK}>
                    Jak počítáme
                  </Link>
                </li>
                <li>
                  <Link href="/bezpecnost" className={FOOTER_LINK}>
                    Bezpečnost
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-ink">
                Autor
              </p>
              <ul className="mt-2">
                <li>
                  <Link href="/o-projektu" className={FOOTER_LINK}>
                    O projektu
                  </Link>
                </li>
                <li>
                  <a
                    href="https://jandunder.dev"
                    className={FOOTER_LINK}
                    target="_blank"
                    rel="noreferrer"
                  >
                    jandunder.dev
                  </a>
                </li>
                <li>
                  <a
                    href={SOURCE_URL}
                    className={FOOTER_LINK}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zdrojový kód
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.linkedin.com/in/jan-dunder"
                    className={FOOTER_LINK}
                    target="_blank"
                    rel="noreferrer"
                  >
                    LinkedIn
                  </a>
                </li>
                {/* § 1820 odst. 1 písm. c) OZ: adresa, telefon i e-mail musí být
                    k dispozici PŘED uzavřením smlouvy, tedy na veřejných
                    stránkách — ne až v potvrzovacím e-mailu (nález E-3-02).
                    Telefon se vypíše, jen když je nastavený DANERO_CONTACT_PHONE. */}
                <li>
                  <a
                    href={`mailto:${OPERATOR.email}`}
                    className={FOOTER_LINK}
                  >
                    {OPERATOR.email}
                  </a>
                </li>
                {/* Telefon tu schválně NENÍ. § 1820 odst. 1 písm. c) chce, aby
                    byl k dispozici před uzavřením smlouvy — to plní `/podminky`
                    (odkaz je v patičce hned vedle) a potvrzení objednávky na
                    trvalém nosiči. Vypisovat ho na všech dvanácti veřejných
                    stránkách povinnost nepřidává, jen zve k volání, které
                    nikdo nezvedne. Preferovaný kanál je e-mail. */}
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-8 space-y-3 border-t border-line pt-6 pb-[env(safe-area-inset-bottom,0px)]">
          <p>
            Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu zákona
            č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
          </p>
          {/* Do 8. 10. 2026 tu stálo upozornění, že loga brokerů jsou známky
              jejich vlastníků a Danero s nimi není propojené (nález E-3-06).
              Zákon ho nevyžaduje, byla to pojistka — provozovatel ji vědomě
              vypustil. Nevracej ji jen proto, že ji další audit navrhne znovu. */}
          <p>
            <Link href="/podminky" className={FOOTER_LINK}>
              Podmínky užití
            </Link>{' '}
            ·{' '}
            <Link href="/soukromi" className={FOOTER_LINK}>
              Ochrana soukromí
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Obal celé marketingové stránky: hlavička + obsah v jednotném kontejneru + patička. */
export function MarketingPage({
  active,
  children,
}: {
  active?: MarketingNavKey;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col bg-surface">
      <MarketingHeader active={active} />
      <main id="obsah" className={cn(CONTAINER, 'flex-1')}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
