import { cn } from '@/lib/utils';

/**
 * Prázdný stav: sekce nebo stránka zatím nemá co ukázat. Je to pozvánka,
 * ne omluva — titulek říká, co tu bude, jedna věta říká, jak to získat,
 * a `action` je tlačítko, které k tomu vede („Nahrát výpisy“).
 *
 * `compact` je varianta do sekce uvnitř stránky (zarovnaná vlevo, bez
 * velkých okrajů); výchozí podoba je vystředěná a patří prázdné stránce.
 */
export function EmptyState({
  title,
  children,
  action,
  compact = false,
  headingAs: Heading = 'h2',
  className,
}: {
  title: string;
  /** Jedna věta: co udělat, aby tu něco bylo. */
  children?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  headingAs?: 'h2' | 'h3' | 'p';
  className?: string;
}) {
  return (
    <div
      className={cn(
        compact
          ? 'rounded-xl bg-canvas px-4 py-5'
          : 'mx-auto flex max-w-[28rem] flex-col items-center py-16 text-center md:py-24',
        className,
      )}
    >
      <Heading className={compact ? 'type-callout font-medium' : 'type-title-2 text-balance'}>
        {title}
      </Heading>
      {children && (
        <p
          className={cn(
            'text-pretty text-ink-muted',
            compact ? 'type-footnote mt-1' : 'type-body mt-2',
          )}
        >
          {children}
        </p>
      )}
      {action && <div className={compact ? 'mt-3' : 'mt-6'}>{action}</div>}
    </div>
  );
}
