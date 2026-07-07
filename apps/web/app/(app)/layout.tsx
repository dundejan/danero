import { NavRail, NavTabBar } from '@/components/nav-rail';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh">
      <NavRail userEmail={user.email} />
      <main className="min-w-0 flex-1 px-4 pb-24 pt-8 md:px-6 md:pb-8 lg:px-10">{children}</main>
      <NavTabBar />
    </div>
  );
}
