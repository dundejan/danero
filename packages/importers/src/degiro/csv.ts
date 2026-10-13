import { d } from '@danero/shared';
import { detectDecimalSeparator, isAmbiguousThousandGroup, isValidIsoDate } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { makePush } from '../metatrader/common';
import { REENTER_VIA_TEMPLATE, emptyResult, type ImportResult } from '../types';

export const DEGIRO_BROKER = 'degiro';

/**
 * Parser Degiro exportů (docs/03): dva soubory — Transactions.csv (obchody)
 * a Account.csv (peněžní pohyby vč. korporátních akcí jako textových párových
 * řádků). Formát je lokalizovaný: hlavičky i popisy CZ/EN/NL/DE/FR, oddělovač
 * středník NEBO čárka (detekce z hlavičky), čísla s desetinnou čárkou i tečkou,
 * datum dd-MM-yyyy. Částka a měna tvoří DVOJICI pojmenovaný + bezejmenný
 * sloupec: Transactions.csv má číslo v pojmenovaném (Kurz) a měnu za ním,
 * reálné Account.csv naopak MĚNU v pojmenovaném (Změna) a částku za ním —
 * Account parser proto rozhoduje podle obsahu a podporuje obě pořadí.
 */

/* ── CSV s parametrickým oddělovačem (vzor src/csv.ts parseCsv, RFC 4180) ── */

interface DelimitedTable {
  headers: string[];
  rows: string[][];
}

/** RFC 4180: uvozovky, nové řádky uvnitř polí (víceřádkové popisy!), "" escape, BOM. */
function parseDelimited(text: string, delimiter: ';' | ','): DelimitedTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      if (input[i + 1] === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) pushRow();

  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell.trim() === '')) {
    rows.pop();
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

/** Oddělovač podle hlavičky: středník (CZ/NL lokalizace) vs. čárka (EN). */
function detectDelimiter(text: string): ';' | ',' {
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  let semicolons = 0;
  let commas = 0;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';') semicolons += 1;
    else if (!inQuotes && ch === ',') commas += 1;
  }
  return semicolons >= commas && semicolons > 0 ? ';' : ',';
}

/* ── Čísla a datumy ──────────────────────────────────────────────────────── */

/**
 * Degiro čísla podle lokalizace: „1.234,56“, „1,234.56“ i „1234,56“.
 * Konzervativně: poslední oddělovač = desetinný; víc výskytů téhož = tisíce.
 * Vrací normalizovaný string s desetinnou tečkou, nebo null (prázdné/nečíslo).
 */
function parseDegiroNumber(value: string, decimal: DecimalSeparator = ','): string | null {
  let v = value.replace(/[\s\u00a0]/g, '');
  if (v === '' || v === '-') return null;
  const hasComma = v.includes(',');
  const hasDot = v.includes('.');
  if (hasComma && hasDot) {
    if (v.lastIndexOf(',') > v.lastIndexOf('.')) {
      v = v.replace(/\./g, '').replace(',', '.');
    } else {
      v = v.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = v.split(',');
    // víc čárek = jistě tisíce; jedna čárka + trojčíslí rozhodne lokalizace
    // souboru (v anglickém exportu je „1,000“ tisíc kusů, v holandském jedna)
    const thousands = parts.length > 2 || (isAmbiguousThousandGroup(v) && decimal === '.');
    v = thousands ? parts.join('') : parts.join('.');
  } else if (hasDot) {
    const parts = v.split('.');
    // Zrcadlově: „1.000“ je v holandském/českém exportu TISÍC. Do 12. 8. 2026
    // se tahle větev nebrala v úvahu vůbec, takže 1 000 kusů se uložilo jako
    // 1 kus — tiše, bez chyby i bez varování.
    const thousands = parts.length > 2 || (isAmbiguousThousandGroup(v) && decimal !== '.');
    v = thousands ? parts.join('') : v;
  }
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

/** Desetinný oddělovač souboru; `null` = soubor nedal důkaz (viz warning níž). */
type DecimalSeparator = ',' | '.' | null;

/**
 * Věta pro uživatele k nerozhodnutelnému zápisu — soubor nedal jediné číslo,
 * ze kterého by šla lokalizace poznat, takže voláme po kontrole očima.
 */
const ambiguousNote = (field: string, raw: string, used: string): string =>
  `${field} „${raw}“ jsme přečetli jako ${used}. Tenhle výpis nikde neprozrazuje, jestli tečka a čárka ` +
  'oddělují tisíce, nebo desetinná místa — zkontroluj si ten řádek ve výpisu; kdyby to bylo naopak, ' +
  'lišila by se hodnota tisíckrát.';

/** Degiro datum dd-MM-yyyy → ISO YYYY-MM-DD; neexistující kalendářní den → null. */
function toIsoDate(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidIsoDate(iso) ? iso : null;
}

/* ── Hlavičky (CZ/EN/NL/DE/FR synonyma) ──────────────────────────────────── */

/*
 * Degiro exportuje v jazyce rozhraní. Klasifikace POPISŮ níž zná pět jazyků
 * (CZ/EN/NL/DE/FR), hlavičky ale do 12. 8. 2026 uměly jen tři — německý
 * a francouzský výpis tak neprošel ani autodetekcí a celá DE/FR větev
 * klasifikace byla nedosažitelný kód. Pozor na dvojici `kurz` (CZ) vs.
 * `kurs` (DE): liší se jediným písmenem a znamenají totéž.
 */
const DATE_HEADERS = ['datum', 'date'];
const TIME_HEADERS = ['čas', 'time', 'tijd', 'uhrzeit', 'heure'];
const PRODUCT_HEADERS = ['produkt', 'product', 'produit'];
const QUANTITY_HEADERS = ['počet', 'quantity', 'aantal', 'anzahl', 'nombre', 'quantité'];
const PRICE_HEADERS = ['kurz', 'cena', 'price', 'koers', 'kurs', 'cours', 'prix'];
const TOTAL_HEADERS = ['celkem', 'total', 'totaal', 'gesamt'];
/** Hodnota obchodu v měně účtu — nečte se, jen její název může nést měnu účtu. */
const VALUE_HEADERS = ['hodnota', 'value', 'waarde', 'wert', 'valeur'];
const ORDER_ID_HEADERS = [
  'id objednávky',
  'order id',
  'ordernummer',
  'order-id',
  'auftrags-id',
  'id de l ordre',
  "id de l'ordre",
];
/** Místo provedení obchodu — korporátní akce ho mají prázdné (viz `isBookEntry`). */
const VENUE_HEADERS = ['venue', 'uitvoeringsplaats', 'ausführungsort', 'ausfuhrungsort', "lieu d'exécution"];
/** Hodnota obchodu v měně titulu („Local value“) — kontrola multiplikátoru u derivátů. */
const isLocalValueHeader = (lower: string): boolean =>
  lower.includes('local value') ||
  lower.includes('domácí měně') ||
  lower.includes('lokale waarde') ||
  lower.includes('wert in lokal') ||
  lower.includes('valeur locale');
const DESCRIPTION_HEADERS = ['popis', 'description', 'omschrijving', 'beschreibung'];
const CHANGE_HEADERS = ['změna', 'pohyb', 'change', 'mutatie', 'änderung', 'anderung', 'variation'];

/**
 * AutoFX = poplatek Degira za automatický převod měny u obchodu v cizí měně.
 * Samostatný sloupec má až rozložení od prosince 2025 („AutoFX Kosten“).
 */
const isAutoFxHeader = (lower: string): boolean => /auto\s?fx/.test(lower);

/** Poplatkový sloupec má dlouhý lokalizovaný název → fuzzy shoda. */
const isFeeHeader = (lower: string): boolean =>
  !isAutoFxHeader(lower) &&
  (lower.includes('transak') || lower.includes('transact')) &&
  (lower.includes('poplatek') ||
    lower.includes('fee') ||
    lower.includes('costs') ||
    lower.includes('kosten') ||
    lower.includes('gebühr') ||
    lower.includes('gebuhr') ||
    lower.includes('frais'));

/** Najde sloupec podle přesných synonym (case-insensitive), případně fuzzy predikátem. */
function findColumn(
  headers: string[],
  names: string[],
  fuzzy?: (lowerHeader: string) => boolean,
): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name);
    if (i >= 0) return i;
  }
  if (fuzzy !== undefined) {
    const i = lower.findIndex((h) => h !== '' && fuzzy(h));
    if (i >= 0) return i;
  }
  return -1;
}

