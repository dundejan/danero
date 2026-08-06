import { TransactionSchema } from '@danero/shared';
import { HeaderMap, isValidIsoDate, parseCsv } from '../csv';
import { fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const UNIVERSAL_BROKER = 'universal';

/** Nejednoznačný číselný zápis v šabloně — chytá se u řádku a hlásí uživateli. */
class AmbiguousNumberError extends Error {}

/**
 * Číslo z univerzální šablony. Šablona předepisuje desetinnou TEČKU, ale
 * v českém Excelu vzniká čárka — a „1,500“ může znamenat 1,5 i 1500. Takový
 * zápis ODMÍTÁME (dřív se tiše bral jako tisícový oddělovač, takže „0,001“ BTC
 * se naimportovalo jako 1 kus — tisícinásobek). Ostatní čárky bereme jako
 * desetinné: „1,25“ → 1.25. Dvě a víc čárek jednoznačně oddělují tisíce
 * („1,234,567“), stejně jako čárka následovaná tečkou („1,234.56“).
 */
function universalNumber(value: string, column: string): string {
  const trimmed = value.replace(/[\s\u00a0\u202f]/g, '');
  if (!trimmed.includes(',')) return trimmed;
  if (trimmed.includes('.')) {
    // tečka i čárka = jednoznačné: poslední oddělovač je desetinný, ten druhý dělí tisíce
    return trimmed.lastIndexOf('.') > trimmed.lastIndexOf(',')
      ? trimmed.replace(/,/g, '')
      : trimmed.replace(/\./g, '').replace(',', '.');
  }
  // dvě a víc čárek nemůže být desetinná čárka → oddělovač tisíců
  if (trimmed.split(',').length > 2) return trimmed.replace(/,/g, '');
  if (/^-?\d+,\d{3}$/.test(trimmed)) {
    throw new AmbiguousNumberError(
      `Hodnota „${value.trim()}“ ve sloupci ${column} je nejednoznačná — čárka může být desetinná čárka (${trimmed.replace(',', '.')}) i oddělovač tisíců (${trimmed.replace(',', '')}). Piš čísla s desetinnou TEČKOU, bez oddělovačů tisíců.`,
    );
  }
  return trimmed.replace(',', '.');
}

/**
 * Univerzální CSV šablona v2 — fallback pro brokery bez vlastního parseru
 * (pattern Koinly/Taxomat, docs/03). Formát je popsán v docs/06-import.md.
 *
 * Sloupce: type, date, settlement_date?, isin, ticker?, name?, asset_class?,
 * settlement_style?, quantity, price, currency, fee?, fee_currency?, amount,
 * withholding_tax?, source_country?, subtype?, ratio_from?, ratio_to?,
 * new_isin?, acquisition_date?, acquisition_price?, acquisition_currency?, note?
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
  'type,date,settlement_date,isin,ticker,name,asset_class,settlement_style,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note',
  'BUY,2024-06-10,2024-06-12,US0378331005,AAPL,Apple Inc,,,10,185.50,USD,1.00,USD,,,,,,,,,,,nákup přes brokera XY',
  'SELL,2026-03-05,2026-03-06,US0378331005,AAPL,Apple Inc,,,5,210.00,USD,1.00,USD,,,,,,,,,,,',
  'BUY,2025-03-01,,BTC,BTC,Bitcoin,CRYPTO,,0.5,60000,EUR,,,,,,,,,,,,,nákup kryptoaktiva — isin = symbol',
  'SELL,2026-04-01,,BTC,BTC,Bitcoin,CRYPTO,,0.2,75000,EUR,,,,,,,,,,,,,prodej (i krypto-krypto směna = prodej oceněný protiplněním)',
  'BUY,2026-01-15,,OPT:AAPL-2026-06-C200,,AAPL call 200 6/2026,DERIVATIVE,premium,1,1250,USD,,,,,,,,,,,,,nákup opce — cena za KONTRAKT (prémie × multiplikátor); isin = libovolný stálý identifikátor',
  'SELL,2026-04-10,,OPT:AAPL-2026-06-C200,,AAPL call 200 6/2026,DERIVATIVE,premium,1,1800,USD,,,,,,,,,,,,,prodej opce; expirace bezcenné opce = prodej za 0',
  'BUY,2026-02-02,,CFD:US500,,S&P 500 CFD,DERIVATIVE,margin,2,5000,USD,,,,,,,,,,,,,otevření CFD — margin: daní se rozdíl cen při uzavření, ne nominál',
  'SELL,2026-03-16,,CFD:US500,,S&P 500 CFD,DERIVATIVE,margin,2,5150,USD,,,,,,,,,,,,,uzavření CFD',
  'DIVIDEND,2026-05-10,,US0378331005,AAPL,Apple Inc,,,,,USD,,,25.00,3.75,US,,,,,,,,brutto a sražená daň',
  'INTEREST,2026-06-01,,,,,,,,,USD,,,1.23,,US,,,,,,,,úrok z hotovosti',
  'FEE,2026-06-01,,,,,,,,,EUR,,,2.50,,,,,,,,,,poplatek za vedení účtu',
  'CORPORATE_ACTION,2024-08-31,,US0378331005,,,,,,,,,,,,,SPLIT,1,4,,,,,split 4:1 (za 1 starý kus 4 nové)',
  'CORPORATE_ACTION,2025-04-01,,GB0002222222,,,,,,,,,,,,,ISIN_CHANGE,,,GB0003333333,,,,změna ISIN',
  'TRANSFER_IN,2025-05-05,,US5949181045,MSFT,Microsoft,,,10,,,,,,,,,,,,2021-03-01,240.00,USD,převod od jiného brokera — datum a cena PŮVODNÍHO nabytí',
].join('\n');

export function parseUniversalCsv(text: string): ImportResult {
  const result = emptyResult(UNIVERSAL_BROKER);
  const { headers, rows } = parseCsv(text);
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
  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    if (row.every((cell) => cell.trim() === '')) return;

    const type = map.get(row, 'type').toUpperCase();
    const date = map.get(row, 'date');
    if (!TYPES.has(type)) {
      result.errors.push({ line, message: `Neznámý typ "${type}" (povolené: ${[...TYPES].join(', ')})` });
      return;
    }
    // Ručně psaná data: regex schématu pustí i neexistující den (2026-02-30)
    // a datumová aritmetika by ho tiše přetekla — řádek se odmítne s chybou
    for (const [column, value] of [
      ['date', date],
      ['settlement_date', map.get(row, 'settlement_date')],
      ['acquisition_date', map.get(row, 'acquisition_date')],
    ] as const) {
      if ((value || column === 'date') && !isValidIsoDate(value)) {
        result.errors.push({
          line,
          message: `Neplatné datum "${value}" ve sloupci ${column} — očekáváme existující den ve formátu RRRR-MM-DD (např. 2026-03-05).`,
          raw: row.join(','),
        });
        return;
      }
    }

    // identické legitimní řádky (dva stejné obchody v týž den) nesmí tiše
    // splynout — pořadový suffix drží klíče stabilní i napříč exporty
    const id = uniqueId(`uni-${fnv1a64(row.join('|'))}`);

    try {
      // uvnitř try: nejednoznačný číselný zápis (desetinná čárka vs. tisíce)
      // vyhodí AmbiguousNumberError a musí skončit chybou řádku, ne pádem
      const feeAmount = universalNumber(map.get(row, 'fee'), 'fee');
      const fee = feeAmount
        ? { amount: feeAmount, currency: map.get(row, 'fee_currency') || map.get(row, 'currency') }
        : undefined;
      switch (type) {
        case 'BUY':
        case 'SELL': {
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
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin,
              ticker: map.get(row, 'ticker') || undefined,
              name: map.get(row, 'name') || undefined,
              assetClass,
              quantity: universalNumber(map.get(row, 'quantity'), 'quantity'),
              pricePerShare: universalNumber(map.get(row, 'price'), 'price'),
              currency: map.get(row, 'currency'),
              fee,
              tradeDate: date,
              settlementDate: map.get(row, 'settlement_date') || undefined,
              settlementStyle: settlementStyle || undefined,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
        }
        case 'DIVIDEND':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin') || undefined,
              gross: universalNumber(map.get(row, 'amount'), 'amount'),
              currency: map.get(row, 'currency'),
              withholdingTax: universalNumber(map.get(row, 'withholding_tax'), 'withholding_tax') || '0',
              sourceCountry: map.get(row, 'source_country') || undefined,
              date,
            }),
          );
          return;
        case 'INTEREST':
        case 'FEE':
        case 'DEPOSIT':
        case 'WITHDRAWAL':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              amount: universalNumber(map.get(row, 'amount'), 'amount'),
              currency: map.get(row, 'currency'),
              ...(type === 'INTEREST'
                ? { sourceCountry: map.get(row, 'source_country') || undefined }
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
          const ratioFrom = universalNumber(map.get(row, 'ratio_from'), 'ratio_from');
          const ratioTo = universalNumber(map.get(row, 'ratio_to'), 'ratio_to');
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
          const acquisitionDate = map.get(row, 'acquisition_date');
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
              quantity: universalNumber(map.get(row, 'quantity'), 'quantity'),
              date,
              ...(acquisitionDate
                ? {
                    acquisition: {
                      date: acquisitionDate,
                      costPerShare: universalNumber(map.get(row, 'acquisition_price'), 'acquisition_price') || undefined,
                      currency: map.get(row, 'acquisition_currency') || undefined,
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
              quantity: universalNumber(map.get(row, 'quantity'), 'quantity'),
              date,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
      }
    } catch (err) {
      // nejednoznačné číslo má vlastní srozumitelnou hlášku — technický kontext
      // Zodu by ji jen zamlžil
      if (err instanceof AmbiguousNumberError) {
        result.errors.push({ line, message: err.message, raw: row.join(',') });
        return;
      }
      // kontext řádku: první neprázdné buňky, ať uživatel řádek v souboru najde
      const context = row
        .filter((cell) => cell.trim() !== '')
        .slice(0, 4)
        .join(' · ');
      result.errors.push({
        line,
        message: `Řádek (${context}) se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: row.join(','),
      });
    }
  });

  return result;
}
