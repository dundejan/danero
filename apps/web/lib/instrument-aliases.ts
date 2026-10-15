import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { builtinInstrument, usTickerFor } from '@danero/importers/isin-directory';
import { isValidIsin } from '@danero/shared';
import type { IsinInstrumentMap, XtbInstrumentMap } from '@danero/importers';
import type { Db } from '@/db';
import { importBatches, instrumentAliases, transactions } from '@/db/schema';

/**
 * Číselník instrumentů pro brokery, jejichž export neuvádí ISIN (a u XTB ani
 * měnu instrumentu). Plní ho uživatel formulářem při importu; další importy
 * ho použijí samy.
 */

/** Brokeři s mapou symbol → ISIN (měnu mají ve výpisu, resp. vždy USD). */
export const ISIN_ONLY_BROKERS = ['fio', 'etoro', 'revolut', 'schwab', 'tastytrade'] as const;
export type IsinOnlyBroker = (typeof ISIN_ONLY_BROKERS)[number];

export type IsinMap = IsinInstrumentMap;

export interface AliasMaps {
  xtb: XtbInstrumentMap;
  isinOnly: Record<IsinOnlyBroker, IsinMap>;
}

export const isIsinOnlyBroker = (broker: string): broker is IsinOnlyBroker =>
  (ISIN_ONLY_BROKERS as readonly string[]).includes(broker);

export async function loadAliases(db: Db, userId: string): Promise<AliasMaps> {
  const rows = await db
    .select()
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, userId));
  // prázdné mapy odvozené ze seznamu — ruční literál by se při přidání
  // brokera rozjel a spadl až v produkci na undefined[symbol]
  const maps: AliasMaps = {
    xtb: {},
    isinOnly: Object.fromEntries(ISIN_ONLY_BROKERS.map((broker) => [broker, {}])) as Record<
      IsinOnlyBroker,
      IsinMap
    >,
  };
  for (const row of rows) {
    if (row.broker === 'xtb') {
      // alias bez měny se dřív TIŠE zahodil — přitom dividendám XTB stačí ISIN
      // (jsou v měně účtu); měna chybí jen obchodům, ty si o ni řeknou samy
      maps.xtb[row.symbol] = {
        isin: row.isin,
        ...(row.currency ? { currency: row.currency } : {}),
      };
    } else if (isIsinOnlyBroker(row.broker)) {
      maps.isinOnly[row.broker][row.symbol] = { isin: row.isin };
    }
  }
  return maps;
}

/**
 * Má uživatel k symbolu záznam, se kterým import obchod uloží? Obchodům XTB
 * nestačí ISIN, potřebují i měnu. Vlastní klíče objektu jen přes `hasOwn` —
 * symbol pochází z výpisu.
 */
export const aliasCovers =
  (aliases: AliasMaps) =>
  (broker: string, symbol: string): boolean =>
    broker === 'xtb'
      ? Object.hasOwn(aliases.xtb, symbol) && aliases.xtb[symbol]!.currency !== undefined
      : isIsinOnlyBroker(broker) && Object.hasOwn(aliases.isinOnly[broker], symbol);

/** ISIN, který k symbolu vede uživatelův číselník (bez ohledu na měnu u XTB). */
export function aliasIsin(aliases: AliasMaps, broker: string, symbol: string): string | undefined {
  if (broker === 'xtb') {
    return Object.hasOwn(aliases.xtb, symbol) ? aliases.xtb[symbol]!.isin : undefined;
  }
  if (!isIsinOnlyBroker(broker)) return undefined;
  const map = aliases.isinOnly[broker];
  return Object.hasOwn(map, symbol) ? map[symbol]!.isin : undefined;
}

/** Odkud by import údaj doplnil sám — pro popisek v seznamu a hlášku po smazání. */
export type AliasOrigin = { source: 'builtin' } | { source: 'own'; broker: string };

/**
 * Je uložený záznam ten, který by import doplnil sám? Porovná se ISIN
 * záznamu s tím, co by dnes doplnil (vlastní obchody > vestavěný číselník).
 * U Revolutu a Fia se počítá s obchody v USD — jen ty se doplňují.
 */