const cell = (row: string[], index: number): string =>
  index >= 0 ? (row[index] ?? '').trim() : '';

const isCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);

/*
 * Od prosince 2025 nosí Transactions.csv měnu účtu v NÁZVU sloupce („Waarde
 * EUR“, „Totaal EUR“) místo v bezejmenném sloupci za částkou. Sufix je
 * třípísmenný kód velkými písmeny oddělený mezerou — „Order ID“ ani „ISIN“
 * mu neodpovídají.
 */
const HEADER_CURRENCY_SUFFIX = /\s+([A-Z]{3})$/;

/** Měna ze sufixu názvu sloupce („Totaal EUR“ → EUR), jinak `undefined`. */
const headerCurrency = (header: string | undefined): string | undefined =>
  HEADER_CURRENCY_SUFFIX.exec(header ?? '')?.[1];

/** Název sloupce bez sufixu měny („Totaal EUR“ → „Totaal“) — pro hledání podle synonym. */
const withoutCurrencySuffix = (header: string): string =>
  header.replace(HEADER_CURRENCY_SUFFIX, '');

type AmountCurrencyPair =
  | { kind: 'ok'; amount: string; currency: string; raw: string }
  | { kind: 'empty' }
  | { kind: 'invalid' };

/**
 * Částka + měna z dvojice buněk: pojmenovaný sloupec (Změna/Change/Mutatie)
 * a bezejmenný hned za ním. Reálné Account.csv exporty mají v pojmenovaném
 * sloupci MĚNU a v bezejmenném ČÁSTKU, jiné varianty pořadí opačné — rozhoduje
 * obsah (třípísmenný kód = měna, parsovatelné číslo = částka), obě pořadí OK.
 */
function readAmountCurrencyPair(
  row: string[],
  namedIndex: number,
  decimal: DecimalSeparator,
): AmountCurrencyPair {
  const first = cell(row, namedIndex);
  const second = cell(row, namedIndex + 1);
  if (first === '' && second === '') return { kind: 'empty' };
  for (const [currency, amountRaw] of [
    [first, second],
    [second, first],
  ] as const) {
    if (!isCurrency(currency)) continue;
    const amount = parseDegiroNumber(amountRaw, decimal);
    if (amount !== null) return { kind: 'ok', amount, currency, raw: amountRaw };
  }
  return { kind: 'invalid' };
}


/* ── Autodetekce ─────────────────────────────────────────────────────────── */

/**
 * Detekce Degiro CSV podle hlaviček — rozliší Transactions.csv a Account.csv.
 * Vyžaduje degiro-specifickou kombinaci sloupců (datum + čas + produkt + …):
 * samotné date+isin+quantity+price by chytalo i naši univerzální šablonu.
 */
export function isDegiroCsv(text: string): 'transactions' | 'account' | null {
  if (text.trim() === '') return null;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const { headers } = parseDelimited(firstLine, detectDelimiter(text));
  if (
    findColumn(headers, DATE_HEADERS) < 0 ||
    findColumn(headers, TIME_HEADERS) < 0 ||
    findColumn(headers, PRODUCT_HEADERS) < 0
  ) {
    return null;
  }
  if (findColumn(headers, DESCRIPTION_HEADERS) >= 0 && findColumn(headers, CHANGE_HEADERS) >= 0) {
    return 'account';
  }
  if (findColumn(headers, ['isin']) >= 0 && findColumn(headers, QUANTITY_HEADERS) >= 0) {
    return 'transactions';
  }
  return null;
}

/* ── Transactions.csv (obchody) ──────────────────────────────────────────── */

const CONTRACT_MESSAGE = (product: string): string =>
  `„${product}“: hodnota obchodu neodpovídá počtu × kurzu, takže jde o kontrakt s multiplikátorem (opce nebo futures). Deriváty z výpisu Degiro sami nezaúčtujeme — jako akcie by vyšly za zlomek skutečné ceny. Doplň obchod přes univerzální šablonu.`;

/**
 * Řádek Transakcí, který není obchod, ale účetní zápis korporátní akce.
 *
 * Štěpení, změnu ISIN i fúzi zapisuje Degiro do Transakcí jako dvojici
 * „prodej“ starých kusů + „nákup“ nových: bez místa provedení (Venue), bez ID
 * objednávky a bez poplatku. Jako obchody by daly zdanitelný prodej, který
 * čerpá limit 100 000 Kč, a nový nákup by vynuloval časový test — přitom se
 * nic neprodalo. Doloženo skutečnými výpisy v Portfolio Performance
 * (`Transactions_english02.txt`: štěpení 23. 12. 2025, fúze 30. 1. 2026; český
 * `Transakce01.txt`) a pravidlem českého nástroje jantobola/degiro-tax-report.
 * Na čas 00:00 se nespoléhá — změna ISIN mívá jiný; slouží jen starším
 * rozložením bez sloupce Venue.
 */
interface BookEntry {
  line: number;
  raw: string;
  date: string;
  time: string;
  isin: string;
  product: string;
  quantity: ReturnType<typeof d>;
  price: ReturnType<typeof d>;
  currency: string;
  candidate: Record<string, unknown>;
}

/**
 * Z účetních zápisů jednoho okamžiku složí korporátní akce:
 *
 *  - odpis a připis TÉHOŽ ISIN → štěpení s poměrem z kusů,
 *  - odpis jednoho a připis jiného ISIN se stejnou hodnotou: stejný počet →
 *    změna ISIN; jiný počet a stejný název → štěpení s novým ISIN (R-04a
 *    + R-04e); jiný název → fúze s poměrem (jestli zachovává časový test, řekne
 *    engine výkladovým varováním — z výpisu se to nepozná).
 *
 * Co zůstane jen na JEDNÉ straně, je samostatný pohyb: připsané kusy (bonusové
 * akcie, spin-off, práva) se zaúčtují jako nákup za cenu z výpisu, typicky
 * nulovou — nová lhůta časového testu a nabývací cena z výpisu, stejně jako
 * u spin-offu podle R-04f; odpis za peníze jako prodej (fúze za hotovost je
 * úplatný převod). Obojí s varováním. Odpis za nulu prodej není a končí
 * chybou: jinak by se celá nabývací cena odečetla jako ztráta.
 */
/**
 * Strop na počet zápisů jednoho okamžiku. Párování porovnává každý odpis
 * s každým připisem; uměle sestavený soubor s tisíci zápisy v jedné minutě by
 * tím import zdržel na minuty. Skutečný výpis jich má ve stejný okamžik jednotky.
 */
const MAX_BOOK_ENTRIES_PER_MOMENT = 40;

