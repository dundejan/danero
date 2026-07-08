import { d, TransactionSchema } from '@danero/shared';
import { isValidIsoDate } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const DEGIRO_BROKER = 'degiro';

/**
 * Parser Degiro exportů (docs/03): dva soubory — Transactions.csv (obchody)
 * a Account.csv (peněžní pohyby vč. korporátních akcí jako textových párových
 * řádků). Formát je lokalizovaný: hlavičky i popisy CZ/EN/NL, oddělovač
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
 * Degiro čísla podle lokalizace: „1.234,56", „1,234.56" i „1234,56".
 * Konzervativně: poslední oddělovač = desetinný; víc výskytů téhož = tisíce.
 * Vrací normalizovaný string s desetinnou tečkou, nebo null (prázdné/nečíslo).
 */
function parseDegiroNumber(value: string): string | null {
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
    v = parts.length > 2 ? parts.join('') : parts.join('.');
  } else if (hasDot && v.split('.').length > 2) {
    v = v.replaceAll('.', '');
  }
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

/** Degiro datum dd-MM-yyyy → ISO YYYY-MM-DD; neexistující kalendářní den → null. */
function toIsoDate(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidIsoDate(iso) ? iso : null;
}

/* ── Hlavičky (CZ/EN/NL synonyma) ────────────────────────────────────────── */

const DATE_HEADERS = ['datum', 'date'];
const TIME_HEADERS = ['čas', 'time', 'tijd'];
const PRODUCT_HEADERS = ['produkt', 'product'];
const QUANTITY_HEADERS = ['počet', 'quantity', 'aantal'];
const PRICE_HEADERS = ['kurz', 'price', 'koers'];
const TOTAL_HEADERS = ['celkem', 'total', 'totaal'];
const ORDER_ID_HEADERS = ['id objednávky', 'order id', 'ordernummer'];
const DESCRIPTION_HEADERS = ['popis', 'description', 'omschrijving'];
const CHANGE_HEADERS = ['změna', 'change', 'mutatie'];

/** Poplatkový sloupec má dlouhý lokalizovaný název → fuzzy shoda. */
const isFeeHeader = (lower: string): boolean =>
  (lower.includes('transak') || lower.includes('transact')) &&
  (lower.includes('poplatek') ||
    lower.includes('fee') ||
    lower.includes('costs') ||
    lower.includes('kosten'));

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

type AmountCurrencyPair =
  | { kind: 'ok'; amount: string; currency: string }
  | { kind: 'empty' }
  | { kind: 'invalid' };

/**
 * Částka + měna z dvojice buněk: pojmenovaný sloupec (Změna/Change/Mutatie)
 * a bezejmenný hned za ním. Reálné Account.csv exporty mají v pojmenovaném
 * sloupci MĚNU a v bezejmenném ČÁSTKU, jiné varianty pořadí opačné — rozhoduje
 * obsah (třípísmenný kód = měna, parsovatelné číslo = částka), obě pořadí OK.
 */
function readAmountCurrencyPair(row: string[], namedIndex: number): AmountCurrencyPair {
  const first = cell(row, namedIndex);
  const second = cell(row, namedIndex + 1);
  if (first === '' && second === '') return { kind: 'empty' };
  for (const [currency, amountRaw] of [
    [first, second],
    [second, first],
  ] as const) {
    if (!isCurrency(currency)) continue;
    const amount = parseDegiroNumber(amountRaw);
    if (amount !== null) return { kind: 'ok', amount, currency };
  }
  return { kind: 'invalid' };
}

/**
 * Stabilní id: `degiro-<OrderID>`; bez ID (Account.csv, prázdné Order ID)
 * obsahový hash fnv1a64 — NIKDY pořadí řádku v souboru. Opakování stejného
 * základu (partial fills sdílející Order ID, identické legitimní záznamy)
 * rozliší pořadový suffix -2, -3… (vzor contentId v src/ibkr/xml.ts) —
 * v rámci stejné množiny záznamů zůstává stabilní mezi překrývajícími se exporty.
 */
