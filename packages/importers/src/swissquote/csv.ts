import { Decimal, d, TransactionSchema } from '@danero/shared';
import { cleanNumber, isValidIsoDate, normalizeHeader, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const SWISSQUOTE_BROKER = 'swissquote';

/**
 * Parser Swissquote CSV výpisu transakcí (středníkový oddělovač).
 *
 * Dva doložené tvary: EN 13 sloupců (Date;Order #;Transaction;…;Currency)
 * a DE 15 sloupců (Datum;Auftrag #;Transaktionen;…;Währung Nettobetrag;…;Währung).
 * Sloupce se mapují VÝHRADNĚ podle názvů (normalizeHeader + fuzzy tolerance
 * na rozbité přehlásky z Latin-1 dekódování) — NE pozičně: DE má 15 sloupců
 * a 13. sloupec existuje ve dvou variantách názvu.
 *
 * Měna transakce: EN sloupec „Currency“; DE „Währung Nettobetrag“ (prosté
 * „Währung“ je měna subúčtu — tu nepoužíváme).
 *
 * Parser bere už DEKÓDOVANÝ text — dekódování (Latin-1 fallback) řeší service.
 */

/* ── Hlavičky (EN/DE, mapování podle názvů) ──────────────────────────────── */

interface FieldSpec {
  /** Přesné názvy po normalizeHeader. */
  names: readonly string[];
  /** Tolerance na rozbité přehlásky („StÃ¼ckpreis“ → „sta¼ckpreis“). */
  fuzzy?: (normalizedHeader: string) => boolean;
}

const FIELDS = {
  date: { names: ['date', 'datum'] },
  order: { names: ['order #', 'auftrag #'] },
  transaction: { names: ['transaction', 'transaktionen'] },
  symbol: { names: ['symbol'] },
  name: { names: ['name'] },
  isin: { names: ['isin'] },
  quantity: { names: ['quantity', 'anzahl'] },
  unitPrice: { names: ['unit price', 'stuckpreis'], fuzzy: (h) => /^st.{0,2}ckpreis$/.test(h) },
  costs: { names: ['costs', 'kosten'] },
  netAmount: { names: ['net amount', 'nettobetrag'] },
  // pořadí názvů je důležité: DE „Währung Nettobetrag“ (měna transakce) má
  // přednost; EN „Currency“ je měna transakce, prosté DE „Währung“ (subúčet) neexistuje v EN
  currency: {
    names: ['wahrung nettobetrag', 'currency'],
    fuzzy: (h) => /^w.{0,2}hrung nettobetrag$/.test(h),
  },
} as const satisfies Record<string, FieldSpec>;

type Field = keyof typeof FIELDS;

/** Najde sloupec podle přesných názvů (po normalizeHeader), pak fuzzy predikátem. */
function findColumn(normalizedHeaders: string[], spec: FieldSpec): number {
  for (const name of spec.names) {
    const i = normalizedHeaders.indexOf(name);
    if (i >= 0) return i;
  }
  if (spec.fuzzy) {
    const i = normalizedHeaders.findIndex((h) => h !== '' && spec.fuzzy!(h));
    if (i >= 0) return i;
  }
  return -1;
}

/* ── Čísla a datumy ──────────────────────────────────────────────────────── */

/**
 * Swissquote čísla mají desetinnou tečku; defenzivně stripujeme apostrofy
 * (švýcarské tisícové oddělovače „1'234.56“) a tisícové čárky (cleanNumber).
 */
function parseSqNumber(value: string): Decimal | null {
  const cleaned = cleanNumber(value.replace(/['’]/g, ''));
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? d(cleaned) : null;
}

/** „10-08-2022 15:30:02“ (DD-MM-YYYY) → ISO; neexistující kalendářní den → null. */
function toIsoDate(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidIsoDate(iso) ? iso : null;
}

/* ── Klasifikace typu transakce (EN/DE slovník) ──────────────────────────── */

type SqKind =
  | { kind: 'BUY' }
  | { kind: 'SELL' }
  | { kind: 'DIVIDEND' }
  | { kind: 'FEE' }
  | { kind: 'INTEREST' }
  | { kind: 'INTEREST_DEBIT' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'WARN_SKIP' }
  | { kind: 'UNKNOWN' };

/** Peněžní pohyby bez daňového dopadu — vědomě mimo import, bez varování. */
const SKIP_TYPES = new Map<string, string>([
  ['payment', 'vklad hotovosti'],
  ['zahlung', 'vklad hotovosti'],
  ['paying out', 'výběr hotovosti'],
  ['auszahlung', 'výběr hotovosti'],
  ['debit', 'interní peněžní pohyb'],
  ['credit', 'interní peněžní pohyb'],
  ['forex credit', 'FX konverze'],
  ['forex-gutschrift', 'FX konverze'],
  ['forex debit', 'FX konverze'],
  ['forex-belastung', 'FX konverze'],
  ['fx credit comp.', 'FX konverze'],
  ['fx-gutschrift comp.', 'FX konverze'],
  ['fx debit comp.', 'FX konverze'],
  ['fx-belastung comp.', 'FX konverze'],
  ['tax statement', 'poplatek za daňový výpis se nebere jako výdaj automaticky'],
]);

/** Typy, které zatím neumíme zaúčtovat automaticky → warning + skip. */
const WARN_SKIP_TYPES = new Set(['spin off', 'capital gain', 'interne titelumbuchung', 'berichtigung']);

function classify(normalized: string): SqKind {
  if (normalized === 'buy' || normalized === 'kauf') return { kind: 'BUY' };
  if (normalized === 'sell' || normalized === 'verkauf') return { kind: 'SELL' };
  if (normalized === 'dividend' || normalized === 'dividende') return { kind: 'DIVIDEND' };
  if (
    normalized === 'custody fees' ||
    normalized === 'spesen' ||
    /^depotgeb.{0,2}hren$/.test(normalized) ||
    /^berichtigung b.{0,2}rsengeb\.?$/.test(normalized)
  ) {
    return { kind: 'FEE' };
  }
  // debetní úrok dřív než obecné „zinsen“
  if (normalized === 'zinsen auf belastungen') return { kind: 'INTEREST_DEBIT' };
  if (normalized === 'interests' || normalized === 'zins' || normalized === 'zinsen') {
    return { kind: 'INTEREST' };
  }
  const skipReason = SKIP_TYPES.get(normalized);
  if (skipReason !== undefined) return { kind: 'SKIP', reason: skipReason };
  if (/^verg.{0,2}tung$/.test(normalized)) return { kind: 'SKIP', reason: 'vklad hotovosti' };
  if (WARN_SKIP_TYPES.has(normalized) || /^r.{0,2}ckzahlung$/.test(normalized)) {
    return { kind: 'WARN_SKIP' };
  }
  return { kind: 'UNKNOWN' };
}

/* ── Autodetekce ─────────────────────────────────────────────────────────── */

/**
 * Detekce Swissquote CSV: první řádek se středníky obsahuje sloupec
 * „Order #“/„Auftrag #“, „ISIN“ a „Unit price“/„Stückpreis“. Kombinace je
 * dost specifická — Degiro má „ID objednávky“/„Order ID“ (bez „#“), takže
 * jeho středníkové exporty neprojdou.
 */
export function sniffSwissquoteCsv(text: string): boolean {
  if (text.trim() === '') return false;
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  if (!firstLine.includes(';')) return false;
  const headers = parseCsv(firstLine, ';').headers.map(normalizeHeader);
  return (
    findColumn(headers, FIELDS.order) >= 0 &&
    findColumn(headers, FIELDS.isin) >= 0 &&
    findColumn(headers, FIELDS.unitPrice) >= 0
  );
}

/* ── Parser ──────────────────────────────────────────────────────────────── */

export function parseSwissquoteCsv(text: string): ImportResult {
  const result = emptyResult(SWISSQUOTE_BROKER);
  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212)
  if (text.trim() === '') return result;

  const { headers, rows } = parseCsv(text, ';');
  const normalizedHeaders = headers.map(normalizeHeader);
  const col = Object.fromEntries(
    (Object.keys(FIELDS) as Field[]).map((field) => [field, findColumn(normalizedHeaders, FIELDS[field])]),
  ) as Record<Field, number>;

  const missing = (['date', 'transaction', 'netAmount', 'currency'] as const).filter((f) => col[f] < 0);
  if (missing.length > 0) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Swissquote export — chybí sloupce ${missing
        .map((f) => FIELDS[f].names.join('/'))
        .join(', ')}. Nalezené sloupce: ${headers.filter((h) => h !== '').join(', ')}`,
    });
    return result;
  }

  // stabilní obsahová ID z celého řádku (NE z Order # — částečné exekuce ho sdílejí);
  // identické řádky rozliší pořadový suffix -2, -3…
  const idOccurrences = new Map<string, number>();
  const contentId = (row: string[]): string => {
    const base = `sq-${fnv1a64(row.join(';'))}`;
    const seen = (idOccurrences.get(base) ?? 0) + 1;
    idOccurrences.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  };

  const push = (line: number, raw: string, candidate: Record<string, unknown>): void => {
    try {
      result.transactions.push(TransactionSchema.parse(candidate));
    } catch (error) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      });
    }
  };

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    if (row.every((cell) => cell.trim() === '')) return;
    const raw = row.join(';');
    const cellAt = (field: Field): string => {
      const index = col[field];
      return index >= 0 ? (row[index] ?? '').trim() : '';
    };

    const transactionRaw = cellAt('transaction');
    const classified = classify(normalizeHeader(transactionRaw));

    if (classified.kind === 'SKIP') {
      result.skipped.push({
        line,
        message: `„${transactionRaw}“: ${classified.reason} — pro daňový výpočet není potřeba.`,
      });
      return;
    }
    if (classified.kind === 'WARN_SKIP') {
      result.warnings.push({
        line,
        message: `Operaci „${transactionRaw}“ zatím neumíme zaúčtovat automaticky — řádek přeskočen, zkontroluj a případně doplň ručně (univerzální šablona).`,
        raw,
      });
      return;
    }
    if (classified.kind === 'UNKNOWN') {
      result.errors.push({
        line,
        message: `Neznámý typ transakce „${transactionRaw}“ — nahlaš nám ho, doplníme podporu.`,
        raw,
      });
      return;
    }

    const date = toIsoDate(cellAt('date'));
    if (!date) {
      result.errors.push({
        line,
        message: `Neplatné datum „${cellAt('date')}“ (očekáván formát DD-MM-YYYY HH:MM:SS).`,
        raw,
      });
      return;
    }

    const rawCurrency = cellAt('currency').toUpperCase();
    // GBX = pence sterling → GBP, ceny i částky /100
    const isGbx = rawCurrency === 'GBX';
    const currency = isGbx ? 'GBP' : rawCurrency;
    const toGbp = (v: Decimal): Decimal => (isGbx ? v.div(100) : v);

    const netAmount = parseSqNumber(cellAt('netAmount'));
    const unitPrice = parseSqNumber(cellAt('unitPrice'));
    const costs = parseSqNumber(cellAt('costs'));

    switch (classified.kind) {
      case 'BUY':
      case 'SELL': {
        const isin = cellAt('isin');
        const quantity = parseSqNumber(cellAt('quantity'));
        if (isin === '' || !quantity || quantity.lte(0) || !unitPrice || unitPrice.lt(0)) {
          result.errors.push({
            line,
            message: 'Obchodu chybí ISIN, počet kusů nebo cena — řádek nelze zpracovat.',
            raw,
          });
          return;
        }
        const fee =
          costs && costs.gt(0) ? { amount: toGbp(costs).toString(), currency } : undefined;
        push(line, raw, {
          type: classified.kind,
          id: contentId(row),
          isin,
          ticker: cellAt('symbol') || undefined,
          name: cellAt('name') || undefined,
          quantity: quantity.toString(),
          pricePerShare: toGbp(unitPrice).toString(),
          currency,
          fee,
          tradeDate: date,
        });
        return;
      }
      case 'DIVIDEND': {
        // Doloženo (MEDIUM): Quantity je u dividend 1.0 a Unit price nese
        // CELOU částku. Kdyby reálný export poslal cenu za kus (Quantity > 1),
        // vzalo by se Unit price samotné a dividenda by se tiše podhodnotila —
        // proto se brutto křížem ověřuje proti Net Amount pro obě čtení.
        if (!unitPrice || unitPrice.lte(0)) {
          result.errors.push({
            line,
            message: `Dividenda ${cellAt('symbol') || cellAt('isin')}: chybí kladná částka (Unit price).`,
            raw,
          });
          return;
        }
        const dividendQty = parseSqNumber(cellAt('quantity'));
        const grossCandidates =
          dividendQty && dividendQty.gt(1)
            ? [unitPrice.mul(dividendQty), unitPrice]
            : [unitPrice];
        const matches = (a: Decimal, b: Decimal): boolean => a.minus(b).abs().lte('0.01');
        // vyber brutto, které sedí na |Net| = brutto − Costs (srážka), nebo
        // |Net| = brutto (bez srážky); bez shody konzervativně brutto = |Net|
        let gross: Decimal | null = null;
        let withholding = d(0);
        for (const candidate of grossCandidates) {
          if (netAmount && costs && costs.gt(0) && matches(netAmount.abs(), candidate.minus(costs))) {
            gross = candidate;
            withholding = costs;
            break;
          }
          if (netAmount && matches(netAmount.abs(), candidate)) {
            gross = candidate;
            break;
          }
        }
        if (gross === null) {
          if (netAmount && netAmount.gt(0)) {
            gross = netAmount;
            result.warnings.push({
              line,
              message: `Dividenda ${cellAt('symbol') || cellAt('isin')}: částky na řádku nejdou dohromady (Unit price × kusy vs. Net Amount) — bereme připsanou částku bez srážky, zkontroluj výpis dividend.`,
            });
          } else {
            gross = unitPrice;
          }
        }
        // Costs > 0 bez role srážky: připsalo se celé brutto, náklad zůstal
        // nevysvětlený — uživatel má vědět, že se srážka nepočítá
        if (withholding.eq(0) && costs && costs.gt(0)) {
          result.warnings.push({
            line,
            message: `Dividenda ${cellAt('symbol') || cellAt('isin')}: náklady ${costs.toString()} ${currency} nesedí na rozdíl brutto−netto, srážkovou daň proto nepočítáme — zkontroluj výpis dividend.`,
          });
        }
        push(line, raw, {
          type: 'DIVIDEND',
          id: contentId(row),
          isin: cellAt('isin') || undefined,
          ticker: cellAt('symbol') || undefined,
          gross: toGbp(gross).toString(),
          currency,
          withholdingTax: toGbp(withholding).toString(),
          date,
        });
        return;
      }
      case 'FEE': {
        if (!netAmount) {
          result.errors.push({ line, message: `Poplatek „${transactionRaw}“: chybí částka.`, raw });
          return;
        }
        push(line, raw, {
          type: 'FEE',
          id: contentId(row),
          amount: toGbp(netAmount.abs()).toString(),
          currency,
          date,
          note: transactionRaw,
        });
        return;
      }
      case 'INTEREST': {
        if (!netAmount) {
          result.errors.push({ line, message: `Úrok „${transactionRaw}“: chybí částka.`, raw });
          return;
        }
        if (netAmount.lte(0)) {
          result.skipped.push({
            line,
            message: `Záporný úrok ${netAmount.toString()} ${currency} („${transactionRaw}“) — debetní úrok do § 8 nevstupuje, přeskočeno.`,
            raw,
          });
          return;
        }
        // Sloupec Costs nese u úroků švýcarskou srážkovou daň (Verrechnungssteuer,
        // 35 %) — stejně jako u dividend. Dokud se ignoroval, uložil se jen čistý
        // úrok: podhodnocený příjem podle § 8 a zahozený nárok na zápočet (R-07f).
        //
        // Brát ho za srážku ale smíme JEN když sedí na rozklad brutto = netto +
        // Costs, tj. když Unit price (brutto) tomu odpovídá — přesně tak to dělá
        // i dividendová větev výš. Bez toho ověření by obyčejný poplatek v Costs
        // nafoukl příjem § 8 a ještě vyrobil zápočet daně, kterou nikdo nesrazil.
        const chargedCosts = costs && costs.gt(0) ? costs : d(0);
        const reconciles =
          chargedCosts.gt(0) &&
          unitPrice !== null &&
          unitPrice.gt(0) &&
          netAmount.plus(chargedCosts).minus(unitPrice).abs().lte('0.01');
        const withholding = reconciles ? chargedCosts : d(0);
        if (chargedCosts.gt(0) && !reconciles) {
          result.warnings.push({
            line,
            message: `Úrok „${transactionRaw}“: sloupec Costs (${chargedCosts.toString()} ${currency}) nesedí na rozdíl brutto−netto, sraženou daň proto nepočítáme — když šlo o srážku, doplň ji přes univerzální šablonu.`,
          });
        }
        push(line, raw, {
          type: 'INTEREST',
          id: contentId(row),
          amount: toGbp(netAmount.plus(withholding)).toString(),
          currency,
          date,
          ...(withholding.gt(0) ? { withholdingTax: toGbp(withholding).toString() } : {}),
        });
        return;
      }
      case 'INTEREST_DEBIT': {
        result.skipped.push({
          line,
          message: `„${transactionRaw}“: debetní úrok (úrok z čerpání) — do § 8 nevstupuje, přeskočeno.`,
          raw,
        });
        return;
      }
    }
  });

  return result;
}
