import { Decimal, d, TransactionSchema } from '@danero/shared';
import { cleanNumberEu, HeaderMap, normalizeHeader, parseCsv, parseEuroDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const PORTU_BROKER = 'portu';

/**
 * Parser CSV exportu transakcí Portu (portu.cz — řízená portfolia).
 *
 * Formát (doloženo skutečným exportem „Transakční historie“, 15. 10. 2026):
 * středníkové CSV v UTF-8, hlavička doslova
 * `Datum;Název;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Měna;Srážková daň;Hrubá výše dividendy`.
 * Datum dd.MM.yyyy, čísla s desetinnou čárkou a pevnou mezerou mezi tisíci,
 * záporná Hodnota = odchozí peníze, frakční kusy jsou běžné. `Název` nese
 * jméno PORTFOLIA uživatele (ne instrumentu!) — instrument je v Symbol/ISIN,
 * u forexu je měnový pár nebo zajišťovací kontrakt v Popisu.
 *
 * Sloupec Typ začíná druhem pohybu a za pomlčkou nese podrobnosti, které
 * opakují ostatní sloupce: „Nákup – VWCE GY – 0,4823 kusů (103,58 € za kus)“,
 * „Poplatek – březen 2026“, „Výběr na bankovní účet – peníze jsme odeslali …“.
 * Rozhoduje jen druh před první pomlčkou (`movementKind`). Do 15. 10. 2026
 * parser čekal holé „Nákup“ (slovník byl odvozený z filtrů v aplikaci Portu)
 * a první skutečný export skončil chybou na každém řádku.
 *
 * Druhy mapujeme přes normalizeHeader (bez diakritiky, malými písmeny) —
 * funguje i pro export s rozbitou nebo vynechanou diakritikou („Nakup“).
 * Neznámý druh hlásíme s DOSLOVNÝM zněním, ať slovník doplníme.
 */

/** Sloupce v tvaru normalizeHeader — diakritiku v hlavičce srovná normalizace. */
const COL = {
  date: 'datum',
  type: 'typ',
  symbol: 'symbol',
  isin: 'isin',
  quantity: 'kusy / pozice',
  description: 'popis',
  price: 'cena',
  value: 'hodnota',
  currency: 'mena',
  withholdingTax: 'srazkova dan',
  grossDividend: 'hruba vyse dividendy',
} as const;

const isCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/**
 * Druh pohybu ze sloupce Typ: text před první pomlčkou, normalizovaný.
 * Pomlčka je ve skutečném exportu en dash; spojovník s mezerami bereme taky
 * (rozbité kódování, ruční úprava v tabulkovém editoru). Podrobnosti za ní
 * smí obsahovat další pomlčky („Swap USDCZK - Roll“) — ty už nerozhodují.
 */
function movementKind(rawType: string): string {
  return normalizeHeader(rawType.split(/\s[–—-]\s/, 1)[0] ?? '');
}

/**
 * Zajišťovací noha (R-12u): Portu u zajištěných portfolií vypořádává měnové
 * swapy a forwardy a v Popisu je pojmenuje („3.4.2023 Swap USDCZK“,
 * „2.9.2025 Forward EURCZK“). Podle ISIN to nejde — ten mají jen novější
 * forwardy.
 */
const isHedgeLeg = (description: string): boolean => /\b(swap|forward)\b/i.test(description);

/** Číslo s desetinnou čárkou → Decimal; prázdné/nečíselné → null. */
function num(value: string): Decimal | null {
  const cleaned = cleanNumberEu(value);
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? d(cleaned) : null;
}

/**
 * Autodetekce Portu CSV z prvního řádku. Jen ASCII-bezpečné názvy sloupců —
 * diakritika v hlavičce („Název“, „Měna“) se při špatném kódování rozpadá,
 * sniff na ní nesmí stát. Kombinace `Typ` + `Symbol` + `ISIN` + `Kusy / Pozice`
 * ve STŘEDNÍKOVÉM souboru se netrefí do Degiro (Datum;Čas;Produkt;ISIN…) ani
 * do čárkových exportů (T212, univerzální šablona).
 *
 * Podle NÁZVŮ, ne podle doslovného pořadí: parser sloupce mapuje `HeaderMap`ou,
 * takže přehozené `Typ` a `Název` přečte — do 12. 8. 2026 mu je ale autodetekce
 * nepustila („;Typ;Symbol;ISIN;“ jako podřetězec) a soubor skončil hláškou
 * „Formát souboru nepoznáváme“.
 */
export function sniffPortuCsv(text: string): boolean {
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  if (!firstLine.includes(';')) return false;
  const map = new HeaderMap(parseCsv(firstLine, ';').headers.map(normalizeHeader));
  // ⚠️ Přesně ty sloupce, které vyžaduje parser — nic navíc (K7b-15). Se
  // `symbol` a `isin` v seznamu odmítl sniffer soubor, který parser přečte
  // (1 transakce, 0 chyb), a uživatel dostal „Formát souboru nepoznáváme".
  return [COL.date, COL.type, COL.quantity, COL.value].every((column) => map.has(column));
}

export function parsePortuCsv(text: string): ImportResult {
  const result = emptyResult(PORTU_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text, ';');
  const map = new HeaderMap(headers.map(normalizeHeader));

  // povinné jsou jen ASCII-bezpečné sloupce — hlavičky s diakritikou (Měna…)
  // řešíme až per řádek, ať soubor s rozbitým kódováním aspoň řekne proč
  for (const required of [COL.date, COL.type, COL.quantity, COL.value] as const) {
    if (!map.has(required)) {
      result.errors.push({
        line: 1,
        message: `Soubor nevypadá jako export transakcí z Portu — chybí sloupec „${required}“. Nalezené sloupce: ${headers.filter((h) => h.trim() !== '').join(', ')}`,
      });
      return result;
    }
  }

  // Portu export nemá ID řádku → stabilní obsahový hash; identické legitimní
  // řádky dostanou pořadový suffix -2, -3 (stabilní mezi překrývajícími se
  // exporty, vzor contentId v src/fio/csv.ts) — NIKDY pořadí řádku v souboru
  const occurrences = new Map<string, number>();
  const rowId = (row: string[]): string => {
    const base = `portu-${fnv1a64(row.join(';'))}`;
    const seen = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  // R-12u: zajišťovací nohy se nepočítají, ale soubor o nich musí říct — jedno
  // upozornění za soubor místo stovek u řádků
  const hedgeLegs = { count: 0, firstLine: undefined as number | undefined, years: new Set<string>() };
  // kusy přesunuté mezi portfolii: „do“ odečítá, „z“ přičítá — v exportu všech
  // portfolií se každý titul vynuluje
  const transferred = new Map<string, { net: Decimal; line: number; ticker: string }>();

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw,
      });
    }
  };

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;

    const raw = row.join(';');
    const rawType = map.get(row, COL.type);
    const rowType = movementKind(rawType);
    const skip = (message: string): void => {
      result.skipped.push({ line, message: `„${rawType}“: ${message}` });
    };

    // „Vklad z bankovního účtu“, „Výběr na bankovní účet – peníze jsme odeslali …“.
    // Jen přesně tyhle druhy: jiný „vklad“ (třeba cenných papírů od jiného
    // obchodníka) nesmí potichu propadnout, má skončit jako neznámý typ.
    if (rowType === 'vklad z bankovniho uctu' || rowType === 'vyber na bankovni ucet') {
      skip('převod peněz mezi bankou a Portu — pro daňový výpočet není potřeba.');
      return;
    }
    if (rowType === 'forex nakup' || rowType === 'forex prodej') {
      const description = map.get(row, COL.description);
      if (isHedgeLeg(description)) {
        hedgeLegs.count += 1;
        hedgeLegs.firstLine ??= line;
        const year = parseEuroDate(map.get(row, COL.date))?.slice(0, 4);
        if (year) hedgeLegs.years.add(year);
        skip('vypořádání měnového zajištění — výsledek z exportu spočítat nejde, viz upozornění k zajištění.');
        return;
      }
      skip(`měnová konverze v rámci Portu (${description || 'měnový pár neuveden'}) — bez daňové události.`);
      return;
    }
    // „Převod do <portfolio>“ / „Převod z <portfolio>“ — peníze i kusy mezi
    // portfolii TÉHOŽ uživatele: vlastník se nemění, takže to není prodej,
    // a nabytí (datum i cena) zůstává. Obě nohy přeskočíme; pozice se počítají
    // za uživatele, ne za portfolio, takže součet kusů sedí i bez nich —
    // pokud ve výpisu jsou obě nohy (hlídá to `transferred`).
    const transferOut = rowType.startsWith('prevod do ');
    if (transferOut || rowType.startsWith('prevod z ')) {
      const isin = map.get(row, COL.isin);
      const quantity = num(map.get(row, COL.quantity));
      if (isin !== '' && quantity !== null) {
        const entry = transferred.get(isin) ?? {
          net: d(0),
          line,
          ticker: map.get(row, COL.symbol) || isin,
        };
        entry.net = transferOut ? entry.net.minus(quantity.abs()) : entry.net.plus(quantity.abs());
        transferred.set(isin, entry);
      }
      skip('přesun mezi tvými portfolii v Portu — nejde o prodej, nákup zůstává s původním datem i cenou.');
      return;
    }
    // poplatky do výpočtu nevstupují (FEE loty neovlivňuje), takže ani jejich sleva
    if (rowType.startsWith('sleva na poplatku')) {
      skip('vrácená část poplatku — poplatky za správu daň neovlivňují.');
      return;
    }
    // půjčka od Portu a její splátka stejnou částkou — pohyb peněz, který se
    // splátkou vyrovná; příjem z investic to není
    if (rowType === 'bezurocna pujcka' || rowType === 'splatka bezurocne pujcky') {
      skip('bezúročná půjčka od Portu a její splátka — nejde o příjem.');
      return;
    }
    if (
      rowType !== 'nakup' &&
      rowType !== 'prodej' &&
      rowType !== 'dividenda' &&
      rowType !== 'poplatek' &&
      rowType !== 'urok'
    ) {
      result.errors.push({
        line,
        message: `Neznámý typ pohybu „${rawType}“ — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      return;
    }

    const rawDate = map.get(row, COL.date);
    const date = parseEuroDate(rawDate);
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatné datum „${rawDate}“ (očekáván formát dd.mm.rrrr).`,
        raw,
      });
      return;
    }

    const currency = map.get(row, COL.currency);
    if (!isCurrency(currency)) {
      result.errors.push({
        line,
        message: `Řádku chybí měna (sloupec Měna) — nalezeno „${currency}“, očekáván třípísmenný kód (EUR, CZK…).`,
        raw,
      });
      return;
    }

    const value = num(map.get(row, COL.value));

    switch (rowType) {
      case 'nakup':
      case 'prodej': {
        const isin = map.get(row, COL.isin);
        if (isin === '') {
          result.errors.push({
            line,
            message: `${rawType}: chybí ISIN instrumentu — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        const quantity = num(map.get(row, COL.quantity));
        if (quantity === null || quantity.eq(0)) {
          result.errors.push({
            line,
            message: `${rawType}: chybí počet kusů — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        let price = num(map.get(row, COL.price));
        if (price === null) {
          if (value === null || value.eq(0)) {
            result.errors.push({
              line,
              message: `${rawType}: chybí cena za kus i hodnota obchodu — řádek nelze zpracovat.`,
              raw,
            });
            return;
          }
          // Cena chybí → jednotková cena z |Hodnoty| (Decimal, žádná JS aritmetika)
          price = value.abs().div(quantity.abs());
        }
        push(line, raw, {
          type: rowType === 'nakup' ? 'BUY' : 'SELL',
          id: rowId(row),
          isin,
          ticker: map.get(row, COL.symbol) || undefined,
          // name vědomě NE — sloupec Název nese jméno portfolia, ne instrumentu
          quantity: quantity.abs().toString(),
          pricePerShare: price.abs().toString(),
          currency,
          tradeDate: date, // datum vypořádání export nemá — dopočte engine
        });
        return;
      }
      case 'dividenda': {
        let gross = num(map.get(row, COL.grossDividend));
        if (gross === null) {
          if (value === null) {
            result.errors.push({
              line,
              message: 'Dividenda bez částky — řádek nelze zpracovat.',
              raw,
            });
            return;
          }
          // záporná částka je storno, ne příjem — `abs()` by ho přičetl k dividendě,
          // kterou ruší
          if (value.lt(0)) {
            result.warnings.push({
              line,
              message: `Záporná dividenda ${value.toString()} ${currency} (${map.get(row, COL.symbol) || map.get(row, COL.isin) || 'bez symbolu'}, ${date}) — vypadá jako storno dřívější výplaty. Nezaúčtovali jsme ji a původní výplatu sami nerušíme; zkontroluj obě ve výpisu Portu.`,
            });
            return;
          }
          gross = value;
          const label = map.get(row, COL.symbol) || map.get(row, COL.isin) || 'bez symbolu';
          result.warnings.push({
            line,
            message: `Dividenda ${label} (${date}): export neuvádí hrubou výši — bereme ${gross.toString()} ${currency} z pohybu, což je nejspíš čistá částka po srážce. Zkontroluj ji ve výpisu Portu.`,
          });
        }
        const withholding = num(map.get(row, COL.withholdingTax));
        push(line, raw, {
          type: 'DIVIDEND',
          id: rowId(row),
          isin: map.get(row, COL.isin) || undefined,
          ticker: map.get(row, COL.symbol) || undefined,
          gross: gross.toString(),
          currency,
          withholdingTax: withholding === null ? '0' : withholding.abs().toString(),
          date,
        });
        return;
      }
      case 'poplatek': {
        if (value === null) {
          result.errors.push({
            line,
            message: 'Poplatek bez částky — řádek nelze zpracovat.',
            raw,
          });
          return;
        }
        push(line, raw, {
          type: 'FEE',
          id: rowId(row),
          amount: value.abs().toString(),
          currency,
          date,
          note: map.get(row, COL.description) || undefined,
        });
        return;
      }
      case 'urok': {
        // Úrok z úročené hotovosti v Portu (Investiční rezerva, Peněženka).
        // Portu ho připisuje v hrubé výši a sám ho řadí do § 8 (FAQ
        // Investiční rezervy); export u něj vyplňuje „Srážková daň“ nulou.
        // Engine takový český úrok podle R-07g započte do § 8 i do limitů.
        if (value === null) {
          result.errors.push({ line, message: 'Úrok bez částky — řádek nelze zpracovat.', raw });
          return;
        }
        // záporný úrok = oprava dřívějšího připsání; `abs()` by ho přičetl
        if (value.lt(0)) {
          result.warnings.push({
            line,
            message: `Záporný úrok ${value.toString()} ${currency} (${date}) — vypadá jako oprava dřívějšího připsání. Nezaúčtovali jsme ho; zkontroluj ho ve výpisu Portu.`,
          });
          return;
        }
        const withholding = num(map.get(row, COL.withholdingTax));
        push(line, raw, {
          type: 'INTEREST',
          id: rowId(row),
          amount: value.toString(),
          currency,
          withholdingTax: withholding === null ? '0' : withholding.abs().toString(),
          sourceCountry: 'CZ', // Portu je česká firma a úrok připisuje sama
          date,
        });
        return;
      }
    }
  });

  for (const [isin, entry] of transferred) {
    if (entry.net.eq(0)) continue;
    result.warnings.push({
      line: entry.line,
      message: `Přesun ${entry.ticker} mezi tvými portfolii nemá ve výpisu druhou stranu (rozdíl ${entry.net.abs().toString()} ks, ${isin}). Stáhni výpis za všechna portfolia najednou, jinak budou kusy v jednom z nich chybět nebo přebývat.`,
    });
  }

  if (hedgeLegs.count > 0) {
    const years = [...hedgeLegs.years].sort();
    const count = hedgeLegs.count;
    const movements = count === 1 ? 'pohyb' : count < 5 ? 'pohyby' : 'pohybů';
    const period = years.length === 1 ? `z roku ${years[0]}` : `z let ${years.join(', ')}`;
    result.warnings.push({
      line: hedgeLegs.firstLine ?? 1,
      message:
        `Výpis obsahuje ${count} ${movements} měnového zajištění (swapy a forwardy, kterými Portu chrání zajištěná portfolia před pohybem kurzu) ${period}. ` +
        'Jejich výsledek se daní jako příjem z derivátů, jenže export obsahuje jen převody měn, ne celé kontrakty, takže ho z něj spolehlivě spočítat nejde — do výpočtu jsme ho nezahrnuli. ' +
        'Zisk ze zajištění za rok patří do ostatních příjmů (§ 10). Do limitu 50 000 Kč pro paušální daň se navíc počítají zisky z jednotlivých kontraktů, i když jiné skončily ztrátou.',
    });
  }

  return result;
}