function idFactory(): (base: string) => string {
  const seen = new Map<string, number>();
  return (base: string): string => {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
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

/**
 * Parser Degiro Transactions.csv: každý řádek je (dílčí) exekuce obchodu.
 * Počet > 0 = BUY, < 0 = SELL; měna kurzu je v bezejmenném sloupci hned za ním.
 */
export function parseDegiroTransactionsCsv(text: string): ImportResult {
  const result = emptyResult(DEGIRO_BROKER);
  if (text.trim() === '') {
    result.errors.push({
      line: 1,
      message: 'Soubor je prázdný — nahraj Transactions.csv z Degiro (Aktivita → Transakce).',
    });
    return result;
  }

  const { headers, rows } = parseDelimited(text, detectDelimiter(text));
  const col = {
    date: findColumn(headers, DATE_HEADERS),
    time: findColumn(headers, TIME_HEADERS),
    product: findColumn(headers, PRODUCT_HEADERS),
    isin: findColumn(headers, ['isin']),
    quantity: findColumn(headers, QUANTITY_HEADERS),
    price: findColumn(headers, PRICE_HEADERS),
    fee: findColumn(headers, [], isFeeHeader),
    total: findColumn(headers, TOTAL_HEADERS),
    orderId: findColumn(headers, ORDER_ID_HEADERS),
  };
  if (col.date < 0 || col.isin < 0 || col.quantity < 0 || col.price < 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Degiro Transactions.csv — chybí sloupce datum/ISIN/počet/kurz. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = idFactory();

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((c) => c.trim() === '')) return;

    const isoDate = toIsoDate(cell(row, col.date));
    if (!isoDate) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cell(row, col.date)}" (očekáván formát dd-MM-yyyy).`,
        raw: row.join(';'),
      });
      return;
    }

    const isin = cell(row, col.isin);
    const quantityRaw = parseDegiroNumber(cell(row, col.quantity));
    const priceRaw = parseDegiroNumber(cell(row, col.price));
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
        message: `U kurzu chybí měna (bezejmenný sloupec za kurzem) — nalezeno „${currency}".`,
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

    // poplatek: záporná částka, měna hned za ním; může být prázdný
    let fee: { amount: string; currency: string } | undefined;
    if (col.fee >= 0) {
      const feeRaw = parseDegiroNumber(cell(row, col.fee));
      if (feeRaw !== null && !d(feeRaw).eq(0)) {
        const feeCurrency = cell(row, col.fee + 1);
        if (isCurrency(feeCurrency)) {
          fee = { amount: d(feeRaw).abs().toString(), currency: feeCurrency };
        } else {
          result.warnings.push({
            line,
            message: `Transakční poplatek ${feeRaw} nemá měnu — nebyl započten, doplň ho ručně.`,
          });
        }
      }
    }

    const orderId = cell(row, col.orderId);
    const contentHash = fnv1a64(
      [isoDate, cell(row, col.time), isin, quantityRaw, priceRaw, cell(row, col.total)].join('|'),
    );
    const id = nextId(orderId !== '' ? `degiro-${orderId}` : `degiro-${contentHash}`);

    try {
      result.transactions.push(
        TransactionSchema.parse({
          type: quantity.gt(0) ? 'BUY' : 'SELL',
          id,
          isin,
          name: cell(row, col.product) || undefined,
          quantity: quantity.abs().toString(),
          pricePerShare: priceRaw,
          currency,
          fee,
          tradeDate: isoDate, // datum vypořádání export neobsahuje — dopočte engine
        }),
      );
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: row.join(';'),
      });
    }
  });

  return result;
}

/* ── Account.csv (peněžní pohyby + korporátní akce) ──────────────────────── */