function resolveBookEntries(
  entries: BookEntry[],
  result: ImportResult,
  pushTrade: (line: number, raw: string, candidate: Record<string, unknown>) => void,
  nextId: (base: string) => string,
): void {
  const moments = new Map<string, BookEntry[]>();
  for (const entry of entries) {
    const key = `${entry.date}|${entry.time}`;
    const moment = moments.get(key);
    if (moment) moment.push(entry);
    else moments.set(key, [entry]);
  }

  const value = (entry: BookEntry): ReturnType<typeof d> => entry.quantity.abs().mul(entry.price);
  // dvě nohy téže akce mají stejnou hodnotu (kusy × cena), jen jinak rozdělenou
  const sameValue = (a: BookEntry, b: BookEntry): boolean => {
    const [va, vb] = [value(a), value(b)];
    const larger = va.gt(vb) ? va : vb;
    return a.currency === b.currency && larger.gt(0) && va.minus(vb).abs().lte(larger.mul('0.02'));
  };
  const retracted = (result.retracted ??= []);

  for (const group of moments.values()) {
    // viz `MAX_BOOK_ENTRIES_PER_MOMENT`
    if (group.length > MAX_BOOK_ENTRIES_PER_MOMENT) {
      for (const entry of group) {
        result.errors.push({
          line: entry.line,
          message: `${entry.product || entry.isin} (${entry.date}): ve stejný okamžik je ve výpisu ${group.length} zápisů korporátních akcí — tolik jich k sobě spolehlivě nepřiřadíme. Doplň akce přes univerzální šablonu.`,
          raw: entry.raw,
          knownUnsupported: true,
        });
      }
      continue;
    }
    const outs = group.filter((entry) => entry.quantity.lt(0));
    const ins = group.filter((entry) => entry.quantity.gt(0));
    const pairs: Array<[BookEntry, BookEntry]> = [];
    // Dvojice se bere, jen když je JEDNOZNAČNÁ: odpis má právě jeden možný
    // připis a ten připis právě tenhle odpis. Dvě akce ve stejný okamžik se tak
    // nespárují křížem a nesouvisející odpis s připisem (vyřazený titul
    // a bonusové akcie) se neslepí do fúze.
    const pairUp = (matches: (out: BookEntry, into: BookEntry) => boolean): void => {
      for (const out of [...outs]) {
        const candidates = ins.filter((into) => matches(out, into));
        if (candidates.length !== 1) continue;
        const into = candidates[0]!;
        if (outs.filter((other) => matches(other, into)).length !== 1) continue;
        pairs.push([out, into]);
        outs.splice(outs.indexOf(out), 1);
        ins.splice(ins.indexOf(into), 1);
      }
    };
    pairUp((out, into) => out.isin === into.isin); // štěpení
    pairUp((out, into) => out.isin !== into.isin && sameValue(out, into)); // změna ISIN, fúze

    for (const [out, into] of pairs) {
      const from = out.quantity.abs();
      const to = into.quantity;
      const sameIsin = out.isin === into.isin;
      // Jiný ISIN a jiný počet kusů: štěpení, při kterém titul dostal nový ISIN
      // (název zůstává), nebo fúze (název se mění). Z čísel se to nepozná.
      const sameProduct = out.product.trim().toLowerCase() === into.product.trim().toLowerCase();
      const subtype = from.eq(to) && !sameIsin ? 'ISIN_CHANGE' : sameIsin || sameProduct ? 'SPLIT' : 'MERGER';
      // Do 13. 10. 2026 se obě nohy ukládaly jako prodej a nákup. Kdo je má
      // z dřívějška, tomu je import s uložením akce odstraní — jinak by se
      // štěpení uplatnilo vedle smyšleného prodeje a nákupu.
      for (const leg of [out, into]) {
        retracted.push({ id: String(leg.candidate.id), types: ['BUY', 'SELL'] });
      }
      pushTrade(out.line, out.raw, {
        type: 'CORPORATE_ACTION',
        id: nextId(
          `degiro-ca-${fnv1a64([out.date, out.isin, into.isin, from.toString(), to.toString()].join('|'))}`,
        ),
        subtype,
        isin: out.isin,
        ...(sameIsin ? {} : { newIsin: into.isin }),
        date: out.date,
        ...(subtype === 'ISIN_CHANGE' ? {} : { ratio: { from: from.toString(), to: to.toString() } }),
        note: sameIsin || sameProduct ? out.product : `${out.product} → ${into.product}`,
      });
    }

    // Co zbylo na OBOU stranách, k sobě přiřadit neumíme (víc akcí naráz, nohy
    // s různou hodnotou). Jako prodej a nákup by to byl přesně ten zdanitelný
    // prodej, kterému se tu vyhýbáme — proto chyba, ne odhad.
    if (outs.length > 0 && ins.length > 0) {
      for (const entry of [...outs, ...ins]) {
        result.errors.push({
          line: entry.line,
          message: `${entry.product || entry.isin} (${entry.date}): řádek je součást korporátní akce (nemá místo provedení ani ID objednávky), ale ve stejný okamžik je takových zápisů víc a neumíme poznat, které k sobě patří. Doplň akci přes univerzální šablonu.`,
          raw: entry.raw,
          knownUnsupported: true,
        });
      }
      continue;
    }

    for (const entry of [...outs, ...ins]) {
      const what = `${entry.product || entry.isin} (${entry.date})`;
      if (entry.quantity.lt(0) && entry.price.isZero()) {
        result.errors.push({
          line: entry.line,
          message: `${what}: Degiro tímhle řádkem odepsal kusy za nulu a bez obchodu na burze — to není prodej (bývá to vyřazení titulu nebo výměna, ke které chybí druhý řádek). Jako prodej za nulu by vznikla ztráta ve výši celé nabývací ceny, proto ho sami nezaúčtujeme. Doplň pohyb přes univerzální šablonu.`,
          raw: entry.raw,
          knownUnsupported: true,
        });
        continue;
      }
      result.warnings.push({
        line: entry.line,
        message: `${what}: řádek nemá místo provedení ani ID objednávky, takže nejde o obchod na burze, ale o korporátní akci (bonusové akcie, spin-off, výplata při fúzi…). Zaúčtovali jsme ho jako ${entry.quantity.gt(0) ? 'nákup' : 'prodej'} za cenu z výpisu — zkontroluj, že to odpovídá tomu, co se s titulem stalo.`,
      });
      pushTrade(entry.line, entry.raw, entry.candidate);
    }
  }
}

/**
 * Parser Degiro Transactions.csv: každý řádek je (dílčí) exekuce obchodu.
 * Počet > 0 = BUY, < 0 = SELL; měna kurzu je v bezejmenném sloupci hned za ním.
 */
