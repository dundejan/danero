import { Decimal, d, TransactionSchema } from '@danero/shared';
import {
  detectDecimalSeparator,
  isAmbiguousThousandGroup,
  normalizeHeader,
  parseCsv,
  parseEuroDate,
} from '../csv';
import { emptyResult, type ImportResult } from '../types';

export const EIC_BROKER = 'eic';

/**
 * Parser CSV exportu pokynů z portálu EIC (European Investment Centre —
 * fondy a ETF přes poradce, typicky pravidelné investování).
 *
 * Formát (doloženo skutečným exportem z 20. 11. 2026): středníkové CSV
 * ve windows-1250, hlavička
 * `Objednávka;Druh pokynu;Fond;Počet;Cena;Objem;Měna;Účet;Obchodní den;Datum vysp.;Stav;Poradce;Síť;Poplatek za výpis poštou;Poplatek za vykonání;Poplatek za vyspořádání;Poplatek za konverzi;Vstupní poplatek;Výstupný poplatek ;Druh pokynu;Share Isin;ID`.
 * Texty jsou v uvozovkách, čísla bez nich a s desetinnou TEČKOU, datum
 * dd.MM.yyyy. Nejnovější pokyn je nahoře.
 *
 * ⚠️ Sloupec „Druh pokynu“ je v hlavičce DVAKRÁT a pokaždé říká něco jiného:
 * první je směr (Koupě / Prodej), druhý druh pokynu (Koupě / Konverze).
 * Rozhoduje ten druhý — měnová konverze má v prvním „Prodej“ (prodává se
 * koruna) a číst ji jako prodej fondu by vyrobilo zdanitelný příjem z ničeho.
 *
 * Druhy řádků, které export prokazatelně nese:
 *  - **Koupě** — nákup fondu: `Fond` je interní kód EIC (ne burzovní ticker),
 *    ISIN je v `Share Isin`, `Počet` × `Cena` = `Objem` v měně pokynu.
 *    Poplatek za vykonání je v téže měně a platí se NAD objem (konverze
 *    k nákupu ho pokrývá), patří tedy k nabývací ceně.
 *  - **Konverze** — výměna korun za měnu fondu před nákupem: `Fond` nese
 *    prodávanou měnu, `Počet` její částku, `Objem` částku v nakoupené měně
 *    (`Cena` je kurz zaokrouhlený na dvě místa, k ničemu). Bez daňové události.
 *
 * Prodej (odkup) fondu, výměnu ani převod jsme ve skutečném exportu ještě
 * neviděli, takže je NEHÁDÁME: neznámý druh končí chybou s doslovným zněním.
 * Totéž stav pokynu — známe „Zaúčtovaný“ a „Vyspořádané“; pokyn v jiném stavu
 * (čekající, zrušený) nesmí potichu vzniknout jako nákup.
 *
 * `ID` je číslo řádku pohledu a ve skutečném exportu je unikátní, ale že ho
 * nesdílí částečná plnění téhož pokynu, doložené není — do
 * `TRANSACTION_ID_BROKERS` proto EIC nepatří, dokud to neuvidíme.
 */

/** Sloupce v tvaru normalizeHeader. */
const COL = {
  order: 'objednavka',
  kind: 'druh pokynu',
  fund: 'fond',
  quantity: 'pocet',
  price: 'cena',
  volume: 'objem',
  currency: 'mena',
  account: 'ucet',
  tradeDate: 'obchodni den',
  settlementDate: 'datum vysp.',
  status: 'stav',
  isin: 'share isin',
  id: 'id',
} as const;

/**
 * Poplatek, který vstupuje do nabývací ceny. Jen ten, u kterého skutečný
 * export doložil, co znamená: částka v měně pokynu placená nad objem.
 */
const PURCHASE_FEE_COLUMNS = ['poplatek za vykonani'] as const;

/**
 * Poplatky, které jsme u nákupu nikdy neviděli vyplněné nenulovou částkou.
 * U vstupního poplatku nevíme ani to, jestli je to částka, nebo procento
 * a jestli už není uvnitř objemu — nezapočítáváme je (bezpečný směr: vyšší
 * daň, ne nižší), ale nenulovou hodnotu ohlásíme. („Výstupný“ je doslovné
 * znění hlavičky; spisovný tvar bereme taky.)
 */
const OTHER_FEE_COLUMNS = [
  'poplatek za vysporadani',
  'vstupni poplatek',
  'poplatek za vypis postou',
  'poplatek za konverzi',
  'vystupny poplatek',
  'vystupni poplatek',
] as const;

/**
 * Sloupce, podle kterých se export pozná A které parser vyžaduje — jeden
 * seznam pro sniffer i parser. Jen názvy bez diakritiky, ať detekce nestojí
 * na kódování; sloupce s diakritikou (Počet, Měna, Obchodní den) se kontrolují
 * až u řádku, kde soubor s rozbitou hlavičkou aspoň řekne, co mu chybí.
 */
