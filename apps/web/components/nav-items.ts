import type { NavIconName } from '@/components/nav-icons';

/**
 * Sekce aplikace. Seznam bydlí mimo klientskou komponentu navigace, protože
 * ho čte i serverová úvodní stránka (náhled aplikace v okně).
 *
 * Sekce má JEDNO jméno a to platí všude: v postranním panelu, ve spodní liště
 * telefonu i v titulku stránky. Kratší popisek pro spodní lištu tu býval
 * („Simulace“ místo „Simulátor“) — položka se pak na telefonu jmenovala jinak
 * než stránka, na kterou vedla. Kdyby se jméno do pětiny lišty nevešlo, hledá
 * se kratší jméno sekce, ne druhé jméno pro telefon.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

export const APP_NAV_ITEMS: readonly NavItem[] = [
  { href: '/prehled', label: 'Přehled', icon: 'overview' },
  { href: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { href: '/simulator', label: 'Simulátor', icon: 'simulator' },
  { href: '/report', label: 'Report', icon: 'report' },
  { href: '/import', label: 'Zdroje dat', icon: 'sources' },
  { href: '/nastaveni', label: 'Nastavení', icon: 'settings' },
];

/** Demo prohlídka: stejné stránky bez Zdrojů dat a Nastavení (nemají smysl bez účtu). */
export const DEMO_NAV_ITEMS: readonly NavItem[] = [
  { href: '/demo/prehled', label: 'Přehled', icon: 'overview' },
  { href: '/demo/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { href: '/demo/simulator', label: 'Simulátor', icon: 'simulator' },
  { href: '/demo/report', label: 'Report', icon: 'report' },
];

/**
 * Stránky skořápky, které v navigaci vlastní položku nemají, a sekce, do které
 * patří. Uvítání nového účtu stojí na místě přehledu — bez toho by na něm
 * nebyla zvýrazněná žádná položka a nešlo by říct, kde člověk je.
 */
const NAV_ALIASES: Readonly<Record<string, string>> = {
  '/vitejte': '/prehled',
};

/** Která položka navigace je pro danou adresu aktivní (`undefined` = žádná). */
export function activeNavHref(items: readonly NavItem[], pathname: string): string | undefined {
  const alias = Object.entries(NAV_ALIASES).find(([prefix]) => pathname.startsWith(prefix))?.[1];
  const path = alias ?? pathname;
  return items.find((item) => path.startsWith(item.href))?.href;
}