export function originOf(
  own: OwnTickerIsins,
  record: { broker: string; symbol: string; isin: string },
): AliasOrigin | null {
  const automatic = automaticInstrument(own, record.broker, record.symbol);
  if (!automatic || automatic.isin !== record.isin) return null;
  return automatic.source === 'own'
    ? { source: 'own', broker: automatic.sourceBroker ?? '' }
    : { source: 'builtin' };
}

/**
 * Co import k symbolu doplní sám, až záznam smazaný uživatelem chybí —
 * i když ho uživatel předtím změnil na jiný ISIN (revize N4). `differs`
 * říká, že se vrátí JINÝ ISIN, než jaký záznam teď má.
 */
export async function returningAfterDelete(
  db: Db,
  userId: string,
  broker: string,
  symbol: string,
): Promise<{ isin: string; differs: boolean } | null> {
  const record = await findAlias(db, userId, broker, symbol);
  if (!record) return null;
  const automatic = automaticInstrument(await ownTickerIsins(db, userId), broker, symbol);
  return automatic ? { isin: automatic.isin, differs: automatic.isin !== record.isin } : null;
}

/**
 * Dotaz pro historii importů: leží pod ISIN ze záznamu transakce brokera
 * v daných dávkách? (`StoredUnderAlias` v lib/import-resolved.) Jeden dotaz
 * na kombinace dávka × broker × ISIN × typ.
 */
export async function storedUnderAliases(
  db: Db,
  userId: string,
  aliases: AliasMaps,
): Promise<
  (broker: string, symbol: string, kind: 'trade' | 'dividend', batchIds: readonly string[]) => boolean
> {
  const rows = await db
    .selectDistinct({
      batchId: transactions.batchId,
      broker: transactions.broker,
      isin: transactions.isin,
      type: transactions.type,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNotNull(transactions.isin)));
  const kindOf = (type: string): string => (type === 'DIVIDEND' ? 'dividend' : 'trade');
  const present = new Set(
    rows.map((row) => `${row.batchId}|${row.broker}|${row.isin}|${kindOf(row.type)}`),
  );
  return (broker, symbol, kind, batchIds) => {
    const isin = aliasIsin(aliases, broker, symbol);
    return (
      isin !== undefined &&
      batchIds.some((batchId) => present.has(`${batchId}|${broker}|${isin}|${kind}`))
    );
  };
}

export interface AliasInput {
  broker: string;
  symbol: string;
  isin: string;
  currency?: string;
}

/**
 * Řádky, které by přepsaly ISIN nebo měnu u symbolu, pod jehož dosavadním ISIN
 * už má uživatel u téhož brokera uložené transakce (L23-02).
 *
 * ISIN je součást dedupe klíče i identity pozice. Po přepisu by další nahrání
 * téhož výpisu uložilo obchody i dividendy podruhé — pod novým ISIN je
 * aplikace jako tytéž nepozná. Uložené řádky se schválně nepřepisují
 * (transakce jsou zdroj pravdy); správná cesta je vrátit import, opravit ISIN
 * a nahrát výpis znovu. Bez uložených transakcí není co zdvojit a přepis projde.
 */
export async function aliasesBlockedByTransactions(
  db: Db,
  userId: string,
  rows: AliasInput[],
): Promise<AliasInput[]> {
  const blocked: AliasInput[] = [];
  for (const row of rows) {
    const [existing] = await db
      .select({ isin: instrumentAliases.isin, currency: instrumentAliases.currency })
      .from(instrumentAliases)
      .where(
        and(
          eq(instrumentAliases.userId, userId),
          eq(instrumentAliases.broker, row.broker),
          eq(instrumentAliases.symbol, row.symbol),
        ),
      );
    // měna z číselníku jde u XTB do obchodu a tím do dedupe otisku stejně jako
    // ISIN — její přepis by výpis zdvojil úplně stejně
    const sameCurrency = (existing?.currency ?? null) === (row.currency ?? null);
    if (!existing || (existing.isin === row.isin && sameCurrency)) continue;
    const [used] = await db
      .select({ key: transactions.dedupeKey })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.broker, row.broker),
          eq(transactions.isin, existing.isin),
        ),
      )
      .limit(1);
    if (used) blocked.push(row);
  }
  return blocked;
}

