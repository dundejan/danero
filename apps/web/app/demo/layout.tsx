import Link from 'next/link';
import { DemoNavRail, DemoNavTabBar } from '@/components/nav-rail';
import { NoScriptNotice } from '@/components/no-script-notice';
import { NOT_TAX_ADVICE } from '@/components/shell-disclaimer';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Demo prohlídka (bez přihlášení, bez DB): stejná skořápka jako aplikace —
 * postranní panel + obsahové okno. Navíc tichý pruh nad obsahem, který říká,
 * že jde o ukázková data, a dole mini patička (návrat na úvod, právní odkazy,
 * přepínač vzhledu).
 * Žádný requireUser; všechno uvnitř počítá čistý engine nad demo datasetem.
 */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    // `scroll-edge-after-banner`: hrana lišty se objeví, až pruh nad ní odroluje
    <div className="scroll-edge-after-banner flex min-h-dvh bg-surface">
      {/* a11y: skip-link jako v aplikaci */}
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-floating"
      >
        Přeskočit na obsah
      </a>
      <DemoNavRail />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* <header>, ne <div>: text pruhu jinak leží mimo jakýkoli landmark
            a čtečka ho v režimu procházení oblastí přeskočí (axe `region`).
            Pruh neroluje s lištou — po odrolování zmizí a uvolní místo datům.
            Na papír nepatří: tištěný report z dema jím nemá začínat. */}
        <header className="page-banner type-footnote flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 bg-canvas px-(--page-gutter) py-2.5 text-center print:hidden">
          <p>
            <span className="font-semibold">Prohlížíš demo s ukázkovými daty</span>
            <span className="text-ink-muted"> — nic se neukládá.</span>
          </p>
          <Link
            href="/registrace"
            className="-my-3 inline-flex min-h-11 items-center font-medium text-accent-text hover:underline active:opacity-60"
          >
            Založit účet
            <span aria-hidden className="ml-1">
              ›
            </span>
          </Link>
        </header>
        <main id="obsah" className="min-w-0 flex-1 px-(--page-gutter) pt-(--page-top)">
          <NoScriptNotice />
          {children}
        </main>
        {/* mini patička: demo je veřejná vstupní brána — návštěvník potřebuje
            cestu zpět na úvod i právní odkazy; spodní okraj kryje spodní lištu */}
        <footer className="type-caption mt-16 px-(--page-gutter) pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom,0px)+1.5rem)] text-ink-muted md:pb-8">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line/70 pt-4">
            <p className="flex flex-wrap items-center gap-x-4">
              {[
                { href: '/', label: 'Zpět na úvod' },
                { href: '/podminky', label: 'Podmínky užití' },
                { href: '/soukromi', label: 'Ochrana soukromí' },
                // výhrada jen pár slovy; závazné znění je v podmínkách (čl. 1)
                NOT_TAX_ADVICE,
              ].map((link) => (
                <Link
                  // dva odkazy míří na podmínky — klíčem je popisek
                  key={link.label}
                  href={link.href}
                  className="inline-flex min-h-11 items-center hover:text-ink active:opacity-60 md:min-h-0"
                >
                  {link.label}
                </Link>
              ))}
            </p>
            {/* jediné místo přepínače vzhledu v demu — panel je jen navigace */}
            <ThemeToggle />
          </div>
        </footer>
      </div>
      <DemoNavTabBar />
    </div>
  );
}
