import { and, count, desc, eq, getTableColumns, gt, gte, lte, max, min, or, sql } from 'drizzle-orm';
import type { Tone } from '@/components/ui/status';
import type { Db } from '@/db';
import { importBatches, transactions } from '@/db/schema';
import { isSyncBatchFilename, type BrokerAccountRow } from '@/lib/broker-sync';
import { platformName } from '@/lib/brokers-catalog';
import { czDate, plural } from '@/lib/format';
import { HISTORY_PARAM } from '@/lib/import-feedback';
import { firstParam } from '@/lib/utils';

/**
 * Historie importů seskupená podle platforem (stránka /import).
 *
 * Plochý seznam dávek od nejnovější zapadal denními synchronizacemi: napojený
 * Trading 212 zapíše dávku každý den („0 nových · 40 duplicit“) a ruční výpis
 * jiné platformy se pod nimi ztratil. Historie proto ukazuje řádek na
 * platformu — odkud data jsou, jak jsou čerstvá a jaké období pokrývají —
 * a dávky až po rozbalení.
 *
 * Starý import přitom musí jít pořád dohledat a vrátit zpět (záznam o dávce je
 * jediná cesta, jak její transakce smazat — viz `HISTORY_LOOKBACK`), takže
 * každá platforma má vlastní „Zobrazit starší“ bez stropu a souhrny se
 * počítají v SQL přes VŠECHNY dávky a transakce uživatele.
 *
 * Čisté funkce (seskupení, řazení, stav, parametry adresy) a loadery nad
 * databází; komponenta jen vykresluje.
 */

export type ImportBatchRow = typeof importBatches.$inferSelect;

/**
 * Kód, kterým `lib/import-service.ts` označí dávku ze souboru, jehož formát
 * nepoznal. Takové dávky mají vlastní skupinu na konci historie.
 */
export const UNKNOWN_FORMAT_BROKER = 'neznámý formát';

/** Klíč skupiny nepoznaných souborů v adrese a v kotvě (kód dávky má mezeru a diakritiku). */
const UNKNOWN_GROUP_KEY = 'nepoznane';

export const UNKNOWN_GROUP_NAME = 'Nepoznané soubory';

/** Parametr adresy s platformou, jejíž starší importy se mají ukázat (vidí ho uživatel). */
export const PLATFORM_PARAM = 'platforma';

/** Kolik nejnovějších dávek ukazuje každá platforma, než uživatel řekne o starší. */
export const PLATFORM_PAGE = 10;

/** Od téhle délky se „Zobrazit starší“ posouvá po stovce, ne po deseti. */
const PLATFORM_LONG_STEP = 100;

/**
 * Tvar klíče platformy z adresy. Kódy parserů jsou malá písmena a číslice;
 * cokoli jiného se zahodí dřív, než se na to stránka podívá.
 */
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Klíč skupiny v adrese a v kotvě `#platforma-<klíč>`. */
export const platformKey = (broker: string): string =>
  broker === UNKNOWN_FORMAT_BROKER ? UNKNOWN_GROUP_KEY : broker;

const brokerForKey = (key: string): string =>
  key === UNKNOWN_GROUP_KEY ? UNKNOWN_FORMAT_BROKER : key;

/** Kotva řádku platformy (`<details>` skupiny). */
export const platformAnchor = (key: string): string => `platforma-${key}`;

type Params = Record<string, string | string[] | undefined>;

/** Která platforma chce víc dávek a kolik (odkaz „Zobrazit starší“). */
export interface PlatformRequest {
  key: string;
  broker: string;
  limit: number;
}

/**
 * Platforma a délka jejího seznamu z adresy (`?platforma=xtb&historie=20`).
 * Adresu může kdokoli poslat odkazem: klíč musí mít tvar kódu parseru a délka
 * být celé číslo. Jestli taková platforma u uživatele vůbec je, rozhodne až
 * `buildPlatformGroups` — cizí klíč tak nic neotevře ani nevypíše.
 */
export function platformRequest(params: Params): PlatformRequest | null {
  const key = firstParam(params[PLATFORM_PARAM]);
  if (key === undefined || !KEY_PATTERN.test(key)) return null;
  const raw = firstParam(params[HISTORY_PARAM]);
  const limit =
    raw !== undefined && /^\d{1,7}$/.test(raw)
      ? Math.max(Number(raw), PLATFORM_PAGE)
      : PLATFORM_PAGE;
  return { key, broker: brokerForKey(key), limit };
}

