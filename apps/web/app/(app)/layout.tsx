import { NavRail, NavTabBar } from '@/components/nav-rail';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh">
      {/* a11y: skip-link — první fokusovatelný prvek, viditelný jen s fokusem */}
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-plocha focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-inkoust focus:shadow-sm"
      >
        Přeskočit na obsah
      </a>
      <NavRail userEmail={user.email} />
      <main id="obsah" className="min-w-0 flex-1 px-4 pb-24 pt-8 md:px-6 md:pb-8 lg:px-10">
        {children}
      </main>
      <NavTabBar />
    </div>
  );
}
