import { MarketingCta } from '@/components/marketing-page';
import { tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';

/**
 * Stavební kameny veřejných stránek, které ve sdílené skořápce
 * (`marketing-page.tsx`) chybí. Skládají se jen z tokenů a tříd `type-*`.
 */

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
          size === 'headline' ? 'type-headline' : 'type-title-1',
          'max-w-[16ch] text-balance',
        )}
      >
        {tidy(title)}
      </h2>
      <div className="type-reading measure space-y-4 text-pretty text-ink-muted">{children}</div>
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
      <dt className="type-title-3">{label}</dt>
      <dd className="type-body text-pretty text-ink-muted">{children}</dd>
    </div>
  );
}

/**
 * Závěrečná výzva podstránek — všude stejná a věcná: co demo je, nic víc.
 * Tlačítka (demo, založení účtu) nese sdílená `MarketingCta`.
 */
export function DemoCta() {
  return (
    <MarketingCta
      title="Podívej se dovnitř"
      lede="Demo je celá aplikace nad ukázkovým portfoliem. Nic se v něm neukládá."
    />
  );
}