/** Symbol, kterému import doplnil ISIN (nebo u XTB měnu) sám. */
export interface FilledInstrument {
  broker: string;
  symbol: string;
  isin: string;
  /** Název z vestavěného číselníku (Wikidata) — jen pro hlášku; u vlastních dat prázdný. */
  name: string;
  currency?: string;
  /**
   * Odkud údaj je: `own` = z uživatelových obchodů u brokera, který ISIN
   * uvádí (`ownTickerIsins`), `builtin` = vestavěný číselník.
   */
  source: 'own' | 'builtin';
  /** U `own`: broker, podle jehož obchodů se ISIN doplnil. */
  sourceBroker?: string;
  /** XTB: ISIN zadal uživatel, import doplnil jen měnu. */
  currencyOnly?: true;
}

/**
 * Brokeři, jejichž výpis nese ISIN i ticker v americkém tvaru (`AAPL`,
 * `GOOG`): Trading 212 (sloupce ISIN a Ticker) a Interactive Brokers (isin
 * a symbol). Ostatní buď ticker nemají (Degiro), nebo ho píšou jinak (Saxo
 * `AAPL:xnas`), nebo ISIN samy berou z číselníku.
 */
export const OWN_DATA_BROKERS = ['trading212', 'ibkr'] as const;

/** Ticker → ISIN z uživatelových obchodů (viz `ownTickerIsins`). */
export type OwnTickerIsins = Map<string, { isin: string; broker: string }>;

/**
 * ISIN, který k tickeru vede v uživatelových VLASTNÍCH datech: transakce
 * u brokera, který ISIN uvádí (`OWN_DATA_BROKERS`), v USD a s americkým
 * ISIN — tedy americká kotace, stejně jako u vestavěného číselníku. Je to
 * přesně ten ISIN, se kterým se má pozice spojit, a pokryje i americká ETF
 * (VOO, SPY, QQQ) a třídy akcií (GOOG/GOOGL), které vestavěný číselník
 * nezná. Ticker, který vede na víc ISIN, se nebere.
 */
export async function ownTickerIsins(db: Db, userId: string): Promise<OwnTickerIsins> {
  const ticker = sql<string | null>`${transactions.payload}->>'ticker'`;
  const currency = sql<string | null>`${transactions.payload}->>'currency'`;
  const rows = await db
    .selectDistinct({ broker: transactions.broker, isin: transactions.isin, ticker, currency })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.broker, [...OWN_DATA_BROKERS]),
        isNotNull(transactions.isin),
      ),
    );
  const found = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.ticker || !row.isin || row.currency !== 'USD' || !isValidIsin(row.isin)) continue;
    const isins = found.get(row.ticker) ?? new Map<string, string>();
    if (!isins.has(row.isin)) isins.set(row.isin, row.broker);
    found.set(row.ticker, isins);
  }
  const result: OwnTickerIsins = new Map();
  for (const [symbol, isins] of found) {
    if (isins.size !== 1) continue;
    const [entry] = [...isins];
    // USD není americká kotace: na LSE se v USD obchodují UCITS ETF pod
    // stejnými tickery jako americké fondy (VanEck SMH, GDX, MOAT; ISIN IE…).
    // Bere se jen americký ISIN — a jen když ticker u uživatele nevede
    // i na jiný ISIN (revize N1).
    if (!entry![0].startsWith('US')) continue;
    result.set(symbol, { isin: entry![0], broker: entry![1] });
  }
  return result;
}

/**
 * Odkud by import údaj k symbolu doplnil sám (vlastní data > vestavěný
 * číselník; když se oba zdroje rozcházejí, nic). U Revolutu a Fia se počítá
 * s obchody v USD — jen ty se doplňují.
 */
