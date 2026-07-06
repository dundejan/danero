import type { Transaction } from '@danero/shared';

/** FNV-1a 64bit — deterministický otisk obsahu (nekryptografický, pro dedupe stačí). */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

const contentParts = (tx: Transaction): string[] => {
  switch (tx.type) {
    case 'BUY':
    case 'SELL':
      return [
        tx.type,
        tx.isin,
        tx.tradeDate,
        tx.quantity.toString(),
        tx.pricePerShare.toString(),
        tx.currency,
        tx.id,
      ];
    case 'DIVIDEND':
      return [
        tx.type,
        tx.isin ?? '',
        tx.date,
        tx.gross.toString(),
        tx.withholdingTax.toString(),
        tx.currency,
        tx.id,
      ];
    case 'INTEREST':
    case 'FEE':
    case 'DEPOSIT':
    case 'WITHDRAWAL':
      return [tx.type, tx.date, tx.amount.toString(), tx.currency, tx.id];
    case 'FX_CONVERSION':
      return [
        tx.type,
        tx.date,
        tx.fromAmount.toString(),
        tx.fromCurrency,
        tx.toAmount.toString(),
        tx.toCurrency,
        tx.id,
      ];
    case 'CORPORATE_ACTION':
      return [tx.type, tx.subtype, tx.isin, tx.date, tx.newIsin ?? '', tx.id];
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':
      return [tx.type, tx.isin, tx.date, tx.quantity.toString(), tx.id];
  }
};

/**
 * Stabilní deduplikační klíč z obsahu transakce. Exporty brokerů mají roční limity,
 * takže uživatel nahrává překrývající se soubory — stejný obsah → stejný klíč →
 * idempotentní import.
 */
export const dedupeKey = (broker: string, tx: Transaction): string =>
  `${broker}|${fnv1a64(contentParts(tx).join('|'))}`;

export interface DedupeOutcome {
  fresh: Transaction[];
  duplicates: number;
}

/** Odfiltruje transakce, jejichž klíč už existuje (např. z DB nebo dřívějších souborů). */
export function dedupeTransactions(
  broker: string,
  incoming: Transaction[],
  existingKeys: Iterable<string> = [],
): DedupeOutcome {
  const seen = new Set(existingKeys);
  const fresh: Transaction[] = [];
  let duplicates = 0;
  for (const tx of incoming) {
    const key = dedupeKey(broker, tx);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push(tx);
  }
  return { fresh, duplicates };
}
