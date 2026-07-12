'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { href: '/prehled', label: 'Přehled' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/simulator', label: 'Simulátor' },
  { href: '/report', label: 'Report' },
  { href: '/import', label: 'Zdroje dat' },
  { href: '/nastaveni', label: 'Nastavení' },
];

/** Demo prohlídka: stejné stránky bez Zdrojů dat a Nastavení (nemají smysl bez účtu). */
const DEMO_ITEMS: NavItem[] = [
  { href: '/demo/prehled', label: 'Přehled' },
  { href: '/demo/portfolio', label: 'Portfolio' },
  { href: '/demo/simulator', label: 'Simulátor' },
  { href: '/demo/report', label: 'Report' },
];

function useSignOut() {
  const router = useRouter();
  return async () => {
    await authClient.signOut();
    router.push('/prihlaseni');
    router.refresh();
  };
}

/** Sdílený levý rail (desktop): logo, položky; patička jen když je co ukázat. */
function Rail({
  items,
  homeHref,
  footer,
}: {
  items: NavItem[];
  homeHref: string;
  footer?: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-48 shrink-0 flex-col border-r border-linka bg-plocha px-4 py-6 md:flex">
      <Link href={homeHref} className="mb-8">
        <Logo className="text-lg" />
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-pozadi font-semibold text-ruzova'
                  : 'text-inkoust-tlumeny hover:text-inkoust',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {footer && <div className="space-y-2 border-t border-linka pt-4">{footer}</div>}
    </aside>
  );
}

/** Sdílený spodní tab bar (mobil <md). */
function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hlavní navigace"
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 grid border-t border-linka bg-plocha md:hidden',
        items.length === 6 ? 'grid-cols-6' : 'grid-cols-4',
      )}
    >
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              // 390 px / 6 položek ≈ 65 px — menší písmo + truncate, ať nic nepřetéká
              'min-w-0 truncate px-0.5 py-3 text-center text-[11px] font-medium tracking-tight',
              active ? 'font-semibold text-ruzova' : 'text-inkoust-tlumeny',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop: levý rail. Mobil (<md): spodní tab bar (docs/07).
 *  Patička jen účet (e-mail + odhlášení) — přepínač vzhledu žije v Nastavení. */
export function NavRail({ userEmail }: { userEmail: string }) {
  const signOut = useSignOut();
  return (
    <Rail
      items={ITEMS}
      homeHref="/prehled"
      footer={
        <>
          <p className="truncate text-xs text-inkoust-tlumeny" title={userEmail}>
            {userEmail}
          </p>
          <button
            type="button"
            className="text-xs font-medium text-inkoust-tlumeny hover:text-cervena"
            onClick={signOut}
          >
            Odhlásit se
          </button>
        </>
      }
    />
  );
}

export function NavTabBar() {
  return <TabBar items={ITEMS} />;
}

/** Demo rail: bez patičky — CTA na registraci má demo v horním banneru,
 *  návrat na úvod nese mini patička i logo (vede na landing). */
export function DemoNavRail() {
  return <Rail items={DEMO_ITEMS} homeHref="/" />;
}

export function DemoNavTabBar() {
  return <TabBar items={DEMO_ITEMS} />;
}
