import { Decimal, TransactionSchema, type Transaction } from '@danero/shared';
import { cleanNumber, HeaderMap, parseCsv } from '../csv';
import { dedupeKey, fnv1a64, uniqueIdFactory } from '../dedupe';
import { emptyResult, type ImportResult } from '../types';

export const TRADING212_BROKER = 'trading212';

/**
 * Poplatkové sloupce T212 exportu (sada se liší podle účtu a období).
 * Každý má párový sloupec `Currency (<název>)`.
 */
const FEE_COLUMNS = [
  'Currency conversion fee',
  'Stamp duty',
  'Stamp duty reserve tax',
  'French transaction tax',
  'Transaction fee',
  'Finra fee',
  'SEC fee',
] as const;

type RowKind =
  | { kind: 'BUY' | 'SELL' }
  | { kind: 'DIVIDEND' }
  | { kind: 'INTEREST' }
  | { kind: 'DEPOSIT' | 'WITHDRAWAL' }
  | { kind: 'SPLIT_CLOSE' | 'SPLIT_OPEN' }
  | { kind: 'SPINOFF' }
  | { kind: 'SKIP'; reason: string }
  | { kind: 'UNKNOWN' };

/** Klasifikace řádku podle sloupce Action (hodnoty typu "Market buy", "Dividend (Ordinary)"…). */
function classifyAction(action: string): RowKind {
  const normalized = action.toLowerCase();
  // korporátní akce dřív než obecné buy/sell — T212 je reportuje párem close/open řádků
  if (normalized.includes('stock split close')) return { kind: 'SPLIT_CLOSE' };
  if (normalized.includes('stock split open')) return { kind: 'SPLIT_OPEN' };
  if (normalized.includes('spin off') || normalized.includes('spin-off'))
    return { kind: 'SPINOFF' };
  if (normalized.includes('card debit') || normalized.includes('card credit'))
    return { kind: 'SKIP', reason: 'platba kartou — pohyb peněz mimo daňový výpočet CP' };
  if (normalized.includes('spending cashback'))
    return { kind: 'SKIP', reason: 'cashback za platby kartou — mimo daňový výpočet CP' };
  if (normalized.includes('buy')) return { kind: 'BUY' };
  if (normalized.includes('sell')) return { kind: 'SELL' };
  if (normalized.startsWith('dividend')) return { kind: 'DIVIDEND' };
  if (normalized.includes('interest')) return { kind: 'INTEREST' };
  if (normalized === 'deposit') return { kind: 'DEPOSIT' };
  if (normalized === 'withdrawal') return { kind: 'WITHDRAWAL' };
  if (normalized.includes('currency conversion'))
    return { kind: 'SKIP', reason: 'FX konverze — pro daňový výpočet není potřeba' };
  if (normalized.includes('result adjustment'))
    return { kind: 'SKIP', reason: 'Result adjustment — interní korekce T212' };
  return { kind: 'UNKNOWN' };
}

interface SplitLeg {
  isin: string;
  date: string;
  quantity: string;
  line: number;
  id: string;
}

/**
 * Parser CSV exportu Trading212 (History → Export, kategorie Orders/Dividends/
 * Transactions/Interest). Mapuje výhradně podle NÁZVŮ sloupců — T212 mění jejich
 * sadu i pořadí podle zvolených kategorií. Datum vypořádání export neobsahuje,
 * engine ho dopočítá (T+1 US od 28. 5. 2024 a CA od 27. 5. 2024, jinak T+2).
 */
