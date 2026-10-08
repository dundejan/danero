import { TransactionSchema } from '@danero/shared';
import {
  detectDecimalSeparator,
  firstLine,
  HeaderMap,
  isAmbiguousThousandGroup,
  isValidIsoDate,
  parseCsv,
  parseEuroDate,
  sniffDelimiter,
} from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const UNIVERSAL_BROKER = 'universal';

/**
 * Hodnota buňky, které v šabloně nerozumíme (nejednoznačné číslo, text místo
 * čísla, značka místo kódu měny) — chytá se u řádku a hlásí uživateli českou
 * větou se jménem sloupce a hodnotou.
 */
class CellError extends Error {}

/** Co po očištění smí zbýt z čísla: číslice, desetinná tečka, případně exponent. */
const PLAIN_NUMBER = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Číslo z univerzální šablony. Šablona předepisuje desetinnou TEČKU, ale
 * v českém Excelu vzniká čárka — a „1,500“ může znamenat 1,5 i 1500. Takový
 * zápis ODMÍTÁME (dřív se tiše bral jako tisícový oddělovač, takže „0,001“ BTC
 * se naimportovalo jako 1 kus — tisícinásobek). Ostatní čárky bereme jako
 * desetinné: „1,25“ → 1.25. Dvě a víc čárek jednoznačně oddělují tisíce
 * („1,234,567“), stejně jako čárka následovaná tečkou („1,234.56“).
 *
 * Co je nejednoznačné, říká sdílená `isAmbiguousThousandGroup`: celá část
 * s vedoucí nulou („0,125“) tisíce být nemůže, takže projde jako desetinná
 * čárka (L2c-03) — odmítat ji znamenalo, že krypto na tři desetinná místa
 * z českého Excelu nahrát nešlo.
 *
 * Text, který číslem není („1 250 Kč“, „$185.50“), končí vlastní větou —
 * jinak by se uživateli vypsala anglická hláška knihovny (L2c-05).
 */
function universalNumber(value: string, column: string): string {
  const number = canonicalNumber(value, column);
  if (number !== '' && !PLAIN_NUMBER.test(number)) {
    throw new CellError(
      `Hodnotě „${value.trim()}“ ve sloupci ${column} nerozumíme jako číslu — napiš jen číslo, bez značky měny a dalšího textu (např. 1250.50). Měna má vlastní sloupec.`,
    );
  }
  return number;
}

/**
 * Úvodní plus je táž hodnota bez něj — banky a brokeři tak tisknou připsané
 * částky („+5000.00“) a uživatel je opíše i se znaménkem (A10-R1-02). Odkládá
 * se DŘÍV, než se zápis posuzuje: sdílené `isAmbiguousThousandGroup`
 * i `detectDecimalSeparator` plus neznají, takže „+1,500“ by jinak tiše prošlo
 * jako 1,5. Bere se jen plus těsně před číslem — „+-5“ ani samotné „+“ číslem
 * nejsou.
 */
const withoutPlusSign = (value: string): string => value.replace(/^\+(?=[\d.,])/, '');

function canonicalNumber(value: string, column: string): string {
  const trimmed = withoutPlusSign(value.replace(/[\s\u00a0\u202f]/g, ''));
  if (!trimmed.includes(',')) return trimmed;
  if (trimmed.includes('.')) {
    // tečka i čárka = jednoznačné: poslední oddělovač je desetinný, ten druhý dělí tisíce
    return trimmed.lastIndexOf('.') > trimmed.lastIndexOf(',')
      ? trimmed.replace(/,/g, '')
      : trimmed.replace(/\./g, '').replace(',', '.');
  }
  // dvě a víc čárek nemůže být desetinná čárka → oddělovač tisíců
  if (trimmed.split(',').length > 2) return trimmed.replace(/,/g, '');
  if (isAmbiguousThousandGroup(trimmed)) {
    throw new CellError(
      `Hodnota „${value.trim()}“ ve sloupci ${column} je nejednoznačná — čárka může být desetinná čárka (${trimmed.replace(',', '.')}) i oddělovač tisíců (${trimmed.replace(',', '')}). Piš čísla s desetinnou TEČKOU, bez oddělovačů tisíců.`,
    );
  }
  return trimmed.replace(',', '.');
}