/** Délka, na kterou vede „Zobrazit starší“: po deseti do stovky, pak po stovce. */
export const nextPlatformLimit = (limit: number): number =>
  limit < PLATFORM_LONG_STEP ? limit + PLATFORM_PAGE : limit + PLATFORM_LONG_STEP;

/**
 * Odkaz na delší seznam jedné platformy. Kotva na stránce schválně není:
 * neexistující kotva nechá polohu být a seznam se jen prodlouží (skok na
 * záhlaví skupiny by uživatele odnesl od řádku, u kterého klepl). Skupinu
 * po načtení otevře parametr `platforma`.
 */
export const platformOlderHref = (key: string, limit: number): string =>
  `/import?${PLATFORM_PARAM}=${encodeURIComponent(key)}&${HISTORY_PARAM}=${nextPlatformLimit(limit)}#starsi-${key}`;

/** Souhrn platformy přes všechny její dávky a transakce. */
export interface PlatformStats {
  broker: string;
  batchCount: number;
  lastImportAt: Date;
  txCount: number;
  /** Nejstarší a nejnovější datum transakce (ISO), `null` bez transakcí. */
  firstTxDate: string | null;
  lastTxDate: string | null;
}

/**
 * Souhrny platforem uživatele: počet dávek a poslední import, z transakcí
 * období a počet. Transakce se počítají k platformě DÁVKY, která je uložila
 * (`transactions.batch_id`), ne podle `transactions.broker` — skupina tak sedí
 * s dávkami, které pod ní uživatel rozbalí (univerzální šablona má vlastní kód).
 */
export async function loadPlatformStats(db: Db, userId: string): Promise<PlatformStats[]> {
  const [batches, txs] = await Promise.all([
    db
      .select({
        broker: importBatches.broker,
        batchCount: count(),
        lastImportAt: max(importBatches.createdAt),
      })
      .from(importBatches)
      .where(eq(importBatches.userId, userId))
      .groupBy(importBatches.broker),
    db
      .select({
        broker: importBatches.broker,
        txCount: count(),
        firstTxDate: min(transactions.txDate),
        lastTxDate: max(transactions.txDate),
      })
      .from(transactions)
      .innerJoin(importBatches, eq(importBatches.id, transactions.batchId))
      // tenancy na obou stranách: dávka cizího uživatele se nesmí přimíchat ani omylem
      .where(and(eq(transactions.userId, userId), eq(importBatches.userId, userId)))
      .groupBy(importBatches.broker),
  ]);
  const byBroker = new Map(txs.map((row) => [row.broker, row]));
  return batches.map((row) => {
    const tx = byBroker.get(row.broker);
    return {
      broker: row.broker,
      batchCount: row.batchCount,
      // skupina vzniká jen z dávek, takže max(created_at) je vždy vyplněné
      lastImportAt: row.lastImportAt ?? new Date(0),
      txCount: tx?.txCount ?? 0,
      firstTxDate: tx?.firstTxDate ?? null,
      lastTxDate: tx?.lastTxDate ?? null,
    };
  });
}

/**
 * Dávky, které historie vypíše: nejnovějších `PLATFORM_PAGE` z každé platformy
 * a u platformy z adresy tolik, kolik si řekla. Jeden dotaz s pořadím dávky
 * v rámci platformy (`row_number`), takže platforma, jejíž poslední výpis je
 * starší než dvě stě denních synchronizací, nevypadne.
 */
export async function loadPlatformBatches(
  db: Db,
  userId: string,
  request: PlatformRequest | null,
): Promise<ImportBatchRow[]> {
  const ranked = db
    .select({
      id: importBatches.id,
      batchRank: sql<number>`row_number() over (partition by ${importBatches.broker} order by ${importBatches.createdAt} desc, ${importBatches.id} desc)`.as(
        'batch_rank',
      ),
    })
    .from(importBatches)
    .where(eq(importBatches.userId, userId))
    .as('ranked');
  const shown = request
    ? or(
        lte(ranked.batchRank, PLATFORM_PAGE),
        and(eq(importBatches.broker, request.broker), lte(ranked.batchRank, request.limit)),
      )
    : lte(ranked.batchRank, PLATFORM_PAGE);
  return db
    .select(getTableColumns(importBatches))
    .from(importBatches)
    .innerJoin(ranked, eq(ranked.id, importBatches.id))
    .where(and(eq(importBatches.userId, userId), shown))
    .orderBy(desc(importBatches.createdAt), desc(importBatches.id));
}

export type PlatformAccount = Pick<
  BrokerAccountRow,
  'broker' | 'lastSyncedAt' | 'lastSyncError' | 'createdAt'
>;

