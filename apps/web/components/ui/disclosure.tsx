import { cn } from '@/lib/utils';

/** Šipka rozbalovátka: zavřená míří doprava, otevřená dolů. */
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 12"
      aria-hidden
      className={cn(
        'h-[0.7em] w-auto shrink-0 fill-none stroke-current transition-transform duration-150 ease-(--ease-out) group-open/disclosure:rotate-90',
        className,
      )}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 1.5L6 6l-4.5 4.5" />
    </svg>
  );
}

/**
 * Rozbalovací detail nad nativním `<details>`: funguje bez JavaScriptu,
 * klávesnicí i čtečkou a při tisku se otevře sám (globals.css). Obsah se
 * neanimuje — rozbalit něco má být okamžité; hýbe se jen šipka.
 *
 * `Disclosure` je malý odkaz „ukaž víc“ pod textem (výčet případů, celé znění).
 */
export function Disclosure({
  summary,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'details'>, 'children'> & {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className={cn('disclosure group/disclosure', className)} {...props}>
      <summary className="type-footnote inline-flex min-h-11 items-center gap-1.5 font-medium text-accent-text active:opacity-60 md:min-h-7">
        <Chevron />
        {summary}
      </summary>
      <div className="type-footnote pb-2 pt-1 text-ink-muted">{children}</div>
    </details>
  );
}

/**
 * Řádek seznamu, který se dá rozbalit: vlevo titulek (jedna věta), vpravo
 * tichý údaj (datum, počet) a šipka; po rozbalení celé znění. Vzor pro dlouhé
 * texty, které přicházejí z enginu nebo z `lib/` (kontroly výpočtu,
 * upozornění): zkracuje se ZOBRAZENÍM, zdroj textu se nepřepisuje.
 *
 * Řádky patří do `Group` (ta kreslí oddělovače). `eyebrow` je barevné slovo
 * nad titulkem („Chyba“, „Upozornění“) — barvu dodá volající třídou.
 */
export function DisclosureRow({
  title,
  eyebrow,
  meta,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'details'>, 'children' | 'title'> & {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Tichý údaj vpravo (datum, počet výskytů). */
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // `listitem` nese obal: <details> má vlastní roli a do seznamu sám nepatří
    <div role="listitem" className={className}>
    <details className="disclosure group/disclosure" {...props}>
      <summary className="row-pressable -mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-(--highlight)">
        <span className="min-w-0 flex-1">
          {eyebrow}
          <span className="type-callout block font-medium text-pretty">{title}</span>
        </span>
        {meta && (
          <span className="type-caption shrink-0 tabular-nums text-ink-muted">{meta}</span>
        )}
        <Chevron className="self-center text-ink-muted" />
      </summary>
      <div className="type-callout pb-3.5 pr-6 text-pretty text-ink-muted">{children}</div>
    </details>
    </div>
  );
}
