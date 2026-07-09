import { NavRail, NavTabBar } from '@/components/nav-rail';
import { PortfolioSwitcher } from '@/components/portfolio-switcher';
import { getDb } from '@/db';
import { activePortfolio, listPortfolios } from '@/lib/portfolio-context';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const db = await getDb();
  const [portfolios, active] = await Promise.all([
    listPortfolios(db, user.id),
    activePortfolio(db, user.id),
  ]);
  return (
    <div className="flex min-h-dvh">
      <NavRail userEmail={user.email} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-8 md:px-6 md:pb-8 lg:px-10">
        <PortfolioSwitcher
          portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))}
          activeId={active.id}
        />
        {children}
      </main>
      <NavTabBar />
    </div>
  );
}
