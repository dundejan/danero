import { and, asc, eq } from 'drizzle-orm';
import {
  addDays,
  parseTransactions,
  TaxpayerProfileSchema,
  type TaxpayerProfile,
  type Transaction,
} from '@danero/shared';
import {
  analyzeTaxYear,
  positionsAt,
  type EngineInput,
  type EngineOptions,
  type Position,
  type TaxYearResult,
} from '@danero/engine';
import type { Db } from '@/db';
import { taxpayerProfiles, transactions } from '@/db/schema';
import { configForYear, UNIFIED_RATES } from './tax-config';

export type ProfileRow = typeof taxpayerProfiles.$inferSelect;

export async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  return rows[0] ?? null;
}

/** Převod DB řádku profilu na vstup enginu (profil + přepínače z docs/02). */
export function profileToEngine(row: ProfileRow): {
  profile: TaxpayerProfile;
  options: Partial<EngineOptions>;
} {
  return {
    profile: TaxpayerProfileSchema.parse({
      regime: row.regime,
      hasSecuritiesInBusinessAssets: row.hasBusinessAssets,
      w8benFiled: row.w8benFiled,
      otherTaxableIncome8to10Czk: row.otherIncomeCzk,
    }),
    options: {
      matchingMethod: row.matchingMethod as EngineOptions['matchingMethod'],
      fxMethod: row.fxMethod as EngineOptions['fxMethod'],
      limit100kIncludesTimeTestExempt: row.limit100kStrict,
      timeTestDateBasis: row.timeTestBasis as EngineOptions['timeTestDateBasis'],
      derivativesExpensesPerType: row.derivativesExpensesPerType,
      emtTimeTestExempt: row.emtTimeTestExempt,
    },
  };
}

/** `broker` zúží na transakce jednoho brokera — rekonciliace pozic je per broker. */
export async function loadTransactions(
  db: Db,
  userId: string,
  broker?: string,
): Promise<Transaction[]> {
  const scope = eq(transactions.userId, userId);
  const rows = await db
    .select({ payload: transactions.payload })
    .from(transactions)
    .where(broker ? and(scope, eq(transactions.broker, broker)) : scope)
    .orderBy(asc(transactions.txDate));
  return parseTransactions(rows.map((r) => r.payload));
}

/** Mapa ISIN → celý název společnosti/fondu z transakcí (doplněk k tickeru). */
export function instrumentNames(txs: Transaction[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL' && tx.type !== 'TRANSFER_IN') continue;
    if (names.has(tx.isin) || !tx.name) continue;
    names.set(tx.isin, tx.name);
  }
  return names;
}

/** Mapa ISIN → ticker/název z transakcí (pro čitelné popisky pozic). */
export function instrumentLabels(txs: Transaction[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL' && tx.type !== 'TRANSFER_IN') continue;
    if (labels.has(tx.isin)) continue;
    const label = tx.ticker ?? tx.name;
    if (label) labels.set(tx.isin, label);
  }
  return labels;
}

