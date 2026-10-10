import { typesetText } from '@/components/typeset';
import { Disclosure } from '@/components/ui/disclosure';
import { cn } from '@/lib/utils';

/**
 * Dlouhý text s obsahem stránky: metodika, podmínky, ochrana soukromí.
 * Sloupec textu drží čitelnou šířku a stojí pod titulkem stránky stejně jako
 * článek průvodce; obsah (odkazy na oddíly) je na širokém okně vpravo
 * a zůstává při rolování na očích, na úzkém stojí nad textem.
 *
 * Bez JavaScriptu: odkazy jsou obyčejné kotvy, zvýraznění právě čteného
 * oddílu tu schválně není — na stránce, kam se chodí pro jednu konkrétní
 * věc, stačí, že je seznam pořád po ruce.
 */

export interface ContentsItem {
  /** `id` oddílu na stránce (cíl kotvy). */
  id: string;
  title: string;
}

/**
 * Odstup kotvy od horního okraje: přilepená lišta veřejných stránek by jinak
 * nadpis oddílu po skoku zakryla. Patří na prvek, který nese `id`.
 */
export const ANCHOR_OFFSET = 'scroll-mt-[calc(var(--nav-height)+1.5rem)]';

/**
 * Doplněk k `Prose` pro text s obsahem: první nadpis doléhá nahoru (odstup
 * už drží titulek stránky) a každý cíl kotvy (`h2`, odstavec s `id`) má
 * odstup od lišty.
 */
export const PROSE_ANCHORS =
  '[&>h2:first-child]:mt-0 [&_h2]:scroll-mt-[calc(var(--nav-height)+1.5rem)] [&_p[id]]:scroll-mt-[calc(var(--nav-height)+1.5rem)]';

function ContentsLinks({ items, columns = false }: { items: ContentsItem[]; columns?: boolean }) {
  return (
    <ol className={cn(columns && 'grid grid-cols-2 gap-x-6 lg:block')}>
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className="type-footnote flex min-h-11 items-center text-pretty text-accent-text active:opacity-60 lg:min-h-0 lg:py-1.5 lg:text-ink-muted lg:hover:text-ink"
          >
            {typesetText(item.title)}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LongRead({
  contents,
  narrow = 'collapsed',
  children,
}: {
  contents: ContentsItem[];
  /**
   * Obsah na úzkém okně: `collapsed` ho sbalí pod „Obsah“ (právní text, který
   * se čte od začátku), `list` ho nechá rozepsaný (stránka, kde se hledá
   * jedno konkrétní pravidlo — seznam je zároveň její přehled).
   */
  narrow?: 'collapsed' | 'list';
  children: React.ReactNode;
}) {
  return (
    <div className="mt-10 md:mt-14 lg:grid lg:grid-cols-[minmax(0,38rem)_minmax(0,15rem)] lg:justify-between lg:gap-x-16">
      <nav aria-label="Obsah stránky" className="mb-10 lg:order-2 lg:mb-0">
        {narrow === 'collapsed' && (
          <Disclosure summary="Obsah" className="lg:hidden">
            <ContentsLinks items={contents} />
          </Disclosure>
        )}
        <div
          className={cn(
            'lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:block',
            narrow === 'collapsed' && 'hidden',
          )}
        >
          <p className="type-footnote font-semibold text-ink">Na této stránce</p>
          <div className="mt-1 lg:mt-2">
            <ContentsLinks items={contents} columns={narrow === 'list'} />
          </div>
        </div>
      </nav>
      <div className="min-w-0 lg:order-1">{children}</div>
    </div>
  );
}
