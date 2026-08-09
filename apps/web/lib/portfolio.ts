import { and, asc, desc, eq } from 'drizzle-orm';
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
import { taxpayerProfiles, taxYearSettings, transactions } from '@/db/schema';
import { errorText, logEvent } from '@/lib/log';
import { configForYear, UNIFIED_RATES } from './tax-config';

/**
 * Volby, které se fixují za daňový rok: mění už spočítaná (a klidně podaná)
 * čísla zpětně, takže je uzavřený rok musí držet. Párování žádá konzistenci
 * podle R-05c, kurzová soustava podle R-06 („jednu soustavu pro celé
 * zdaňovací období"), výklad limitu 100k je sporný přepínač R-02c.
 */
export type PinnedTaxYearOptions = Pick<
  EngineOptions,
  'matchingMethod' | 'fxMethod' | 'limit100kIncludesTimeTestExempt'
>;

/** Daňový rok → konfigurace, se kterou se ten rok zafixoval. */
export type PinnedTaxYears = Record<number, PinnedTaxYearOptions>;

export type ProfileRow = typeof taxpayerProfiles.$inferSelect & {
  /**
   * Roky, za které si uživatel vygeneroval podklady, si drží konfiguraci,
   * se kterou se počítaly (R-05c). Plní je `getProfile`, aby přehled,
   * portfolio, simulátor i report vycházely ze stejné konfigurace.
   */
  pinnedTaxYears?: PinnedTaxYears;
};

export async function getProfile(db: Db, userId: string): Promise<ProfileRow | null> {
  const rows = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  const row = rows[0];
  if (!row) return null;
  return { ...row, pinnedTaxYears: await loadPinnedTaxYears(db, userId) };
}

export type PinnedTaxYearRow = typeof taxYearSettings.$inferSelect;

/** Zafixované roky od nejnovějšího — pro výpis v nastavení i pro `getProfile`. */
export async function listPinnedTaxYears(db: Db, userId: string): Promise<PinnedTaxYearRow[]> {
  return db
    .select()
    .from(taxYearSettings)
    .where(eq(taxYearSettings.userId, userId))
    .orderBy(desc(taxYearSettings.taxYear));
}

/** Řádek fixace → volby enginu (názvy sloupců se od klíčů enginu liší). */
const pinnedRowToOptions = (row: PinnedTaxYearRow): PinnedTaxYearOptions => ({
  matchingMethod: row.matchingMethod as EngineOptions['matchingMethod'],
  fxMethod: row.fxMethod as EngineOptions['fxMethod'],
  limit100kIncludesTimeTestExempt: row.limit100kStrict,
});

export async function loadPinnedTaxYears(db: Db, userId: string): Promise<PinnedTaxYears> {
  const rows = await listPinnedTaxYears(db, userId);
  return Object.fromEntries(rows.map((row) => [row.taxYear, pinnedRowToOptions(row)]));
}

/** Tytéž volby, jak je má uživatel právě teď nastavené v profilu. */
const profileTaxYearOptions = (profileRow: ProfileRow): PinnedTaxYearOptions => ({
  matchingMethod: profileRow.matchingMethod as EngineOptions['matchingMethod'],
  fxMethod: profileRow.fxMethod as EngineOptions['fxMethod'],
  limit100kIncludesTimeTestExempt: profileRow.limit100kStrict,
});

/**
 * Konfigurace platná pro daný rok: zafixovaná, pokud existuje, jinak aktuální
 * z profilu. Jediné místo, kde se to rozhoduje — díky tomu ukazuje přehled,
 * portfolio, simulátor, report, XML pro EPO i notifikační cron stejná čísla.
 * Fixace je vždy celá (všechny sloupce jsou NOT NULL), takže se hodnoty
 * z profilu a z fixace nikdy nemíchají.
 */
export function taxYearOptions(profileRow: ProfileRow, year: number): PinnedTaxYearOptions {
  return profileRow.pinnedTaxYears?.[year] ?? profileTaxYearOptions(profileRow);
}