export function parseTrading212Csv(text: string): ImportResult {
  const result = emptyResult(TRADING212_BROKER);
  const { headers, rows } = parseCsv(text);
  const map = new HeaderMap(headers);

  // Úplně prázdný soubor = prázdné období (T212 ho vrací pro roky před založením
  // účtu) — to není chyba formátu, ale nula transakcí.
  if (text.trim() === '') return result;

  if (!map.has('Action') || !map.has('Time')) {
    result.errors.push({
      line: 1,
      message: `Soubor nevypadá jako Trading212 export — chybí sloupce "Action"/"Time". Nalezené sloupce: ${headers.join(', ')}`,
    });
    return result;
  }

  const seenIds = new Set<string>();
  const uniqueId = uniqueIdFactory();
  const seenNoIdBases = new Set<string>();
  const splitCloses: SplitLeg[] = [];
  const splitOpens: SplitLeg[] = [];

  rows.forEach((row, rowIndex) => {
    const line = rowIndex + 2; // 1 = hlavička
    const action = map.get(row, 'Action');
    const time = map.get(row, 'Time');
    const date = time.slice(0, 10);

    if (action === '' && row.every((cell) => cell.trim() === '')) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      result.errors.push({ line, message: `Neplatný čas "${time}" (očekáván formát YYYY-MM-DD HH:mm:ss)`, raw: action });
      return;
    }

    const classified = classifyAction(action);
    const rowId = (): string => {
      const explicit = map.get(row, 'ID');
      if (explicit !== '') {
        const id = `t212-${explicit}`;
        if (seenIds.has(id)) {
          result.warnings.push({
            line,
            message: `Řádek má stejné ID jako jiný řádek souboru (${action} ${time}) — deduplikace je sloučí v jednu transakci. Ověř, zda nejde o dvě skutečné transakce.`,
          });
        }
        seenIds.add(id);
        return id;
      }
      // identické legitimní řádky bez ID (dva stejné fill-y v téže sekundě) nesmí
      // tiše splynout — pořadový suffix drží klíče stabilní i napříč exporty
      const base = `t212-${fnv1a64([action, time, map.get(row, 'ISIN'), map.get(row, 'No. of shares'), map.get(row, 'Price / share'), map.get(row, 'Total')].join('|'))}`;
      if (seenNoIdBases.has(base)) {
        // nahlas: může jít o dva skutečné fill-y, ale i o omylem slepené exporty
        result.warnings.push({
          line,
          message: `Obsahově identický řádek bez ID (${action} ${time}) — importuje se jako další samostatná transakce. Pokud jde o omylem zdvojený export, smaž duplicitní řádky.`,
        });
      }
      seenNoIdBases.add(base);
      return uniqueId(base);
    };

    try {
      switch (classified.kind) {
        case 'BUY':
        case 'SELL': {
          const isin = map.get(row, 'ISIN');
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          const price = cleanNumber(map.get(row, 'Price / share'));
          const currency = map.get(row, 'Currency (Price / share)');
          if (!isin || !shares || !price || !currency) {
            result.errors.push({
              line,
              message: `${action}: chybí ISIN, počet kusů, cena nebo měna — řádek nelze zpracovat.`,
              raw: row.join(','),
            });
            return;
          }
          const fee = collectFees(map, row, result, line);
          result.transactions.push(
            TransactionSchema.parse({
              type: classified.kind,
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              name: map.get(row, 'Name') || undefined,
              quantity: shares,
              pricePerShare: price,
              currency,
              fee,
              tradeDate: date,
              note: map.get(row, 'Notes') || undefined,
            }),
          );
          return;
        }
        case 'DIVIDEND': {
          // Return of capital: správně jde o snížení nabývací ceny pozice, ne příjem —
          // konzervativně (bezpečný směr) danit jako dividendu, ale říct to uživateli
          // (otevřený bod docs/14 #14 — vyžaduje produktové rozhodnutí)
          if (action.toLowerCase().includes('return of capital')) {
            result.warnings.push({
              line,
              message: `${action}: vratka kapitálu se konzervativně daní jako dividenda (§ 8) a čerpá limit 50 000 Kč paušální daně. Věcně správné zacházení je snížení nabývací ceny pozice (nižší daň až při prodeji) — pokud jde o významnou částku, uprav historii ručně nebo se poraď s poradcem.`,
            });
          }
          const isin = map.get(row, 'ISIN') || undefined;
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          const price = cleanNumber(map.get(row, 'Price / share'));
          const instrumentCurrency = map.get(row, 'Currency (Price / share)');
          let withholding = cleanNumber(map.get(row, 'Withholding tax')) || '0';
          const withholdingCurrency = map.get(row, 'Currency (Withholding tax)');

          let gross: string;
          let currency: string;
          if (shares && price && instrumentCurrency) {
            // brutto v měně instrumentu = kusy × dividenda/kus (srážka bývá v téže měně)
            gross = new Decimal(shares).mul(price).toString();
            currency = instrumentCurrency;
            if (withholdingCurrency && withholdingCurrency !== instrumentCurrency) {
              // číslo v cizí měně by se tiše přepočetlo špatným kurzem —
              // bezpečněji: zápočet nezapočíst (vyšší daň) a říct si o doplnění
              withholding = '0';
              result.warnings.push({
                line,
                message: `Dividenda: srážková daň v jiné měně (${withholdingCurrency}) než brutto (${instrumentCurrency}) — do zápočtu nebyla započtena, doplň ji ručně.`,
              });
            }
          } else {
            // starší formát bez kusů/ceny: k dispozici jen čistá částka Total
            gross = cleanNumber(map.get(row, 'Total'));
            currency = map.get(row, 'Currency (Total)');
            if (!gross || !currency) {
              result.errors.push({ line, message: 'Dividenda bez částky — řádek nelze zpracovat.' });
              return;
            }
            result.warnings.push({
              line,
              message:
                'Dividenda: brutto odhadnuto z čisté připsané částky (export neobsahuje kusy × dividenda/kus) — základ § 8 může být podhodnocen o srážkovou daň.',
            });
          }
          // nulové brutto s nenulovou srážkou = zápočet daně bez příjmu; nulová
          // dividenda vůbec je podezřelá vždy (chybějící kusy/cena v exportu)
          if (new Decimal(gross || '0').eq(0)) {
            const tax = new Decimal(withholding || '0');
            result.warnings.push({
              line,
              message: tax.gt(0)
                ? `${action}: dividenda má nulové brutto (kusy „${shares || '—'}“ × cena „${price || '—'}“), ale sraženou daň ${tax.toString()} ${currency} — zápočet daně bez příjmu je podezřelý. Zkontroluj řádek ve výpisu brokera a částku případně doplň ručně.`
                : `${action}: dividenda s nulovou částkou — v exportu chybí počet kusů nebo dividenda na kus. Zkontroluj řádek ve výpisu brokera.`,
            });
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'DIVIDEND',
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              gross,
              currency,
              withholdingTax: withholding,
              date,
            }),
          );
          return;
        }
        case 'INTEREST': {
          const amount = cleanNumber(map.get(row, 'Total'));
          const currency = map.get(row, 'Currency (Total)');
          if (!amount || !currency) {
            result.errors.push({ line, message: `${action}: chybí částka/měna úroku.` });
            return;
          }
          // Záporný úrok = naúčtovaný (ne připsaný) — nesmí se tiše otočit
          // do zdanitelného příjmu § 8; evidujeme ho jako poplatek účtu
          if (amount.startsWith('-')) {
            result.warnings.push({
              line,
              message: `${action}: záporná částka ${amount} ${currency} — jde o naúčtovaný úrok (náklad), ne příjem. Evidujeme jako poplatek účtu, do základu § 8 nevstupuje.`,
            });
            result.transactions.push(
              TransactionSchema.parse({
                type: 'FEE',
                id: rowId(),
                amount: amount.replace(/^-/, ''),
                currency,
                date,
              }),
            );
            return;
          }
          // R-07f: sloupec srážkové daně nese T212 na každém řádku (u úroků bývá
          // prázdný). Když vyplněný je, musí se přenést — jinak zápočet propadne
          // už v importu. V jiné měně než úrok ho radši nezapočítáme (stejně
          // jako u dividend: špatný kurz by zápočet nadhodnotil).
          let interestWithholding = cleanNumber(map.get(row, 'Withholding tax')) || '0';
          const interestWithholdingCurrency = map.get(row, 'Currency (Withholding tax)');
          if (
            new Decimal(interestWithholding).gt(0) &&
            interestWithholdingCurrency &&
            interestWithholdingCurrency !== currency
          ) {
            result.warnings.push({
              line,
              message: `${action}: srážková daň v jiné měně (${interestWithholdingCurrency}) než úrok (${currency}) — do zápočtu nebyla započtena, doplň ji ručně.`,
            });
            interestWithholding = '0';
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'INTEREST',
              id: rowId(),
              amount,
              currency,
              withholdingTax: interestWithholding,
              date,
            }),
          );
          return;
        }
        case 'DEPOSIT':
        case 'WITHDRAWAL': {
          const amount = cleanNumber(map.get(row, 'Total'));
          const currency = map.get(row, 'Currency (Total)');
          if (!amount || !currency) {
            result.errors.push({ line, message: `${action}: chybí částka/měna.` });
            return;
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: classified.kind,
              id: rowId(),
              amount: amount.replace(/^-/, ''),
              currency,
              date,
            }),
          );
          return;
        }
        case 'SPLIT_CLOSE':
        case 'SPLIT_OPEN': {
          const isin = map.get(row, 'ISIN');
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          if (!isin || !shares) {
            result.errors.push({ line, message: `${action}: chybí ISIN nebo počet kusů.` });
            return;
          }
          const leg: SplitLeg = { isin, date, quantity: shares, line, id: rowId() };
          (classified.kind === 'SPLIT_CLOSE' ? splitCloses : splitOpens).push(leg);
          return;
        }
        case 'SPINOFF': {
          // T212 reportuje spin-off jako příjem nových kusů dceřiného ISIN s cenou 0
          // → BUY za 0 přesně odpovídá R-04f (nová lhůta testu, nabývací cena 0).
          const isin = map.get(row, 'ISIN');
          const shares = cleanNumber(map.get(row, 'No. of shares'));
          const currency = map.get(row, 'Currency (Price / share)') || 'USD';
          if (!isin || !shares) {
            result.errors.push({ line, message: 'Spin off: chybí ISIN nebo počet kusů.' });
            return;
          }
          result.transactions.push(
            TransactionSchema.parse({
              type: 'BUY',
              id: rowId(),
              isin,
              ticker: map.get(row, 'Ticker') || undefined,
              name: map.get(row, 'Name') || undefined,
              quantity: shares,
              pricePerShare: cleanNumber(map.get(row, 'Price / share')) || '0',
              currency,
              tradeDate: date,
              settlementDate: date,
              note: 'Spin-off (T212)',
            }),
          );
          result.warnings.push({
            line,
            message: `Spin-off ${isin}: nové kusy s nabývací cenou 0 a novou lhůtou časového testu (konzervativní postup); mateřská pozice beze změny.`,
          });
          return;
        }
        case 'SKIP': {
          result.skipped.push({ line, message: `${action}: ${classified.reason}` });
          return;
        }
        case 'UNKNOWN': {
          result.errors.push({
            line,
            message: `Neznámý typ transakce "${action}" — nahlaš nám ho, doplníme podporu.`,
            raw: row.join(','),
          });
          return;
        }
      }
    } catch (err) {
      result.errors.push({
        line,
        message: `Řádek se nepodařilo zpracovat: ${err instanceof Error ? err.message : String(err)}`,
        raw: row.join(','),
      });
    }
  });

  // Párování Stock split close/open (stejný ISIN a den) → CORPORATE_ACTION SPLIT.
  // Poměr = nové kusy / staré kusy celé pozice — ledger jím proporcionálně
  // transformuje všechny loty bez resetu data nabytí (R-04a).
  for (const open of splitOpens) {
    const closeIndex = splitCloses.findIndex((c) => c.isin === open.isin && c.date === open.date);
    if (closeIndex === -1) {
      result.errors.push({
        line: open.line,
        message: `Stock split open (${open.isin}) bez párového close řádku — split nelze sestavit.`,
      });
      continue;
    }
    const close = splitCloses.splice(closeIndex, 1)[0]!;
    result.transactions.push(
      TransactionSchema.parse({
        type: 'CORPORATE_ACTION',
        id: open.id,
        subtype: 'SPLIT',
        isin: open.isin,
        date: open.date,
        ratio: { from: close.quantity, to: open.quantity },
        note: 'Stock split (T212 close/open pár)',
      }),
    );
  }
  for (const close of splitCloses) {
    result.errors.push({
      line: close.line,
      message: `Stock split close (${close.isin}) bez párového open řádku — split nelze sestavit.`,
    });
  }

  return result;
}

