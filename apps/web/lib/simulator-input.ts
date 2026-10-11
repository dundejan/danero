/**
 * Číslo z pole simulátoru (kusy, cena) do tvaru pro `Decimal`: bez mezer
 * a s desetinnou tečkou.
 *
 * Aplikace sama píše čísla česky — tisíce odděluje pevnou mezerou
 * („1 234,56“), některé prohlížeče úzkou pevnou. Do 11. 10. 2026 se převáděla
 * jen čárka, takže číslo zkopírované z portfolia do pole „Cena za kus“ skončilo
 * hláškou „Zadej cenu za kus — kladné číslo“. `\s` pokrývá obyčejnou, pevnou
 * (U+00A0), úzkou pevnou (U+202F) i tenkou mezeru (U+2009).
 *
 * Nic se tu nehádá: tečka zůstává desetinnou tečkou (tisíce tečkou aplikace
 * nepíše) a jednotky ani měnu funkce neodřezává — co po úpravě není číslo,
 * odmítne kontrola tvaru u pole.
 */
export const normalizeNumberInput = (raw: string): string =>
  raw.replace(/\s/g, '').replace(',', '.');

/**
 * Klíč zadání simulátoru (pozice, kusy, cena). Server jím označí výsledek,
 * který spočítal, formulář zadání, které právě odeslal — dokud se neshodují,
 * výsledek na obrazovce k formuláři ještě nepatří a zobrazí se zešedlý.
 *
 * Klíč nese zadání TAK, JAK HO UŽIVATEL NAPSAL (jen bez okrajových mezer) —
 * normalizuje se až pro výpočet. Kdyby jedna strana číslo normalizovala
 * a druhá ne, klíče by se nesešly a výsledek by zůstal zešedlý.
 *
 * Sdílí ho serverová i klientská komponenta, proto bydlí mimo obě.
 */
export const simulationKey = (isin: string, quantity: string, price: string): string =>
  [isin, quantity.trim(), price.trim()].join('|');

/**
 * Přišel výsledek s klíčem `resultKey`. Je to odpověď na některé z odeslaných
 * zadání (`pending`, od nejstaršího), nebo navigace odjinud?
 *
 * - Odpověď: vrací zadání, která na odpověď ještě čekají — tedy ta odeslaná
 *   PO tom, na které odpověď přišla (starší už nedorazí, novější požadavek je
 *   přebil). Prázdné pole = výsledek patří k poslednímu odeslanému zadání.
 * - Navigace odjinud (klik na „Simulátor“ v navigaci, odkaz s jinou pozicí,
 *   tlačítko zpět): vrací `null` a formulář má převzít hodnoty z adresy.
 *
 * Do 10. 10. 2026 formulář bral hodnoty z adresy jen při prvním vykreslení,
 * takže po takové navigaci zůstal vyplněný vedle výsledku „Vyber pozici“
 * a oblast výsledku zůstala zešedlá (nález R4-06).
 */
export function answeredSubmissions(
  pending: readonly string[],
  resultKey: string,
): string[] | null {
  const at = pending.lastIndexOf(resultKey);
  return at === -1 ? null : pending.slice(at + 1);
}
