import { cn } from '@/lib/utils';

/**
 * Stav celé stránky uvnitř skořápky aplikace nebo dema: chyba, nenalezeno.
 * Vystředěný titulek, jedna věta a cesta ven — nic dalšího.
 *
 * Vzhledem kopíruje `EmptyState` (prázdná stránka), jen titulek je nadpis
 * první úrovně: stránka v tomhle stavu nemá nástrojovou lištu, která by ho
 * jinak nesla, a `EmptyState` umí jen `h2`/`h3`/`p`.
 */
export function AppState({
  title,
  children,
  actions,
  note,
  className,
}: {
  title: string;
  /** Jedna věta: co se stalo a co s tím. */
  children: React.ReactNode;
  /** Tlačítko a nejvýš jeden odkaz. */
  actions: React.ReactNode;
  /** Tichý údaj pod akcemi (kód chyby pro podporu). */
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-[28rem] flex-col items-center py-16 text-center md:py-24',
        className,
      )}
    >
      <h1 className="type-title-2 text-balance">{title}</h1>
      <p className="type-body mt-2 text-pretty text-ink-muted">{children}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {actions}
      </div>
      {note && <p className="type-caption mt-6 tabular-nums text-ink-muted">{note}</p>}
    </div>
  );
}