export function parseDegiroTransactionsCsv(text: string): ImportResult {
  const result = emptyResult(DEGIRO_BROKER);
  if (text.trim() === '') {
    result.errors.push({
      line: 1,
      message: 'Soubor je prázdný — nahraj Transactions.csv z Degiro (Inbox → Transakce).',
    });
    return result;
  }

  const { headers, rows } = parseDelimited(text, detectDelimiter(text));
  // sloupce se hledají podle názvu BEZ sufixu měny: „Totaal EUR“ je „Totaal“
  const bare = headers.map(withoutCurrencySuffix);
  const col = {
    date: findColumn(bare, DATE_HEADERS),
    time: findColumn(bare, TIME_HEADERS),
    product: findColumn(bare, PRODUCT_HEADERS),
    isin: findColumn(bare, ['isin']),
    quantity: findColumn(bare, QUANTITY_HEADERS),
    price: findColumn(bare, PRICE_HEADERS),
    fee: findColumn(bare, [], isFeeHeader),
    autoFx: findColumn(bare, [], isAutoFxHeader),
    total: findColumn(bare, TOTAL_HEADERS),
    value: findColumn(bare, VALUE_HEADERS),
    orderId: findColumn(bare, ORDER_ID_HEADERS),
    venue: findColumn(bare, VENUE_HEADERS),
    localValue: findColumn(bare, [], isLocalValueHeader),
  };
  if (col.date < 0 || col.isin < 0 || col.quantity < 0 || col.price < 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Degiro Transactions.csv — chybí sloupce datum/ISIN/počet/kurz. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  // lokalizace čísel se pozná z celého souboru, ne z jedné buňky (viz csv.ts)
  const decimal = detectDecimalSeparator(rows.flat());

  const isUnnamed = (index: number): boolean => (headers[index] ?? '') === '';
  // měna účtu, pokud ji nese název některého sloupce (rozložení od prosince 2025)
  const accountCurrency =
    headerCurrency(headers[col.fee]) ??
    headerCurrency(headers[col.total]) ??
    headerCurrency(headers[col.value]);
  /**
   * Měna částky ve sloupci: starší rozložení ji má v bezejmenném sloupci hned
   * za částkou, novější v názvu sloupce. AutoFX nemá ani jedno a je v měně účtu.
   */
  const columnCurrency = (row: string[], index: number): string | undefined => {
    const next = cell(row, index + 1);
    if (isUnnamed(index + 1) && isCurrency(next)) return next;
    return headerCurrency(headers[index]) ?? accountCurrency;
  };

  const nextId = uniqueIdFactory();
  const pushTrade = makePush(result);
  // účetní zápisy korporátních akcí — párují se až po průchodu všemi řádky
  const bookEntries: BookEntry[] = [];

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((c) => c.trim() === '')) return;

    const isoDate = toIsoDate(cell(row, col.date));
    if (!isoDate) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cell(row, col.date)}“ (očekáván formát dd-MM-yyyy).`,
        raw: row.join(';'),
      });
      return;
    }

    const isin = cell(row, col.isin);
    const quantityRaw = parseDegiroNumber(cell(row, col.quantity), decimal);
    const priceRaw = parseDegiroNumber(cell(row, col.price), decimal);
    // nerozhodnutelný zápis bez důkazu ze souboru → řekni to nahlas
    if (decimal === null) {
      for (const [field, index, parsed] of [
        ['Počet kusů', col.quantity, quantityRaw],
        ['Kurz', col.price, priceRaw],
      ] as const) {
        const raw = cell(row, index);
        if (parsed !== null && isAmbiguousThousandGroup(raw)) {
          result.warnings.push({ line, message: ambiguousNote(field, raw, parsed) });
        }
      }
    }
    if (!isin || quantityRaw === null || priceRaw === null) {
      result.errors.push({
        line,
        message: 'Obchodu chybí ISIN, počet kusů nebo kurz — řádek nelze zpracovat.',
        raw: row.join(';'),
      });
      return;
    }

    // měna kurzu = bezejmenný sloupec hned za sloupcem kurzu (pozičně!)
    const currency = cell(row, col.price + 1);
    if (!isCurrency(currency)) {
      result.errors.push({
        line,
        message: `U kurzu chybí měna (bezejmenný sloupec za kurzem) — nalezeno „${currency}“.`,
        raw: row.join(';'),
      });
      return;
    }

    const quantity = d(quantityRaw);
    if (quantity.eq(0)) {
      result.errors.push({
        line,
        message: 'Obchod s nulovým počtem kusů — řádek nelze zpracovat.',
        raw: row.join(';'),
      });
      return;
    }

    // Opce a futures mají multiplikátor: hodnota obchodu je násobek počtu
    // × kurzu (opce na DAX pětkrát, americká opce stokrát). Práh 2 nechává
    // stranou zaokrouhlení i drobné rozdíly u akcií.
    if (col.localValue >= 0) {
      const localRaw = parseDegiroNumber(cell(row, col.localValue), decimal);
      const localCurrency = cell(row, col.localValue + 1);
      const nominal = quantity.mul(priceRaw).abs();
      if (
        localRaw !== null &&
        nominal.gt(0) &&
        (!isCurrency(localCurrency) || localCurrency === currency) &&
        d(localRaw).abs().div(nominal).gte(2)
      ) {
        result.errors.push({
          line,
          message: CONTRACT_MESSAGE(cell(row, col.product) || isin),
          raw: row.join(';'),
          knownUnsupported: true,
        });
        return;
      }
    }

    // R-05b: výdajem k obchodu jsou i poplatky. Transakční poplatek i AutoFX
    // jsou záporné částky v měně účtu a můžou být prázdné; sčítají se do
    // jednoho poplatku obchodu.
    let fee: { amount: string; currency: string } | undefined;
    if (col.fee >= 0) {
      const feeRaw = parseDegiroNumber(cell(row, col.fee), decimal);
      if (feeRaw !== null && !d(feeRaw).eq(0)) {
        const feeCurrency = columnCurrency(row, col.fee);
        if (feeCurrency !== undefined) {
          fee = { amount: d(feeRaw).abs().toString(), currency: feeCurrency };
        } else {
          result.warnings.push({
            line,
            message: `Transakční poplatek ${feeRaw} nemá měnu — nebyl započten, doplň ho ručně.`,
          });
        }
      }
    }
    if (col.autoFx >= 0) {
      const autoFxRaw = parseDegiroNumber(cell(row, col.autoFx), decimal);
      if (autoFxRaw !== null && !d(autoFxRaw).eq(0)) {
        const autoFxCurrency = columnCurrency(row, col.autoFx);
        if (autoFxCurrency === undefined) {
          result.warnings.push({
            line,
            message:
              `Poplatek za převod měny (AutoFX) ${autoFxRaw} nemá ve výpisu měnu, kterou bychom ` +
              'poznali — do výdajů k obchodu jsme ho nezapočítali. Daň tím vyjde nanejvýš o něco vyšší.',
          });
        } else if (fee !== undefined && fee.currency !== autoFxCurrency) {
          // měnu známe, jen se liší od transakčního poplatku — obchod nese jediný poplatek v jedné měně
          result.warnings.push({
            line,
            message:
              `Poplatek za převod měny (AutoFX) ${autoFxRaw} ${autoFxCurrency} je v jiné měně než ` +
              `transakční poplatek (${fee.currency}) a k obchodu umíme uložit poplatek jen v jedné — ` +
              'do výdajů k obchodu jsme ho nezapočítali. Daň tím vyjde nanejvýš o něco vyšší.',
          });
        } else {
          fee = {
            amount: d(fee?.amount ?? '0')
              .plus(d(autoFxRaw).abs())
              .toString(),
            currency: autoFxCurrency,
          };
        }
      }
    }

    // Nové rozložení má pod „Order ID“ prázdnou buňku a samotné ID až
    // v bezejmenném sloupci za ní.
    const orderId =
      cell(row, col.orderId) ||
      (col.orderId >= 0 && isUnnamed(col.orderId + 1) ? cell(row, col.orderId + 1) : '');
    const contentHash = fnv1a64(
      [isoDate, cell(row, col.time), isin, quantityRaw, priceRaw, cell(row, col.total)].join('|'),
    );
    const id = nextId(orderId !== '' ? `degiro-${orderId}` : `degiro-${contentHash}`);
    const candidate = {
      type: quantity.gt(0) ? 'BUY' : 'SELL',
      id,
      isin,
      name: cell(row, col.product) || undefined,
      quantity: quantity.abs().toString(),
      pricePerShare: priceRaw,
      currency,
      fee,
      tradeDate: isoDate, // datum vypořádání export neobsahuje — dopočte engine
    };

    const isBookEntry =
      orderId === '' &&
      (col.venue >= 0 ? cell(row, col.venue) === '' : cell(row, col.time) === '00:00');
    if (isBookEntry) {
      bookEntries.push({
        line,
        raw: row.join(';'),
        date: isoDate,
        time: cell(row, col.time),
        isin,
        product: cell(row, col.product),
        quantity,
        price: d(priceRaw),
        currency,
        candidate,
      });
      return;
    }
    pushTrade(line, row.join(';'), candidate);
  });

  resolveBookEntries(bookEntries, result, pushTrade, nextId);
  return result;
}

/* ── Account.csv (peněžní pohyby + korporátní akce) ──────────────────────── */

type CorporateSubtype = 'ISIN_CHANGE' | 'MERGER' | 'SPLIT' | 'SPINOFF';

type AccountKind =
  | { kind: 'DIVIDEND' }
  | { kind: 'DIVIDEND_TAX' }
  | { kind: 'RETURN_OF_CAPITAL' }
  | { kind: 'INTEREST' }
  | { kind: 'FEE' }
  | { kind: 'COURTESY' }
  | { kind: 'DEPOSIT' }
  | { kind: 'WITHDRAWAL' }
  | { kind: 'CORPORATE'; subtype: CorporateSubtype }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

const containsAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/**
 * Hranice slova s diakritikou: `\b` v JS zná jen [A-Za-z0-9_], takže „štěpení“
 * by na začátku popisu nikdy nechytil. Lookaround přes \p{L}\p{N} to řeší.
 */
const wordPattern = (source: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'u');

/**
 * Popisy korporátních akcí v lokalizacích, které Degiro používá (CZ/EN/NL/DE/FR).
 * Hledá se na HRANICI SLOV — holé `includes('split')` by chytilo i název produktu
 * v echu obchodu („Koop 2 SPLIT INC@…“) a řádek by skončil v párování akcí.
 * Reverzní štěpení je pro nás obyčejný SPLIT — směr určí poměr kusů z popisů
 * párových řádků (odpis 40 ks → připis 10 ks je poměr 40:10).
 */
const CORPORATE_PATTERNS: Array<{ subtype: CorporateSubtype; pattern: RegExp }> = [
  {
    subtype: 'ISIN_CHANGE',
    pattern: wordPattern(
      "změna\\s+isin|isin\\s+change|wijziging\\s+isin|isin[\\s-]?(?:wijziging|änderung|anderung)|(?:changement|modification)\\s+(?:d[eu]\\s+l['’]?|d['’])?isin",
    ),
  },
  {
    subtype: 'SPINOFF',
    pattern: wordPattern('spin[\\s-]?off|afsplitsing|abspaltung|odštěpení|scission'),
  },
  {
    subtype: 'SPLIT',
    pattern: wordPattern(
      "aandelensplitsing|split|aktiensplit|štěpení\\s+akcií|rozdělení\\s+akcií|division\\s+(?:d['’]?actions|du\\s+nominal)|regroupement\\s+d['’]?actions",
    ),
  },
  {
    subtype: 'MERGER',
    pattern: wordPattern('fúze|fusie|merger|fusion|verschmelzung'),
  },
];

/**
 * Echo obchodu z Account.csv: sloveso NA ZAČÁTKU popisu, hned za ním počet kusů
 * („Koop 100 Fusion Fuel Green@2,50 EUR“, „Kauf 3 zu je 60,5 USD“).
 *
 * Ukotvení na začátek je podstatné, a to v obou směrech:
 *
 * - Bez něj se echo obchodu s tituly jako **Fusion** Fuel Green, **Split** Rock
 *   Partners nebo The **Merger** Fund klasifikovalo jako korporátní akce
 *   a skončilo chybou, která uživatele naváděla doplnit akci ručně — kdo
 *   poslechl, rozbil si držení (nález B4-2). Hranice slova na to nestačí:
 *   název produktu JE samostatné slovo.
 * - A naopak: Degiro reportuje korporátní akce jako `PREFIX: <sloveso> <počet>`
 *   (`STOCK DIVIDEND: Verkoop 35`). Neukotvené sloveso je odsoudilo k přeskočení
 *   „bereme z Transactions.csv“ — jenže tam nejsou, takže pohyb kusů zmizel.
 *   S ukotvením spadnou na neznámý popis a skončí chybou (bezpečný směr).
 *
 * DE a FR slovesa v seznamu dřív chyběla úplně, takže německý i francouzský
 * výpis dostával „Neznámý popis pohybu“ na KAŽDÉM obchodním řádku (B4-0).
 */
/**
 * Noha korporátní akce v Account.csv: `PREFIX: <sloveso obchodu> <počet> …`
 * („AKTIENSPLIT: Kauf 12 zu je 210 USD“, „Stock split: Prodej 4 …@630 USD“).
 * Obě nohy nesou částku a vyruší se. Tytéž akce jsou v Transactions.csv, odkud
 * se berou — stejně jako obchody.
 */
const CORPORATE_BOOK_ENTRY =
  /^[^:@]{2,40}:\s*(nákup|prodej|koop|verkoop|buy|sell|kauf|verkauf|achat|vente)\s+[\d.,]+/iu;

const TRADE_ECHO =
  /^\s*(nákup|prodej|koop|verkoop|buy|sell|kauf|verkauf|achat|vente)\s+[\d\s.,]+/iu;

/**
 * Pohyb KUSŮ kdekoli v popisu (sloveso + počet), typicky za prefixem korporátní
 * akce: `STOCK DIVIDEND: Verkoop 35 …`. Na rozdíl od `TRADE_ECHO` neukotvené —
 * slouží jen k tomu, aby řádek bez peněžního pohybu, který přesto přesouvá kusy,
 * neodešel do ztracena.
 */
const SHARE_MOVEMENT =
  /(?:^|\s)(nákup|prodej|koop|verkoop|buy|sell|kauf|verkauf|achat|vente)\s+\d/iu;

/** Změna produktu („PRODUCTWIJZIGING : Koop 500 @ …“) — kusy se odepíšou a znovu připíšou. */
const PRODUCT_CHANGE = /productwijziging/i;

/**
 * Klasifikace řádku Account.csv podle POPISU — slovníky CZ/EN/NL/DE/FR, case-insensitive.
 *
 * Slovníky DE a FR vznikly původně PŘEKLADEM, ne z výpisu, a francouzskou
 * srážku z dividendy ani poplatek za obchod nepoznaly: „Impôts sur dividende“
 * skončilo jako záporná dividenda a dividenda se uložila se sraženou daní 0
 * (L2a-04). Znění doložená veřejným vzorkem Account.csv a slovníkem převodníku
 * Export-To-Ghostfolio: „Impôts sur dividende“, „Frais DEGIRO de courtage
 * et/ou de parties tierces“, „DEGIRO Corporate Action Kosten“, „Overboeking
 * van/naar uw geldrekening bij flatexDEGIRO Bank“, „DEGIRO courtesy“
 * a „DEGIRO Verbindungskosten“. Nové znění sem patří jen s dokladem.
 */
function classifyDescription(description: string): AccountKind {
  const lower = description.toLowerCase();
  // Echo obchodu dřív než korporátní akce: rozhoduje TVAR řádku (sloveso +
  // počet na začátku), ne výskyt slova kdekoli v názvu titulu.
  if (TRADE_ECHO.test(description))
    return {
      kind: 'SKIP',
      reason: 'obchod — nákupy a prodeje bereme z Transactions.csv (jinak by se importovaly dvakrát)',
    };
  // dřív než cokoli se slovesem obchodu: „Konverze Peněžního Fondu: Prodej 2,1140 v …“
  if (containsAny(lower, ['konverze peněžního fondu', 'změna ceny peněžního fondu']))
    return { kind: 'SKIP', reason: 'peněžní fond, ve kterém Degiro dřív drželo hotovost — pro daň z CP nepodstatné' };
  // korporátní akce dřív než zbytek — NIKDY je neinterpretovat jako obchod
  for (const { subtype, pattern } of CORPORATE_PATTERNS) {
    if (!pattern.test(lower)) continue;
    // tvar, jakým Degiro akci opravdu zapisuje — viz `CORPORATE_BOOK_ENTRY`
    if (CORPORATE_BOOK_ENTRY.test(description))
      return {
        kind: 'SKIP',
        reason:
          'účetní zápis korporátní akce — štěpení, změny ISIN a fúze bereme z Transactions.csv (jinak by se importovaly dvakrát)',
      };
    return { kind: 'CORPORATE', subtype };
  }
  if (containsAny(lower, ['vratka kapitálu', 'kapitalrückzahlung', 'kapitalruckzahlung']))
    return { kind: 'RETURN_OF_CAPITAL' };
  if (
    containsAny(lower, [
      'daň z dividendy',
      'dividend tax',
      'dividendbelasting',
      'dividendensteuer',
      'quellensteuer',
      'retenue à la source',
      'retenue a la source',
      'impôts sur dividende',
      'impots sur dividende',
    ])
  )
    return { kind: 'DIVIDEND_TAX' };
  if (containsAny(lower, ['dividenda', 'dividend'])) return { kind: 'DIVIDEND' };
  // přesuny do peněžního trhu nejsou příjem („Flatex Interest Income“ je úrok — viz níž)
  if (containsAny(lower, ['cash sweep', 'geldmarktfonds', 'money market']))
    return { kind: 'SKIP', reason: 'převod peněžního trhu / cash sweep — pro daň z CP nepodstatné' };
  // Protějšek cash sweepu: částku nese jen popis, sloupec Změna bývá prázdný.
  if (
    containsAny(lower, [
      'overboeking van uw geldrekening',
      'overboeking naar uw geldrekening',
      'your cash account at flatex',
      'votre compte espèces à la flatex',
      'votre compte especes a la flatex',
    ])
  )
    return {
      kind: 'SKIP',
      reason:
        'převod mezi Degirem a tvým peněžním účtem u flatexDEGIRO Bank — peníze zůstávají u brokera, vklad ani výběr to není',
    };
  if (
    containsAny(lower, [
      'konverze měny',
      'fx credit',
      'fx debit',
      'valuta creditering',
      'valuta debitering',
      'währungswechsel',
      'wahrungswechsel',
      'devisen',
      'conversion de devise',
      'change de devise',
      'operation de change',
      'opération de change',
    ])
  )
    return { kind: 'SKIP', reason: 'FX konverze — pro daňový výpočet CP není potřeba' };
  if (
    containsAny(lower, [
      'poplatek za připojení na burzu',
      'exchange connection fee',
      'aansluitingskosten',
      'degiro transaction fee',
      'transactiekosten',
      'transakční poplatek',
      'anschlusskosten',
      'transaktionsgebühr',
      'transaktionsgebuhr',
      'gebühren',
      'gebuhren',
      'frais de connexion',
      'frais de transaction',
      'verbindungskosten',
      'corporate action kosten',
      'courtage et/ou',
      'transaction and/or third party fees',
      'poplatek za obchodování',
      'einrichtung von handelsmodalitäten',
      'einrichtung von handelsmodalitaten',
      'adr/gdr pass-through fee',
      'adr/gdr weitergabegebühr',
      'adr/gdr weitergabegebuhr',
      'gebühr für kapitalmaßnahme',
      'gebuhr fur kapitalmassnahme',
    ])
  )
    return { kind: 'FEE' };
  if (lower.includes('degiro courtesy')) return { kind: 'COURTESY' };
  // výběr dřív než vklad („Terugstorting“ obsahuje „storting“)
  if (containsAny(lower, ['výběr', 'withdrawal', 'terugstorting', 'auszahlung', 'retrait']))
    return { kind: 'WITHDRAWAL' };
  if (
    containsAny(lower, ['vklad', 'deposit', 'storting', 'ideal', 'einzahlung', 'versement', 'dépôt'])
  )
    return { kind: 'DEPOSIT' };
  if (containsAny(lower, ['úrok', 'interest', 'rente', 'zinsen', 'intérêt', 'interet']))
    return { kind: 'INTEREST' };
  return { kind: 'UNKNOWN' };
}

/** Klíčová slova odpisu a připisu kusů (CZ/EN/NL/DE/FR) — sdílí je směr i počet kusů. */
const LEG_OUT_WORDS = ['uitboeking', 'odpis', 'removal', 'ausbuchung', 'sortie', 'retrait'];
const LEG_IN_WORDS = [
  'inboeking',
  'připis',
  'pripis',
  'addition',
  'einbuchung',
  'entrée',
  'entree',
  'apport',
];

/** Směr párového řádku korporátní akce: odpis (staré kusy) vs. připis (nové). */
function legDirection(lowerDescription: string): 'out' | 'in' | null {
  if (containsAny(lowerDescription, LEG_OUT_WORDS)) return 'out';
  if (containsAny(lowerDescription, LEG_IN_WORDS)) return 'in';
  return null;
}

/** Počet kusů z popisu („Uitboeking 10 …“) — jen číslo HNED za klíčovým slovem (ne cifry z ISIN). */
function legQuantity(description: string, decimal: DecimalSeparator): string | null {
  const match = new RegExp(
    `(?:${[...LEG_OUT_WORDS, ...LEG_IN_WORDS].join('|')})[\\s:]*(\\d+(?:[.,]\\d+)?)`,
    'i',
  ).exec(description);
  return match ? parseDegiroNumber(match[1]!, decimal) : null;
}

/** České popisky akcí do chybových hlášek (uživatel je čte). */
const CORPORATE_LABELS: Record<Exclude<CorporateSubtype, 'SPINOFF'>, string> = {
  ISIN_CHANGE: 'Změna ISIN',
  MERGER: 'Fúze',
  SPLIT: 'Štěpení akcií',
};

interface CorporateLeg {
  line: number;
  isin: string;
  direction: 'out' | 'in' | null;
  quantity: string | null;
  date: string;
  description: string;
}

/**
 * Parser Degiro Account.csv: dividendy + srážková daň (párování ISIN+datum),
 * úroky, poplatky, vklady/výběry; změny ISIN a fúze jako textové párové řádky
 * (odpis starého ISIN + připis nového) → CORPORATE_ACTION, nikdy prodej/nákup.
 * Obchody se vědomě přeskakují — berou se z Transactions.csv.
 */
export function parseDegiroAccountCsv(text: string): ImportResult {
  const result = emptyResult(DEGIRO_BROKER);
  if (text.trim() === '') {
    result.errors.push({
      line: 1,
      message: 'Soubor je prázdný — nahraj Account.csv z Degiro (Inbox → Přehled účtu).',
    });
    return result;
  }

  const { headers, rows } = parseDelimited(text, detectDelimiter(text));
  const col = {
    date: findColumn(headers, DATE_HEADERS),
    time: findColumn(headers, TIME_HEADERS),
    isin: findColumn(headers, ['isin']),
    description: findColumn(headers, DESCRIPTION_HEADERS),
    change: findColumn(headers, CHANGE_HEADERS),
  };
  const decimal = detectDecimalSeparator(rows.flat());
  if (col.date < 0 || col.description < 0 || col.change < 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Degiro Account.csv — chybí sloupce datum/popis/změna. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = uniqueIdFactory();

  // Dlouhou buňku (ID objednávky, popis) Degiro láme na další řádek, který má
  // všechno ostatní prázdné. Zbytek se vrací do buněk předchozího řádku, než
  // se začne číst — jinak by se popis klasifikoval useknutý a zbytek by
  // skončil chybou „neplatné datum“ nebo beze stopy.
  const continuations = new Set<number>();
  let lastDataRow = -1;
  rows.forEach((row, rowIndex) => {
    const filled = row.filter((c) => c.trim() !== '').length;
    if (filled === 0) return;
    if (lastDataRow >= 0 && cell(row, col.date) === '' && filled <= 2) {
      const target = rows[lastDataRow]!;
      row.forEach((value, index) => {
        if (value.trim() === '') return;
        const joiner = index === col.description ? ' ' : '';
        target[index] = `${target[index] ?? ''}${joiner}${value.trim()}`;
      });
      continuations.add(rowIndex);
      return;
    }
    lastDataRow = rowIndex;
  });

  interface PendingDividend {
    line: number;
    id: string;
    isin?: string;
    date: string;
    gross: string;
    currency: string;
    withholding?: string;
  }
  interface PendingTax {
    line: number;
    isin?: string;
    date: string;
    amount: string;
    currency: string;
  }
  const dividends: PendingDividend[] = [];
  const taxes: PendingTax[] = [];
  const corporateLegs = new Map<string, CorporateLeg[]>(); // klíč: subtype|datum

  const push = makePush(result);

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((c) => c.trim() === '')) return;
    if (continuations.has(rowIndex)) return; // obsah už je v předchozím řádku

    const isoDate = toIsoDate(cell(row, col.date));
    if (!isoDate) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cell(row, col.date)}“ (očekáván formát dd-MM-yyyy).`,
        raw: row.join(';'),
      });
      return;
    }

    const description = cell(row, col.description);
    const classified = classifyDescription(description);

    // korporátní akce nemají peněžní pohyb (Změna bývá prázdná) — sbíráme páry
    if (classified.kind === 'CORPORATE') {
      // Spin-off Degiro reportuje jen připisem nových kusů; rozdělení nabývací
      // ceny mezi mateřskou a novou pozici z výpisu nevyčteme (R-04f) — radši
      // chyba k ručnímu doplnění než tiše špatná nabývací cena.
      if (classified.subtype === 'SPINOFF') {
        result.errors.push({
          line,
          message: `Spin-off „${description}“: rozdělení nabývací ceny mezi původní a novou pozici z výpisu Degiro nevyčteme — doplň akci ručně přes univerzální šablonu (typ CORPORATE_ACTION, subtype SPINOFF, sloupce isin, new_isin a ratio_from/ratio_to).`,
          raw: row.join(';'),
        });
        return;
      }
      const isin = cell(row, col.isin);
      if (!isin) {
        result.errors.push({
          line,
          message: `Korporátní akce „${description}“ nemá ISIN — doplň akci ručně přes univerzální šablonu.`,
          raw: row.join(';'),
        });
        return;
      }
      const key = `${classified.subtype}|${isoDate}`;
      const legs = corporateLegs.get(key) ?? [];
      legs.push({
        line,
        isin,
        direction: legDirection(description.toLowerCase()),
        quantity: legQuantity(description, decimal),
        date: isoDate,
        description,
      });
      corporateLegs.set(key, legs);
      return;
    }

    if (classified.kind === 'SKIP') {
      result.skipped.push({ line, message: `„${description}“: ${classified.reason}` });
      return;
    }

    // částka + měna = pojmenovaný sloupec Změna + bezejmenný za ním (obě pořadí)
    const pair = readAmountCurrencyPair(row, col.change, decimal);

    // Řádek, který nehýbe penězi, zato HÝBE KUSY: `STOCK DIVIDEND: Verkoop 35 …`
    // se kvůli slovu „dividend“ klasifikuje jako dividenda a bez částky by
    // zmizel beze stopy i s pohybem 35 kusů (nález B4-0). Skutečné avízo
    // dividendy počet kusů v popisu nemá.
    //
    // „Bez peněz“ je prázdná částka I NULA: Degiro u `STOCK DIVIDEND: Koop 9
    // @ 0 EUR` píše do Změny `0,00` a u změny produktu `0`. S kontrolou jen na
    // prázdnou dvojici dostal první řádek varování „Záporná dividenda 0.00“
    // a druhý „Neznámý popis“ (L2a-04) — proto se ptáme dřív než na neznámý popis.
    const carriesNoMoney = pair.kind === 'empty' || (pair.kind === 'ok' && d(pair.amount).eq(0));
    if (carriesNoMoney && SHARE_MOVEMENT.test(description)) {
      result.errors.push({
        line,
        message: PRODUCT_CHANGE.test(description)
          ? `„${description}“ je změna produktu: Degiro při ní kusy odepíše a znovu připíše, peníze se nehýbou. Takový pohyb z výpisu neumíme zpracovat — když se změnil ISIN nebo počet kusů, doplň ho ručně přes univerzální šablonu, jinak ti nebude sedět počet kusů. Když ISIN i počet zůstaly stejné, nic doplňovat nemusíš.`
          : `„${description}“ nehýbe penězi, ale kusy — takový pohyb z výpisu Degiro neumíme zpracovat. Doplň ho ručně přes univerzální šablonu, jinak ti nebude sedět počet kusů.`,
        raw: row.join(';'),
      });
      return;
    }

    // POŘADÍ JE ZÁVAZNÉ: neznámý popis musí skončit chybou i BEZ peněžního
    // pohybu. Degiro takhle reportuje korporátní akce (prázdná Změna) — dřívější
    // kontrola na prázdnou dvojici je zahazovala úplně beze stopy.
    if (classified.kind === 'UNKNOWN') {
      result.errors.push({
        line,
        message: `Neznámý popis pohybu „${description}“ — nahlaš nám ho, doplníme podporu.`,
        raw: row.join(';'),
      });
      return;
    }

    if (decimal === null && pair.kind === 'ok' && isAmbiguousThousandGroup(pair.raw)) {
      result.warnings.push({ line, message: ambiguousNote('Částka', pair.raw, pair.amount) });
    }
    // prázdná dvojice u ROZPOZNANÉHO popisu = informativní řádek bez peněžního
    // pohybu → bez záznamu (např. avízo dividendy před připsáním)
    if (pair.kind === 'empty') {
      // Pohyb kusů bez peněz už skončil chybou výš. Zbytek (avízo dividendy,
      // řádek daně či poplatku s prázdnou částkou) peněžní pohyb opravdu
      // nenese, takže transakce nevzniká — ale nesmí zmizet beze stopy.
      // Do 8. 8. 2026 se takový řádek zahodil úplně:
      // nešel do transakcí, do chyb, do varování ani do přeskočených, takže
      // import hlásil „0 chyb, 0 přeskočeno“ a řádek nebylo jak dohledat
      // (nález B-3-6, dřív hlášeno úžeji jako B1-1 „mizí dividenda“).
      result.skipped.push({
        line,
        message: `„${description}“ nemá vyplněnou částku ve sloupci Změna — bereme to jako avízo bez peněžního pohybu a transakci z něj nevytváříme.`,
      });
      return;
    }

    if (pair.kind === 'invalid') {
      result.errors.push({
        line,
        message: `Částku pohybu se nepodařilo přečíst — ve sloupci Změna a vedle něj je „${cell(row, col.change)}“ / „${cell(row, col.change + 1)}“, očekáváme číslo a třípísmenný kód měny.`,
        raw: row.join(';'),
      });
      return;
    }

    const changeRaw = pair.amount;
    const currency = pair.currency;
    const change = d(changeRaw);

    // Account.csv nemá ID řádku → stabilní obsahový hash
    const id = nextId(
      `degiro-${fnv1a64([isoDate, cell(row, col.time), description, cell(row, col.isin), changeRaw, currency].join('|'))}`,
    );

    switch (classified.kind) {
      case 'DIVIDEND': {
        if (change.eq(0)) {
          result.skipped.push({ line, message: `„${description}“: nulová částka — nic k zaúčtování.` });
          return;
        }
        dividends.push({
          line,
          id,
          isin: cell(row, col.isin) || undefined,
          date: isoDate,
          gross: changeRaw,
          currency,
        });
        return;
      }
      case 'DIVIDEND_TAX': {
        taxes.push({
          line,
          isin: cell(row, col.isin) || undefined,
          date: isoDate,
          // sražená daň je záporná; kladná je vrácená srážka (oprava)
          amount: change.neg().toString(),
          currency,
        });
        return;
      }
      case 'RETURN_OF_CAPITAL': {
        if (change.lte(0)) {
          result.warnings.push({
            line,
            message: `Vratka kapitálu ${changeRaw} ${currency} („${description}“) není kladná — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
          });
          return;
        }
        push(line, row.join(';'), {
          type: 'DIVIDEND',
          id,
          isin: cell(row, col.isin) || undefined,
          gross: changeRaw,
          currency,
          withholdingTax: '0',
          returnOfCapital: true,
          date: isoDate,
          note: description,
        });
        result.warnings.push({
          line,
          message: `„${description}“: vratka kapitálu není podíl na zisku — věcně snižuje nabývací cenu držených kusů (daň až při prodeji). Ve výchozím nastavení ji daníme jako dividendu (§ 8) a čerpá limit 50 000 Kč, protože je to bezpečnější výklad; přepnout to jde v Nastavení u „Vratka kapitálu“ (R-07h).`,
        });
        return;
      }
      case 'INTEREST': {
        if (change.eq(0)) {
          result.skipped.push({ line, message: `„${description}“: nulový úrok — nic k zaúčtování.` });
          return;
        }
        if (change.gt(0)) {
          push(line, row.join(';'), {
            type: 'INTEREST',
            id,
            amount: changeRaw,
            currency,
            date: isoDate,
            note: description,
          });
        } else {
          // záporný úrok = náklad (debetní úrok) → FEE s poznámkou
          push(line, row.join(';'), {
            type: 'FEE',
            id,
            amount: change.abs().toString(),
            currency,
            date: isoDate,
            note: `Záporný úrok (${description})`,
          });
        }
        return;
      }
      case 'FEE': {
        if (change.gt(0)) {
          result.warnings.push({
            line,
            message: `Vratka poplatku ${changeRaw} ${currency} („${description}“) — evidujeme jen informativně, do výpočtu nevstupuje.`,
          });
          return;
        }
        push(line, row.join(';'), {
          type: 'FEE',
          id,
          amount: change.abs().toString(),
          currency,
          date: isoDate,
          note: description,
        });
        return;
      }
      case 'COURTESY': {
        // Částka, kterou Degiro připíše z vlastní vůle. Jaký je to příjem,
        // z výpisu nepoznáme (docs/02 na to pravidlo nemá) — nezařazujeme ji,
        // ale řekneme to, stejně jako u „Promotional Award“ ve výpisu Schwabu.
        result.warnings.push({
          line,
          message: `Kompenzace od Degira ${changeRaw} ${currency} („${description}“) — tenhle pohyb neumíme automaticky zařadit, do výpočtu nevstupuje. Pokud je daňově relevantní, doplň ho přes univerzální šablonu.`,
        });
        return;
      }
      case 'DEPOSIT':
      case 'WITHDRAWAL': {
        push(line, row.join(';'), {
          type: classified.kind,
          id,
          amount: change.abs().toString(),
          currency,
          date: isoDate,
          note: description,
        });
        return;
      }
    }
  });

  // Dividendy a srážky se skládají po titulu a dni.
  const eventKey = (item: { isin?: string; date: string }): string => `${item.isin ?? ''}|${item.date}`;
  const events = new Map<string, { dividends: PendingDividend[]; taxes: PendingTax[] }>();
  const eventOf = (item: { isin?: string; date: string }) => {
    const key = eventKey(item);
    const event = events.get(key) ?? { dividends: [], taxes: [] };
    events.set(key, event);
    return event;
  };
  for (const dividend of dividends) eventOf(dividend).dividends.push(dividend);
  for (const tax of taxes) eventOf(tax).taxes.push(tax);

  const pushDividend = (dividend: PendingDividend, gross: string, withholding: string): void =>
    push(dividend.line, '', {
      type: 'DIVIDEND',
      id: dividend.id,
      isin: dividend.isin,
      gross,
      currency: dividend.currency,
      withholdingTax: withholding,
      date: dividend.date,
    });

  for (const event of events.values()) {
    // Degiro opravuje protizápisem: záporná „Dividend“ ruší výplatu a KLADNÁ
    // „Dividendbelasting“ vrací srážku (doloženo výpisy z let 2019–2025
    // v Portfolio Performance). Dřív se záporná dividenda jen ohlásila
    // a vrácená srážka se brala v absolutní hodnotě — stornovaná výplata tak
    // zůstala v příjmech i se zápočtem daně, která se vrátila.
    const corrected =
      event.dividends.some((dividend) => d(dividend.gross).lt(0)) ||
      event.taxes.some((tax) => d(tax.amount).lt(0));

    const currencies = new Set([
      ...event.dividends.map((dividend) => dividend.currency),
      ...event.taxes.map((tax) => tax.currency),
    ]);
    if (corrected && currencies.size > 1) {
      // Opravy ve víc měnách (Degiro výplatu přeúčtoval do jiné měny) sečíst
      // nejde. Kladné výplaty se proto zaúčtují tak, jak jsou, bez sražené
      // daně — příjem zůstane a zápočet se neuplatní (bezpečný směr) —
      // a řekne se to; zahodit je by dividendu ztratilo beze stopy.
      result.warnings.push({
        line: event.dividends[0]?.line ?? event.taxes[0]!.line,
        message: `Dividenda ${event.dividends[0]?.isin ?? event.taxes[0]?.isin ?? ''} z ${event.dividends[0]?.date ?? event.taxes[0]!.date} má ve výpisu opravné zápisy ve více měnách (${[...currencies].join(', ')}) — sečíst je neumíme. Kladné výplaty jsme zaúčtovali bez oprav a bez sražené daně; zkontroluj je podle výpisu. ${REENTER_VIA_TEMPLATE}`,
      });
      for (const dividend of event.dividends) {
        if (d(dividend.gross).gt(0)) pushDividend(dividend, dividend.gross, '0');
      }
      continue;
    }

    if (corrected) {
      const carrier =
        event.dividends.find((dividend) => d(dividend.gross).gt(0)) ?? event.dividends[0];
      const withheld = event.taxes
        .filter((tax) => carrier === undefined || tax.currency === carrier.currency)
        .reduce((sum, tax) => sum.plus(tax.amount), d(0));
      if (carrier === undefined) {
        if (!withheld.eq(0)) {
          result.warnings.push({
            line: event.taxes[0]!.line,
            message: `Opravy daně z dividendy (${event.taxes[0]!.isin ?? 'bez ISIN'}, ${event.taxes[0]!.date}) nemají ve výpisu dividendu, ke které patří — nezaúčtováno, zkontroluj, že export pokrývá celé období.`,
          });
        }
        continue;
      }
      const net = event.dividends
        .filter((dividend) => dividend.currency === carrier.currency)
        .reduce((sum, dividend) => sum.plus(dividend.gross), d(0));
      if (net.lte(0)) {
        result.warnings.push({
          line: carrier.line,
          message: net.eq(0)
            ? `Dividenda ${carrier.isin ?? ''} z ${carrier.date} je ve výpisu stornovaná (výplata i protizápis se vyruší) — nezaúčtována.`
            : `Záporná dividenda ${net.toString()} ${carrier.currency} (${carrier.isin ?? 'bez ISIN'}, ${carrier.date}) — vypadá jako korekce výplaty, která v tomhle výpisu není; nezaúčtováno, zkontroluj výpis.`,
        });
        continue;
      }
      result.warnings.push({
        line: carrier.line,
        message: `Dividenda ${carrier.isin ?? ''} z ${carrier.date} má ve výpisu opravné zápisy — účtujeme výsledek jednou transakcí: ${net.toString()} ${carrier.currency}, sražená daň ${(withheld.lt(0) ? d(0) : withheld).toString()} ${carrier.currency}.`,
      });
      pushDividend(carrier, net.toString(), (withheld.lt(0) ? d(0) : withheld).toString());
      continue;
    }

    // bez oprav: srážka k dividendě 1:1 v pořadí výpisu
    for (const tax of event.taxes) {
      const dividend = event.dividends.find((div) => div.withholding === undefined);
      if (!dividend) {
        result.warnings.push({
          line: tax.line,
          message: `Daň z dividendy ${tax.amount} ${tax.currency} (${tax.isin ?? 'bez ISIN'}, ${tax.date}) nemá ve výpisu párovou dividendu — nezaúčtována, zkontroluj, že export pokrývá celé období.`,
        });
        continue;
      }
      if (dividend.currency !== tax.currency) {
        result.warnings.push({
          line: tax.line,
          message: `Daň z dividendy je v jiné měně (${tax.currency}) než dividenda (${dividend.currency}) — zkontroluj ručně.`,
        });
      }
      dividend.withholding = tax.amount;
    }
    for (const dividend of event.dividends) {
      pushDividend(dividend, dividend.gross, dividend.withholding ?? '0');
    }
  }

  // párování korporátních akcí: odpis starého ISIN + připis nového, stejné datum
  for (const [key, legs] of corporateLegs) {
    const subtype = key.slice(0, key.indexOf('|')) as Exclude<CorporateSubtype, 'SPINOFF'>;
    const label = CORPORATE_LABELS[subtype];

    for (const leg of legs.filter((l) => l.direction === null)) {
      result.errors.push({
        line: leg.line,
        message: `${label} „${leg.description}“: z popisu nepoznáme, jestli jde o odpis, nebo připis kusů — akci doplň ručně přes univerzální šablonu.`,
        raw: leg.description,
      });
    }

    const outs = legs.filter((leg) => leg.direction === 'out');
    const ins = legs.filter((leg) => leg.direction === 'in');

    // 2+ odpisů nebo 2+ připisů v týž den: párování podle pořadí by mohlo
    // spojit špatné dvojice → radši error než tichá chyba v držení
    if (outs.length > 1 || ins.length > 1) {
      result.errors.push({
        line: legs[0]!.line,
        message: `${label} ${legs[0]!.date}: ve výpisu je ${outs.length}× odpis a ${ins.length}× připis v týž den — dvojice nejde spolehlivě přiřadit automaticky, akce doplň ručně přes univerzální šablonu.`,
        raw: legs.map((leg) => leg.description).join(' | '),
      });
      continue;
    }

    const pairCount = Math.min(outs.length, ins.length);

    for (let i = 0; i < pairCount; i += 1) {
      const oldLeg = outs[i]!;
      const newLeg = ins[i]!;
      let ratio: { from: string; to: string } | undefined;
      if (subtype === 'MERGER' || subtype === 'SPLIT') {
        if (oldLeg.quantity !== null && newLeg.quantity !== null) {
          // za `from` starých kusů `to` nových — počty z popisů obou řádků
          ratio = { from: oldLeg.quantity, to: newLeg.quantity };
        } else if (subtype === 'SPLIT') {
          // bez poměru je split nepoužitelný (engine ho odmítne) a tichý
          // přeskok by rozbil počty kusů u každého dalšího prodeje
          result.errors.push({
            line: oldLeg.line,
            message: `Štěpení akcií ${oldLeg.isin} (${oldLeg.date}): z popisů „${oldLeg.description}“ / „${newLeg.description}“ nejde zjistit poměr staré:nové kusy — doplň akci ručně přes univerzální šablonu (subtype SPLIT, ratio_from a ratio_to).`,
            raw: `${oldLeg.description} | ${newLeg.description}`,
          });
          continue;
        } else {
          result.warnings.push({
            line: oldLeg.line,
            message: `Fúze ${oldLeg.isin} → ${newLeg.isin}: z popisů se nepodařilo zjistit poměr výměny kusů — akce je bez poměru, zkontroluj a případně doplň ručně.`,
          });
        }
      }
      // Split, který zároveň mění ISIN, engine neumí jednou transakcí (SPLIT
      // nový ISIN ignoruje) — radši chyba než tiše zamlčená změna ISIN
      if (subtype === 'SPLIT' && oldLeg.isin !== newLeg.isin) {
        result.errors.push({
          line: oldLeg.line,
          message: `Štěpení akcií ${oldLeg.isin} → ${newLeg.isin} (${oldLeg.date}) zároveň mění ISIN — doplň akci ručně přes univerzální šablonu (SPLIT s poměrem a samostatně ISIN_CHANGE).`,
          raw: `${oldLeg.description} | ${newLeg.description}`,
        });
        continue;
      }
      push(oldLeg.line, oldLeg.description, {
        type: 'CORPORATE_ACTION',
        id: nextId(`degiro-${fnv1a64([subtype, oldLeg.date, oldLeg.isin, newLeg.isin].join('|'))}`),
        subtype,
        isin: oldLeg.isin,
        ...(subtype === 'SPLIT' ? {} : { newIsin: newLeg.isin }),
        date: oldLeg.date,
        ...(ratio ? { ratio } : {}),
        note: `${oldLeg.description} / ${newLeg.description}`,
      });
    }

    for (const leftover of [...outs.slice(pairCount), ...ins.slice(pairCount)]) {
      result.errors.push({
        line: leftover.line,
        message: `${label} ${leftover.isin} (${leftover.date}) nemá kompletní pár odpis+připis — akci doplň ručně přes univerzální šablonu.`,
        raw: leftover.description,
      });
    }
  }

  return result;
}
