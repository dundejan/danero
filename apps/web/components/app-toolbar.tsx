import Link from 'next/link';
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
 *
 * Podstránka (detail pozice) má vlevo od titulku cestu zpět (`back`): šipka
 * a název nadřazené stránky, jako tlačítko zpět v okně Macu. Je to navigace,
 * ne obsah — proto patří do lišty, a ne jako první řádek stránky.
 *
 * Každá stránka aplikace má právě jednu lištu a ta nese její jediný nadpis
 * první úrovně. Do lišty patří titulek, přepínač (rok, pohled) a nejvýš jedna
 * hlavní akce; žádný podtitulek ani popis stránky — metadata výpočtu
 * (počet transakcí, metoda) bydlí ve vysvětlivce u čísla, kterého se týkají.
 */
export function AppToolbar({
  title,
  titleContext,
  back,
  children,
  actions,
  pinned = true,
  className,
}: {
  title: string;
  /** Cesta zpět na nadřazenou stránku — vlevo od titulku. */
  back?: { href: string; label: string };
  /**
   * Doplněk titulku, který patří k nadpisu stránky (rok: „Přehled 2026“).
   * Když lišta nese přepínač, který totéž ukazuje, je doplněk jen pro čtečku;
   * bez přepínače se vypíše tiše za titulkem.
   */
  titleContext?: string;
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
      {back && (
        <nav aria-label="Drobečková navigace" className="-mr-1 shrink-0">
          <Link
            href={back.href}
            className="type-callout -my-2 -ml-1.5 inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 font-medium text-accent-text hover:underline active:opacity-60"
          >
            <span aria-hidden>‹</span>
            {back.label}
          </Link>
        </nav>
      )}
      <div className="min-w-0 flex-1 md:flex-none">
        {/* v náhledu na úvodní stránce nesmí vzniknout druhý nadpis první úrovně */}
        {pinned ? (
          <h1 className="type-title-3 truncate">
            {title}
            {titleContext && (
              <span className={children ? 'sr-only' : 'font-normal text-ink-muted'}>
                {' '}
                {titleContext}
              </span>
            )}
          </h1>
        ) : (
          <p className="type-title-3 truncate">{title}</p>
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