const REQUIRED_COLUMNS = [COL.kind, COL.fund, COL.price, COL.status, COL.isin, COL.id] as const;

const isCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/**
 * Stavy provedeného pokynu — přesná shoda, ne předpona: „Vyspořádání probíhá“
 * nebo „Zaúčtovaný – storno“ by předponou prošly jako hotový nákup.
 */
const EXECUTED_STATUSES = new Set(['zauctovany', 'zauctovane', 'vysporadany', 'vysporadane']);
const isExecuted = (status: string): boolean => EXECUTED_STATUSES.has(normalizeHeader(status));

interface Columns {
  headers: string[];
  /** První výskyt názvu sloupce. */
  first: (name: string) => number;
  /** Poslední výskyt — u zdvojeného „Druh pokynu“ ten rozhodující. */
  last: (name: string) => number;
}

function readColumns(rawHeaders: string[]): Columns {
  const headers = rawHeaders.map(normalizeHeader);
  return {
    headers,
    first: (name) => headers.indexOf(name),
    last: (name) => headers.lastIndexOf(name),
  };
}

const missingColumns = (columns: Columns): string[] =>
  REQUIRED_COLUMNS.filter((name) => columns.first(name) === -1);

/**
 * Autodetekce exportu pokynů EIC z prvního řádku: středníkový soubor se
 * všemi sloupci, které parser vyžaduje. `Share Isin` vedle `Fond` a `Stav`
 * se netrefí do Portu (Datum;Název;Typ…), Degira (Datum;Čas;Produkt…) ani Fia.
 */
export function sniffEicCsv(text: string): boolean {
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  if (!firstLine.includes(';')) return false;
  return missingColumns(readColumns(parseCsv(firstLine, ';').headers)).length === 0;
}