/**
 * Rok se fixuje, teprve když může sloužit pro přiznání — tedy až po jeho konci.
 * Za běžící rok se přiznání podat nedá, takže si uživatel může metodu dál
 * volně měnit a report za letošek ho nezamkne.
 */
export function isPinnableTaxYear(year: number, currentYear: number): boolean {
  return year < currentYear;
}

/** UTC, konzistentně se zbytkem aplikace (`today`). */
const utcYear = (): number => Number(new Date().toISOString().slice(0, 4));

/**
 * R-05c: zafixuje konfiguraci roku, za který si uživatel právě generuje
 * podklady k přiznání, a vrátí profil s touto fixací. Idempotentní — jednou
 * zapsané hodnoty nikdy nepřepisuje. Fixace sama čísla nemění (fixuje se
 * právě ta konfigurace, kterou výpočet v tu chvíli používá), takže cache
 * výsledků v lib/engine-cache zůstává platná.
 */
export async function pinTaxYear(
  db: Db,
  profileRow: ProfileRow,
  year: number,
  currentYear: number = utcYear(),
): Promise<ProfileRow> {
  if (!isPinnableTaxYear(year, currentYear)) return profileRow;
  if (profileRow.pinnedTaxYears?.[year]) return profileRow;
  const options = taxYearOptions(profileRow, year);
  const inserted = await db
    .insert(taxYearSettings)
    .values({
      userId: profileRow.userId,
      taxYear: year,
      matchingMethod: options.matchingMethod,
      fxMethod: options.fxMethod,
      limit100kStrict: options.limit100kIncludesTimeTestExempt,
    })
    // souběžné generování podkladů (dvě záložky) nesmí spadnout ani přepsat
    .onConflictDoNothing()
    .returning({ taxYear: taxYearSettings.taxYear });
  if (inserted.length === 0) {
    // konflikt: fixaci mezitím zapsal jiný požadavek — platí ta jeho, ať
    // report ukazuje čísla spočítaná tím, co je opravdu v databázi
    return { ...profileRow, pinnedTaxYears: await loadPinnedTaxYears(db, profileRow.userId) };
  }
  return { ...profileRow, pinnedTaxYears: { ...profileRow.pinnedTaxYears, [year]: options } };
}

/**
 * Zrušení fixace (dodatečné přiznání) — rok se zase počítá podle profilu.
 * Posune `updatedAt` profilu: otisk v lib/engine-cache stojí na něm a bez
 * posunu by přehled dál servíroval čísla spočítaná zafixovanou konfigurací.
 */
export async function unpinTaxYear(db: Db, userId: string, year: number): Promise<void> {
  await db
    .delete(taxYearSettings)
    .where(and(eq(taxYearSettings.userId, userId), eq(taxYearSettings.taxYear, year)));
  await db
    .update(taxpayerProfiles)
    .set({ updatedAt: new Date() })
    .where(eq(taxpayerProfiles.userId, userId));
}

