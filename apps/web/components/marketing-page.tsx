import Link from 'next/link';
import { Logo } from '@/components/logo';

/**
 * Lehká hlavička a patička pro marketingové podstránky (/kalkulacka,
 * /platformy) — landing má vlastní bohatší verze, podstránky sdílejí tuhle.
 */

export function MarketingHeader() {
  return (
    <header className="flex items-center justify-between py-5">
      <Link href="/" aria-label="Danero — úvodní stránka">
        <Logo className="text-lg" />
      </Link>
      <nav className="flex items-center gap-2 text-sm sm:gap-5" aria-label="Hlavní navigace">
        <Link
          href="/prihlaseni"
          className="font-medium text-inkoust-tlumeny hover:text-inkoust"
        >
          Přihlásit se
        </Link>
        <Link
          href="/demo/prehled"
          className="rounded-md bg-ruzova-syta px-4 py-2 font-semibold text-white hover:opacity-90"
        >
          Vyzkoušet demo
        </Link>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="mt-20 border-t border-linka py-10 text-sm text-inkoust-tlumeny">
      <p>
        Danero je výpočetní a evidenční nástroj, nikoli daňové poradenství ve smyslu zákona
        č. 523/1992 Sb. Za správnost daňového přiznání odpovídá poplatník.
      </p>
      <p className="mt-3">
        <Link href="/" className="font-medium hover:text-inkoust">
          Úvodní stránka
        </Link>{' '}
        ·{' '}
        <Link href="/podminky" className="font-medium hover:text-inkoust">
          Podmínky užití
        </Link>{' '}
        ·{' '}
        <Link href="/soukromi" className="font-medium hover:text-inkoust">
          Ochrana soukromí
        </Link>
      </p>
    </footer>
  );
}
