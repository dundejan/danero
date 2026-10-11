/**
 * Výsledek akce s přesměrováním, jak ho stránka dostala v adrese (`?ok=` /
 * `?chyba=`), pro formuláře, které chybu ukazují přímo u pole.
 *
 * Stránka je funkce adresy a kód výsledku se z adresy hned po zobrazení uklízí
 * (`ClearFeedbackUrl`). Jakmile se pak stránka obnoví ze serveru — doběhla
 * synchronizace, uložilo se nastavení opuštěné na jiné stránce, návrat
 * z mezipaměti prohlížeče —, přijde už bez výsledku. Formulář vykreslený jen
 * z toho, co poslal server, se tím zavřel uživateli pod rukama, hláška u pole
 * zmizela a rozepsaný text s ní (změřeno 11. 10. 2026: stačilo jediné obnovení
 * stránky, i u řádku otevřeného ručně bez chyby).
 *
 * Výsledek proto drží prohlížeč, dokud nepřijde další.
 */
export interface ActionResult {
  /** Jiné při každém vykreslení na serveru — odliší dvě stejné chyby po sobě. */
  id: string;
  /** Kód chyby z `?chyba=`; `null` = akce se povedla. */
  error: string | null;
}

/**
 * Který výsledek formulář ukazuje po dalším vykreslení.
 *
 * - `incoming` je to, co poslal server; `null`, když adresa výsledek nenesla
 *   (obyčejné obnovení stránky) — pak platí ten, který formulář drží.
 * - `fresh` říká, že adresa výsledek nese právě teď. Bez toho jde o stránku
 *   vrácenou z paměti směrovače (Zpět/Vpřed): ta si pamatuje i výsledek, se
 *   kterým byla kdysi vykreslená, a chybu z minula by ukázala znovu.
 */
export function heldActionResult(
  held: ActionResult | null,
  incoming: ActionResult | null,
  fresh: boolean,
): ActionResult | null {
  return fresh && incoming !== null && incoming.id !== held?.id ? incoming : held;
}
