import Link from 'next/link';
import { DemoNavRail, DemoNavTabBar } from '@/components/nav-rail';

/**
 * Demo prohlídka (bez přihlášení, bez DB): stejný layout jako aplikace —
 * nav-rail + obsah — navrch výrazný banner, že jde o ukázková data.
 * Žádný requireUser; všechno uvnitř počítá čistý engine nad demo datasetem.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ruzova/40 bg-ruzova/10 px-4 py-2.5 md:px-6">
        <p className="text-sm">
          <span className="font-semibold text-ruzova">Prohlížíš demo s ukázkovými daty</span>
          <span className="text-inkoust-tlumeny"> — nic se neukládá.</span>
        </p>
        <Link
          href="/registrace"
          className="rounded-md bg-ruzova-syta px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Založit účet zdarma
        </Link>
      </div>
      <div className="flex flex-1">
        <DemoNavRail />
        <main className="min-w-0 flex-1 px-4 pb-24 pt-8 md:px-6 md:pb-8 lg:px-10">
          {children}
        </main>
      </div>
      <DemoNavTabBar />
    </div>
  );
}
