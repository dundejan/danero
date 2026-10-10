import { cn } from '@/lib/utils';

/**
 * Hlavička sekce na stránce aplikace: titulek, hned za ním případná
 * vysvětlivka (`info` = `InfoPopover`) a tichý údaj (`count`), vpravo akce
 * nebo přepínač pohledu. Pod titulkem NENÍ úvodní odstavec — co sekce
 * ukazuje, má být poznat z ní samé; „jak se to počítá“ patří do `info`.
 */
export function SectionHeader({
  title,
  info,
  count,
  actions,
  as: Heading = 'h2',
  className,
}: {
  title: React.ReactNode;
  info?: React.ReactNode;
  /** Tiché číslo za titulkem (počet položek). */
  count?: React.ReactNode;
  actions?: React.ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <Heading className={Heading === 'h2' ? 'type-title-2' : 'type-title-3'}>
          {title}
          {count != null && (
            <span className="ml-2 font-normal tabular-nums text-ink-muted">{count}</span>
          )}
        </Heading>
        {info}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Sekce stránky aplikace: hlavička + obsah s jednotným odstupem. Sekce se na
 * stránce řadí pod sebe s mezerou `space-y-14` (viz vzor „Stránka aplikace“
 * v docs/07) — bez rámečků, bez podbarvení.
 */
export function Section({
  title,
  info,
  count,
  actions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode;
  info?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className={className} {...props}>
      <SectionHeader title={title} info={info} count={count} actions={actions} />
      <div className="mt-4">{children}</div>
    </section>
  );
}
