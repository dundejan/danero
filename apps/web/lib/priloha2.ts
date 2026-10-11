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
 * Úhrn v celých korunách dolů — totéž, co `wholeCzkParts` dá v součtu. Pro
 * úhrn, který se po druzích nerozepisuje (základ z prodejů jiné varianty
 * párování v porovnání variant).
 */
export const wholeCzkDown = (value: Money): Money =>
  value.toDecimalPlaces(0, Decimal.ROUND_FLOOR);

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
 * `base8WholeCzk` si k nim připojí ještě § 8 a rozdělí celé koruny přes celý
 * seznam naráz — proto musí dostat surové hodnoty, ne už rozdělené díly.
 * (S rozdělenými by poslední díl vyšel jako `floor(§8)` místo správného
 * `floor(zbytek + §8)`.)
 */
const base10Values = (result: TaxYearResult): Money[] =>
  kinds(result).map((k) => k.zdroj.base10Czk);

/**
 * Dílčí základ § 8 v celých korunách — JEDINÝ zdroj pro XML i pro průvodce
 * v reportu, stejně jako `priloha2()` pro § 10.
 *
 * Průvodce do revize 5 tiskl nezaokrouhlený `base8Czk` matematicky, kdežto XML
 * neslo celé koruny dolů: nad týmiž daty radil zapsat na ř. 38 a ř. 401a
 * 59 136 Kč, zatímco XML mělo 59 135 (nález L5-05).
 *
 * - `generalCzk` → ř. 38 přiznání: § 8 je posledním dílem TÉHOŽ rozdělení celých
 *   korun jako druhy § 10 — běžící součet zaručí, že se řádky Přílohy 2
 *   přidáním § 8 na konec nepohnou a ř. 42 sedí na základ z enginu (A3-08).
 * - `separate16aCzk` → ř. 401a Přílohy 4: samostatný základ má vlastní
 *   zaokrouhlení na sta dolů (ř. 409), proto celé koruny dolů samostatně.
 */
export function base8WholeCzk(result: TaxYearResult): {
  generalCzk: Money;
  separate16aCzk: Money;
} {
  return {
    generalCzk: wholeCzkParts([...base10Values(result), result.dividends.base8Czk]).at(-1)!,
    separate16aCzk: wholeCzkDown(result.dividends.base8Czk),
  };
}

/**
 * Dílčí základy tak, jak je ponese tiskopis — pro ROZPAD DANĚ na přehledu
 * a v reportu (docs/02 R-14h).
 *
 * Rozpad do 11. 10. 2026 formátoval nezaokrouhlené základy z enginu
 * matematicky, kdežto Příloha č. 2 o pár řádků výš je nese v celých korunách
 * dolů: v demu za rok 2026 stálo pod sebou 8 551 Kč (ř. 209) a 8 552 Kč
 * („Základ daně z prodejů“). Jedna veličina má mít jedno číslo — a to, které
 * se opisuje do formuláře.
 *
 * Nic se tu nepočítá nově: druhy § 10 jsou řádky `priloha2()`, § 8 je
 * `base8WholeCzk()` pro zvolený způsob zdanění dividend. Daň se z toho
 * nepočítá — tu dál dává engine z nezaokrouhleného základu, který § 16 odst. 2
 * zaokrouhluje na sta dolů, takže celé koruny dolů výsledek neposunou.
 */
export function wholeBasesCzk(
  result: TaxYearResult,
  taxation: 'GENERAL' | 'SEPARATE_16A',
): {
  securitiesCzk: Money;
  cryptoCzk: Money;
  derivativesCzk: Money;
  /** Úhrn druhů § 10 = ř. 209 Přílohy č. 2 = ř. 40 přiznání. */
  base10Czk: Money;
  /** § 8: ř. 38 (s ostatními příjmy), nebo ř. 401a Přílohy č. 4 (zvlášť). */
  base8Czk: Money;
} {
  const p2 = priloha2(result);
  const base8 = base8WholeCzk(result);
  return {
    securitiesCzk: p2.rows[0]!.rozdilCzk,
    cryptoCzk: p2.rows[1]!.rozdilCzk,
    derivativesCzk: p2.rows[2]!.rozdilCzk,
    base10Czk: p2.rozdilCzk,
    base8Czk: taxation === 'GENERAL' ? base8.generalCzk : base8.separate16aCzk,
  };
}

/**
 * Tržby (u derivátů plnění) druhu v celých korunách tak, aby seděly na sloupec
 * „Příjmy“ Přílohy č. 2 — pro tichý řádek pod druhem v rozpadu daně
 * (docs/02 R-14h).
 *
 * Příloha příjmy druhu nezaokrouhluje, ale dopočítává (výdaje dolů + rozdíl
 * podle úhrnu, viz `priloha2`), takže vyjdou až o 2 Kč níž než táž tržba
 * zaokrouhlená matematicky: u tržby 108 601,60 Kč stálo v příloze 108 601 Kč
 * a o pár sekcí níž „tržby 108 602 Kč“. Zdanitelná část tržeb se proto bere
 * z řádku přílohy. Osvobozená část (časový test, prodeje do limitu) v příloze
 * není vůbec — přičte se zaokrouhlená na koruny, takže rok, kde je osvobozené
 * všechno, ukáže totéž číslo jako čerpání limitu na přehledu.
 *
 * Jen zobrazení: nic z toho nejde do XML ani do výpočtu daně.
 */
export function wholeProceedsCzk(result: TaxYearResult): {
  securitiesCzk: Money;
  cryptoCzk: Money;
  derivativesCzk: Money;
} {
  const rows = priloha2(result).rows;
  const beyondForm = (grossCzk: Money, taxableCzk: Money): Money =>
    grossCzk.sub(taxableCzk).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const { securities, crypto } = result;
  return {
    securitiesCzk: rows[0]!.prijmyCzk.plus(
      beyondForm(securities.totalGrossProceedsCzk, securities.taxableIncomeCzk),
    ),
    cryptoCzk: rows[1]!.prijmyCzk.plus(
      beyondForm(crypto.totalGrossProceedsCzk, crypto.taxableIncomeCzk),
    ),
    // u derivátů se zobrazuje rovnou zdanitelné plnění — to je řádek přílohy
    derivativesCzk: rows[2]!.prijmyCzk,
  };
}

/**
 * Ztráta, kterou do Přílohy 2 zapsat nejde: součet toho, oč výdaje každého
 * druhu převýšily jeho příjmy (§ 10 odst. 4; R-05d, R-10c, R-12b). Druhy se
 * nekompenzují, takže zisk jednoho ztrátu druhého nesnižuje.
 *
 * Počítá se z NEZAOKROUHLENÉHO rozdílu příjmů a výdajů druhu, ne z rozdílu
 * mezi řádky přílohy a výdaji z enginu: řádky jsou v celých korunách dolů,
 * takže odříznuté haléře vypadaly jako „ztráta 1 Kč“ i v roce, kdy žádný druh
 * ve ztrátě nebyl (nález L5-06). Výdaje derivátů navíc engine vrací už
 * zastropované — jejich ztrátu nese jen `rawGainLossCzk`.
 */
export function lossBeyondIncomeCzk(result: TaxYearResult): Money {
  return kinds(result).reduce(
    (sum, k) => sum.plus(Decimal.max(ZERO, k.zdroj.rawGainLossCzk.neg())),
    ZERO,
  );
}

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
