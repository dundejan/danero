import type { NavIconName } from '@/components/nav-icons';

/**
 * Sekce aplikace. Seznam bydlí mimo klientskou komponentu navigace, protože
 * ho čte i serverová úvodní stránka (náhled aplikace v okně).
 */
export interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
  /**
   * Kratší popisek pro spodní lištu. Ořezaný popisek je horší než kratší
   * slovo (audit H2-07), proto tady jedno slovo, které se vejde.
   */
  short?: string;
}

export const APP_NAV_ITEMS: readonly NavItem[] = [
  { href: '/prehled', label: 'Přehled', icon: 'overview' },
  { href: '/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { href: '/simulator', label: 'Simulátor', short: 'Simulace', icon: 'simulator' },
  { href: '/report', label: 'Report', icon: 'report' },
  { href: '/import', label: 'Zdroje dat', icon: 'sources' },
  { href: '/nastaveni', label: 'Nastavení', icon: 'settings' },
];

/** Demo prohlídka: stejné stránky bez Zdrojů dat a Nastavení (nemají smysl bez účtu). */
export const DEMO_NAV_ITEMS: readonly NavItem[] = [
  { href: '/demo/prehled', label: 'Přehled', icon: 'overview' },
  { href: '/demo/portfolio', label: 'Portfolio', icon: 'portfolio' },
  { href: '/demo/simulator', label: 'Simulátor', short: 'Simulace', icon: 'simulator' },
  { href: '/demo/report', label: 'Report', icon: 'report' },
];