/**
 * Kód měny ze šablony. Malá písmena jsou táž měna (stejně se převádí `type`
 * a `asset_class`); značka („Kč“, „$“) kódem není a dostane vlastní větu —
 * validace modelu by na ni odpověděla výpisem z knihovny (L2c-05).
 */
function universalCurrency(value: string, column: string): string {
  const code = value.trim().toUpperCase();
  if (code === '' || /^[A-Z]{3}$/.test(code)) return code;
  throw new CellError(
    `Měně „${value.trim()}“ ve sloupci ${column} nerozumíme — napiš třípísmenný kód měny (např. CZK, USD, EUR).`,
  );
}

/**
 * Datum ze šablony → ISO. Vedle předepsaného RRRR-MM-DD bereme český zápis
 * s tečkami („10.06.2024“, „1.2.2026“, „1. 2. 2026“): český Excel tak datum
 * uloží, i když ho uživatel napíše v ISO tvaru (L2c-01). Lomítka NEbereme —
 * „1/2/2026“ je v českém prostředí 1. února a v americkém 2. ledna a z jedné
 * buňky to nerozhodneš; špatné datum nabytí by tiše posunulo časový test.
 * Neexistující den (30.02.) vrací null stejně jako dřív.
 */
function universalDate(value: string): string | null {
  if (isValidIsoDate(value)) return value;
  return /^\d{1,2}\.\s?\d{1,2}\.\s?\d{4}$/.test(value) ? parseEuroDate(value) : null;
}

const DATE_COLUMNS = ['date', 'settlement_date', 'acquisition_date'] as const;

/** Sloupce s čísly — z nich se pozná, jestli soubor píše desetinnou čárku. */
const NUMERIC_COLUMNS = [
  'quantity',
  'price',
  'fee',
  'amount',
  'withholding_tax',
  'ratio_from',
  'ratio_to',
  'acquisition_price',
] as const;

/** Pole kanonického modelu → sloupec šablony (kde se jméno liší). */
const COLUMN_BY_FIELD: Record<string, string> = {
  pricePerShare: 'price',
  tradeDate: 'date',
  settlementDate: 'settlement_date',
  assetClass: 'asset_class',
  settlementStyle: 'settlement_style',
  positionEffect: 'position_effect',
  gross: 'amount',
  withholdingTax: 'withholding_tax',
  sourceCountry: 'source_country',
  returnOfCapital: 'return_of_capital',
  newIsin: 'new_isin',
  'fee.amount': 'fee',
  'fee.currency': 'fee_currency',
  'ratio.from': 'ratio_from',
  'ratio.to': 'ratio_to',
  'acquisition.date': 'acquisition_date',
  'acquisition.costPerShare': 'acquisition_price',
  'acquisition.currency': 'acquisition_currency',
};

/** Tvar chyby validace modelu (Zod) — importéry na knihovně přímo nezávisí. */
interface ValidationIssue {
  code?: string;
  path: PropertyKey[];
  message: string;
  values?: unknown[];
}

const validationIssues = (err: unknown): ValidationIssue[] | null => {
  const issues = (err as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as ValidationIssue[]) : null;
};

/**
 * Chyba validace modelu řečená sloupci šablony (L2c-05). Knihovna vrací seznam
 * objektů a `err.message` je jejich JSON — uživateli z něj patří jen to, který
 * sloupec opravit a proč. Vlastní české zprávy modelu („Hodnota musí být
 * kladná“) nesou kódy `custom` a `invalid_format`; ostatní kódy mají anglický
 * text knihovny, takže je nahrazuje obecná věta.
 */
function describeIssues(issues: ValidationIssue[], cell: (column: string) => string): string {
  const missing = new Set<string>();
  const invalid = new Set<string>();
  for (const issue of issues) {
    const field = issue.path.map(String).join('.');
    const column = COLUMN_BY_FIELD[field] ?? field;
    const value = cell(column);
    if (value === '') missing.add(column);
    else if (issue.code === 'custom' || issue.code === 'invalid_format') {
      invalid.add(`sloupec ${column} („${value}“): ${issue.message}`);
    } else {
      const allowed = Array.isArray(issue.values) ? ` (povolené: ${issue.values.join(', ')})` : '';
      invalid.add(`hodnota „${value}“ ve sloupci ${column} není platná${allowed}`);
    }
  }
  const parts = [...invalid];
  if (missing.size > 0) {
    parts.unshift(
      `${missing.size === 1 ? 'chybí hodnota ve sloupci' : 'chybí hodnoty ve sloupcích'} ${[...missing].join(', ')}`,
    );
  }
  return parts.join('; ');
}