/**
 * Převod DB řádku profilu na vstup enginu (profil + přepínače z docs/02).
 * Fixovatelné volby (párování, kurzy, výklad limitu 100k) přebíjí
 * `engineInputForUser` podle roku — tudy chodí vždycky hodnoty z profilu.
 */
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
    // Řadit JEN podle data nestačí. Engine si události téhož dne se stejnou
    // prioritou (dva prodeje; prodej vs. TRANSFER_OUT) rozhodne podle pořadí
    // ve vstupním poli — a to pořadí sem dodává databáze. Bez druhého klíče
    // ho Postgres nezaručuje vůbec: shodné `tx_date` vrátí v pořadí, které
    // dá zrovna zvolený plán (index scan, bitmap, paralelní seq scan) a které
    // se mění po UPDATE i po VACUUM. Táž sada transakcí tak mohla vyjít pokaždé
    // jinak — na náhodných portfoliích rozdíl daně 0 vs. 148 875 Kč podle toho,
    // který ze dvou prodejů téhož dne se spároval s lotem, co splnil časový
    // test (nález A1-3-01). To porušuje jak invariant „výpočet je čistá funkce
    // a jde reprodukovat od nuly“, tak podmínku průkaznosti a konzistence
    // z R-05c.
    //
    // `created_at` drží pořadí importu, tedy pořadí z výpisu brokera — to je
    // nejvěrnější dostupná chronologie uvnitř dne (čas obchodu model nenese).
    // Celá dávka se vkládá jedním příkazem, takže má `created_at` shodné;
    // zbytek remíz proto láme `dedupe_key`, který je v rámci uživatele unikátní
    // (je součástí primárního klíče), takže výsledné pořadí je vždy jednoznačné.
    .orderBy(asc(transactions.txDate), asc(transactions.createdAt), asc(transactions.dedupeKey));
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
  return {
    transactions: txs,
    profile,
    // R-05c: rok, za který už uživatel generoval podklady, se počítá svou
    // zafixovanou konfigurací — pozdější změna v profilu ho zpětně nepřepíše
    options: { ...options, ...taxYearOptions(profileRow, year) },
    config: configForYear(year),
    dailyRates,
  };
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
  const toYear = Math.max(...years, currentYear);
  // SOUVISLÝ rozsah, ne jen roky s transakcemi. `availableYears` vrací množinu,
  // takže portfolio s obchody v 2023, 2024 a 2026 nikdy nestáhlo rok 2025 —
  // a přesto se z něj počítalo (F-3-2).
  const needed = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);

  try {
    await ensureCnbYears(db, needed);
  } catch (error) {
    // Dřív tu byl `catch {}` — výpadek ČNB, timeout i 404 vypadaly
    // v monitoringu úplně stejně jako úspěch (F-3-10).
    logEvent('error', 'cnb.backfill_failed', {
      fromYear,
      toYear,
      error: errorText(error),
    });
  }

  const provider = await loadCnbRateProvider(db, fromYear, toYear);
  if (provider.isEmpty) return undefined;

  // Bez pokrytí VŠECH potřebných let se denní varianta nesmí nabídnout.
  // Poloprázdná tabulka totiž nedá chybu: `getRate` se u chybějícího roku
  // vrátí prázdný, engine spadne na jednotný kurz — a v jednom zdaňovacím
  // období se tak namíchají obě soustavy, což § 38 odst. 1 zakazuje (R-06).
  // Na doloženém případu to byl rozdíl 2 340 Kč vyrobený z kurzů, které
  // v databázi vůbec nejsou. `isEmpty` se ptá na CELOU tabulku, takže díru
  // uprostřed rozsahu nepoznalo (F-3-2).
  if (provider.missingYears?.length) {
    logEvent('warn', 'cnb.years_missing', { missing: provider.missingYears.join(',') });
    return undefined;
  }
  return provider;
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
 * Potřebuje uživatel denní kurzy ČNB? Nestačí se ptát profilu: rok zafixovaný
 * na denní kurzy je počítá i po pozdějším přepnutí profilu na jednotný kurz —
 * a bez provideru by mu engine potichu dosadil jednotný kurz (FxConverter má
 * fallback s warningem), tedy jiná čísla, než jaká uživatel podal.
 */
const needsDailyRates = (profileRow: ProfileRow): boolean =>
  profileRow.fxMethod === 'CNB_DAILY' ||
  Object.values(profileRow.pinnedTaxYears ?? {}).some((o) => o.fxMethod === 'CNB_DAILY');

/**
 * Denní kurzy jen když je uživatel ZVOLIL (fxMethod CNB_DAILY, ať v profilu
 * nebo v zafixovaném roce) — jinak by každé načtení stránky platilo backfill.
 * Report si je bere vždy (srovnání). Výjimka pro UNIFIED: transakce mimo
 * pokrytí jednotné tabulky (měna/rok bez kurzu) by engine bez denního
 * fallbacku shodila — denní kurzy se načtou a engine je použije s warningem
 * FX_UNIFIED_RATE_MISSING místo pádu.
 */
export async function dailyRatesForProfile(
  db: Db,
  txs: Transaction[],
  profileRow: ProfileRow,
  currentYear: number,
): Promise<EngineInput['dailyRates']> {
  if (!needsDailyRates(profileRow) && unifiedRatesCover(txs)) return undefined;
  return loadDailyRates(db, txs, currentYear);
}
