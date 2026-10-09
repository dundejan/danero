import { dedupeKey, parseSchwabCsv } from '@danero/importers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { auditLog, instrumentAliases, transactions, user } from '@/db/schema';
import { importFileIsolated, importParsed, loadImportState } from '@/lib/import-service';
import { saveAliases } from '@/lib/instrument-aliases';
import { loadTransactions } from '@/lib/portfolio';
import {
  buildEtoroXlsx,
  ETORO_ACTIVITY_ROWS,
  ETORO_CLOSED_ROWS,
  ETORO_DIVIDEND_ROWS,
} from '../../../packages/importers/test/fixtures/etoro';

/**
 * Táž událost ve dvou po sobě jdoucích výpisech.
 *
 * eToro popisuje jeden nákup dvakrát a pokaždé jinak přesně: dokud je pozice
 * otevřená, je jen v Account Activity a cena se počítá `Amount / Units`
 * (147,9201326…); po uzavření přijde v Closed Positions s `Open Rate` 147,92.
 * Dedupe je vědomě obsahový (B-3-2), takže jiná cena = jiný klíč a nákup se
 * uložil PODRUHÉ: zdvojená držba, zdvojená nabývací cena a pozdější prodej
 * spárovaný s lotem, který nikdy neexistoval.
 */

const withUser = async (): Promise<Db> => {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  // eToro ISIN u části pozic neuvádí — číselník uživatele ho dodává
  await db.insert(instrumentAliases).values([
    { userId: 'u1', broker: 'etoro', symbol: 'AMD', isin: 'US0079031078' },
    { userId: 'u1', broker: 'etoro', symbol: 'OLED', isin: 'US91347P1057' },
    { userId: 'u1', broker: 'etoro', symbol: 'TSLA', isin: 'US88160R1014' },
    { userId: 'u1', broker: 'etoro', symbol: 'AAPL', isin: 'US0378331005' },
    { userId: 'u1', broker: 'etoro', symbol: 'MSFT', isin: 'US5949181045' },
    { userId: 'u1', broker: 'etoro', symbol: 'NVDA', isin: 'US67066G1040' },
    { userId: 'u1', broker: 'etoro', symbol: 'ZZZ', isin: 'US0000000000' },
  ]);
  return db;
};

const upload = async (db: Db, filename: string, buffer: Buffer) =>
  importFileIsolated(
    db,
    'u1',
    filename,
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );

describe('eToro: pozice otevřená v prvním výpisu a uzavřená ve druhém', () => {
  it('nákup se neuloží dvakrát a uživatel se o rozdílu dozví', { timeout: 60_000 }, async () => {
    const db = await withUser();

    // 1. výpis: pozice AMD je otevřená → BUY jen z Account Activity
    const otevrena = await buildEtoroXlsx({
      closed: { rows: [] },
      activity: { rows: ETORO_ACTIVITY_ROWS },
      dividends: { rows: ETORO_DIVIDEND_ROWS },
    });
    const prvni = await upload(db, 'etoro-2025.xlsx', otevrena);
    expect(prvni.errors).toEqual([]);
    const poPrvnim = await loadTransactions(db, 'u1');
    const nakupy = poPrvnim.filter((tx) => tx.type === 'BUY');
    expect(nakupy.length).toBeGreaterThan(0);

    // 2. výpis: tatáž pozice už uzavřená → pár BUY/SELL z Closed Positions
    const uzavrena = await buildEtoroXlsx({
      closed: { rows: ETORO_CLOSED_ROWS },
      activity: { rows: ETORO_ACTIVITY_ROWS },
      dividends: { rows: ETORO_DIVIDEND_ROWS },
    });
    const druhy = await upload(db, 'etoro-2026.xlsx', uzavrena);
    expect(druhy.errors).toEqual([]);

    const poDruhem = await loadTransactions(db, 'u1');
    // každý nákup smí být v databázi jen jednou (klíč = id, ne obsah)
    const idsPoDruhem = poDruhem.map((tx) => tx.id);
    expect(new Set(idsPoDruhem).size).toBe(idsPoDruhem.length);

    // rozdíl se nesmí spolknout: řádek se neuloží, ale uživatel se to dozví
    const hlaseno = druhy.warnings.filter((w) => w.message.includes('už máš uloženou'));
    expect(hlaseno.length).toBeGreaterThan(0);
    expect(hlaseno[0]!.message).toContain('zaokrouhlení');
  });
});

