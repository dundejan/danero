import Link from 'next/link';
import { ANCHOR_OFFSET } from '@/components/long-read';
import { cn } from '@/lib/utils';

/**
 * Stavební bloky článků průvodce (/pruvodce/<slug>): dlouhý text skládáme
 * z jednotných prvků, ať mají všechny články stejnou typografii — repo nemá
 * typography plugin a ruční třídy v každém článku by se časem rozjely.
 */

/** Tělo článku: čitelná šířka pod hero blokem. */
export function ArticleBody({ children }: { children: React.ReactNode }) {
  return <article className="measure mt-10 md:mt-14">{children}</article>;
}

/** Úvodní odstavec — krátká odpověď článku; tučnou část označí článek přes <strong>. */
export function ArticleIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-lede text-pretty text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink">
      {children}
    </p>
  );
}

/**
 * Sekce článku: nadpis + odstavce a bloky s jednotnými mezerami.
 *
 * - `id` udělá ze sekce cíl kotvy (obsah stránky v `LongRead`) a přidá odstup
 *   od přilepené lišty,
 * - mezititulky uvnitř jsou obyčejné `h3`,
 * - `lead` vysází první odstavec barvou textu — pro stránku, kde je první
 *   odstavec pravidlo samo a zbytek jeho výklad (metodika),
 * - `footnote` je tichý řádek pod sekcí (zdroj pravidla).
 */
export function ArticleSection({
  title,
  id,
  lead = false,
  footnote,
  className,
  children,
}: {
  title: string;
  id?: string;
  lead?: boolean;
  footnote?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn('mt-14', id && ANCHOR_OFFSET, className)}>
      <h2 className="type-title-2 text-balance">{title}</h2>
      <div
        className={cn(
          'type-reading mt-4 space-y-4 text-pretty text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink',
          '[&>h3]:type-title-3 [&>h3]:pt-4 [&>h3]:text-ink',
          // rozbalovací detail uvnitř má velikost čteného textu, ne poznámky
          '[&_details>div]:type-callout',
          lead && '[&>p:first-child]:text-ink',
        )}
      >
        {children}
      </div>
      {footnote && <p className="type-footnote mt-5 text-pretty text-ink-muted">{footnote}</p>}
    </section>
  );
}

/** Odrážkový seznam uvnitř sekce. */
export function ArticleList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

/** Tichý panel s konkrétním příkladem — čísla řeknou víc než poučky. */
export function Example({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas p-5">
      <p className="type-footnote font-semibold text-ink-muted">Příklad</p>
      {title && <p className="type-callout mt-1 font-semibold text-ink">{title}</p>}
      <div className="type-callout mt-2 space-y-2 text-ink-muted [&_strong]:font-semibold [&_strong]:text-ink">
        {children}
      </div>
    </div>
  );
}

/** Tichý panel pro poctivě označený sporný výklad (stejně jako v metodice aplikace). */
export function DisputedReading({ children }: { children: React.ReactNode }) {
  return (
    <div className="type-callout rounded-xl bg-canvas p-5 text-ink-muted">
      <p className="type-footnote flex items-center gap-2 font-semibold text-caution-text">
        <span aria-hidden className="size-2 rounded-full bg-current" />
        Sporný výklad
      </p>
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}

/** Interní odkaz ve stylu ostatních marketingových stránek. */
export function ArticleLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent-text underline underline-offset-2">
      {children}
    </Link>
  );
}

/** Pata článku: platnost pravidel, další čtení a cesta zpět na rozcestník. */
export function ArticleFooter({ next }: { next: { href: string; title: string }[] }) {
  return (
    <footer className="mt-14 border-t border-line/70 pt-6">
      <p className="type-caption text-ink-muted">
        Článek vychází z pravidel pro zdaňovací období 2025 a 2026 (zákon č. 586/1992 Sb.,
        o daních z příjmů); sporné výklady poctivě označujeme. Danero je výpočetní
        a evidenční nástroj, ne daňové poradenství — za přiznání odpovídá poplatník.
      </p>
      <p className="type-footnote mt-5 font-semibold text-ink">
        Další čtení
      </p>
      <ul className="type-callout mt-2 space-y-1">
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

/**
 * Dlouhý text psaný obyčejnými značkami (`h2`, `h3`, `p`, `ul`, `ol`, `a`,
 * `strong`, `table`) — podmínky, ochrana soukromí, metodika. Typografii
 * dodává obal, takže stránka nepíše třídy ke každému odstavci a všechny
 * dlouhé texty vypadají stejně. Odkazy v textu jsou podtržené (musí být
 * poznat i bez barvy).
 *
 * Články průvodce se dál skládají z `ArticleSection` a spol. — tam nadpisy
 * a mezery hlídá komponenta; `Prose` je pro texty, které mají vlastní
 * strukturu (číslované oddíly právních textů).
 */
export function Prose({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'measure type-reading text-pretty text-ink-muted',
        '[&_h2]:type-title-2 [&_h2]:mb-3 [&_h2]:mt-12 [&_h2]:text-balance [&_h2]:text-ink',
        '[&_h3]:type-title-3 [&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-ink',
        '[&_p+p]:mt-4 [&_p+ul]:mt-3 [&_ul+p]:mt-4 [&_p+ol]:mt-3 [&_ol+p]:mt-4',
        '[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5',
        '[&_a]:font-medium [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2',
        '[&_strong]:font-semibold [&_strong]:text-ink',
        className,
      )}
      {...props}
    />
  );
}
