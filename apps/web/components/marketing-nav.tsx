'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type MarketingNavKey = 'platformy' | 'cenik' | 'caste-otazky' | 'o-projektu';

// Kalkulačka v menu není (Janovo rozhodnutí 12. 7.) — žije v patičce
// a v odkazech z hero/textů
const LINKS: { key: MarketingNavKey; href: string; label: string }[] = [
  { key: 'platformy', href: '/platformy', label: 'Platformy' },
  { key: 'cenik', href: '/cenik', label: 'Ceník' },
  { key: 'caste-otazky', href: '/caste-otazky', label: 'Časté otázky' },
  { key: 'o-projektu', href: '/o-projektu', label: 'O projektu' },
];

/**
 * Navigace marketingových stránek — desktop odkazy + mobilní rozbalovací menu
 * (Escape i klik mimo zavírá, fokus se vrací na tlačítko). `active` zvýrazní
 * aktuální stránku (aria-current); landing ho nepředává.
 */
export function MarketingNav({ active }: { active?: MarketingNavKey }) {
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
      {/* pět odkazů se na tablet (md) nevejde — plná navigace až od lg */}
      <nav className="hidden items-center gap-6 lg:flex" aria-label="Hlavní navigace">
        {LINKS.map((link) => (
          <Link
            key={link.key}
            href={link.href}
            aria-current={active === link.key ? 'page' : undefined}
            className={cn(
              'text-sm font-medium transition-colors',
              active === link.key
                ? 'text-inkoust underline decoration-ruzova decoration-2 underline-offset-8'
                : 'text-inkoust-tlumeny hover:text-inkoust',
            )}
          >
            {link.label}
          </Link>
        ))}
        {/* svislý předěl: vlevo stránky, vpravo akce účtu (login + CTA) */}
        <span aria-hidden className="h-5 w-px bg-linka" />
        <Link
          href="/prihlaseni"
          className="text-sm font-medium text-inkoust-tlumeny hover:text-inkoust"
        >
          Přihlásit se
        </Link>
        <Link
          href="/demo/prehled"
          className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Vyzkoušet demo
        </Link>
      </nav>

      {/* mobil a tablet: CTA zůstává viditelné, zbytek pod tlačítkem menu */}
      <div className="flex items-center gap-3 lg:hidden">
        <Link
          href="/demo/prehled"
          className="rounded-md bg-ruzova-syta px-3.5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
        >
          Demo
        </Link>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobilni-menu"
          aria-label={open ? 'Zavřít menu' : 'Otevřít menu'}
          onClick={() => setOpen((value) => !value)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-linka bg-plocha"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-5 w-5"
            aria-hidden
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <>
          {/* scrim: ztmaví stránku a klik mimo panel menu zavře */}
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 top-16 z-40 bg-inkoust/20 lg:hidden"
          />
          <div
            id="mobilni-menu"
            className="absolute inset-x-0 top-full z-50 border-b border-linka bg-plocha shadow-lg lg:hidden"
          >
            <nav className="mx-auto max-w-6xl px-6 py-4" aria-label="Mobilní navigace">
              <ul className="space-y-1">
                {LINKS.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      aria-current={active === link.key ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'block rounded-md px-3 py-3 text-sm font-medium',
                        active === link.key
                          ? 'bg-ruzova/10 text-ruzova-text'
                          : 'text-inkoust hover:bg-pozadi',
                      )}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
                {/* akce účtu pohromadě pod předělem — stejná logika jako desktop */}
                <li className="border-t border-linka pt-2">
                  <Link
                    href="/prihlaseni"
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-3 py-3 text-sm font-medium text-inkoust hover:bg-pozadi"
                  >
                    Přihlásit se
                  </Link>
                </li>
                <li>
                  <Link
                    href="/registrace"
                    onClick={() => setOpen(false)}
                    className="block rounded-md px-3 py-3 text-sm font-semibold text-ruzova-text hover:bg-pozadi"
                  >
                    Založit účet zdarma
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </>
      )}
    </>
  );
}
