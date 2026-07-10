'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/prehled', label: 'Přehled' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/simulator', label: 'Simulátor' },
  { href: '/report', label: 'Report' },
  { href: '/import', label: 'Zdroje dat' },
  { href: '/nastaveni', label: 'Nastavení' },
];

function useSignOut() {
  const router = useRouter();
  return async () => {
    await authClient.signOut();
    router.push('/prihlaseni');
    router.refresh();
  };
}

/** Desktop: levý rail. Mobil (<md): spodní tab bar (docs/07). */
export function NavRail({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const signOut = useSignOut();

  return (
    <aside className="hidden w-48 shrink-0 flex-col border-r border-linka bg-plocha px-4 py-6 md:flex">
      <Link href="/prehled" className="mb-8 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-ruzova" aria-hidden />
        <span className="font-display text-lg font-bold tracking-tight">Danero</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map((item) => {
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

      <div className="space-y-2 border-t border-linka pt-4">
        <ThemeToggle />
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
      </div>
    </aside>
  );
}

export function NavTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hlavní navigace"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 border-t border-linka bg-plocha md:hidden"
    >
      {ITEMS.map((item) => {
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