export function parseEicCsv(text: string): ImportResult {
  const result = emptyResult(EIC_BROKER);
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text, ';');
  const columns = readColumns(headers);
  const missing = missingColumns(columns);
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako export pokynů z EIC — chybí sloupec „${missing[0]}“. Nalezené sloupce: ${headers.filter((h) => h.trim() !== '').join(', ')}`,
    });
    return result;
  }

  const cell = (row: string[], index: number): string => (index === -1 ? '' : (row[index] ?? '').trim());
  const get = (row: string[], name: string): string => cell(row, columns.first(name));

  const numericColumns = [COL.quantity, COL.price, COL.volume, ...PURCHASE_FEE_COLUMNS, ...OTHER_FEE_COLUMNS]
    .map((name) => columns.first(name))
    .filter((index) => index !== -1);
  // Lokalizace čísel se rozhoduje jednou za soubor. Export nepíše tisíce,
  // takže když soubor důkaz nedá (samá čísla se třemi desetinnými místy),
  // bereme jediný oddělovač jako desetinný — a řekneme to.
  const decimal = detectDecimalSeparator(rows.flatMap((row) => numericColumns.map((index) => cell(row, index))));
  const ambiguous = { count: 0, firstLine: undefined as number | undefined };

  /** Číslo bez tisícových oddělovačů → Decimal; prázdné → null; jiný zápis → 'invalid'. */
  const num = (raw: string, line: number): Decimal | null | 'invalid' => {
    const value = raw.replace(/\s/g, '');
    if (value === '') return null;
    const match = /^(-?\d+)(?:([.,])(\d+))?$/.exec(value);
    if (!match) return 'invalid';
    if (match[2] !== undefined && decimal !== null && match[2] !== decimal) return 'invalid';
    if (decimal === null && isAmbiguousThousandGroup(value)) {
      ambiguous.count += 1;
      ambiguous.firstLine ??= line;
    }
    return d(match[3] === undefined ? match[1]! : `${match[1]}.${match[3]}`);
  };

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((value) => value.trim() === '')) return;

    const raw = row.join(';');
    const rawKind = cell(row, columns.last(COL.kind));
    const kind = normalizeHeader(rawKind);
    const fail = (message: string): void => {
      result.errors.push({ line, message, raw });
    };

    if (kind === 'konverze') {
      const from = get(row, COL.fund);
      const to = get(row, COL.currency);
      result.skipped.push({
        line,
        message: `„${get(row, COL.order) || rawKind}“: měnová konverze v rámci EIC (${from || '?'} → ${to || '?'}) — bez daňové události.`,
      });
      return;
    }
    if (kind !== 'koupe') {
      fail(`Neznámý druh pokynu „${rawKind}“ — nahlaš nám ho, doplníme podporu.`);
      return;
    }
    // Nákup má „Koupě“ v OBOU sloupcích Druh pokynu. Co nese druhý sloupec
    // u odkupu fondu, nevíme — kdyby to nebyl směr, zaúčtoval by se prodej
    // jako nákup. Neshodu proto nehádáme.
    const rawSide = cell(row, columns.first(COL.kind));
    if (normalizeHeader(rawSide) !== 'koupe') {
      fail(
        `Pokyn má ve sloupcích Druh pokynu „${rawSide}“ a „${rawKind}“ — takovou kombinaci neznáme, takže jsme ho nezaúčtovali. Nahlaš nám ho, doplníme podporu.`,
      );
      return;
    }

    const rawStatus = get(row, COL.status);
    if (!isExecuted(rawStatus)) {
      fail(
        `Pokyn je ve stavu „${rawStatus}“, který neznáme — nevíme, jestli se provedl, takže jsme ho nezaúčtovali. Nahlaš nám ho, doplníme podporu.`,
      );
      return;
    }

    const rawDate = get(row, COL.tradeDate);
    const tradeDate = parseEuroDate(rawDate);
    if (!tradeDate) {
      fail(`Neplatné datum „${rawDate}“ ve sloupci Obchodní den (očekáván formát dd.mm.rrrr).`);
      return;
    }
    const currency = get(row, COL.currency);
    if (!isCurrency(currency)) {
      fail(`Řádku chybí měna (sloupec Měna) — nalezeno „${currency}“, očekáván třípísmenný kód (EUR, USD…).`);
      return;
    }
    const isin = get(row, COL.isin);
    if (isin === '') {
      fail(`${rawKind}: chybí ISIN fondu (sloupec Share Isin) — řádek nelze zpracovat.`);
      return;
    }
    const id = get(row, COL.id);
    if (id === '') {
      fail(`${rawKind}: chybí ID pokynu — řádek nelze zpracovat.`);
      return;
    }

    const quantity = num(get(row, COL.quantity), line);
    if (quantity === null || quantity === 'invalid' || quantity.lte(0)) {
      fail(`${rawKind}: chybí počet kusů nebo ho neumíme přečíst („${get(row, COL.quantity)}“).`);
      return;
    }
    let price = num(get(row, COL.price), line);
    if (price === 'invalid' || (price !== null && price.lt(0))) {
      fail(`${rawKind}: cenu za kus neumíme přečíst („${get(row, COL.price)}“).`);
      return;
    }
    // nulová cena u nákupu je chybějící údaj, ne fond zadarmo — nabývací cena
    // by vyšla nulová a z prodeje by se zdanilo všechno
    if (price === null || price.eq(0)) {
      const volume = num(get(row, COL.volume), line);
      if (volume === null || volume === 'invalid' || volume.lte(0)) {
        fail(`${rawKind}: chybí cena za kus i objem obchodu — řádek nelze zpracovat.`);
        return;
      }
      price = volume.div(quantity);
    }

    let fee = d(0);
    for (const name of PURCHASE_FEE_COLUMNS) {
      const value = num(get(row, name), line);
      if (value === 'invalid' || (value !== null && value.lt(0))) {
        fail(`${rawKind}: poplatek neumíme přečíst („${get(row, name)}“).`);
        return;
      }
      if (value !== null) fee = fee.plus(value);
    }
    for (const name of OTHER_FEE_COLUMNS) {
      const value = num(get(row, name), line);
      if (value === null || (value !== 'invalid' && value.eq(0))) continue;
      const header = headers[columns.first(name)]!.trim();
      result.warnings.push({
        line,
        message: `${get(row, COL.fund) || isin} (${tradeDate}): ve sloupci „${header}“ je ${get(row, name)} ${currency}. Tenhle poplatek jsme u nákupu ještě neviděli a do nabývací ceny jsme ho nezapočítali (daň tím vyjde nanejvýš vyšší, ne nižší) — dej nám vědět, ať ho doplníme.`,
      });
    }

    const settlementDate = parseEuroDate(get(row, COL.settlementDate));
    const candidate = {
      type: 'BUY',
      id: `eic-${id}`,
      account: get(row, COL.account) || undefined,
      isin,
      // kód fondu v EIC, ne burzovní ticker — jiné označení ale export nemá
      ticker: get(row, COL.fund) || undefined,
      quantity: quantity.toString(),
      pricePerShare: price.toString(),
      currency,
      fee: fee.gt(0) ? { amount: fee.toString(), currency } : undefined,
      tradeDate,
      // u nákupů bývá prázdné — pak ho dopočte engine
      settlementDate: settlementDate !== null && settlementDate >= tradeDate ? settlementDate : undefined,
    };
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (err) {
      fail(`Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  if (ambiguous.count > 0) {
    result.warnings.push({
      line: ambiguous.firstLine ?? 1,
      message:
        'Čísla v tomhle výpisu mají samá tři místa za oddělovačem, takže z něj nejde poznat, jestli tečka a čárka oddělují desetinná místa, nebo tisíce. ' +
        'Četli jsme je jako desetinná (tak EIC čísla píše) — zkontroluj si počty kusů; kdyby to bylo naopak, lišily by se tisíckrát.',
    });
  }

  return result;
}