/** Hodnoty, které v šabloně znamenají „ano“ — česky i anglicky, jak kdo napíše. */
const TRUTHY = new Set(['ano', 'yes', 'true', '1', 'y', 'a']);
const FALSY = new Set(['', 'ne', 'no', 'false', '0', 'n']);

/**
 * Zaškrtávací sloupec šablony. Neznámou hodnotu NEbereme jako „ne“: tiché
 * ignorování překlepu je přesně ten druh ztráty, kvůli kterému se ve výdajích
 * hlídají nejednoznačná čísla.
 */
function universalFlag(value: string, column: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  throw new CellError(
    `Hodnotě „${value.trim()}“ ve sloupci ${column} nerozumíme — napiš „ano“, nebo pole nech prázdné.`,
  );
}

/**
 * Univerzální CSV šablona v2 — fallback pro brokery bez vlastního parseru
 * (pattern Koinly/Taxomat, docs/03). Formát je popsán v docs/06-import.md.
 *
 * Sloupce: type, date, settlement_date?, isin, ticker?, name?, asset_class?,
 * settlement_style?, position_effect?, quantity, price, currency, fee?,
 * fee_currency?, amount, withholding_tax?, source_country?,
 * return_of_capital?, subtype?, ratio_from?, ratio_to?, new_isin?,
 * acquisition_date?, acquisition_price?, acquisition_currency?, note?
 */
const REQUIRED_HEADERS = ['type', 'date'] as const;

const TYPES = new Set([
  'BUY',
  'SELL',
  'DIVIDEND',
  'INTEREST',
  'FEE',
  'DEPOSIT',
  'WITHDRAWAL',
  'CORPORATE_ACTION',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]);

const CA_SUBTYPES = new Set(['SPLIT', 'ISIN_CHANGE', 'MERGER', 'SPINOFF', 'DELISTING']);

/** Stažitelná předvyplněná šablona (hlavička + ukázkové řádky k přepsání). */
export const UNIVERSAL_TEMPLATE_CSV = [
  'type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,position_effect,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,return_of_capital,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note',
  'BUY,2024-06-10,2024-06-12,US0378331005,AAPL,Apple Inc,,,,10,185.50,USD,1.00,USD,,,,,,,,,,,,nákup přes brokera XY',
  'SELL,2026-03-05,2026-03-06,US0378331005,AAPL,Apple Inc,,,,5,210.00,USD,1.00,USD,,,,,,,,,,,,',
  'BUY,2025-03-01,,BTC,BTC,Bitcoin,CRYPTO,,,0.5,60000,EUR,,,,,,,,,,,,,,nákup kryptoaktiva — isin = symbol',
  'SELL,2026-04-01,,BTC,BTC,Bitcoin,CRYPTO,,,0.2,75000,EUR,,,,,,,,,,,,,,prodej (i krypto-krypto směna = prodej oceněný protiplněním)',
  'BUY,2026-01-15,,OPT:AAPL-2026-06-C200,,AAPL call 200 6/2026,DERIVATIVE,premium,,1,1250,USD,,,,,,,,,,,,,,nákup opce — cena za KONTRAKT (prémie × multiplikátor); isin = libovolný stálý identifikátor',
  'SELL,2026-04-10,,OPT:AAPL-2026-06-C200,,AAPL call 200 6/2026,DERIVATIVE,premium,,1,1800,USD,,,,,,,,,,,,,,prodej opce; expirace bezcenné opce = prodej za 0',
  'BUY,2026-02-02,,CFD:US500,,S&P 500 CFD,DERIVATIVE,margin,,2,5000,USD,,,,,,,,,,,,,,otevření CFD — margin: daní se rozdíl cen při uzavření (ne nominál)',
  'SELL,2026-03-16,,CFD:US500,,S&P 500 CFD,DERIVATIVE,margin,,2,5150,USD,,,,,,,,,,,,,,uzavření CFD',
  'DIVIDEND,2026-05-10,,US0378331005,AAPL,Apple Inc,,,,,,USD,,,25.00,3.75,US,,,,,,,,,brutto a sražená daň',
  'DIVIDEND,2026-07-15,,IE00B4L5Y983,IWDA,iShares Core MSCI World,,,,,,USD,,,40.00,0,,ano,,,,,,,,"vratka kapitálu (return of capital) — u fondů a REITů; snižuje nabývací cenu držených kusů, ne podíl na zisku (R-07h)"',
  'INTEREST,2026-06-01,,,,,,,,,,USD,,,1.23,,US,,,,,,,,,"úrok z hotovosti (withholding_tax vyplň jen tehdy, když ti z něj v zahraničí srazili daň)"',
  'FEE,2026-06-01,,,,,,,,,,EUR,,,2.50,,,,,,,,,,,poplatek za vedení účtu',
  'CORPORATE_ACTION,2024-08-31,,US0378331005,,,,,,,,,,,,,,,SPLIT,1,4,,,,,split 4:1 (za 1 starý kus 4 nové)',
  'CORPORATE_ACTION,2025-04-01,,GB0002222222,,,,,,,,,,,,,,,ISIN_CHANGE,,,GB0003333333,,,,změna ISIN',
  'SELL,2026-02-10,2026-02-11,US0378331005,AAPL,Apple Inc,,,open,100,300.00,USD,1.00,USD,,,,,,,,,,,,prodej NAKRÁTKO (short) — otevření krátké pozice; daní se jinak než běžný prodej',
  'BUY,2026-04-20,2026-04-21,US0378331005,AAPL,Apple Inc,,,close,100,250.00,USD,1.00,USD,,,,,,,,,,,,zpětný nákup k pokrytí shortu — uzavření krátké pozice',
  'TRANSFER_IN,2025-05-05,,US5949181045,MSFT,Microsoft,,,,10,,,,,,,,,,,,,2021-03-01,240.00,USD,převod od jiného brokera — datum a cena PŮVODNÍHO nabytí',
].join('\n');