export function automaticInstrument(
  own: OwnTickerIsins,
  broker: string,
  symbol: string,
  currencies: readonly string[] = ['USD'],
): FilledInstrument | undefined {
  const us = usTickerFor(broker, symbol, currencies);
  if (!us) return undefined;
  const mine = own.get(us.ticker);
  const builtin = builtinInstrument(broker, symbol, currencies);
  // Dva zdroje, dvě odpovědi: nedoplnit nic a zeptat se (revize N1).
  if (mine && builtin && mine.isin !== builtin.isin) return undefined;
  if (mine) {
    return {
      broker,
      symbol,
      isin: mine.isin,
      name: '',
      ...(us.currency ? { currency: us.currency } : {}),
      source: 'own',
      sourceBroker: mine.broker,
    };
  }
  return builtin ? { broker, ...builtin, source: 'builtin' } : undefined;
}

/**
 * Uloží dvojice z vestavěného číselníku do uživatelova. Nikdy nepřepíše
 * ISIN, který už uživatel má (jeho údaj má přednost a podle L23-02 by
 * přepis mohl zdvojit uložené transakce) — proto `onConflictDoNothing`;
 * jediná výjimka je chybějící měna u XTB při shodném ISIN.
 */
export async function saveBuiltinAliases(
  db: Db,
  userId: string,
  rows: FilledInstrument[],
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(instrumentAliases)
    .values(
      rows.map((row) => ({
        userId,
        broker: row.broker,
        symbol: row.symbol,
        isin: row.isin,
        currency: row.currency ?? null,
      })),
    )
    .onConflictDoNothing();
  // XTB: záznam se shodným ISIN, jen bez měny (dividendám ISIN stačí, obchody
  // čekají na měnu), dostane měnu z vestavěného číselníku. ISIN se nemění
  // a obchod bez měny se nikdy neuložil, takže tu není co zdvojit (L23-02).
  for (const row of rows) {
    if (row.broker !== 'xtb' || !row.currency) continue;
    await db
      .update(instrumentAliases)
      .set({ currency: row.currency })
      .where(
        and(
          eq(instrumentAliases.userId, userId),
          eq(instrumentAliases.broker, 'xtb'),
          eq(instrumentAliases.symbol, row.symbol),
          eq(instrumentAliases.isin, row.isin),
          isNull(instrumentAliases.currency),
        ),
      );
  }
}

export async function saveAliases(db: Db, userId: string, rows: AliasInput[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(instrumentAliases)
      .values({
        userId,
        broker: row.broker,
        symbol: row.symbol,
        isin: row.isin,
        currency: row.currency ?? null,
      })
      .onConflictDoUpdate({
        target: [instrumentAliases.userId, instrumentAliases.broker, instrumentAliases.symbol],
        set: { isin: row.isin, currency: row.currency ?? null },
      });
  }
}

/* ── Úprava a mazání uložených záznamů (stránka /import) ─────────────────── */

export interface AliasRecord {
  broker: string;
  symbol: string;
  isin: string;
  currency: string | null;
}

/** Uložené záznamy uživatele, seřazené podle brokera a symbolu. */
export async function listAliases(db: Db, userId: string): Promise<AliasRecord[]> {
  return db
    .select({
      broker: instrumentAliases.broker,
      symbol: instrumentAliases.symbol,
      isin: instrumentAliases.isin,
      currency: instrumentAliases.currency,
    })
    .from(instrumentAliases)
    .where(eq(instrumentAliases.userId, userId))
    .orderBy(asc(instrumentAliases.broker), asc(instrumentAliases.symbol));
}

export async function findAlias(
  db: Db,
  userId: string,
  broker: string,
  symbol: string,
): Promise<AliasRecord | undefined> {
  const [row] = await db
    .select({
      broker: instrumentAliases.broker,
      symbol: instrumentAliases.symbol,
      isin: instrumentAliases.isin,
      currency: instrumentAliases.currency,
    })
    .from(instrumentAliases)
    .where(
      and(
        eq(instrumentAliases.userId, userId),
        eq(instrumentAliases.broker, broker),
        eq(instrumentAliases.symbol, symbol),
      ),
    );
  return row;
}