/**
 * Dividenda uložená bez ISIN a tentýž výpis po doplnění číselníku (L14-02).
 *
 * Schwab ISIN neexportuje: obchod bez něj skončí chybou „doplň ISIN“, dividenda
 * se uloží hned. Stránka importu pak radí „po uložení nahraj soubor znovu“ —
 * a protože ISIN vstupuje do otisku dividendy, uložila se tatáž výplata
 * podruhé (jednou bez ISIN, jednou s ním) a § 8 i sražená daň vyšly dvojnásobné.
 */
describe('dividenda bez ISIN → doplněný číselník → týž výpis znovu (L14-02)', () => {
  const ISIN = 'US0000000018';
  const SCHWAB_HEADER =
    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"';
  const SCHWAB_STATEMENT = [
    SCHWAB_HEADER,
    '"05/02/2025","Qualified Dividend","ZZTA","ZETA TEST CORP","","","","$20.00"',
    '"05/02/2025","NRA Tax Adj","ZZTA","ZETA TEST CORP","","","","-$3.00"',
    // jiný titul, který na číselník čeká dál — jeho dividendy se oprava nesmí dotknout
    '"05/02/2025","Qualified Dividend","ZZTB","BETA TEST INC","","","","$7.50"',
    '"03/03/2025","Buy","ZZTA","ZETA TEST CORP","40","$70.00","","-$2800.00"',
  ].join('\n');
  // dvě výplaty téhož titulu, téhož dne a ve stejné výši — legitimní stav
  const SCHWAB_TWIN_DIVIDENDS = [
    SCHWAB_HEADER,
    '"06/10/2025","Qualified Dividend","ZZTA","ZETA TEST CORP","","","","$4.25"',
    '"06/10/2025","Qualified Dividend","ZZTA","ZETA TEST CORP","","","","$4.25"',
    '"03/03/2025","Buy","ZZTA","ZETA TEST CORP","40","$70.00","","-$2800.00"',
  ].join('\n');

  const withUsers = async (): Promise<Db> => {
    const db = await createPgliteDb();
    await db.insert(user).values([
      { id: 'u1', name: 'Test', email: 'test@danero.cz' },
      { id: 'u2', name: 'Druhý', email: 'druhy@danero.cz' },
    ]);
    return db;
  };

  const uploadText = (db: Db, userId: string, text: string) =>
    importFileIsolated(
      db,
      userId,
      'schwab.csv',
      new TextEncoder().encode(text).buffer as ArrayBuffer,
    );

  const dividendRows = async (db: Db, userId: string) =>
    (await db.select().from(transactions).where(eq(transactions.userId, userId)))
      .filter((row) => row.type === 'DIVIDEND')
      .sort((a, b) => a.dedupeKey.localeCompare(b.dedupeKey));

  it(
    'dividenda se neuloží podruhé, uloženému řádku se doplní ISIN a třetí nahrání jsou samé duplicity',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();

      const first = await uploadText(db, 'u1', SCHWAB_STATEMENT);
      expect(first.broker).toBe('schwab');
      expect(first.added).toBe(2);
      expect(first.unmapped.map((item) => item.symbol)).toContain('ZZTA');
      // cizí uživatel má tentýž výpis uložený taky bez ISIN
      expect((await uploadText(db, 'u2', SCHWAB_STATEMENT)).added).toBe(2);
      const [storedBefore] = (await dividendRows(db, 'u1')).filter(
        (row) => (row.payload as { ticker?: string }).ticker === 'ZZTA',
      );
      expect(storedBefore!.isin).toBeNull();

      await saveAliases(db, 'u1', [{ broker: 'schwab', symbol: 'ZZTA', isin: ISIN }]);

      const second = await uploadText(db, 'u1', SCHWAB_STATEMENT);
      expect(second.errors).toEqual([]);
      // přibyl jen nákup, který čekal na ISIN; obě dividendy jsou duplicity
      expect(second.added).toBe(1);
      expect(second.duplicates).toBe(2);

      const dividends = await dividendRows(db, 'u1');
      expect(dividends).toHaveLength(2);
      const promoted = dividends.find((row) => row.isin === ISIN)!;
      expect(promoted).toBeDefined();
      expect((promoted.payload as { isin?: string }).isin).toBe(ISIN);
      expect((promoted.payload as { gross: string }).gross).toBe('20');
      expect((promoted.payload as { withholdingTax: string }).withholdingTax).toBe('3');
      // řádek zůstal tentýž (dávka prvního nahrání), jen pod klíčem s ISIN
      expect(promoted.batchId).toBe(storedBefore!.batchId);
      expect(promoted.createdAt).toEqual(storedBefore!.createdAt);
      expect(promoted.dedupeKey).not.toBe(storedBefore!.dedupeKey);
      const loaded = (await loadTransactions(db, 'u1')).find(
        (tx) => tx.type === 'DIVIDEND' && tx.isin === ISIN,
      )!;
      expect(promoted.dedupeKey).toBe(dedupeKey('schwab', loaded, 1));

      // dividenda titulu bez číselníku zůstala, jak byla
      const untouched = dividends.find((row) => row !== promoted)!;
      expect(untouched.isin).toBeNull();
      expect((untouched.payload as { isin?: string }).isin).toBeUndefined();
      expect((untouched.payload as { gross: string }).gross).toBe('7.5');
      // nově načtený stav vede mezi dividendami bez ISIN už jen tu nedotčenou
      expect([...(await loadImportState(db, 'u1')).bareDividends]).toEqual([
        [untouched.dedupeKey, 'ZZTB'],
      ]);

      const third = await uploadText(db, 'u1', SCHWAB_STATEMENT);
      expect(third.added).toBe(0);
      expect(third.duplicates).toBe(3);
      expect(await dividendRows(db, 'u1')).toHaveLength(2);
      expect(await loadTransactions(db, 'u1')).toHaveLength(3);

      // přepis uloženého řádku je dohledatelný v auditu — právě jednou
      const audited = (await db.select().from(auditLog).where(eq(auditLog.userId, 'u1'))).filter(
        (row) => row.detail?.includes('ISIN doplněn u uložených dividend'),
      );
      expect(audited.map((row) => row.detail)).toEqual([
        'schwab.csv (schwab): 1 nových, ISIN doplněn u uložených dividend: 1',
      ]);

      // tenancy: řádky druhého uživatele se nepřepsaly
      const foreign = await dividendRows(db, 'u2');
      expect(foreign).toHaveLength(2);
      expect(foreign.map((row) => row.isin)).toEqual([null, null]);
      expect(foreign.map((row) => row.dedupeKey)).toContain(storedBefore!.dedupeKey);
    },
  );

  it(
    'dvě shodné dividendy téhož dne zůstanou dvě a obě dostanou ISIN',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();

      expect((await uploadText(db, 'u1', SCHWAB_TWIN_DIVIDENDS)).added).toBe(2);
      await saveAliases(db, 'u1', [{ broker: 'schwab', symbol: 'ZZTA', isin: ISIN }]);

      const second = await uploadText(db, 'u1', SCHWAB_TWIN_DIVIDENDS);
      expect(second.added).toBe(1);
      expect(second.duplicates).toBe(2);

      const dividends = await dividendRows(db, 'u1');
      expect(dividends).toHaveLength(2);
      expect(dividends.map((row) => row.isin)).toEqual([ISIN, ISIN]);
      expect(dividends.map((row) => (row.payload as { isin?: string }).isin)).toEqual([ISIN, ISIN]);

      const third = await uploadText(db, 'u1', SCHWAB_TWIN_DIVIDENDS);
      expect(third.added).toBe(0);
      expect(third.duplicates).toBe(3);
      expect(await dividendRows(db, 'u1')).toHaveLength(2);
    },
  );

  it(
    'sdílený stav importu (sync) po povýšení zná nový klíč a starý už ne',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();
      const state = await loadImportState(db, 'u1');

      const bare = parseSchwabCsv(SCHWAB_STATEMENT);
      await importParsed(db, 'u1', 'schwab.csv', bare, state);
      const bareKeys = new Set(state.keys);
      expect(bareKeys.size).toBe(2);

      const mapped = parseSchwabCsv(SCHWAB_STATEMENT, { ZZTA: { isin: ISIN } });
      const second = await importParsed(db, 'u1', 'schwab.csv', mapped, state);
      expect(second.added).toBe(1);
      expect(second.duplicates).toBe(2);
      // stav odpovídá databázi: tři řádky, z původních klíčů zbyl jen ten nedotčený
      const stored = await db.select().from(transactions).where(eq(transactions.userId, 'u1'));
      expect([...state.keys].sort()).toEqual(stored.map((row) => row.dedupeKey).sort());
      expect([...state.keys].filter((key) => bareKeys.has(key))).toHaveLength(1);
      // totéž platí o přehledu dividend bez ISIN: povýšený řádek v něm nezůstal
      // (jinak by se s ním při dalším souboru téhož běhu párovalo naprázdno)
      expect([...state.bareDividends]).toEqual(
        stored
          .filter((row) => row.type === 'DIVIDEND' && row.isin === null)
          .map((row) => [row.dedupeKey, 'ZZTB']),
      );
      expect(state.bareDividends.size).toBe(1);

      // týž stav podruhé: nic nového, nic k povýšení
      const third = await importParsed(db, 'u1', 'schwab.csv', mapped, state);
      expect(third.added).toBe(0);
      expect(third.duplicates).toBe(3);
      expect(await dividendRows(db, 'u1')).toHaveLength(2);
    },
  );

  it(
    'souběh: import se zastaralým stavem nespadne a nic nezdvojí',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();
      const mapped = parseSchwabCsv(SCHWAB_STATEMENT, { ZZTA: { isin: ISIN } });

      // dvojí odeslání formuláře: oba importy si stav načetly před povýšením
      await uploadText(db, 'u1', SCHWAB_STATEMENT);
      const earlier = await loadImportState(db, 'u1');
      const later = await loadImportState(db, 'u1');
      expect((await importParsed(db, 'u1', 'schwab.csv', mapped, earlier)).added).toBe(1);
      const second = await importParsed(db, 'u1', 'schwab.csv', mapped, later);
      expect(second.added).toBe(0);
      expect(second.duplicates).toBe(3);
      expect(await dividendRows(db, 'u1')).toHaveLength(2);
      expect(await loadTransactions(db, 'u1')).toHaveLength(3);

      // cílový klíč mezitím obsadil někdo jiný: UPDATE nesmí spadnout na
      // primárním klíči a shodit s sebou celý import
      const first = await uploadText(db, 'u2', SCHWAB_STATEMENT);
      const stale = await loadImportState(db, 'u2');
      const mappedDividend = mapped.transactions.find((tx) => tx.type === 'DIVIDEND' && tx.isin)!;
      await db.insert(transactions).values({
        userId: 'u2',
        dedupeKey: dedupeKey('schwab', mappedDividend, 1),
        batchId: first.batchId,
        broker: 'schwab',
        type: 'DIVIDEND',
        txDate: '2025-05-02',
        isin: ISIN,
        payload: JSON.parse(JSON.stringify(mappedDividend)) as unknown,
      });
      const raced = await importParsed(db, 'u2', 'schwab.csv', mapped, stale);
      expect(raced.added).toBe(1);
      // řádek bez ISIN zůstal nedotčený — klíč ani ISIN se nepřepsaly napůl
      const rows = await dividendRows(db, 'u2');
      expect(rows).toHaveLength(3);
      expect(rows.filter((row) => row.isin === null)).toHaveLength(2);
    },
  );

  it(
    'cizí uživatel, který má tutéž dividendu už s ISIN, povýšení neblokuje (tenancy v poddotazu)',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();
      // u2 má číselník od začátku: jeho řádek drží přesně ten klíč, na který se
      // řádek u1 po doplnění číselníku povyšuje
      await saveAliases(db, 'u2', [{ broker: 'schwab', symbol: 'ZZTA', isin: ISIN }]);
      expect((await uploadText(db, 'u2', SCHWAB_STATEMENT)).added).toBe(3);

      expect((await uploadText(db, 'u1', SCHWAB_STATEMENT)).added).toBe(2);
      await saveAliases(db, 'u1', [{ broker: 'schwab', symbol: 'ZZTA', isin: ISIN }]);
      const second = await uploadText(db, 'u1', SCHWAB_STATEMENT);
      expect(second.added).toBe(1);
      expect(second.duplicates).toBe(2);

      const own = await dividendRows(db, 'u1');
      expect(own).toHaveLength(2);
      expect(own.map((row) => row.isin).sort()).toEqual([ISIN, null].sort());
      const foreign = (await dividendRows(db, 'u2')).find((row) => row.isin === ISIN)!;
      expect(own.find((row) => row.isin === ISIN)!.dedupeKey).toBe(foreign.dedupeKey);
    },
  );

  it(
    'pojistky zápisu: zastaralý stav nepřepíše řádek, který už ISIN má, ani řádek jiného typu',
    { timeout: 60_000 },
    async () => {
      const db = await withUsers();
      const OTHER_ISIN = 'US0000000034';
      await uploadText(db, 'u1', SCHWAB_STATEMENT);
      const stale = await loadImportState(db, 'u1');
      const before = await dividendRows(db, 'u1');
      const tickerOf = (row: (typeof before)[number]) =>
        (row.payload as { ticker?: string }).ticker;
      const zeta = before.find((row) => tickerOf(row) === 'ZZTA')!;
      const beta = before.find((row) => tickerOf(row) === 'ZZTB')!;

      // mezi načtením stavu a zápisem se řádky změnily pod rukama: jeden už
      // ISIN má (jiný), druhý přestal být dividendou
      await db
        .update(transactions)
        .set({ isin: OTHER_ISIN })
        .where(eq(transactions.dedupeKey, zeta.dedupeKey));
      await db
        .update(transactions)
        .set({ type: 'INTEREST' })
        .where(eq(transactions.dedupeKey, beta.dedupeKey));

      const mapped = parseSchwabCsv(SCHWAB_STATEMENT, {
        ZZTA: { isin: ISIN },
        ZZTB: { isin: 'US0000000026' },
      });
      await importParsed(db, 'u1', 'schwab.csv', mapped, stale);

      const after = await db.select().from(transactions).where(eq(transactions.userId, 'u1'));
      const zetaAfter = after.find((row) => tickerOf(row) === 'ZZTA' && row.type === 'DIVIDEND')!;
      expect(zetaAfter.dedupeKey).toBe(zeta.dedupeKey);
      expect(zetaAfter.isin).toBe(OTHER_ISIN);
      expect((zetaAfter.payload as { isin?: string }).isin).toBeUndefined();
      const betaAfter = after.find((row) => tickerOf(row) === 'ZZTB')!;
      expect(betaAfter.type).toBe('INTEREST');
      expect(betaAfter.dedupeKey).toBe(beta.dedupeKey);
      expect(betaAfter.isin).toBeNull();
      expect((betaAfter.payload as { isin?: string }).isin).toBeUndefined();
    },
  );
});

