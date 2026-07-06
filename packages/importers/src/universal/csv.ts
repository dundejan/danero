import { TransactionSchema } from '@danero/shared';
import { cleanNumber, HeaderMap, parseCsv } from '../csv';
import { fnv1a64 } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const UNIVERSAL_BROKER = 'universal';

/**
 * Univerzální CSV šablona — fallback pro brokery bez vlastního parseru
 * (pattern Koinly/Taxomat, docs/03). Formát je popsán v docs/06-import.md.
 *
 * Sloupce: type, date, settlement_date?, isin, ticker?, name?, quantity, price,
 * currency, fee?, fee_currency?, amount, withholding_tax?, source_country?, note?
 */
const REQUIRED_HEADERS = ['type', 'date'] as const;

const TYPES = new Set(['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'DEPOSIT', 'WITHDRAWAL']);

export function parseUniversalCsv(text: string): ImportResult {
  const result = emptyResult(UNIVERSAL_BROKER);
  const { headers, rows } = parseCsv(text);
  const normalizedHeaders = headers.map((h) => h.toLowerCase());
  const map = new HeaderMap(normalizedHeaders);

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
      }
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: row.join(','),
      });
    }
  });

  return result;
}
