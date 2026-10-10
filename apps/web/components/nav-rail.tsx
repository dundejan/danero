'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { NavIcon } from '@/components/nav-icons';
import {
  activeNavHref,
  APP_NAV_ITEMS,
  DEMO_NAV_ITEMS,
  type NavItem,
} from '@/components/nav-items';
import { SignOutButton } from '@/components/sign-out-button';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * Spodní lišta unese nejvýš pět cílů (čtyři sekce + „Více“). Šest položek se
 * na 360 px dělilo o desítky pixelů a popisky se ořezávaly.
 */
const TAB_LIMIT = 4;

/**
 * Seznam sekcí v postranním panelu. Výběr je tichý šedý obdélník a ikona
 * v akcentní barvě — jako v postranních panelech macOS. Výběr se nepřesouvá
 * animací: navigace je nejčastější akce v aplikaci a má být okamžitá.
 */
export function SidebarNav({
  items,
  activeHref,
  ariaLabel = 'Hlavní navigace',
  className,
}: {
  items: readonly NavItem[];
  /** Aktivní položka; `undefined` = žádná. */
  activeHref?: string;
  /**
   * Název navigace pro čtečku. Náhled aplikace na úvodní stránce potřebuje
   * vlastní — „Hlavní navigace“ je tam už lišta webu a dvě stejně pojmenované
   * oblasti od sebe čtečka nerozliší.
   */
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-col gap-0.5', className)}>
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'control-link row-pressable flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium text-ink pointer-coarse:h-11',
              active ? 'bg-(--highlight)' : 'row-hover',
            )}
          >
            <NavIcon name={item.icon} className="h-[1.125rem] w-[1.125rem] text-accent" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Postranní panel (desktop): druhotná plocha (`canvas`) u okraje okna po celé
 * výšce, obsah roluje vedle něj. Je to plná plocha, ne průsvitný materiál —
 * panel stojí vedle obsahu, ne nad ním, takže pod ním nic neroluje a rozostření
 * by se platilo za prázdno.
 */
function Rail({
  items,
  homeHref,
  footer,
}: {
  items: readonly NavItem[];
  homeHref: string;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden material-sidebar w-(--sidebar-width) shrink-0 border-r border-(--material-edge) md:flex">
      {/* Plocha panelu sahá přes celou výšku stránky (i při přetažení za
          okraj), obsah se drží v okně prohlížeče. */}
      <div className="sticky top-0 flex h-dvh w-full flex-col px-3 pb-4 pt-5">
        <Link href={homeHref} className="mb-6 flex h-8 items-center self-start rounded-md px-2">
          <Logo className="text-[1.0625rem]" />
        </Link>

        <SidebarNav items={items} activeHref={activeNavHref(items, pathname)} className="flex-1" />

        {footer && <div className="space-y-1.5 px-2 pt-4">{footer}</div>}
      </div>
    </aside>
  );
}

/**
 * Spodní lišta (mobil): průsvitná, obsah roluje pod ní. Položky nad limit se
 * sbalí pod „Více“, které otevře sheet se zbytkem sekcí.
 */
