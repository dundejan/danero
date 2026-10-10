import { cn } from '@/lib/utils';

/**
 * Nástrojová lišta okna aplikace: titulek sekce, uprostřed přepínače pohledu
 * (rok), vpravo hlavní akce. Je průsvitná a drží se nahoře — obsah roluje pod
 * ní, a teprve když pod ni něco zajede, objeví se její spodní hrana
 * (`scroll-edge`), ne dřív.
 *
 * Lišta stojí uvnitř `<main>`, který má vodorovné odsazení (`--page-gutter`)
 * i horní okraj (`--page-top`); záporné okraje ji roztáhnou přes celou šířku
 * obsahového okna. Na telefonu se přepínač zalomí pod titulek na vlastní
 * řádek, aby titulek ani akce neustupovaly.
 */
export function AppToolbar({
  title,
  subtitle,
  children,
  actions,
  pinned = true,
  className,
}: {
  title: string;
  /** Tichý druhý řádek pod titulkem (jen od tabletu výš). */
  subtitle?: React.ReactNode;
  /** Přepínače pohledu — typicky segmentový přepínač roku. */
  children?: React.ReactNode;
  /** Hlavní akce stránky (vpravo). */
  actions?: React.ReactNode;
  /**
   * `false` = lišta stojí na místě a hranu má stále (náhled aplikace na úvodní
   * stránce: tam roluje web, ne okno, a lišta se nemá lepit k oknu prohlížeče).
   */
  pinned?: boolean;
  className?: string;
}) {
  // náhled není hlavička stránky — druhý landmark `banner` by čtečku mátl
  const Bar = pinned ? 'header' : 'div';
  return (
    <Bar
      className={cn(
        '-mx-(--page-gutter) -mt-(--page-top) mb-(--page-top) min-h-(--toolbar-height)',
        'flex flex-wrap items-center gap-x-4 gap-y-2 px-(--page-gutter) py-2.5 print:hidden',
        pinned
          ? 'material-bar scroll-edge sticky top-0 z-20 pt-[calc(0.625rem+env(safe-area-inset-top,0px))]'
          : 'shadow-[0_0.5px_0_var(--material-edge)]',
        className,
      )}
    >
      <div className="min-w-0 flex-1 md:flex-none">
        {/* v náhledu na úvodní stránce nesmí vzniknout druhý nadpis první úrovně */}
        {pinned ? (
          <h1 className="type-title-3 truncate">{title}</h1>
        ) : (
          <p className="type-title-3 truncate">{title}</p>
        )}
        {subtitle && (
          <p className="type-caption hidden truncate text-ink-muted md:block">{subtitle}</p>
        )}
      </div>
      {children && (
        // Hodně let se na úzký displej nevejde — posouvá se jen tenhle řádek,
        // ne stránka. Svislé odsazení nechává místo klikacím plochám segmentů
        // (přesahují dráhu) a záporný okraj ho v rozvržení zase ruší.
        <div className="order-last -my-2 flex w-full min-w-0 overflow-x-auto py-2 [scrollbar-width:none] md:order-none md:ml-2 md:w-auto md:flex-1">
          {children}
        </div>
      )}
      {actions && <div className="flex shrink-0 items-center gap-2 md:ml-auto">{actions}</div>}
    </Bar>
  );
}
