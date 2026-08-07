import Link from 'next/link';

/**
 * Stavební bloky článků průvodce (/pruvodce/<slug>): dlouhý text skládáme
 * z jednotných prvků, ať mají všechny články stejnou typografii — repo nemá
 * typography plugin a ruční třídy v každém článku by se časem rozjely.
 */

/** Tělo článku: čitelná šířka pod hero blokem. */
export function ArticleBody({ children }: { children: React.ReactNode }) {
  return <article className="mt-10 max-w-3xl">{children}</article>;
}

/** Úvodní odstavec — krátká odpověď článku; tučnou část označí článek přes <strong>. */
export function ArticleIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-lg leading-relaxed text-inkoust-tlumeny [&_strong]:font-semibold [&_strong]:text-inkoust">
      {children}
    </p>
  );
}

/** Sekce článku: nadpis + odstavce a bloky s jednotnými mezerami. */
export function ArticleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-inkoust-tlumeny [&_strong]:font-semibold [&_strong]:text-inkoust">
        {children}
      </div>
    </section>
  );
}

/** Odrážkový seznam uvnitř sekce. */
export function ArticleList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

/** Rámeček s konkrétním příkladem — čísla řeknou víc než poučky. */
export function Example({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-linka bg-plocha p-5">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
        Příklad
      </p>
      {title && <p className="mt-2 font-semibold">{title}</p>}
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-inkoust-tlumeny [&_strong]:font-semibold [&_strong]:text-inkoust">
        {children}
      </div>
    </div>
  );
}

/** Rámeček pro poctivě označený sporný výklad (stejně jako v metodice aplikace). */
export function DisputedReading({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-ruzova/30 bg-ruzova/5 p-5 text-sm leading-relaxed text-inkoust-tlumeny">
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
        Sporný výklad
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

/** Interní odkaz ve stylu ostatních marketingových stránek. */
export function ArticleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-ruzova-text underline underline-offset-2">
      {children}
    </Link>
  );
}

/** Pata článku: platnost pravidel, další čtení a cesta zpět na rozcestník. */
export function ArticleFooter({ next }: { next: { href: string; title: string }[] }) {
  return (
    <footer className="mt-12 border-t border-linka pt-6">
      <p className="text-xs text-inkoust-tlumeny">
        Článek vychází z pravidel pro zdaňovací období 2025 a 2026 (zákon č. 586/1992 Sb.,
        o daních z příjmů); sporné výklady poctivě označujeme. Danero je výpočetní
        a evidenční nástroj, ne daňové poradenství — za přiznání odpovídá poplatník.
      </p>
      <p className="mt-4 font-mono text-xs font-semibold uppercase tracking-wide text-inkoust-tlumeny">
        Další čtení
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {next.map((odkaz) => (
          <li key={odkaz.href}>
            <ArticleLink href={odkaz.href}>{odkaz.title}</ArticleLink>
          </li>
        ))}
        <li>
          <ArticleLink href="/pruvodce">Všechny články průvodce</ArticleLink>
        </li>
      </ul>
    </footer>
  );
}
