import { cn } from '@/lib/utils';

/**
 * Hlavička sekce na stránce aplikace: titulek, hned za ním případná
 * vysvětlivka (`info` = `InfoPopover`) a tichý údaj (`count`), vpravo akce
 * nebo přepínač pohledu. Pod titulkem NENÍ úvodní odstavec — co sekce
 * ukazuje, má být poznat z ní samé; „jak se to počítá“ patří do `info`.
 *
 * `scrollActions` je pro akci, která se na úzký displej nemusí vejít
 * (přepínač roku s mnoha lety): posouvá se vodorovně jen ona, ne stránka.
 */
export function SectionHeader({
  title,
  info,
  count,
  actions,
  scrollActions = false,
  as: Heading = 'h2',
  className,
}: {
  title: React.ReactNode;
  info?: React.ReactNode;
  /** Tiché číslo za titulkem (počet položek). */
  count?: React.ReactNode;
  actions?: React.ReactNode;
  scrollActions?: boolean;
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
      {actions && (
        <div
          className={
            scrollActions
              ? // svislé odsazení nechává místo klikacím plochám segmentů, které
                // dráhu přepínače přesahují (stejně jako v nástrojové liště)
                '-my-2 flex max-w-full min-w-0 overflow-x-auto py-2 [scrollbar-width:none]'
              : 'flex shrink-0 items-center gap-2'
          }
        >
          {actions}
        </div>
      )}
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
  scrollActions,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode;
  info?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  scrollActions?: boolean;
}) {
  return (
    <section className={className} {...props}>
      <SectionHeader
        title={title}
        info={info}
        count={count}
        actions={actions}
        scrollActions={scrollActions}
      />
      <div className="mt-4">{children}</div>
    </section>
  );
}
