import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/logo';
import { MarketingNav, type MarketingNavKey } from '@/components/marketing-nav';
import { currentUser } from '@/lib/session';
import { OPERATOR } from '@/lib/contact';
import { SOURCE_URL } from '@/lib/legal';

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
  // bez backdrop-blur: filter by z headeru udělal containing block pro fixed
  // scrim mobilního menu (nulová výška) — plné pozadí je i čitelnější
  return (
    <header className="sticky top-0 z-40 border-b border-linka/60 bg-pozadi">
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-plocha focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Přeskočit na obsah
      </a>
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Danero — úvodní stránka">
          <Logo className="text-lg" />
        </Link>
        <MarketingNav active={active} signedIn={Boolean(user)} />
      </div>
    </header>
  );
}

/** Hlavička podstránky: jednotný vzor eyebrow → H1 → perex (landing má hero vlastní). */
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
    <div className="pt-12 md:pt-16">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
        {eyebrow}
      </p>
      <h1 className="mt-3 max-w-3xl text-balance font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
        {title}
      </h1>
      {lede && <p className="mt-5 max-w-2xl text-lg text-inkoust-tlumeny">{lede}</p>}
    </div>
  );
}

/** Závěrečné CTA — stejný blok na landingu i podstránkách. */
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
  if (user) {
    return (
      <section className="mt-24 lg:mt-32">
        <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 px-6 py-12 text-center sm:py-16">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-inkoust-tlumeny">
            Účet už máš — stačí se do něj vrátit.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/prehled"
              className="inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:brightness-95"
            >
              Přejít do aplikace
            </Link>
          </div>
        </div>
      </section>
    );
  }
  const demoClass =
    primary === 'demo'
      ? 'inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:brightness-95'
      : 'inline-block rounded-md border border-linka-ovladaci bg-plocha px-6 py-3 font-semibold shadow-sm hover:border-ruzova hover:text-ruzova';
  const registerClass =
    primary === 'registrace'
      ? 'inline-block rounded-md bg-ruzova-syta px-6 py-3 font-semibold text-white hover:brightness-95'
      : 'inline-block rounded-md border border-linka-ovladaci bg-plocha px-6 py-3 font-semibold shadow-sm hover:border-ruzova hover:text-ruzova';
  return (
    <section className="mt-24 lg:mt-32">
      <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 px-6 py-12 text-center sm:py-16">
        <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-inkoust-tlumeny">{lede}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/demo/prehled" className={demoClass}>
            Vyzkoušet demo — bez registrace
          </Link>
          <Link href="/registrace" className={registerClass}>
            Založit účet zdarma
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Patička vypisuje telefon provozovatele z `DANERO_CONTACT_PHONE` (§ 1820 odst.
 * 1 písm. c OZ). Ta proměnná při `next build` k dispozici NENÍ — ověřeno čtyřmi
 * nasazeními, na kterých nepomohlo ani odebrání příznaku Sensitive, ani build
 * bez cache. Staticky předrenderovaná stránka si tedy zapekla `phone = null`
 * a telefon na ní nebyl vidět, i když byl ve Vercelu nastavený.
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
    <footer className="mt-24 border-t border-linka">
      <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-inkoust-tlumeny">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md space-y-3">
            <Logo className="text-base text-inkoust" />
            <p>
              Danero hlídá českým investorům daně z investic — limity, časové testy
              i podklady k přiznání.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-16 gap-y-8">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                Danero
              </p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/platformy" className="font-medium hover:text-inkoust">
                    Platformy
                  </Link>
                </li>
                <li>
                  <Link href="/kalkulacka" className="font-medium hover:text-inkoust">
                    Kalkulačka
                  </Link>
                </li>
                <li>
                  <Link href="/pruvodce" className="font-medium hover:text-inkoust">
                    Průvodce
                  </Link>
                </li>
                <li>
                  <Link href="/cenik" className="font-medium hover:text-inkoust">
                    Ceník
                  </Link>
                </li>
                <li>
                  <Link href="/demo/prehled" className="font-medium hover:text-inkoust">
                    Demo
                  </Link>
                </li>
                <li>
                  <Link href="/caste-otazky" className="font-medium hover:text-inkoust">
                    Časté otázky
                  </Link>
                </li>
                <li>
                  <Link href="/jak-pocitame" className="font-medium hover:text-inkoust">
                    Jak počítáme
                  </Link>
                </li>
                <li>
                  <Link href="/bezpecnost" className="font-medium hover:text-inkoust">
                    Bezpečnost
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
                Autor
              </p>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/o-projektu" className="font-medium hover:text-inkoust">
                    O projektu
                  </Link>
                </li>
                <li>
                  <a
                    href="https://jandunder.dev"
                    className="font-medium hover:text-inkoust"
                    target="_blank"
                    rel="noreferrer"
                  >
                    jandunder.dev
                  </a>
                </li>
                <li>
                  <a
                    href={SOURCE_URL}
                    className="font-medium hover:text-inkoust"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Zdrojový kód
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.linkedin.com/in/jan-dunder"
                    className="font-medium hover:text-inkoust"
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
                    className="font-medium hover:text-inkoust"
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
        <div className="mt-8 space-y-3 border-t border-linka pt-6">
          <p>
            Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu zákona
            č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
          </p>
          {/* Katalog platforem i mřížka na landingu ukazují 29 cizích log. Bez
              téhle věty se to čte jako „naši partneři" — vyvolání dojmu
              obchodního spojení je klamavá praktika (§ 5 odst. 1 písm. e)
              zák. č. 634/1992 Sb.) a odkazové užití známky je přípustné jen
              v souladu s poctivými zvyklostmi (§ 10 odst. 1 zák. č. 441/2003 Sb.).
              Nález E-3-06. */}
          <p>
            Názvy a loga brokerů, bank a burz jsou ochranné známky jejich vlastníků.
            Uvádíme je jen proto, aby ses poznal — Danero s nimi není nijak propojené
            a žádná z těch firem ho neschvaluje ani nesponzoruje.
          </p>
          <p>
            <Link href="/podminky" className="font-medium hover:text-inkoust">
              Podmínky užití
            </Link>{' '}
            ·{' '}
            <Link href="/soukromi" className="font-medium hover:text-inkoust">
              Ochrana soukromí
            </Link>{' '}
            ·{' '}
            {/* povinné poučení dle § 1820 odst. 1 písm. i) OZ musí být dohledatelné
                odjinud než z podmínek a z objednávky (nález E-39) */}
            <Link href="/odstoupeni" className="font-medium hover:text-inkoust">
              Odstoupení od smlouvy
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
    <div className="flex min-h-screen flex-col">
      <MarketingHeader active={active} />
      <main id="obsah" className="mx-auto w-full max-w-6xl flex-1 px-6">{children}</main>
      <MarketingFooter />
    </div>
  );
}
