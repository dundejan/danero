/**
 * Vrátil prohlížeč stránku ze své paměti, místo aby se zeptal serveru?
 *
 * Tlačítko Zpět (i Vpřed) umí ukázat stránku tak, jak vypadala naposledy —
 * a u aplikace, kde se stav mění i jinde, je to starý stav. Změřeno
 * 11. 10. 2026 v Chromiu i Firefoxu: Nastavení → jiná stránka plným načtením →
 * změna na druhém zařízení → Zpět ukázalo původní hodnoty (dokument přišel
 * z mezipaměti, přenos 0 bajtů). Cesty jsou dvě a každá se pozná jinak:
 *
 * - **bfcache**: prohlížeč stránku zmrazí i s běžícím JavaScriptem a po návratu
 *   ji rozmrazí. Nic se nenačítá, přijde jen `pageshow` s `persisted`.
 * - **dokument z mezipaměti**: stránka se načte znovu, ale HTML si prohlížeč
 *   vezme z disku bez ověření (při procházení historie to smí, pokud odpověď
 *   nezakázala uložení). Pozná se podle druhu navigace `back_forward`
 *   a nulového přenosu.
 *
 * Čistě čerstvé načtení (odkaz, F5, i návrat, při kterém server odpověděl)
 * obnovovat netřeba — druhý dotaz by jen zdvojil práci serveru.
 */

/** Co o načtení dokumentu říká `PerformanceNavigationTiming`. */
export interface NavigationInfo {
  type?: string;
  transferSize?: number;
}

/** Dokument při procházení historie přišel z mezipaměti prohlížeče, ne ze serveru. */
export function cameFromHistoryCache(navigation: NavigationInfo | undefined): boolean {
  return navigation?.type === 'back_forward' && navigation.transferSize === 0;
}
