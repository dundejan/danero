import Link from 'next/link';
import { DemoChecklist } from '@/components/demo-checklist';
import { DemoNavRail, DemoNavTabBar } from '@/components/nav-rail';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Demo prohlídka (bez přihlášení, bez DB): stejný layout jako aplikace —
 * nav-rail + obsah — navrch výrazný banner s naváděcím checklistem a dole
 * mini patička (návrat na úvod, právní odkazy, přepínač vzhledu).
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
      <DemoChecklist />
      <div className="flex flex-1">
        <DemoNavRail />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 px-4 pt-8 md:px-6 lg:px-10">{children}</main>
          {/* mini patička: demo je veřejná vstupní brána — návštěvník potřebuje
              cestu zpět na ceník/FAQ i právní odkazy; pb-24 kryje mobilní tab bar */}
          <footer className="mt-12 border-t border-linka px-4 pb-24 pt-4 text-xs text-inkoust-tlumeny md:px-6 md:pb-4 lg:px-10">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <p className="flex flex-wrap gap-x-2 gap-y-1">
                <Link href="/" className="font-medium hover:text-inkoust">
                  ← Zpět na úvod
                </Link>
                <span aria-hidden>·</span>
                <Link href="/podminky" className="font-medium hover:text-inkoust">
                  Podmínky užití
                </Link>
                <span aria-hidden>·</span>
                <Link href="/soukromi" className="font-medium hover:text-inkoust">
                  Ochrana soukromí
                </Link>
              </p>
              {/* jediné místo přepínače vzhledu v demu — rail je jen navigace */}
              <ThemeToggle />
            </div>
            <p className="mt-2">
              Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství — za
              daňové přiznání odpovídá poplatník.
            </p>
          </footer>
        </div>
      </div>
      <DemoNavTabBar />
    </div>
  );
}