/** Stav platformy jednou větou; `when` je tiché datum za ní. */
export interface PlatformStatus {
  tone: Tone;
  text: string;
  /** „naposledy 10. 11. 2026“ — kdy naposledy přišla data. */
  when?: string;
}

const lastly = (date: Date): string => `naposledy ${czDate(date)}`;

/**
 * Stav platformy: napojená přes API, nebo ruční výpisy.
 *
 * Napojený účet má stav z `broker_accounts` — tóny i znění drží s kartou účtu
 * (`account-state.tsx`): selhání je tam červené, tak i tady, ať jedna věc
 * nemá na jedné stránce dvě barvy. Bez napojení rozhoduje poslední dávka:
 * když ji založila synchronizace, účet byl mezitím odpojený a „Ruční výpisy“
 * by nebyly pravda.
 */
export function platformStatus(
  account: PlatformAccount | undefined,
  latest: Pick<ImportBatchRow, 'filename' | 'createdAt'> | undefined,
): PlatformStatus | null {
  if (account) {
    if (account.lastSyncError) return { tone: 'danger', text: 'Poslední synchronizace selhala' };
    if (account.lastSyncedAt) {
      return {
        tone: 'success',
        text: 'Synchronizuje se automaticky',
        when: lastly(account.lastSyncedAt),
      };
    }
    // táž věta jako na kartě účtu
    return { tone: 'neutral', text: 'Připojeno, zbývá stáhnout historii' };
  }
  if (!latest) return null;
  return {
    tone: 'neutral',
    text: isSyncBatchFilename(latest.filename) ? 'Odpojeno' : 'Ruční výpisy',
    when: lastly(latest.createdAt),
  };
}

const transactionsWord = (n: number): string => plural(n, 'transakce', 'transakce', 'transakcí');

/** Období a počet transakcí platformy: „Transakce od 3. 1. 2024 do 7. 11. 2026 · 312 transakcí“. */
export function rangeText(
  stats: Pick<PlatformStats, 'txCount' | 'firstTxDate' | 'lastTxDate'>,
): string {
  if (stats.txCount === 0 || !stats.firstTxDate || !stats.lastTxDate) {
    return 'Zatím žádné transakce';
  }
  const tail = `${stats.txCount} ${transactionsWord(stats.txCount)}`;
  if (stats.firstTxDate === stats.lastTxDate) {
    return `Transakce z ${czDate(stats.firstTxDate)} · ${tail}`;
  }
  return `Transakce od ${czDate(stats.firstTxDate)} do ${czDate(stats.lastTxDate)} · ${tail}`;
}

/** Jeden řádek historie: platforma a její dávky. */
export interface PlatformGroup {
  key: string;
  broker: string;
  name: string;
  /** `null` u nepoznaných souborů — jejich stav nese sekce nepřečtených výpisů. */
  status: PlatformStatus | null;
  /** Období a počet transakcí (u nepoznaných souborů počet souborů). */
  summary: string;
  /** Vypisované dávky od nejnovější; prázdné u napojeného účtu bez dat. */
  batches: ImportBatchRow[];
  /** Odkaz „Zobrazit starší“; chybí, když už starší dávky nejsou. */
  olderHref?: string;
  /** Otevřít skupinu při načtení stránky. */
  open: boolean;
  /**
   * Právě nahrané dávky skupiny (id oddělená mezerou, jinak prázdné). Mění se
   * jen s novým nahráním — podle toho se otevře i skupina, která už na stránce
   * je a je zavřená (`defaultOpen` platí jen při prvním vykreslení).
   */
  openSignal: string;
}

const newestFirst = (a: ImportBatchRow, b: ImportBatchRow): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Seskupí dávky podle platformy a seřadí podle posledního importu, nejnovější
 * nahoře; nepoznané soubory jsou vždy poslední.
 *
 * Napojený účet bez jediné dávky má řádek taky: přehled říká, odkud data
 * chodí, a právě připojený broker by v něm jinak chyběl, jako by připojení
 * selhalo (stejně tak po vrácení všech jeho importů). Řadí se podle chvíle
 * připojení — to je jeho poslední událost.
 *
 * Skupina je otevřená, když obsahuje právě nahranou dávku, když je to
 * platforma z adresy (po „Zobrazit starší“), nebo když je jediná.
 */