/** Sečte poplatkové sloupce řádku; při míchání měn vezme první měnu a zbytek nahlásí.
 * Bezpečný směr: podezřelý poplatek (záporný = vratka, bez sloupce s měnou) se
 * NEzapočte a nahlásí — nezapočtený výdaj daň nesníží, tichá chyba by ji zkreslila. */
function collectFees(
  map: HeaderMap,
  row: string[],
  result: ImportResult,
  line: number,
): { amount: string; currency: string } | undefined {
  let total: Decimal | undefined;
  let currency: string | undefined;
  for (const column of FEE_COLUMNS) {
    const raw = cleanNumber(map.get(row, column));
    if (!raw) continue;
    if (raw.startsWith('-')) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" je záporný (${raw}) — vypadá jako vratka, do výdajů nebyl započten. Zkontroluj ručně.`,
      });
      continue;
    }
    const feeCurrency = map.get(row, `Currency (${column})`) || undefined;
    if (feeCurrency === undefined) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" nemá v exportu sloupec s měnou — do výdajů nebyl započten, doplň ručně.`,
      });
      continue;
    }
    if (currency !== undefined && feeCurrency !== currency) {
      result.warnings.push({
        line,
        message: `Poplatek "${column}" je v jiné měně (${feeCurrency}) než ostatní poplatky (${currency}) — nebyl započten, doplň ručně.`,
      });
      continue;
    }
    currency = currency ?? feeCurrency;
    total = (total ?? new Decimal(0)).plus(raw);
  }
  if (!total || total.lte(0) || currency === undefined) return undefined;
  return { amount: total.toString(), currency };
}

