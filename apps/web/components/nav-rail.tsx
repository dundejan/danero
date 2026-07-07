'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/prehled', label: 'Přehled' },
  { href: '/import', label: 'Import' },
  { href: '/nastaveni', label: 'Nastavení' },
];

export function NavRail({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-linka bg-plocha px-4 py-6">
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
        <p className="truncate text-xs text-inkoust-tlumeny" title={userEmail}>
          {userEmail}
        </p>
        <button
          type="button"
          className="text-xs font-medium text-inkoust-tlumeny hover:text-cervena"
          onClick={async () => {
            await authClient.signOut();
            router.push('/prihlaseni');
            router.refresh();
          }}
        >
          Odhlásit se
        </button>
      </div>
    </aside>
  );
}