/** Import z historie, pod jehož transakcemi leží daný ISIN. */
export interface ImportUsingIsin {
  id: string;
  filename: string;
  createdAt: Date;
}

/**
 * Importy, které uložily transakce brokera pod daným ISIN — ty musí uživatel
 * vrátit zpět, než ISIN v číselníku změní nebo smaže (L23-02). Od nejnovějšího.
 */
export async function importsUsingIsin(
  db: Db,
  userId: string,
  broker: string,
  isin: string,
): Promise<ImportUsingIsin[]> {
  return db
    .selectDistinct({
      id: importBatches.id,
      filename: importBatches.filename,
      createdAt: importBatches.createdAt,
    })
    .from(transactions)
    .innerJoin(
      importBatches,
      and(eq(importBatches.id, transactions.batchId), eq(importBatches.userId, userId)),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.broker, broker),
        eq(transactions.isin, isin),
      ),
    )
    .orderBy(desc(importBatches.createdAt));
}

export type AliasChange =
  | { outcome: 'ok' }
  | { outcome: 'missing' }
  | { outcome: 'in-use'; imports: ImportUsingIsin[] };

/**
 * Změní ISIN (u XTB i měnu) uloženého záznamu. Pod dosavadním ISIN nesmí
 * ležet transakce téhož brokera — další nahrání výpisu by je pod novým ISIN
 * uložilo podruhé (L23-02). Stejné údaje znovu nejsou změna a projdou.
 *
 * Kontrola a zápis nejsou atomické (revize R6): import, který doběhne přesně
 * mezi nimi, může pod starým ISIN ještě uložit transakce. Okno je zlomek
 * sekundy, transakci kvůli postgres.js nepoužíváme (CLAUDE.md) a stejně se
 * chová i první uložení číselníku (`aliasesBlockedByTransactions`).
 */
export async function updateAlias(db: Db, userId: string, input: AliasInput): Promise<AliasChange> {
  const existing = await findAlias(db, userId, input.broker, input.symbol);
  if (!existing) return { outcome: 'missing' };
  const currency = input.currency ?? null;
  if (existing.isin === input.isin && existing.currency === currency) return { outcome: 'ok' };
  const imports = await importsUsingIsin(db, userId, input.broker, existing.isin);
  if (imports.length > 0) return { outcome: 'in-use', imports };
  await db
    .update(instrumentAliases)
    .set({ isin: input.isin, currency })
    .where(
      and(
        eq(instrumentAliases.userId, userId),
        eq(instrumentAliases.broker, input.broker),
        eq(instrumentAliases.symbol, input.symbol),
      ),
    );
  return { outcome: 'ok' };
}

/**
 * Smaže uložený záznam. Blokuje se stejně jako změna: dividenda uložená
 * s ISIN by se bez záznamu při dalším nahrání téhož výpisu uložila znovu,
 * tentokrát bez ISIN — jiný otisk, takže podruhé (opačný směr párování
 * dividend dedupe nedělá, `promoteStoredDividends` v importers).
 * Souběh kontroly a zápisu viz `updateAlias`.
 */
export async function deleteAlias(
  db: Db,
  userId: string,
  broker: string,
  symbol: string,
): Promise<AliasChange> {
  const existing = await findAlias(db, userId, broker, symbol);
  if (!existing) return { outcome: 'missing' };
  const imports = await importsUsingIsin(db, userId, broker, existing.isin);
  if (imports.length > 0) return { outcome: 'in-use', imports };
  await db
    .delete(instrumentAliases)
    .where(
      and(
        eq(instrumentAliases.userId, userId),
        eq(instrumentAliases.broker, broker),
        eq(instrumentAliases.symbol, symbol),
      ),
    );
  return { outcome: 'ok' };
}
