import Link from 'next/link';
import { typeset } from '@/components/typeset';
import { cn } from '@/lib/utils';
import { tidy } from '@/lib/typography';

/**
 * Stavební kameny obsahu veřejných stránek — to, co se skládá DO pásů a pod
 * titulek stránky (skořápku, pásy a závěr stránky nese `marketing-page.tsx`).
 * Skládají se jen z tokenů a tříd `type-*`; českou sazbu textu dělají samy
 * (`typeset`), stránka do nich píše obyčejné odstavce.
 */

/**
 * Nadpis oddílu na podstránce (skupina pod titulkem stránky). Na telefonu je
 * o stupeň menší: titulek stránky tam má 32 px a `type-title-1` 28 px, takže
 * by dva nadpisy pod sebou vypadaly jako dva titulky.
 */
export const SECTION_TITLE = 'type-title-2 md:type-title-1';

/**
 * Titulek vlevo, obsah vpravo — pás, který na něco odpovídá („Proč se
 * neplatí“ → odstavec). Na úzkém displeji stojí titulek nad obsahem.
 * Víc dvojic pod sebou odděluje vlásová linka (`divided`).
 */
export function Split({
  title,
  children,
  size = 'title',
  divided = false,
  className,
}: {
  title: string;
  /** `headline` na úvodní stránce, kde je titulek dvojice zároveň titulkem pásu. */
  size?: 'title' | 'headline';
  children: React.ReactNode;
  /** Vlásová linka nad dvojicí — pro druhou a další dvojici v témže pásu. */
  divided?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-x-(--column-gap) gap-y-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]',
        divided && 'mt-12 border-t border-line/70 pt-12 md:mt-16 md:pt-16',
        className,
      )}
    >
      <h2
        className={cn(
          size === 'headline' ? 'type-headline' : SECTION_TITLE,
          'max-w-[16ch] text-balance',
        )}
      >
        {tidy(title)}
      </h2>
      <div className="type-reading measure space-y-4 text-pretty text-ink-muted">
        {typeset(children)}
      </div>
    </div>
  );
}

/**
 * Výčet „pojem — co k němu patří“ jako list se specifikacemi: pojem vlevo,
 * obsah vpravo, mezi řádky vlásová linka. Místo mřížky dlaždic s ikonami.
 */
export function SpecList({
  children,
  className,
  ...props
}: React.ComponentProps<'dl'>) {
  return (
    <dl className={cn('divide-y divide-line/70 border-y border-line/70', className)} {...props}>
      {children}
    </dl>
  );
}

export function SpecRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-(--column-gap) gap-y-1.5 py-5 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:py-6">
      <dt className="type-title-3">{typeset(label)}</dt>
      <dd className="type-body text-pretty text-ink-muted">{typeset(children)}</dd>
    </div>
  );
}

/**
 * Seznam odkazů „titulek + jedna věta + šipka“: rozcestník (články průvodce)
 * nebo cesty ven (404). Řádek je celý klikací; je to seznam, ne mřížka dlaždic.
 * `size="lg"` je pro seznam, který je hlavním obsahem stránky.
 */
export function LinkList({
  items,
  size = 'md',
  className,
}: {
  items: { href: string; title: string; summary: string }[];
  size?: 'md' | 'lg';
  className?: string;
}) {
  const large = size === 'lg';
  const titleClass = large ? 'type-title-2 text-balance' : 'type-title-3';
  return (
    <ul className={cn('measure divide-y divide-line/70 border-y border-line/70', className)}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className={cn('group flex items-center gap-4 active:opacity-60', large ? 'py-6' : 'py-4')}
          >
            <span className="min-w-0 flex-1">
              <span className={cn(titleClass, 'block group-hover:underline')}>
                {tidy(item.title)}
              </span>
              <span
                className={cn(
                  'block text-pretty text-ink-muted',
                  large ? 'type-body mt-2' : 'type-callout mt-0.5',
                )}
              >
                {tidy(item.summary)}
              </span>
            </span>
            <span aria-hidden className={cn(titleClass, 'text-ink-muted')}>
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
