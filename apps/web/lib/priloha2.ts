import { Decimal, ZERO, type Money } from '@danero/shared';
import type { TaxYearResult } from '@danero/engine';

/**
 * Příloha č. 2 přiznání (§ 10) — JEDINÝ zdroj čísel pro XML i pro průvodce
 * v reportu.
 *
 * Do 23. 8. 2026 měl každý svoje: XML zastropovalo výdaje výší příjmů podle
 * § 10 odst. 4, report tiskl nezastropovanou částku z enginu. U ztrátového roku
 * pak jedna stránka radila zapsat „příjmy 1 244 880, výdaje 2 653 920", zatímco
 * XML z téhož výsledku neslo `vydaje10="1244880"` — a podatelna to odmítá
 * (`[N] kc_vyd10 :: Příloha 2/ř.208 — hodnota položky může být maximálně do
 * výše ř.207`). Nález K3-03.
 */
export interface Priloha2Row {
  /** Kód druhu příjmu podle číselníku tiskopisu 5405-P2. */
  kod: 'D' | 'C' | 'F';
  popis: string;
  /** Sloupec 2 — příjmy druhu (celé Kč). */
  prijmyCzk: Money;
  /** Sloupec 3 — výdaje druhu, nejvýš do výše jeho příjmů (§ 10 odst. 4). */
  vydajeCzk: Money;
  /** Sloupec 4 — rozdíl (dílčí základ druhu). */
  rozdilCzk: Money;
  /** Příjem ze zdrojů v zahraničí → kód „Z" na řádku. */
  zahranicniZdroj: boolean;
}

export interface Priloha2 {
  rows: Priloha2Row[];
  /** ř. 207 — úhrn příjmů. */
  prijmyCzk: Money;
  /** ř. 208 — úhrn výdajů. */
  vydajeCzk: Money;
  /** ř. 209 — úhrn rozdílů → ř. 40 přiznání. */
  rozdilCzk: Money;
}

/**
 * Celé koruny přidělené podle ÚHRNU, ne po jednotlivých položkách.
 *
 * Zaokrouhlení každého dílčího základu zvlášť by úhrn rozešlo se základem, ze
 * kterého § 16 zaokrouhluje na sta dolů (report ukazoval 52 092 Kč, XML
 * 52 107 Kč — nález A3-08). i-tá položka proto dostane tolik, aby součet prvních
 * i položek byl celá koruna DOLŮ z jejich nezaokrouhleného součtu.
 *
 * Přidání další položky na konec seznamu předchozími nehýbe (součet je běžící),
 * takže § 8 jde připojit až v generátoru XML, aniž by se druhy § 10 pohnuly.
 */
export function wholeCzkParts(values: Money[]): Money[] {
  let exact = ZERO;
  let allocated = ZERO;
  return values.map((value) => {
    exact = exact.plus(value);
    const cil = exact.toDecimalPlaces(0, Decimal.ROUND_FLOOR);
    const part = cil.sub(allocated);
    allocated = cil;
    return part;
  });
}

/**
 * `kod10 = 'Z'` znamená příjem ZE ZDROJŮ V ZAHRANIČÍ. Rozhoduje původ
 * instrumentu: ISIN začínající `CZ` je tuzemský. Míchá-li druh tuzemské
 * i zahraniční, označí se `Z` — přiznat zahraniční zdroj je bezpečnější směr
 * než ho zamlčet (nález A3-05).
 */
const jeTuzemsky = (isin: string): boolean => isin.toUpperCase().startsWith('CZ');
const zahranicniZdroj = (isins: string[]): boolean =>
  isins.length === 0 || isins.some((isin) => !jeTuzemsky(isin));

/**
 * Druhy § 10, které Danero počítá — v pořadí řádků tabulky Přílohy 2.
 * Posuzují se samostatně (R-10c/R-12l, pokyn D-59 ke § 10/4): výdaje každého
 * druhu max. do výše jeho příjmů, úhrn = součet kladných rozdílů.
 */
function kinds(result: TaxYearResult) {
  return [
    {
      kod: 'D' as const,
      popis: 'Prodej cenných papírů',
      zdroj: result.securities,
      isins: result.securities.disposals.map((d) => d.isin),
    },
    {
      kod: 'C' as const,
      popis: 'Prodej kryptoaktiv (movitá věc)',
      zdroj: result.crypto,
      isins: result.crypto.disposals.map((d) => d.isin),
    }, // R-10c
    {
      kod: 'F' as const,
      popis: 'Deriváty (opce, futures, CFD)',
      zdroj: result.derivatives,
      isins: result.derivatives.items.map((i) => i.isin),
    }, // R-12n
  ];
}

/**
 * NEZAOKROUHLENÉ dílčí základy § 10 v pořadí řádků Přílohy 2.
 *
 * Generátor XML si k nim připojí ještě § 8 a rozdělí celé koruny přes celý
 * seznam naráz — proto musí dostat surové hodnoty, ne už rozdělené díly.
 * (S rozdělenými by poslední díl vyšel jako `floor(§8)` místo správného
 * `floor(zbytek + §8)`.)
 */
export const base10Values = (result: TaxYearResult): Money[] =>
  kinds(result).map((k) => k.zdroj.base10Czk);

export function priloha2(result: TaxYearResult): Priloha2 {
  const parts = wholeCzkParts(base10Values(result));
  const rows: Priloha2Row[] = kinds(result).map(({ kod, popis, zdroj, isins }, i) => {
    const rozdilCzk = parts[i]!;
    // Výdaje druhu se uplatní nejvýš do výše jeho příjmů (§ 10 odst. 4) a do
    // celých korun je zaokrouhlujeme DOLŮ — uplatněný výdaj nikdy nenadhodnotíme.
    // Příjmy pak dopočteme, aby řádek seděl (P − V = rozdíl): podatelna kontroluje
    // jak jednotlivé řádky, tak úhrny sloupců.
    const vydajeCzk = Decimal.min(zdroj.expensesCzk, zdroj.taxableIncomeCzk).toDecimalPlaces(
      0,
      Decimal.ROUND_FLOOR,
    );
    return {
      kod,
      popis,
      prijmyCzk: vydajeCzk.plus(rozdilCzk),
      vydajeCzk,
      rozdilCzk,
      zahranicniZdroj: zahranicniZdroj(isins),
    };
  });
  return {
    rows,
    prijmyCzk: rows.reduce((sum, r) => sum.plus(r.prijmyCzk), ZERO),
    vydajeCzk: rows.reduce((sum, r) => sum.plus(r.vydajeCzk), ZERO),
    rozdilCzk: rows.reduce((sum, r) => sum.plus(r.rozdilCzk), ZERO),
  };
}