/** Roky, ve kterých má uživatel transakce (sestupně), vždy včetně aktuálního. */
export function availableYears(txs: Transaction[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const tx of txs) {
    const date = tx.type === 'BUY' || tx.type === 'SELL' ? tx.tradeDate : tx.date;
    years.add(Number(date.slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}

export function engineInputForUser(
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  dailyRates?: EngineInput['dailyRates'],
): EngineInput {
  const { profile, options } = profileToEngine(profileRow);
  return { transactions: txs, profile, options, config: configForYear(year), dailyRates };
}

/**
 * Denní kurzy ČNB pro výpočet (R-06b): načte provider z DB a při prvním
 * použití doplní chybějící roky z oficiálního ČNB API (jednorázový backfill,
 * ~1 request na rok). Vrací undefined, když kurzy nejsou potřeba ani po ruce.
 */
export async function loadDailyRates(
  db: Db,
  txs: Transaction[],
  currentYear: number,
): Promise<EngineInput['dailyRates']> {
  const { ensureCnbYears, loadCnbRateProvider } = await import('@/lib/cnb');
  const years = availableYears(txs, currentYear);
  // rok−1 kvůli transakcím z 1.–2. ledna: fallback bere poslední vyhlášený
  // kurz PŘEDCHOZÍHO roku (Silvestr)
  const fromYear = Math.min(...years) - 1;
  try {
    await ensureCnbYears(db, [fromYear, ...years]);
  } catch {
    // offline/backfill selhal — zkusíme, co už v DB je; report stav přizná
  }
  const provider = await loadCnbRateProvider(db, fromYear, currentYear);
  return provider.isEmpty ? undefined : provider;
}

export interface YearAnalysis {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  transactionCount: number;
}

export function analyzeForUser(
  txs: Transaction[],
  profileRow: ProfileRow,
  year: number,
  atDate: string,
  dailyRates?: EngineInput['dailyRates'],
): YearAnalysis {
  const result = analyzeTaxYear(engineInputForUser(txs, profileRow, year, dailyRates));
  return {
    result,
    positions: positionsAt(result.ledger, atDate),
    labels: instrumentLabels(txs),
    transactionCount: txs.length,
  };
}

/** GBX (pence) engine převádí přes GBP (R-06) — kontrola pokrytí musí dělat totéž. */
const fxCode = (currency: string): string => (currency === 'GBX' ? 'GBP' : currency);

/**
 * Pokrývá jednotná tabulka kurzů (lib/tax-config) všechny měny a roky, které
 * výpočet potřebuje? Mimo pokrytí (exotická měna, rok před první tabulkou) by
 * engine bez denních kurzů spadl na EngineError FX_RATE_MISSING — a s ním celá
 * stránka. Kontroluje se každé datum, kterým engine převádí: obchodní i
 * vypořádací den (výdaj se přepočítává kurzem roku VYPOŘÁDÁNÍ nákupu — R-06a),
 * u převodů datum původního nabytí.
 */
export function unifiedRatesCover(txs: Transaction[]): boolean {
  const covered = (currency: string, date: string): boolean => {
    const code = fxCode(currency);
    if (code === 'CZK') return true;
    return UNIFIED_RATES[Number(date.slice(0, 4))]?.[code] !== undefined;
  };
  for (const tx of txs) {
    switch (tx.type) {
      case 'BUY':
      case 'SELL': {
        // bez explicitního vypořádání ho engine dopočítává (T+1/T+2) — přes
        // přelom roku může spadnout do dalšího roku; +7 dní je bezpečný strop
        const dates = [tx.tradeDate, tx.settlementDate ?? addDays(tx.tradeDate, 7)];
        if (!dates.every((day) => covered(tx.currency, day))) return false;
        const fee = tx.fee;
        if (fee && !dates.every((day) => covered(fee.currency, day))) return false;
        break;
      }
      case 'DIVIDEND':
      case 'INTEREST':
      case 'FEE':
      case 'DEPOSIT':
      case 'WITHDRAWAL':
        if (!covered(tx.currency, tx.date)) return false;
        break;
      case 'FX_CONVERSION':
        if (!covered(tx.fromCurrency, tx.date) || !covered(tx.toCurrency, tx.date)) return false;
        break;
      case 'TRANSFER_IN':
        if (tx.acquisition?.currency && !covered(tx.acquisition.currency, tx.acquisition.date)) {
          return false;
        }
        break;
      default:
        break;
    }
  }
  return true;
}

/**
 * Denní kurzy jen když je uživatel ZVOLIL (fxMethod CNB_DAILY) — jinak by
 * každé načtení stránky platilo backfill. Report si je bere vždy (srovnání).
 * Výjimka pro UNIFIED: transakce mimo pokrytí jednotné tabulky (měna/rok bez
 * kurzu) by engine bez denního fallbacku shodila — denní kurzy se načtou
 * a engine je použije s warningem FX_UNIFIED_RATE_MISSING místo pádu.
 */
export async function dailyRatesForProfile(
  db: Db,
  txs: Transaction[],
  profileRow: ProfileRow,
  currentYear: number,
): Promise<EngineInput['dailyRates']> {
  if (profileRow.fxMethod !== 'CNB_DAILY' && unifiedRatesCover(txs)) return undefined;
  return loadDailyRates(db, txs, currentYear);
}
