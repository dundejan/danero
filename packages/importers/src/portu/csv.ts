import { Decimal, d, TransactionSchema } from '@danero/shared';
import { cleanNumberEu, HeaderMap, normalizeHeader, parseCsv, parseEuroDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const PORTU_BROKER = 'portu';

/**
 * Parser CSV exportu transakcí Portu (portu.cz — řízená portfolia).
 *
 * Formát (doloženo vzorkem z fóra Portfolio Performance): středníkové CSV,
 * hlavička doslova
 * `Datum;Název;Typ;Symbol;ISIN;Kusy / Pozice;Popis;Cena;Hodnota;Měna;Srážková daň;Hrubá výše dividendy`.
 * Datum dd.MM.yyyy, čísla s desetinnou čárkou, záporná Hodnota = odchozí
 * peníze, frakční kusy jsou běžné. `Název` nese jméno PORTFOLIA uživatele
 * (ne instrumentu!) — instrument je v Symbol/ISIN, u forexu je měnový pár
 * v Popisu. Forex nákup/prodej dělá Portu automaticky při vkladech — bez
 * daňové události, přeskakujeme.
 *
 * POZOR: hodnoty sloupce Typ mimo „Forex nákup/prodej“ jsou ODVOZENÉ z filtrů
 * v aplikaci Portu (Vklady/Výběry/Nákupy/Prodeje/Převody/Poplatky/Forex/Ostatní),
 * ne z reálného souboru — neznámý typ proto hlásíme s DOSLOVNÝM zněním, ať
 * slovník doplníme z reálných exportů. Typy mapujeme přes normalizeHeader
 * (case-insensitive, bez diakritiky) — funguje i pro export s rozbitou nebo
 * vynechanou diakritikou („Nakup“, „Vyber“).
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
  return [COL.type, COL.symbol, COL.isin, COL.quantity].every((column) => map.has(column));
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
    const typRaw = map.get(row, COL.type);
    const typ = normalizeHeader(typRaw);

    // vklady/výběry = převody peněz, forex = interní konverze — bez daňové události
    if (typ === 'vklad' || typ === 'vyber') {
      result.skipped.push({
        line,
        message: `„${typRaw}“: převod peněz mezi bankou a Portu — pro daňový výpočet není potřeba.`,
      });
      return;
    }
    if (typ === 'forex nakup' || typ === 'forex prodej') {
      result.skipped.push({
        line,
        message: `„${typRaw}“ (${map.get(row, COL.description) || 'měnový pár neuveden'}): měnová konverze v rámci Portu — bez daňové události (Portu ji provádí automaticky při vkladech).`,
      });
      return;
    }
    if (typ === 'prevod') {
      result.warnings.push({
        line,
        message: `„${typRaw}“: převod mezi portfolii — řádek jsme přeskočili, ale zkontroluj ve výpisu Portu, zda nejde ve skutečnosti o prodej (ten by byl daňová událost).`,
      });
      return;
    }
    if (typ !== 'nakup' && typ !== 'prodej' && typ !== 'dividenda' && typ !== 'poplatek') {
      result.errors.push({
        line,
        message: `Neznámý typ pohybu „${typRaw}“ — nahlaš nám ho, doplníme podporu (typy Portu mimo Forex zatím odvozujeme z filtrů v jejich aplikaci, reálný export je může pojmenovat jinak).`,
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

    switch (typ) {
      case 'nakup':
      case 'prodej': {
        const isin = map.get(row, COL.isin);
        if (isin === '') {
          result.errors.push({
            line,
            message: `${typRaw}: chybí ISIN instrumentu — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        const quantity = num(map.get(row, COL.quantity));
        if (quantity === null || quantity.eq(0)) {
          result.errors.push({
            line,
            message: `${typRaw}: chybí počet kusů — řádek nelze zpracovat.`,
            raw,
          });
          return;
        }
        let price = num(map.get(row, COL.price));
        if (price === null) {
          if (value === null || value.eq(0)) {
            result.errors.push({
              line,
              message: `${typRaw}: chybí cena za kus i hodnota obchodu — řádek nelze zpracovat.`,
              raw,
            });
            return;
          }
          // Cena chybí → jednotková cena z |Hodnoty| (Decimal, žádná JS aritmetika)
          price = value.abs().div(quantity.abs());
        }
        push(line, raw, {
          type: typ === 'nakup' ? 'BUY' : 'SELL',
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
          gross = value.abs();
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
          gross: gross.abs().toString(),
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
    }
  });

  return result;
}
