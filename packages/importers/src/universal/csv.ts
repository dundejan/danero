import { TransactionSchema } from '@danero/shared';
import { cleanNumber, HeaderMap, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const UNIVERSAL_BROKER = 'universal';

/**
 * Univerzální CSV šablona v2 — fallback pro brokery bez vlastního parseru
 * (pattern Koinly/Taxomat, docs/03). Formát je popsán v docs/06-import.md.
 *
 * Sloupce: type, date, settlement_date?, isin, ticker?, name?, quantity, price,
 * currency, fee?, fee_currency?, amount, withholding_tax?, source_country?,
 * subtype?, ratio_from?, ratio_to?, new_isin?, acquisition_date?,
 * acquisition_price?, acquisition_currency?, note?
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
  'type,date,settlement_date,isin,ticker,name,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,subtype,ratio_from,ratio_to,new_isin,acquisition_date,acquisition_price,acquisition_currency,note',
  'BUY,2024-06-10,2024-06-12,US0378331005,AAPL,Apple Inc,10,185.50,USD,1.00,USD,,,,,,,,,,,nákup přes brokera XY',
  'SELL,2026-03-05,2026-03-06,US0378331005,AAPL,Apple Inc,5,210.00,USD,1.00,USD,,,,,,,,,,,',
  'DIVIDEND,2026-05-10,,US0378331005,AAPL,Apple Inc,,,USD,,,25.00,3.75,US,,,,,,,,brutto a sražená daň',
  'INTEREST,2026-06-01,,,,,,,USD,,,1.23,,US,,,,,,,,úrok z hotovosti',
  'FEE,2026-06-01,,,,,,,EUR,,,2.50,,,,,,,,,,poplatek za vedení účtu',
  'CORPORATE_ACTION,2024-08-31,,US0378331005,,,,,,,,,,,SPLIT,1,4,,,,,split 4:1 (za 1 starý kus 4 nové)',
  'CORPORATE_ACTION,2025-04-01,,GB0002222222,,,,,,,,,,,ISIN_CHANGE,,,GB0003333333,,,,změna ISIN',
  'TRANSFER_IN,2025-05-05,,US5949181045,MSFT,Microsoft,10,,,,,,,,,,,,2021-03-01,240.00,USD,převod od jiného brokera — datum a cena PŮVODNÍHO nabytí',
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
        message: `Chybí povinný sloupec "${required}". Očekávaná šablona: viz docs/06-import.md.`,
      });
      return result;
    }
  }

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2;
    if (row.every((cell) => cell.trim() === '')) return;

    const type = map.get(row, 'type').toUpperCase();
    const date = map.get(row, 'date');
    if (!TYPES.has(type)) {
      result.errors.push({ line, message: `Neznámý typ "${type}" (povolené: ${[...TYPES].join(', ')})` });
      return;
    }

    const id = `uni-${fnv1a64(row.join('|'))}`;
    const feeAmount = cleanNumber(map.get(row, 'fee'));
    const fee = feeAmount
      ? { amount: feeAmount, currency: map.get(row, 'fee_currency') || map.get(row, 'currency') }
      : undefined;

    try {
      switch (type) {
        case 'BUY':
        case 'SELL':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin'),
              ticker: map.get(row, 'ticker') || undefined,
              name: map.get(row, 'name') || undefined,
              quantity: cleanNumber(map.get(row, 'quantity')),
              pricePerShare: cleanNumber(map.get(row, 'price')),
              currency: map.get(row, 'currency'),
              fee,
              tradeDate: date,
              settlementDate: map.get(row, 'settlement_date') || undefined,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
        case 'DIVIDEND':
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin') || undefined,
              gross: cleanNumber(map.get(row, 'amount')),
              currency: map.get(row, 'currency'),
              withholdingTax: cleanNumber(map.get(row, 'withholding_tax')) || '0',
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
              amount: cleanNumber(map.get(row, 'amount')),
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
          const ratioFrom = cleanNumber(map.get(row, 'ratio_from'));
          const ratioTo = cleanNumber(map.get(row, 'ratio_to'));
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
                'TRANSFER_IN bez acquisition_date: počítáme nabývací cenu 0 a časový test od data převodu (R-04i). Doplň acquisition_date/price/currency z výpisu původního brokera, ať je výpočet přesný.',
            });
          }
          result.transactions.push(
            TransactionSchema.parse({
              type,
              id,
              isin: map.get(row, 'isin'),
              quantity: cleanNumber(map.get(row, 'quantity')),
              date,
              ...(acquisitionDate
                ? {
                    acquisition: {
                      date: acquisitionDate,
                      costPerShare: cleanNumber(map.get(row, 'acquisition_price')) || undefined,
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
              quantity: cleanNumber(map.get(row, 'quantity')),
              date,
              note: map.get(row, 'note') || undefined,
            }),
          );
          return;
      }
    } catch (err) {
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
