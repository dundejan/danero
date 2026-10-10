/**
 * Klíč zadání simulátoru (pozice, kusy, cena). Server jím označí výsledek,
 * který spočítal, formulář zadání, které právě odeslal — dokud se neshodují,
 * výsledek na obrazovce k formuláři ještě nepatří a zobrazí se zešedlý.
 *
 * Sdílí ho serverová i klientská komponenta, proto bydlí mimo obě.
 */
export const simulationKey = (isin: string, quantity: string, price: string): string =>
  [isin, quantity.trim(), price.trim()].join('|');