/**
 * Povolené hodnoty sloupce `type` — aby je text u stahování šablony mohl
 * vyjmenovat a strážný test katalogu ohlídal, že žádná nechybí.
 */
export const UNIVERSAL_TEMPLATE_TYPES: readonly string[] = [...TYPES];

/**
 * Táž šablona ve tvaru, který se dvojklikem otevře v českém Excelu (L2c-02) —
 * tohle posílá `/api/sablona`. Změřeno ve skutečném Excelu s českým prostředím:
 * čárkové CSV bez BOM skončí celé ve sloupci A s rozbitou diakritikou a samotný
 * BOM spraví jen tu diakritiku. Proto tři změny proti konstantě výš:
 *
 *  - **BOM**, podle kterého Excel pozná UTF-8,
 *  - **středník** jako oddělovač sloupců (český Excel se řídí oddělovačem
 *    seznamu z místního nastavení; řádek `sep=` nepoužíváme, autodetekce by ho
 *    četla jako hlavičku),
 *  - **desetinná čárka** v číslech — tečka v českém prostředí desetinným
 *    oddělovačem není, kdežto „185,50“ Excel načte jako číslo.
 *
 * Data zůstávají v ISO tvaru: Excel je pozná jako datum a uloží česky
 * (10.06.2024), což parser čte taky. Tenhle tvar je taky změřený ve skutečném
 * Excelu (9. 10. 2026): 26 sloupců, 18 řádků, čísla i data jako hodnoty,
 * diakritika v poznámkách celá. Čárková `UNIVERSAL_TEMPLATE_CSV` zůstává
 * zdrojem pravdy — odvozuje se z ní slovník sloupců pro autodetekci.
 */
export const UNIVERSAL_TEMPLATE_EXCEL_CSV = ((): string => {
  const { headers, rows } = parseCsv(UNIVERSAL_TEMPLATE_CSV);
  const numeric = new Set(NUMERIC_COLUMNS.map((column) => headers.indexOf(column)));
  const quote = (cell: string): string =>
    /[;"\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  const lines = rows.map((row) =>
    row.map((cell, index) => quote(numeric.has(index) ? cell.replace('.', ',') : cell)).join(';'),
  );
  return `\uFEFF${[headers.join(';'), ...lines].join('\n')}`;
})();