type AccountKind =
  | { kind: 'DIVIDEND' }
  | { kind: 'DIVIDEND_TAX' }
  | { kind: 'INTEREST' }
  | { kind: 'FEE' }
  | { kind: 'DEPOSIT' }
  | { kind: 'WITHDRAWAL' }
  | { kind: 'CORPORATE'; subtype: 'ISIN_CHANGE' | 'MERGER' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

const containsAny = (haystack: string, needles: string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/** Klasifikace řádku Account.csv podle POPISU — slovníky CZ/EN/NL, case-insensitive contains. */
function classifyDescription(description: string): AccountKind {
  const lower = description.toLowerCase();
  // korporátní akce dřív než cokoli jiného — NIKDY je neinterpretovat jako obchod
  if (containsAny(lower, ['změna isin', 'isin change', 'wijziging isin']))
    return { kind: 'CORPORATE', subtype: 'ISIN_CHANGE' };
  if (containsAny(lower, ['fúze', 'fusie', 'merger']))
    return { kind: 'CORPORATE', subtype: 'MERGER' };
  // echo obchodů („Nákup 5 …") dřív než dividendy — název produktu může obsahovat „Dividend"
  if (/(?:^|\s)(nákup|prodej|koop|verkoop|buy|sell)\b/i.test(description))
    return {
      kind: 'SKIP',
      reason: 'obchod — nákupy a prodeje bereme z Transactions.csv (jinak by se importovaly dvakrát)',
    };
  if (containsAny(lower, ['daň z dividendy', 'dividend tax', 'dividendbelasting']))
    return { kind: 'DIVIDEND_TAX' };
  if (containsAny(lower, ['dividenda', 'dividend'])) return { kind: 'DIVIDEND' };
  // sweep/peněžní trh dřív než úrok („Flatex Interest" obsahuje „interest")
  if (containsAny(lower, ['cash sweep', 'flatex interest', 'geldmarktfonds', 'money market']))
    return { kind: 'SKIP', reason: 'převod peněžního trhu / cash sweep — pro daň z CP nepodstatné' };
  if (
    containsAny(lower, [
      'konverze měny',
      'fx credit',
      'fx debit',
      'valuta creditering',
      'valuta debitering',
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
    ])
  )
    return { kind: 'FEE' };
  // výběr dřív než vklad („Terugstorting" obsahuje „storting")
  if (containsAny(lower, ['výběr', 'withdrawal', 'terugstorting'])) return { kind: 'WITHDRAWAL' };
  if (containsAny(lower, ['vklad', 'deposit', 'storting', 'ideal'])) return { kind: 'DEPOSIT' };
  if (containsAny(lower, ['úrok', 'interest', 'rente'])) return { kind: 'INTEREST' };
  return { kind: 'UNKNOWN' };
}

/** Směr párového řádku korporátní akce: odpis (staré kusy) vs. připis (nové). */
function legDirection(lowerDescription: string): 'out' | 'in' | null {
  if (containsAny(lowerDescription, ['uitboeking', 'odpis', 'removal'])) return 'out';
  if (containsAny(lowerDescription, ['inboeking', 'připis', 'pripis', 'addition'])) return 'in';
  return null;
}

/** Počet kusů z popisu („Uitboeking 10 …") — jen číslo HNED za klíčovým slovem (ne cifry z ISIN). */
function legQuantity(description: string): string | null {
  const match =
    /(?:uitboeking|inboeking|odpis|připis|pripis|removal|addition)[\s:]*(\d+(?:[.,]\d+)?)/i.exec(
      description,
    );
  return match ? parseDegiroNumber(match[1]!) : null;
}

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
      message: 'Soubor je prázdný — nahraj Account.csv z Degiro (Aktivita → Výpisy z účtu).',
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
  if (col.date < 0 || col.description < 0 || col.change < 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Degiro Account.csv — chybí sloupce datum/popis/změna. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  const nextId = idFactory();

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
    if (row.every((c) => c.trim() === '')) return;

    const isoDate = toIsoDate(cell(row, col.date));
    if (!isoDate) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cell(row, col.date)}" (očekáván formát dd-MM-yyyy).`,
        raw: row.join(';'),
      });
      return;
    }

    const description = cell(row, col.description);
    const classified = classifyDescription(description);

    // korporátní akce nemají peněžní pohyb (Změna bývá prázdná) — sbíráme páry
    if (classified.kind === 'CORPORATE') {
      const isin = cell(row, col.isin);
      if (!isin) {
        result.errors.push({
          line,
          message: `Korporátní akce „${description}" nemá ISIN — doplň akci ručně přes univerzální šablonu.`,
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
        quantity: legQuantity(description),
        date: isoDate,
        description,
      });
      corporateLegs.set(key, legs);
      return;
    }

    if (classified.kind === 'SKIP') {
      result.skipped.push({ line, message: `„${description}": ${classified.reason}` });
      return;
    }

    // částka + měna = pojmenovaný sloupec Změna + bezejmenný za ním (obě pořadí)
    const pair = readAmountCurrencyPair(row, col.change);
    // prázdná dvojice = informativní řádek bez peněžního pohybu → bez záznamu
    if (pair.kind === 'empty') return;

    if (classified.kind === 'UNKNOWN') {
      result.errors.push({
        line,
        message: `Neznámý popis pohybu „${description}" — nahlaš nám ho, doplníme podporu.`,
        raw: row.join(';'),
      });
      return;
    }
    if (pair.kind === 'invalid') {
      result.errors.push({
        line,
        message: `Částku pohybu se nepodařilo přečíst — ve sloupci Změna a vedle něj je „${cell(row, col.change)}" / „${cell(row, col.change + 1)}", očekáváme číslo a třípísmenný kód měny.`,
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
        if (change.lte(0)) {
          result.warnings.push({
            line,
            message: `Záporná dividenda ${changeRaw} ${currency} („${description}") — vypadá jako korekce, nezaúčtováno; zkontroluj výpis.`,
          });
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
          amount: change.abs().toString(),
          currency,
        });
        return;
      }
      case 'INTEREST': {
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
            message: `Vratka poplatku ${changeRaw} ${currency} („${description}") — evidujeme jen informativně, do výpočtu nevstupuje.`,
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

  // párování srážkové daně k dividendě: stejný ISIN a datum, 1:1
  for (const tax of taxes) {
    const dividend = dividends.find(
      (div) =>
        div.withholding === undefined && (div.isin ?? '') === (tax.isin ?? '') && div.date === tax.date,
    );
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
  for (const dividend of dividends) {
    push(dividend.line, '', {
      type: 'DIVIDEND',
      id: dividend.id,
      isin: dividend.isin,
      gross: dividend.gross,
      currency: dividend.currency,
      withholdingTax: dividend.withholding ?? '0',
      date: dividend.date,
    });
  }

  // párování korporátních akcí: odpis starého ISIN + připis nového, stejné datum
  for (const [key, legs] of corporateLegs) {
    const subtype = key.startsWith('ISIN_CHANGE') ? 'ISIN_CHANGE' : 'MERGER';
    const label = subtype === 'ISIN_CHANGE' ? 'Změna ISIN' : 'Fúze';

    for (const leg of legs.filter((l) => l.direction === null)) {
      result.errors.push({
        line: leg.line,
        message: `${label} „${leg.description}": z popisu nepoznáme, jestli jde o odpis, nebo připis kusů — akci doplň ručně přes univerzální šablonu.`,
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
      if (subtype === 'MERGER') {
        if (oldLeg.quantity !== null && newLeg.quantity !== null) {
          // za `from` starých kusů `to` nových — počty z popisů obou řádků
          ratio = { from: oldLeg.quantity, to: newLeg.quantity };
        } else {
          result.warnings.push({
            line: oldLeg.line,
            message: `Fúze ${oldLeg.isin} → ${newLeg.isin}: z popisů se nepodařilo zjistit poměr výměny kusů — akce je bez poměru, zkontroluj a případně doplň ručně.`,
          });
        }
      }
      push(oldLeg.line, oldLeg.description, {
        type: 'CORPORATE_ACTION',
        id: nextId(`degiro-${fnv1a64([subtype, oldLeg.date, oldLeg.isin, newLeg.isin].join('|'))}`),
        subtype,
        isin: oldLeg.isin,
        newIsin: newLeg.isin,
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