function TabBar({ items, accountEmail }: { items: readonly NavItem[]; accountEmail?: string }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const overflow = items.length > TAB_LIMIT + 1;
  const tabs = overflow ? items.slice(0, TAB_LIMIT) : items;
  const rest = overflow ? items.slice(TAB_LIMIT) : [];
  const active = activeNavHref(items, pathname);
  const restActive = rest.some((item) => item.href === active);

  const tabClass = (isActive: boolean) =>
    cn(
      // Aktivní položku nenese jen barva (H-3-12): má silnější tah ikony
      // a tučnější popisek.
      // Popisek je nejdrobnější text aplikace (10 px) a sloupec lišty má pevnou
      // šířku: strop `3.4vw` drží popisky ve sloupci i při zvětšeném písmu
      // prohlížeče, při výchozím písmu nezasáhne (320 px → 10,9 px).
      'flex min-w-0 flex-col items-center justify-center gap-0.5 text-[min(0.625rem,3.4vw)] leading-none tracking-[0.01em] active:opacity-50',
      isActive ? 'font-semibold text-accent-text' : 'font-medium text-ink-muted',
    );

  return (
    <>
      <nav
        aria-label="Hlavní navigace"
        // H-3-18: bez rezervy na gesto domovského indikátoru by popisky
        // ležely uvnitř systémového gesta
        className="material-tabbar fixed inset-x-0 bottom-0 z-30 grid h-[calc(var(--tabbar-height)+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-0.5px_0_var(--material-edge)] md:hidden"
        // Počet sloupců z délky seznamu, ne natvrdo: přidání položky by jinak
        // tiše shodilo lištu do dvou řad. Tailwind `grid-cols-${n}` staticky
        // nevygeneruje, proto inline styl.
        style={{ gridTemplateColumns: `repeat(${tabs.length + (overflow ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {tabs.map((item) => {
          const isActive = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(tabClass(isActive), 'control-link')}
            >
              <NavIcon name={item.icon} strong={isActive} className="h-6 w-6" />
              <span className="max-w-full truncate px-0.5">{item.label}</span>
            </Link>
          );
        })}
        {overflow && (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={tabClass(restActive)}
          >
            <NavIcon name="more" strong={restActive} className="h-6 w-6" />
            <span className="max-w-full truncate px-0.5">Více</span>
          </button>
        )}
      </nav>

      {overflow && (
        <Sheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onReopen={() => setMoreOpen(true)}
          label="Další sekce"
        >
          <ul className="overflow-hidden rounded-xl bg-surface">
            {rest.map((item, index) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.href === active ? 'page' : undefined}
                  onClick={() => setMoreOpen(false)}
                  className="control-link row-pressable flex h-12 items-center gap-3 pl-4 text-[1.0625rem] text-ink"
                >
                  <NavIcon name={item.icon} className="text-accent" />
                  <span
                    className={cn(
                      'flex h-full flex-1 items-center pr-4',
                      // oddělovač začíná až u textu, ne pod ikonou
                      index > 0 && 'shadow-[0_-0.5px_0_var(--line)]',
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {/* Účet: kdo je přihlášený a cesta ven. Na počítači je obojí v patičce
              panelu; na telefonu bylo odhlášení až v Nastavení → Účet, čtyři
              kroky daleko. Adresa se zalamuje celá — zkrácenou by na dotyku
              nešlo přečíst nikde. */}
          {accountEmail && (
            <div className="mt-5">
              <p className="type-footnote px-4 pb-2 text-ink-muted wrap-anywhere">{accountEmail}</p>
              <div className="overflow-hidden rounded-xl bg-surface">
                <SignOutButton
                  className="row-pressable flex h-12 w-full items-center px-4 text-left text-[1.0625rem] text-accent-text"
                  errorClassName="type-footnote px-4 pb-3 text-danger"
                />
              </div>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

/** Desktop: postranní panel. Mobil (<md): spodní lišta.
 *  Patička panelu je jen účet (e-mail + odhlášení) — přepínač vzhledu žije
 *  v Nastavení. Pod md je totéž v sheetu „Více“. */
export function NavRail({ userEmail }: { userEmail: string }) {
  return (
    <Rail
      items={APP_NAV_ITEMS}
      homeHref="/prehled"
      footer={
        <>
          <p className="type-caption truncate text-ink-muted" title={userEmail}>
            {userEmail}
          </p>
          <SignOutButton
            className="type-footnote -mx-2 rounded-md px-2 py-1 font-medium text-accent-text hover:bg-(--highlight) active:bg-(--highlight-pressed)"
            errorClassName="type-caption text-danger"
          />
        </>
      }
    />
  );
}

export function NavTabBar({ userEmail }: { userEmail?: string }) {
  return <TabBar items={APP_NAV_ITEMS} accountEmail={userEmail} />;
}

/** Demo panel: bez patičky — návrat na úvod nese logo (vede na úvodní stránku)
 *  a patička pod obsahem. */
export function DemoNavRail() {
  return <Rail items={DEMO_NAV_ITEMS} homeHref="/" />;
}

export function DemoNavTabBar() {
  return <TabBar items={DEMO_NAV_ITEMS} />;
}