export function parseUniversalCsv(text: string): ImportResult {
  const result = emptyResult(UNIVERSAL_BROKER);
  // středník: šablona vyplněná a uložená v českém Excelu (viz sniffDelimiter)
  const { headers, rows } = parseCsv(text, sniffDelimiter(firstLine(text)));
  const normalizedHeaders = headers.map((h) => h.toLowerCase());
  const map = new HeaderMap(normalizedHeaders);

  // prázdný soubor = prázdné období, ne chyba formátu (konzistentně s T212 parserem)
  if (text.trim() === '') return result;

  for (const required of REQUIRED_HEADERS) {
    if (!map.has(required)) {
      result.errors.push({
        line: 1,
        message: `Chybí povinný sloupec "${required}". Zkontroluj, že jde o export z podporovaného brokera, nebo použij univerzální šablonu.`,
      });
      return result;
    }
  }

  const uniqueId = uniqueIdFactory();
  // R-12f/R-12r: derivát bez settlement_style se počítá prémiovým stylem —
  // upozornit jednou per instrument, ne u každého řádku (CFD exporty mají stovky řádků)
  const warnedMissingStyle = new Set<string>();
  // L2c-03: tečka je v šabloně VŽDY desetinná a ten výklad se nemění. Když ale
  // zbytek souboru prokazatelně píše desetinnou čárku, je „1.500“ nejspíš
  // patnáct set zapsaných s oddělovačem tisíců — čteme dál 1,5, jen nahlas.
  const fileWritesDecimalComma =
    detectDecimalSeparator(
      rows.flatMap((row) => NUMERIC_COLUMNS.map((column) => withoutPlusSign(map.get(row, column)))),
    ) === ',';
  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    if (row.every((cell) => cell.trim() === '')) return;

    const type = map.get(row, 'type').toUpperCase();
    if (!TYPES.has(type)) {
      result.errors.push({ line, message: `Neznámý typ "${type}" (povolené: ${[...TYPES].join(', ')})` });
      return;
    }
    // Ručně psaná data: regex schématu pustí i neexistující den (2026-02-30)
    // a datumová aritmetika by ho tiše přetekla — řádek se odmítne s chybou
    const dates: Record<(typeof DATE_COLUMNS)[number], string> = {
      date: '',
      settlement_date: '',
      acquisition_date: '',
    };
    for (const column of DATE_COLUMNS) {
      const value = map.get(row, column);
      if (value === '' && column !== 'date') continue;
      const iso = universalDate(value);
      if (iso === null) {
        result.errors.push({
          line,
          message: `Neplatné datum "${value}" ve sloupci ${column} — očekáváme existující den ve tvaru RRRR-MM-DD (např. 2026-03-05) nebo D.M.RRRR (např. 5.3.2026).`,
          raw: row.join(','),
        });
        return;
      }
      dates[column] = iso;
    }
    const date = dates.date;

    // identické legitimní řádky (dva stejné obchody v týž den) nesmí tiše
    // splynout — pořadový suffix drží klíče stabilní i napříč exporty
    const id = uniqueId(`uni-${fnv1a64(row.join('|'))}`);

    const number = (column: (typeof NUMERIC_COLUMNS)[number]): string => {
      const raw = map.get(row, column);
      if (fileWritesDecimalComma && raw.includes('.') && isAmbiguousThousandGroup(withoutPlusSign(raw))) {
        const asDecimal = raw.replace(/\.?0+$/, '').replace('.', ',');
        result.warnings.push({
          line,
          message: `Hodnotu „${raw}“ ve sloupci ${column} čteme jako ${asDecimal} — tečka je v šabloně vždy desetinná. Ostatní čísla v souboru ale píšeš s desetinnou čárkou; jestli má jít o ${raw.replace('.', '')}, napiš číslo bez tečky.`,
        });
      }
      return universalNumber(raw, column);
    };
    const currency = (column: 'currency' | 'fee_currency' | 'acquisition_currency'): string =>
      universalCurrency(map.get(row, column), column);

    try {
      // uvnitř try: buňka, které nerozumíme (nejednoznačné číslo, text místo
      // čísla, značka místo kódu měny), vyhodí CellError a musí skončit chybou
      // řádku, ne pádem. Prázdné POVINNÉ číslo jde do modelu jako undefined —
      // validace pak vyjmenuje všechny chybějící sloupce naráz, kdežto prázdný
      // řetězec by shodil převod na Decimal anglickou hláškou knihovny.
      switch (type) {
        case 'BUY':
        case 'SELL': {
          // Poplatek nese jen nákup a prodej, proto se čte až tady (A10-R1-01):
          // u dividendy, úroku, vkladu nebo převodu se `fee` do transakce
          // nedostane, takže pomlčka nebo „0 Kč“ v něm nesmí řádek shodit.
          const feeAmount = number('fee');
          const fee = feeAmount
            ? { amount: feeAmount, currency: currency('fee_currency') || currency('currency') }
            : undefined;
          const isin = map.get(row, 'isin');
          const assetClass = map.get(row, 'asset_class').toUpperCase() || undefined;
          // R-12f/R-12g: settlement_style určuje, zda je cash tokem cena (premium),
          // nebo až rozdíl cen při uzavření (margin — futures, CFD)
          const styleRaw = map.get(row, 'settlement_style');
          const settlementStyle = styleRaw.toUpperCase();
          if (settlementStyle !== '' && settlementStyle !== 'PREMIUM' && settlementStyle !== 'MARGIN') {
            result.errors.push({
              line,
              message: `Neznámý settlement_style "${styleRaw}" — povolené hodnoty: premium (opce — cena je skutečný cash tok) a margin (futures/CFD — daní se rozdíl cen při uzavření).`,
              raw: row.join(','),
            });
            return;
          }
          if (assetClass === 'DERIVATIVE' && settlementStyle === '' && !warnedMissingStyle.has(isin)) {
            warnedMissingStyle.add(isin);
            result.warnings.push({
              line,
              message: `Derivát ${isin} nemá vyplněný settlement_style — počítáme prémiový styl (celá cena obchodu = cash tok, R-12f). U CFD a futures vyplň settlement_style=margin, jinak se místo rozdílu cen zdaní nominál pozice.`,
            });
          }
          // R-13: prodej nakrátko a jeho pokrytí. Značka dává smysl jen
          // u dvojice SELL+open / BUY+close — u běžného obchodu je zbytečná
          // a mlčky ji ignorovat by znamenalo, že překlep („open“ u nákupu)
          // zmizí beze stopy.
          const effectRaw = map.get(row, 'position_effect').toUpperCase();
          if (effectRaw !== '' && effectRaw !== 'OPEN' && effectRaw !== 'CLOSE') {
            result.errors.push({
              line,
              message: `Neznámý position_effect "${map.get(row, 'position_effect')}" — povolené hodnoty: open (otevření prodeje nakrátko) a close (zpětný nákup, kterým ho zavíráš).`,
              raw: row.join(','),
            });
            return;
          }
          const shortEffect =
            (type === 'SELL' && effectRaw === 'OPEN') || (type === 'BUY' && effectRaw === 'CLOSE')
              ? effectRaw
              : undefined;
          if (effectRaw !== '' && shortEffect === undefined) {
            result.warnings.push({
              line,
              message: `${type} s position_effect="${effectRaw.toLowerCase()}" je běžný obchod — prodej nakrátko se zapisuje jako SELL s "open" a jeho pokrytí jako BUY s "close". Značku jsme ignorovali.`,
            });
          }
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin,
              ticker: map.get(row, 'ticker') || undefined,
              name: map.get(row, 'name') || undefined,
              assetClass,
              positionEffect: shortEffect,
              quantity: number('quantity') || undefined,
              pricePerShare: number('price') || undefined,
              currency: currency('currency'),
              fee,
              tradeDate: date,
              settlementDate: dates.settlement_date || undefined,
              settlementStyle: settlementStyle || undefined,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
        }
        case 'DIVIDEND': {
          const returnOfCapital = universalFlag(
            map.get(row, 'return_of_capital'),
            'return_of_capital',
          );
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin') || undefined,
              // ticker i poznámku šablona nabízí a uživatel je vyplňuje —
              // zahazovat je bylo tiché mrhání tím, co si dal práci vypsat
              ticker: map.get(row, 'ticker') || undefined,
              gross: number('amount') || undefined,
              currency: currency('currency'),
              withholdingTax: number('withholding_tax') || '0',
              sourceCountry: map.get(row, 'source_country') || undefined,
              // R-07h/K6a-14: bez tohohle sloupce neměl uživatel Schwabu nebo
              // Degira jak přepínač „vratka kapitálu“ vůbec využít — příznak
              // zavádějí jen parsery T212 a IBKR a dopočítat ho zpětně nejde.
              ...(returnOfCapital ? { returnOfCapital: true } : {}),
              note: map.get(row, 'note') || undefined,
              date,
            }),
          );
          return;
        }
        case 'INTEREST':
        case 'FEE':
        case 'DEPOSIT':
        case 'WITHDRAWAL':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              amount: number('amount') || undefined,
              currency: currency('currency'),
              note: map.get(row, 'note') || undefined,
              // R-07f: u úroku má smysl i sražená daň — bez ní zápočet propadá
              ...(type === 'INTEREST'
                ? {
                    sourceCountry: map.get(row, 'source_country') || undefined,
                    withholdingTax:
                      number('withholding_tax') || '0',
                  }
                : {}),
              date,
            }),
          );
          return;
        case 'CORPORATE_ACTION': {
          const subtype = map.get(row, 'subtype').toUpperCase();
          if (!CA_SUBTYPES.has(subtype)) {
            result.errors.push({
              line,
              message: `Korporátní akce potřebuje sloupec subtype (${[...CA_SUBTYPES].join(', ')}) — máš "${map.get(row, 'subtype') || 'prázdno'}".`,
              raw: row.join(','),
            });
            return;
          }
          const ratioFrom = number('ratio_from');
          const ratioTo = number('ratio_to');
          if (subtype === 'SPLIT' && (!ratioFrom || !ratioTo)) {
            result.errors.push({
              line,
              message:
                'SPLIT potřebuje ratio_from a ratio_to (např. 1 a 4 = za 1 starý kus 4 nové).',
              raw: row.join(','),
            });
            return;
          }
          if ((subtype === 'ISIN_CHANGE' || subtype === 'MERGER') && !map.get(row, 'new_isin')) {
            result.errors.push({
              line,
              message: `${subtype} potřebuje sloupec new_isin (nový ISIN po akci).`,
              raw: row.join(','),
            });
            return;
          }
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              subtype,
              isin: map.get(row, 'isin'),
              date,
              ...(ratioFrom && ratioTo ? { ratio: { from: ratioFrom, to: ratioTo } } : {}),
              ...(map.get(row, 'new_isin') ? { newIsin: map.get(row, 'new_isin') } : {}),
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
        }
        case 'TRANSFER_IN': {
          const acquisitionDate = dates.acquisition_date;
          if (!acquisitionDate) {
            // R-04i: bez původního nabytí počítáme cenu 0 a test od převodu
            result.warnings.push({
              line,
              message:
                'TRANSFER_IN bez acquisition_date: počítáme nabývací cenu 0 a časový test od data převodu. Doplň acquisition_date/price/currency z výpisu původního brokera, ať je výpočet přesný.',
            });
          }
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin'),
              ticker: map.get(row, 'ticker') || undefined,
              name: map.get(row, 'name') || undefined,
              assetClass: map.get(row, 'asset_class').toUpperCase() || undefined,
              quantity: number('quantity') || undefined,
              date,
              ...(acquisitionDate
                ? {
                    acquisition: {
                      date: acquisitionDate,
                      costPerShare: number('acquisition_price') || undefined,
                      currency: currency('acquisition_currency') || undefined,
                    },
                  }
                : {}),
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
        }
        case 'TRANSFER_OUT':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin'),
              quantity: number('quantity') || undefined,
              date,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
      }
    } catch (err) {
      // nejednoznačné číslo má vlastní srozumitelnou hlášku — technický kontext
      // Zodu by ji jen zamlžil
      if (err instanceof CellError) {
        result.errors.push({ line, message: err.message, raw: row.join(',') });
        return;
      }
      // kontext řádku: první neprázdné buňky, ať uživatel řádek v souboru najde
      const context = row
        .filter((cell) => cell.trim() !== '')
        .slice(0, 4)
        .join(' · ');
      // L2c-05: z chyby validace jen sloupec a zpráva — `err.message` je u ní
      // JSON se všemi vnitřnostmi knihovny a stránka importu ho tiskne beze změny
      const issues = validationIssues(err);
      const reason = issues
        ? describeIssues(issues, (column) => map.get(row, column))
        : err instanceof Error
          ? err.message
          : String(err);
      result.errors.push({
        line,
        message: `Řádek (${context}) se nepodařilo zpracovat: ${reason}`,
        raw: row.join(','),
      });
    }
  });

  return result;
}