/**
 * Povýšení nesmí spolknout JINOU dividendu (A25-R1-01).
 *
 * První podoba třetí sítě párovala jen podle dne, brutta, srážky a měny. Když
 * uložená dividenda bez ISIN v příchozím souboru nebyla a byla v něm shodná
 * dividenda jiného titulu, druhá výplata se neuložila a první dostala cizí
 * ISIN — tiše chybějící příjem i sražená daň. Dvě různé výplaty jsou dvě
 * transakce; páruje se proto jen při shodě titulu.
 */
describe('shodná dividenda JINÉHO titulu v jiném souboru se uloží (A25-R1-01)', () => {
  const TEMPLATE_HEADER =
    'type,date,isin,ticker,name,quantity,price,currency,amount,withholding_tax,source_country,note';
  const SCHWAB_HEADER =
    '"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"';
  const LOOKALIKE = 'uloženou bez ISIN';

  const withUser = async (): Promise<Db> => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
    return db;
  };
  const uploadText = (db: Db, filename: string, lines: string[]) =>
    importFileIsolated(
      db,
      'u1',
      filename,
      new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer,
    );
  const dividendRows = async (db: Db) =>
    (await db.select().from(transactions).where(eq(transactions.userId, 'u1'))).filter(
      (row) => row.type === 'DIVIDEND',
    );
  const tickers = (rows: Awaited<ReturnType<typeof dividendRows>>) =>
    rows.map((row) => `${(row.payload as { ticker?: string }).ticker}:${row.isin}`).sort();

  it(
    'šablona, dva soubory: dividenda bez ISIN a shodná dividenda jiného titulu s ISIN jsou dvě',
    {
      timeout: 60_000,
    },
    async () => {
      const db = await withUser();
      await uploadText(db, 'sablona-1.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,,ALFA,Alfa Test,,,USD,12.00,1.80,US,',
      ]);
      const second = await uploadText(db, 'sablona-2.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,',
      ]);
      expect(second.broker).toBe('universal');
      expect({ added: second.added, duplicates: second.duplicates }).toEqual({
        added: 1,
        duplicates: 0,
      });
      // řádek titulu ALFA cizí ISIN nedostal
      expect(tickers(await dividendRows(db))).toEqual(['ALFA:null', 'BETA:US0000000026']);
      // oba tituly známe, o záměně nemůže být řeč → žádné varování
      expect(second.warnings.filter((w) => w.message.includes(LOOKALIKE))).toEqual([]);
    },
  );

  it(
    'Schwab, dva účty: titul bez číselníku na jednom, shodná dividenda titulu s číselníkem na druhém',
    {
      timeout: 60_000,
    },
    async () => {
      const db = await withUser();
      await saveAliases(db, 'u1', [{ broker: 'schwab', symbol: 'ZZTA', isin: 'US0000000018' }]);
      await uploadText(db, 'ucet-1.csv', [
        SCHWAB_HEADER,
        '"05/02/2025","Qualified Dividend","ZZTC","GAMA TEST","","","","$9.40"',
      ]);
      const second = await uploadText(db, 'ucet-2.csv', [
        SCHWAB_HEADER,
        '"05/02/2025","Qualified Dividend","ZZTA","ZETA TEST CORP","","","","$9.40"',
      ]);
      expect({ added: second.added, duplicates: second.duplicates }).toEqual({
        added: 1,
        duplicates: 0,
      });
      expect(tickers(await dividendRows(db))).toEqual(['ZZTA:US0000000018', 'ZZTC:null']);
    },
  );

  it(
    'uložená dividenda nemá ISIN ani ticker: nespáruje se, uloží se obě a uživatel dostane varování',
    {
      timeout: 60_000,
    },
    async () => {
      const db = await withUser();
      await uploadText(db, 'sablona-1.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,,,,,,USD,12.00,1.80,US,',
      ]);
      const second = await uploadText(db, 'sablona-2.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,',
      ]);
      expect(second.added).toBe(1);
      expect(second.duplicates).toBe(0);
      expect(await dividendRows(db)).toHaveLength(2);
      const warned = second.warnings.filter((w) => w.message.includes(LOOKALIKE));
      expect(warned).toHaveLength(1);
      expect(warned[0]!.message).toContain('2. 5. 2025');
      expect(warned[0]!.message).toContain('BETA');
      // varování je i v uložené dávce — historie importů ho ukáže i později
      const again = await uploadText(db, 'sablona-2.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,',
      ]);
      expect({ added: again.added, duplicates: again.duplicates }).toEqual({
        added: 0,
        duplicates: 1,
      });
      expect(again.warnings.filter((w) => w.message.includes(LOOKALIKE))).toEqual([]);
    },
  );

  it(
    'týž titul, týž soubor po doplnění ISIN v šabloně: dividenda se nezdvojí',
    {
      timeout: 60_000,
    },
    async () => {
      const db = await withUser();
      await uploadText(db, 'sablona.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,,beta,Beta Test,,,USD,12.00,1.80,US,',
      ]);
      const second = await uploadText(db, 'sablona.csv', [
        TEMPLATE_HEADER,
        'DIVIDEND,2025-05-02,US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,',
      ]);
      expect({ added: second.added, duplicates: second.duplicates }).toEqual({
        added: 0,
        duplicates: 1,
      });
      // řádek zůstal jeden, s ISIN — velikost písmen tickeru shodu nekazí
      expect(tickers(await dividendRows(db))).toEqual(['beta:US0000000026']);
    },
  );
});
