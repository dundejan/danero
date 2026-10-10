/**
 * Uložení, po kterém stránka zůstane tam, kde byla.
 *
 * Server action po úspěchu přesměruje na adresu bez kotvy a Next po takové
 * navigaci odroluje na začátek — přepnutí vypínače na konci dlouhé stránky by
 * člověka pokaždé vyhodilo nahoru. Kotva, která na stránce neexistuje, je pro
 * Next „vyřízené rolování“, takže poloha zůstane. Obal akce proto zachytí její
 * přesměrování a doplní mu takovou kotvu.
 *
 * Doplnit ji smí JEN návratu na tutéž stránku s potvrzením (`?ok=`). První
 * verze obalu spolkla jakékoli přesměrování vnitřní akce a vždy poslala
 * „Uloženo“ — chybová větev (`?chyba=`), limit nebo vypršelé přihlášení uvnitř
 * akce by tak skončily zeleným potvrzením (R4-10). Cokoli jiného se proto
 * propouští beze změny.
 */

/** Otisk, kterým Next značí výjimku z `redirect()`: `NEXT_REDIRECT;<typ>;<adresa>;<stav>;`. */
const REDIRECT_DIGEST = 'NEXT_REDIRECT';

/** Cíl přesměrování z výjimky, kterou vyhodil `redirect()`; `null` = není to přesměrování. */
export function redirectDestination(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return null;
  const { digest } = error;
  if (typeof digest !== 'string') return null;
  const parts = digest.split(';');
  if (parts[0] !== REDIRECT_DIGEST || parts.length < 5) return null;
  // adresa sama smí obsahovat středník — stejně ji skládá i Next
  return parts.slice(2, -2).join(';');
}

/**
 * Cíl, kterým má obal skončit místo zachyceného přesměrování: táž adresa
 * s kotvou `anchor`. `null` = přesměrování (nebo výjimku) propusť dál tak, jak
 * je — není to úspěšný návrat na `pathname`.
 */
export function inPlaceDestination(
  error: unknown,
  pathname: string,
  anchor: string,
): string | null {
  const destination = redirectDestination(error);
  if (destination === null) return null;
  // základ je jen kvůli rozboru relativní adresy; cizí původ znamená „jinam“
  const base = 'http://danero.invalid';
  let url: URL;
  try {
    url = new URL(destination, base);
  } catch {
    return null;
  }
  if (url.origin !== base || url.pathname !== pathname) return null;
  if (!url.searchParams.has('ok') || url.searchParams.has('chyba')) return null;
  return `${url.pathname}${url.search}#${anchor}`;
}

/**
 * Pustí akci a vrátí adresu, na kterou má obal přesměrovat, aby stránka
 * zůstala stát: úspěšný návrat akce na `pathname` s kotvou. Když akce
 * nepřesměruje vůbec, vrací `null` (potvrzení si dodá obal). Cokoli jiného —
 * přesměrování jinam, chyba, opravdová výjimka — vyhodí dál beze změny.
 */
export async function runInPlace(
  action: () => Promise<void>,
  pathname: string,
  anchor: string,
): Promise<string | null> {
  try {
    await action();
  } catch (error) {
    const target = inPlaceDestination(error, pathname, anchor);
    if (target === null) throw error;
    return target;
  }
  return null;
}