export function buildPlatformGroups({
  stats,
  batches,
  accounts,
  request,
  highlighted,
}: {
  stats: readonly PlatformStats[];
  batches: readonly ImportBatchRow[];
  accounts: readonly PlatformAccount[];
  request: PlatformRequest | null;
  highlighted: ReadonlySet<string>;
}): PlatformGroup[] {
  const accountByBroker = new Map(accounts.map((account) => [account.broker, account]));
  const batchesByBroker = new Map<string, ImportBatchRow[]>();
  for (const batch of batches) {
    const list = batchesByBroker.get(batch.broker) ?? [];
    list.push(batch);
    batchesByBroker.set(batch.broker, list);
  }

  interface Draft {
    group: Omit<PlatformGroup, 'open'>;
    /** Poslední import (u účtu bez dávek chvíle připojení) — podle něj se řadí. */
    lastActivity: number;
    unknown: boolean;
  }
  const drafts: Draft[] = stats.map((item) => {
    const key = platformKey(item.broker);
    const unknown = item.broker === UNKNOWN_FORMAT_BROKER;
    const limit = request?.broker === item.broker ? request.limit : PLATFORM_PAGE;
    const shown = [...(batchesByBroker.get(item.broker) ?? [])].sort(newestFirst).slice(0, limit);
    return {
      group: {
        key,
        broker: item.broker,
        name: unknown ? UNKNOWN_GROUP_NAME : platformName(item.broker),
        status: unknown ? null : platformStatus(accountByBroker.get(item.broker), shown[0]),
        summary: unknown
          ? `${item.batchCount} ${plural(item.batchCount, 'soubor', 'soubory', 'souborů')}`
          : rangeText(item),
        batches: shown,
        ...(item.batchCount > shown.length && KEY_PATTERN.test(key)
          ? { olderHref: platformOlderHref(key, limit) }
          : {}),
        openSignal: shown
          .filter((batch) => highlighted.has(batch.id))
          .map((batch) => batch.id)
          .join(' '),
      },
      lastActivity: item.lastImportAt.getTime(),
      unknown,
    };
  });
  const withBatches = new Set(stats.map((item) => item.broker));
  for (const account of accounts) {
    if (withBatches.has(account.broker)) continue;
    drafts.push({
      group: {
        key: platformKey(account.broker),
        broker: account.broker,
        name: platformName(account.broker),
        status: platformStatus(account, undefined),
        summary: rangeText({ txCount: 0, firstTxDate: null, lastTxDate: null }),
        batches: [],
        openSignal: '',
      },
      lastActivity: account.createdAt.getTime(),
      unknown: false,
    });
  }

  drafts.sort(
    (a, b) =>
      Number(a.unknown) - Number(b.unknown) ||
      b.lastActivity - a.lastActivity ||
      a.group.name.localeCompare(b.group.name, 'cs'),
  );
  return drafts.map(({ group }) => ({
    ...group,
    open:
      group.batches.length > 0 &&
      (drafts.length === 1 || request?.key === group.key || group.openSignal !== ''),
  }));
}

/**
 * Odkaz na řádek dávky v historii (`#import-<id>`). Dávka, kterou historie
 * právě nevypisuje (leží za prvními `PLATFORM_PAGE` své platformy — u denní
 * synchronizace stačí jedenáctá), dostane adresu, která její platformu
 * prodlouží právě po ni; `OpenOnHash` pak otevře skupinu i řádek. Hláška
 * číselníku („nejdřív vrať zpět import…“) tak vede vždy na tlačítko, ne na
 * holý název souboru. `null`, když dávka neexistuje (nebo je cizí).
 */
export async function batchHistoryHref(
  db: Db,
  userId: string,
  batchId: string,
  shown: ReadonlySet<string>,
): Promise<string | null> {
  if (shown.has(batchId)) return `#import-${batchId}`;
  const [batch] = await db
    .select({ broker: importBatches.broker, createdAt: importBatches.createdAt })
    .from(importBatches)
    .where(and(eq(importBatches.userId, userId), eq(importBatches.id, batchId)));
  if (!batch) return null;
  // pořadí dávky v platformě od nejnovější — stejné jako `row_number` v `loadPlatformBatches`
  const [rank] = await db
    .select({ value: count() })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.userId, userId),
        eq(importBatches.broker, batch.broker),
        or(
          gt(importBatches.createdAt, batch.createdAt),
          and(eq(importBatches.createdAt, batch.createdAt), gte(importBatches.id, batchId)),
        ),
      ),
    );
  const key = platformKey(batch.broker);
  if (!KEY_PATTERN.test(key)) return null;
  const limit = Math.max(rank?.value ?? PLATFORM_PAGE, PLATFORM_PAGE);
  return `/import?${PLATFORM_PARAM}=${encodeURIComponent(key)}&${HISTORY_PARAM}=${limit}#import-${batchId}`;
}
