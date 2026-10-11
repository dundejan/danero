import { DetailsOnce } from '@/components/ui/details-once';
import { cn } from '@/lib/utils';

/**
 * Šipka rozbalovátka: zavřená míří doprava, otevřená dolů. Patří do `<summary>`
 * — otáčí se podle NEJBLIŽŠÍHO `<details>`, ne podle skupiny: rozbalovátko
 * vnořené do jiného rozbalovátka by jinak přebíralo stav rodiče (zavřený
 * detail v otevřeném řádku by ukazoval dolů).
 */
export function Chevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 12"
      aria-hidden
      className={cn(
        'h-[0.7em] w-auto shrink-0 fill-none stroke-current transition-transform duration-150 ease-(--ease-out) [details[open]>summary_&]:rotate-90',
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
    <details className={cn('disclosure', className)} {...props}>
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
 *
 * `id` a ostatní atributy dostává `<details>`: řádek jde otevřít kotvou
 * (`OpenOnHash`) i atributem `open`; `defaultOpen` ho otevře jen napoprvé.
 */
export function DisclosureRow({
  title,
  eyebrow,
  meta,
  defaultOpen,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<'details'>, 'children' | 'title'> & {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  /** Tichý údaj vpravo (datum, počet výskytů). */
  meta?: React.ReactNode;
  /**
   * Otevřít při prvním vykreslení a dál nechat na uživateli (`DetailsOnce`).
   * Na rozdíl od `open` řádek nezavře, když další vykreslení ze serveru
   * přijde s jinou hodnotou.
   */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const body = (
    <>
      {/* v tisku bez přesahu do okrajů — zvýraznění řádku tam nemá smysl
          a přesah vyčníval z tiskové plochy */}
      <summary className="row-hover row-pressable -mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2.5 print:mx-0 print:px-0">
        <span className="min-w-0 flex-1 wrap-anywhere">
          {eyebrow}
          <span className="type-callout block font-medium text-pretty">{title}</span>
        </span>
        {/* tichý údaj si bere nejvýš 40 % řádku: dlouhý se zalomí, místo aby
            titulek složil po slově na řádek */}
        {meta && (
          <span className="type-caption max-w-[40%] min-w-0 shrink-0 text-right tabular-nums text-ink-muted wrap-anywhere">
            {meta}
          </span>
        )}
        <Chevron className="self-center text-ink-muted" />
      </summary>
      <div className="type-callout pb-3.5 pr-6 text-pretty text-ink-muted">{children}</div>
    </>
  );
  return (
    // `listitem` nese obal: <details> má vlastní roli a do seznamu sám nepatří
    <div role="listitem" className={className}>
      {defaultOpen === undefined ? (
        <details className="disclosure" {...props}>
          {body}
        </details>
      ) : (
        <DetailsOnce className="disclosure" {...props} defaultOpen={defaultOpen}>
          {body}
        </DetailsOnce>
      )}
    </div>
  );
}
