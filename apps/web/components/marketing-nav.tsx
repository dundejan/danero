'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { SPRING_DEFAULT } from '@/lib/motion';
import { cn } from '@/lib/utils';

export type MarketingNavKey =
  | 'platformy'
  | 'kalkulacka'
  | 'cenik'
  | 'caste-otazky'
  | 'o-projektu';

// Čtyři odkazy a víc ne — každý odpovídá na jednu otázku návštěvníka: načte to
// mého brokera, týká se mě to vůbec, v čem je háček, a co dalšího se lidé
// ptají. Kalkulačka je v liště od 10. 10. 2026 (do té doby jen v patičce): je
// to jediná věc na webu, která odpoví bez účtu i bez dema. Stránka o autorovi
// žije v patičce a v odkazech z textů; klíč `o-projektu` v typu zůstává, aby
// ho stránka dál směla předat.
// `/cenik` nese popisek „Proč zdarma“ — ceník bez cen by byl prázdné slovo.
const LINKS: { key: MarketingNavKey; href: string; label: string }[] = [
  { key: 'platformy', href: '/platformy', label: 'Platformy' },
  { key: 'kalkulacka', href: '/kalkulacka', label: 'Kalkulačka' },
  { key: 'cenik', href: '/cenik', label: 'Proč zdarma' },
  { key: 'caste-otazky', href: '/caste-otazky', label: 'Časté otázky' },
];

/**
 * Navigace veřejných stránek — desktop odkazy + mobilní menu. `active`
 * zvýrazní aktuální stránku (aria-current); úvodní stránka ho nepředává.
 *
 * Mobilní menu vyjíždí z lišty, která ho otevřela, a stejnou cestou se do ní
 * vrací (krátká pružina bez překmitu, s omezeným pohybem jen prolnutí).
 * Escape i klepnutí mimo zavírá, fokus se vrací na tlačítko.
 */
export function MarketingNav({
  active,
  signedIn,
}: {
  active?: MarketingNavKey;
  /** Přihlášený návštěvník — místo přihlášení/registrace nabídneme aplikaci. */
  signedIn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      {/* čtyři odkazy a dvě akce se vejdou už na tablet (s užší mezerou) —
          menu pod tlačítkem jen na telefonu */}
      <nav className="hidden items-center gap-5 md:flex lg:gap-7" aria-label="Hlavní navigace">
        {LINKS.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            aria-current={active === link.key ? 'page' : undefined}
            className={cn(
              'type-footnote active:opacity-60',
              active === link.key ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {link.label}
          </Link>
        ))}
        {signedIn ? (
          // přihlášenému nemá smysl nabízet přihlášení ani demo na cizích datech
          <Link href="/prehled" className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Přejít do aplikace
          </Link>
        ) : (
          <>
            <Link
              href="/prihlaseni"
              className="type-footnote text-ink-muted hover:text-ink active:opacity-60"
            >
              Přihlásit se
            </Link>
            <Link
              href="/demo/prehled"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              Vyzkoušet demo
            </Link>
          </>
        )}
      </nav>

      {/* telefon: hlavní výzva zůstává viditelná, zbytek pod tlačítkem menu */}
      <div className="flex items-center gap-1 md:hidden">
        <Link
          href={signedIn ? '/prehled' : '/demo/prehled'}
          // viditelná výška 32 px, klikací plocha natažená na 44 px
          className={cn(
            buttonVariants({ variant: 'primary', size: 'sm' }),
            'relative pointer-coarse:min-h-8 after:absolute after:inset-x-0 after:-inset-y-1.5',
          )}
        >
          {signedIn ? 'Do aplikace' : 'Demo'}
        </Link>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobilni-menu"
          aria-label={open ? 'Zavřít menu' : 'Otevřít menu'}
          onClick={() => setOpen((value) => !value)}
          className="-mr-3 flex h-11 w-11 items-center justify-center rounded-full active:bg-(--highlight-pressed)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="h-5 w-5"
            aria-hidden
          >
            {open ? <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /> : <path d="M4 9h16M4 15h16" />}
          </svg>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <>
            {/* Závoj: ztmaví stránku a klepnutí mimo panel menu zavře. Otevřené
                menu je modální — `data-scroll-lock` zamkne rolování stránky pod
                ním (pravidlo v globals.css, stejné jako pod sheetem), `touch-none`
                brání tahu prstem. */}
            <motion.div
              key="scrim"
              aria-hidden
              data-scroll-lock
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ backgroundColor: 'var(--scrim)' }}
              className="fixed inset-0 top-12 z-40 touch-none md:hidden"
            />
            <motion.div
              key="panel"
              id="mobilni-menu"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              // zavírá se rychleji, než se otevírá: odchod nemá na co čekat
              exit={{ opacity: 0, y: -12, transition: { duration: 0.15, ease: 'easeOut' } }}
              transition={SPRING_DEFAULT}
              className="material-sheet absolute inset-x-0 top-full z-50 origin-top rounded-b-2xl shadow-floating md:hidden"
            >
              <nav className="px-5 pb-5 pt-2" aria-label="Mobilní navigace">
                <ul className="divide-y divide-line/70">
                  {LINKS.map((link) => (
                    <li key={link.key}>
                      <Link
                        href={link.href}
                        aria-current={active === link.key ? 'page' : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'type-title-3 flex h-12 items-center active:opacity-50',
                          active === link.key ? 'text-accent-text' : 'text-ink',
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {/* akce účtu pohromadě na konci — stejná logika jako desktop */}
                  <li>
                    <Link
                      href={signedIn ? '/prehled' : '/prihlaseni'}
                      onClick={() => setOpen(false)}
                      className="type-title-3 flex h-12 items-center text-ink active:opacity-50"
                    >
                      {signedIn ? 'Přejít do aplikace' : 'Přihlásit se'}
                    </Link>
                  </li>
                </ul>
                {!signedIn && (
                  <Link
                    href="/registrace"
                    onClick={() => setOpen(false)}
                    className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }), 'mt-4 w-full')}
                  >
                    Založit účet
                  </Link>
                )}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