/** Deduplikační klíče pro výsledek importu (viz dedupe.ts). */
export const trading212DedupeKey = (tx: Transaction): string => dedupeKey(TRADING212_BROKER, tx);

/**
 * Poznávací znamení přenosu přerušeného hned za hlavičkou: přišel neprázdný
 * soubor, ale ani jeden datový řádek. Prázdné období posílá T212 jako ÚPLNĚ
 * prázdný soubor (ověřeno provozem), takže tohle prázdný rok NENÍ — a kdyby
 * se za něj vydával, ukončil by předčasně stahování plné historie a chybějící
 * roky by se už nikdy nedotáhly. Kontrola nestojí na hlavičce Content-Length:
 * tu server poslat nemusí (chunked přenos) a u komprimované odpovědi neplatí
 * pro rozbalený text.
 *
 * Schválně se nedívá na názvy sloupců: řez může padnout i doprostřed hlavičky
 * a takový soubor by pak prošel jako „cizí formát“ = chybný import, po kterém
 * se rok považuje za stažený. Řez uprostřed dat (hlavička + část řádků) takhle
 * poznat nejde — na ten je Content-Length jediná obrana.
 */
export function isTruncatedTrading212Export(text: string): boolean {
  if (text.trim() === '') return false;
  const { rows } = parseCsv(text);
  return rows.every((row) => row.every((cell) => cell.trim() === ''));
}
