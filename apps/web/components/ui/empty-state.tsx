import { cn } from '@/lib/utils';

/**
 * Prázdný stav: sekce nebo stránka zatím nemá co ukázat. Je to pozvánka,
 * ne omluva — titulek říká, co tu bude, jedna věta říká, jak to získat,
 * a `action` je tlačítko, které k tomu vede („Nahrát výpisy“).
 *
 * `compact` je varianta do sekce uvnitř stránky (zarovnaná vlevo, bez
 * velkých okrajů); výchozí podoba je vystředěná a patří prázdné stránce.
 *
 * Stejnou podobu má i stav celé stránky bez nástrojové lišty — chyba,
 * nenalezeno, výpočet nejde dokončit. Titulek je pak `headingAs="h1"` (lišta,
 * která jinak nese jediný nadpis první úrovně, na takové stránce není),
 * `action` smí vedle tlačítka nést jeden odkaz a `note` je tichý údaj pod
 * nimi (kód chyby pro podporu).
 */
export function EmptyState({
  title,
  children,
  action,
  note,
  compact = false,
  headingAs: Heading = 'h2',
  className,
}: {
  title: string;
  /** Jedna věta: co udělat, aby tu něco bylo. */
  children?: React.ReactNode;
  /** Tlačítko a nejvýš jeden odkaz. */
  action?: React.ReactNode;
  /** Tichý údaj pod akcemi. */
  note?: React.ReactNode;
  compact?: boolean;
  headingAs?: 'h1' | 'h2' | 'h3' | 'p';
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
        <div
          className={cn(
            'text-pretty text-ink-muted [&>*+*]:mt-2',
            compact ? 'type-footnote mt-1' : 'type-body mt-2',
          )}
        >
          {children}
        </div>
      )}
      {action && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-x-5 gap-y-2',
            compact ? 'mt-3' : 'mt-6 justify-center',
          )}
        >
          {action}
        </div>
      )}
      {note && (
        <div className={cn('type-caption tabular-nums text-ink-muted', compact ? 'mt-3' : 'mt-6')}>
          {note}
        </div>
      )}
    </div>
  );
}
