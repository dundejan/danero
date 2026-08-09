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

/**
 * Sémantická identita události — VÝHRADNĚ pole, která popisují, co se stalo.
 * Žádné `tx.id`: to si každý parser skládá po svém (u půlky brokerů z otisku
 * SYROVÉHO řádku), takže by změna tvaru exportu — koncová čárka, přidaný nebo
 * přehozený sloupec — vyrobila jiný otisk a tatáž transakce by se uložila
 * podruhé, zatímco import by hlásil „0 duplicit" (nález B-3-2). Že se tvar
 * exportů mění, ví i sám kód: `schwab/csv.ts` u mapování sloupců píše „Pořadí
 * sloupců se mezi exporty LIŠÍ".
 */
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
      ];
    case 'DIVIDEND':
      return [
        tx.type,
        tx.isin ?? '',
        tx.date,
        tx.gross.toString(),
        tx.withholdingTax.toString(),
        tx.currency,
      ];
    case 'INTEREST':
    case 'FEE':
    case 'DEPOSIT':
    case 'WITHDRAWAL':
      return [tx.type, tx.date, tx.amount.toString(), tx.currency];
    case 'FX_CONVERSION':
      return [
        tx.type,
        tx.date,
        tx.fromAmount.toString(),
        tx.fromCurrency,
        tx.toAmount.toString(),
        tx.toCurrency,
      ];
    case 'CORPORATE_ACTION':
      return [tx.type, tx.subtype, tx.isin, tx.date, tx.newIsin ?? ''];
    case 'TRANSFER_IN':
    case 'TRANSFER_OUT':
      return [tx.type, tx.isin, tx.date, tx.quantity.toString()];
  }
};

/**
 * Otisk obsahu transakce bez brokera a bez id. Tatáž událost stažená od dvou
 * zdrojů (ruční zápis × pozdější stažení z API) má stejný otisk — čehož se dá
 * využít k hlášení, ne ke slučování.
 */
export const contentFingerprint = (tx: Transaction): string =>
  fnv1a64(contentParts(tx).join('|'));

/**
 * Stabilní deduplikační klíč. Exporty brokerů mají roční limity, takže uživatel
 * nahrává překrývající se soubory — stejný obsah → stejný klíč → idempotentní
 * import.
 *
 * `occurrence` odlišuje události, které jsou obsahově NEROZLIŠITELNÉ a přitom
 * legitimní (dvě částečná plnění stejného objemu za stejnou cenu, dva úroky
 * téhož dne). Pořadí přiděluje `dedupeTransactions` v rámci jednoho výpisu,
 * takže je stabilní mezi importy téhož souboru a nezávisí na jeho tvaru.
 */
export const dedupeKey = (broker: string, tx: Transaction, occurrence = 1): string =>
  `${broker}|${contentFingerprint(tx)}|${occurrence}`;

export interface DedupeOutcome {
  /** Transakce k uložení i s klíčem — počítat ho podruhé zvlášť nejde (pořadí). */
  fresh: Array<{ tx: Transaction; key: string }>;
  duplicates: number;
}

/** Odfiltruje transakce, jejichž klíč už existuje (např. z DB nebo dřívějších souborů). */
export function dedupeTransactions(
  broker: string,
  incoming: Transaction[],
  existingKeys: Iterable<string> = [],
): DedupeOutcome {
  const seen = new Set(existingKeys);
  const fresh: DedupeOutcome['fresh'] = [];
  // otisk obsahu → (id transakce → pořadí). Pořadí se váže na ID, ne na pouhé
  // pořadí v poli: týž soubor naparsovaný dvakrát za sebou (nebo dvě
  // překrývající se dávky v jednom volání) tak dá tatáž ID, tedy tatáž pořadí
  // a tytéž klíče — a duplicity se poznají i uvnitř jedné dávky.
  const occurrences = new Map<string, Map<string, number>>();
  let duplicates = 0;
  for (const tx of incoming) {
    const fingerprint = contentFingerprint(tx);
    let ids = occurrences.get(fingerprint);
    if (!ids) {
      ids = new Map();
      occurrences.set(fingerprint, ids);
    }
    let occurrence = ids.get(tx.id);
    if (occurrence === undefined) {
      occurrence = ids.size + 1;
      ids.set(tx.id, occurrence);
    }
    const key = `${broker}|${fingerprint}|${occurrence}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    fresh.push({ tx, key });
  }
  return { fresh, duplicates };
}

/**
 * Stabilní id s pořadovým suffixem pro kolidující základy: identické legitimní
 * řádky (partial fills, opakované obchody v jedné sekundě) dostanou -2, -3…
 * V rámci stejné množiny záznamů je výsledek stabilní mezi parse-běhy, takže
 * dedupe napříč překrývajícími se exporty funguje. Sdílené parsery brokerů.
 */
export function uniqueIdFactory(): (base: string) => string {
  const seen = new Map<string, number>();
  return (base: string): string => {
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  };
}
