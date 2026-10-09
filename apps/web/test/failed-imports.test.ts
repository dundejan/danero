import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { failedImports, transactions, user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import {
  casesForBatches,
  listOpenCases,
  loadOpenCase,
  MAX_OPEN_CASES_PER_USER,
  reportFailedImport,
  resolveCase,
} from '@/lib/failed-imports';
import { importFileIsolated } from '@/lib/import-service';
import { pruneFailedImports } from '@/lib/retention';

/**
 * Nepřečtený výpis si necháváme k rozboru — jinak se formát, který neumíme
 * přečíst, nemá podle čeho doplnit (viz lib/failed-imports.ts).
 *
 * Testy jedou přes `importFileIsolated`, ne přes samotné `keepFailedUpload`:
 * půlka ceny téhle funkce je v tom, KTERÁ selhání se schovávají — prázdný
 * soubor a PDF ne, nepoznaná hlavička ano.
 */

const bytes = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

/**
 * Výpis od vymyšlené platformy: sniffery ho nepoznají, „type“ v něm není.
 * (Pozor na české názvy sloupců — „Datum obchodu“ si bere Fio.)
 */
const NEZNAMY_VYPIS = [
  'Obchodni den;Titul;Operace;Mnozstvi;Kurz;Mena',
  '2026-01-05;CEZ;Nakup;10;1050,50;CZK',
].join('\n');

/**
 * Výpis, jehož formát POZNÁME, ale parser z něj nic nedostane — takhle vypadá
 * broker, který přejmenoval sloupec (9. 8. 2026, T212 `Time` → `Time (UTC)`).
 */
const T212_S_ROZBITYM_RADKEM = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,tohle-neni-datum,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOF9',
].join('\n');

const T212_VYPIS = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOF1',
].join('\n');

/**
 * Export T212, ve kterém jsou jen převody kusů z jiného účtu: parser je pozná,
 * vědomě nezaúčtuje a v hlášce radí, kudy je doplnit. Tituly, kusy, částky
 * i časy jsou smyšlené.
 */
const T212_HEADER_2026 =
  'Action,Time (UTC),ISIN,Ticker,Name,Notes,ID,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Currency conversion from amount,Currency (Currency conversion from amount),Currency conversion to amount,Currency (Currency conversion to amount),Currency conversion fee,Currency (Currency conversion fee),Merchant name,Merchant category';
const T212_ONLY_TRANSFERS = [
  T212_HEADER_2026,
  'Transfer in,2026-12-07 10:00:00+00:00,US0000000003,CCC,Gama Inc,,id-6,3,30.00,USD,0.045,,,2000.00,CZK,,,,,,,,,,',
  'Transfer in,2026-12-07 10:00:01+00:00,US0000000001,AAA,Alfa Inc,,id-7,5,20.00,USD,0.045,,,2200.00,CZK,,,,,,,,,,',
].join('\n');
/** Hodnota Action, kterou parser nezná vůbec — „nahlaš nám ji“. */
const T212_UNKNOWN_ROW =
  'Lending fee,2026-12-08 10:00:00+00:00,,,,,id-8,,,,,,,1.00,CZK,,,,,,,,,,';

let emailLog: string;

const emails = (): Array<{ to: string; subject: string; text: string }> =>
  readFileSync(emailLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string });

async function freshDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  return db;
}

beforeEach(() => {
  emailLog = join(mkdtempSync(join(tmpdir(), 'danero-failed-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = emailLog;
  process.env.DANERO_ALERT_EMAIL = 'provoz@example.test';
});

afterEach(() => {
  delete process.env.DANERO_EMAIL_LOG;
  delete process.env.DANERO_ALERT_EMAIL;
});

describe('zachycení nepřečteného výpisu', () => {
  it('nepoznaný formát se uloží a provozovateli přijde upozornění', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));

    expect(summary.unrecognized).toBe(true);
    const cases = await listOpenCases(db);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.filename).toBe('vypis.csv');
    expect(cases[0]!.batchId).toBe(summary.batchId);

    // originál se dá načíst zpátky bajt po bajtu — o to celé jde
    const detail = await loadOpenCase(db, cases[0]!.id);
    expect(new TextDecoder().decode(detail!.data)).toBe(NEZNAMY_VYPIS);

    const alert = emails().at(-1)!;
    expect(alert.to).toBe('provoz@example.test');
    expect(alert.text).toContain('vypis.csv');
    // hlavička ano (podle ní se formát pozná), obsah výpisu NIKDY
    expect(alert.text).toContain('Obchodni den');
    expect(alert.text).not.toContain('1050,50');
  });

  it('prázdný soubor ani PDF se neukládají — chyba není na naší straně', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'prazdny.csv', bytes(''));
    await importFileIsolated(db, 'u1', 'vypis.pdf', bytes('%PDF-1.7\n%âã'));
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('poznaný formát, ze kterého parser nic nedostane, si taky necháme', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_S_ROZBITYM_RADKEM));
    expect(summary.added).toBe(0);
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(summary.unrecognized).toBe(true);
    expect(await listOpenCases(db)).toHaveLength(1);
  });

  it('výpis jen s pohyby kusů, které vědomě nezaúčtujeme, se neschovává (A04-R1-01)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // konec roku: uživatel si převedl portfolio odjinud a v exportu za ten rok
    // nic jiného není. Hláška mu říká, ať kusy doplní šablonou — panel „na
    // zpracování pracujeme“ vedle ní by tvrdil opak.
    const summary = await importFileIsolated(db, 'u1', 't212-2026.csv', bytes(T212_ONLY_TRANSFERS));
    expect(summary.added).toBe(0);
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0]!.message).toContain('sami nezaúčtujeme');
    expect(summary.unrecognized).toBeUndefined();
    expect(await db.select().from(failedImports)).toHaveLength(0);
    // provozovateli nechodí upozornění na případ, který nemá jak vyřídit
    expect(existsSync(emailLog)).toBe(false);
  });

  it('stačí jediný řádek, kterému nerozumíme, a výpis si necháme dál (A04-R1-01)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // vedle převodu je tu typ, který neznáme — to už vada na naší straně být může
    const withUnknownRow = `${T212_ONLY_TRANSFERS}\n${T212_UNKNOWN_ROW}`;
    const summary = await importFileIsolated(db, 'u1', 't212-2026.csv', bytes(withUnknownRow));
    expect(summary.added).toBe(0);
    expect(summary.errors).toHaveLength(3);
    expect(summary.unrecognized).toBe(true);
    expect(await listOpenCases(db)).toHaveLength(1);
  });

  it('useknutý T212 export si nenecháváme — vada je v přenosu', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // hlavička bez jediného datového řádku = přerušené stahování
    const useknuty = T212_VYPIS.split('\n')[0]!;
    const summary = await importFileIsolated(db, 'u1', 't212-useknuty.csv', bytes(useknuty));
    expect(summary.errors.length).toBe(1);
    expect(summary.unrecognized).toBeUndefined();
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('špatně vyplněná univerzální šablona se neschovává — hláška je přesná', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // šablona bez povinného sloupce „date": parser vrátí 0 transakcí a chybu,
    // ale je to naše šablona a uživatel dostane návodnou hlášku
    const summary = await importFileIsolated(
      db,
      'u1',
      'sablona.csv',
      // `settlement_date` je jeden ze sloupců, které má JEN naše šablona —
      // podle nich se od 23. 8. 2026 pozná (K7b-01)
      bytes('type,isin,quantity,settlement_date\nBUY,US0378331005,10,2024-06-12'),
    );
    expect(summary.errors.length).toBeGreaterThan(0);
    expect(summary.unrecognized).toBeUndefined();
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('hlavička se pozná i u souboru bez LF (Excel pro Mac)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // celý soubor na jednom „řádku" oddělený samotnými \r — bez správného
    // hledání konce řádku by se do e-mailu obtiskly obchody
    const crOnly = NEZNAMY_VYPIS.replace(/\n/g, '\r');
    await importFileIsolated(db, 'u1', 'mac.csv', bytes(crOnly));

    const alert = emails().at(-1)!;
    expect(alert.text).toContain('Obchodni den');
    expect(alert.text).not.toContain('1050,50');
  });

  it('úspěšný import nic neschovává', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_VYPIS));
    expect(summary.added).toBe(1);
    expect(summary.unrecognized).toBeUndefined();
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('týž soubor podruhé nezaloží druhý případ, jen se přepne na novou dávku', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const druhy = await importFileIsolated(db, 'u1', 'vypis-znovu.csv', bytes(NEZNAMY_VYPIS));

    const cases = await listOpenCases(db);
    expect(cases).toHaveLength(1);
    // panel musí viset u dávky, kterou má uživatel před očima
    expect(cases[0]!.batchId).toBe(druhy.batchId);
    expect(cases[0]!.filename).toBe('vypis-znovu.csv');
    // a provozovateli o témž souboru podruhé nic nechodí
    expect(emails().filter((m) => m.to === 'provoz@example.test')).toHaveLength(1);
  });

  it('víc než pět otevřených případů jeden uživatel nenasbírá', { timeout: 60_000 }, async () => {
    const db = await freshDb();
    for (let i = 0; i < MAX_OPEN_CASES_PER_USER + 2; i += 1) {
      await importFileIsolated(db, 'u1', `vypis-${i}.csv`, bytes(`${NEZNAMY_VYPIS}\n;;;${i};;`));
    }
    expect(await listOpenCases(db)).toHaveLength(MAX_OPEN_CASES_PER_USER);
  });

  it('plný strop nebrání přepnutí existujícího případu na novou dávku', { timeout: 60_000 }, async () => {
    const db = await freshDb();
    const prvni = bytes(`${NEZNAMY_VYPIS}\n;;;0;;`);
    await importFileIsolated(db, 'u1', 'vypis-0.csv', prvni);
    for (let i = 1; i < MAX_OPEN_CASES_PER_USER; i += 1) {
      await importFileIsolated(db, 'u1', `vypis-${i}.csv`, bytes(`${NEZNAMY_VYPIS}\n;;;${i};;`));
    }
    // strop je plný; nahrání JIŽ ZNÁMÉHO souboru přesto musí panel přesunout
    // na dávku, kterou má uživatel před očima
    const znovu = await importFileIsolated(db, 'u1', 'vypis-0-znovu.csv', prvni);

    const cases = await casesForBatches(db, 'u1', [znovu.batchId]);
    expect(cases.get(znovu.batchId)?.filename).toBe('vypis-0-znovu.csv');
    expect(await listOpenCases(db)).toHaveLength(MAX_OPEN_CASES_PER_USER);
  });

  /**
   * K6a-07: produkční migrace se pouští ručně, takže nasazený kód může na
   * chvíli mluvit s databází, kde tabulka ještě není. `keepFailedUpload` to
   * ustojí, `casesForBatches` shazovalo CELOU stránku /import na 500 — a s ní
   * i historii a formulář pro nahrání, tedy věci, které s panelem
   * „koukneme se na to“ nemají nic společného.
   */
  it('bez tabulky failed_imports se /import nesmí sesypat', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    expect((await casesForBatches(db, 'u1', [summary.batchId])).size).toBe(1);

    const { sql } = await import('drizzle-orm');
    await db.execute(sql`DROP TABLE failed_imports`);
    await expect(casesForBatches(db, 'u1', [summary.batchId])).resolves.toEqual(new Map());
  });
});

describe('hlášení od uživatele', () => {
  it('uloží platformu i poznámku a pošle druhé upozornění', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);

    const done = await reportFailedImport(db, 'u1', item!.id, {
      platform: 'Fio e-Broker',
      note: 'Export z Obchody → Historie.',
    });
    expect(done).toBe('ok');

    const cases = await casesForBatches(db, 'u1', [summary.batchId]);
    expect(cases.get(summary.batchId)!.reportedPlatform).toBe('Fio e-Broker');
    expect(cases.get(summary.batchId)!.reportedAt).not.toBeNull();

    const alert = emails().at(-1)!;
    expect(alert.subject).toContain('Fio e-Broker');
    expect(alert.text).toContain('Export z Obchody');
  });

  it('cizí případ hlásit nejde (tenancy)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await db.insert(user).values({ id: 'u2', name: 'Jiný', email: 'jiny@danero.cz' });
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);
    expect(await reportFailedImport(db, 'u2', item!.id, { platform: 'XTB', note: '' })).toBe(
      'neexistuje',
    );
  });

  it('prázdné hlášení se neuloží — formulář musí zůstat', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);

    expect(await reportFailedImport(db, 'u1', item!.id, { platform: '  ', note: '' })).toBe(
      'prazdne',
    );
    // reportedAt schovává formulář natrvalo — po prázdném odeslání musí být null
    const cases = await casesForBatches(db, 'u1', [summary.batchId]);
    expect(cases.get(summary.batchId)!.reportedAt).toBeNull();
  });

  it('uzavřený případ už hlásit nejde', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);
    await resolveCase(db, item!.id, { status: 'rejected', note: 'Nečitelné.' });

    expect(await reportFailedImport(db, 'u1', item!.id, { platform: 'XTB', note: '' })).toBe(
      'neexistuje',
    );
  });

  it('hlášení má vlastní limit e-mailů — automatika ho nevyčerpá', { timeout: 60_000 }, async () => {
    const db = await freshDb();
    // pět nečitelných souborů: automatická upozornění vyčerpají svůj kbelík (3/den)
    for (let i = 0; i < 5; i += 1) {
      await importFileIsolated(db, 'u1', `vypis-${i}.csv`, bytes(`${NEZNAMY_VYPIS}\n;;;${i};;`));
    }
    const pred = emails().length;
    const [item] = await listOpenCases(db);
    expect(await reportFailedImport(db, 'u1', item!.id, { platform: 'Portu', note: '' })).toBe('ok');
    // hlášení od uživatele přesto odejde — je to jediná informace, která případ řeší
    expect(emails().length).toBe(pred + 1);
    expect(emails().at(-1)!.subject).toContain('Portu');
  });
});

describe('uzavření případu', () => {
  it('doimportovaný výpis: stav fixed a e-mail uživateli', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    // simulace opravy parseru: případ vznikne z nepoznaného souboru, uzavře se
    // výsledkem importu, který už projde
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(T212_VYPIS));

    await resolveCase(db, item!.id, {
      status: 'fixed',
      batchId: summary.batchId,
      added: summary.added,
    });

    const [row] = await db.select().from(failedImports).where(eq(failedImports.id, item!.id));
    expect(row!.status).toBe('fixed');
    expect(await listOpenCases(db)).toHaveLength(0);

    const zprava = emails().at(-1)!;
    expect(zprava.to).toBe('test@danero.cz');
    expect(zprava.subject).toContain('umíme přečíst');
    expect(zprava.text).toContain('1 transakci');
  });

  it('nečitelný výpis: stav rejected a vysvětlení v e-mailu', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);

    await resolveCase(db, item!.id, {
      status: 'rejected',
      note: 'Je to potvrzení o obchodu, ne výpis — stáhni prosím Historii transakcí.',
    });

    const zprava = emails().at(-1)!;
    expect(zprava.to).toBe('test@danero.cz');
    expect(zprava.text).toContain('Historii transakcí');
  });
});

/**
 * L14-07: týž soubor nahraný po uzavření případu. Do 9. 10. 2026 skončil
 * naprázdno v obou stavech — `ON CONFLICT … WHERE status = 'open'` uzavřený
 * řádek nezměnil, funkce vrátila `null` a po druhém selhání nezůstal případ,
 * panel, upozornění ani řádek v logu.
 */
describe('týž soubor po uzavření případu (L14-07)', () => {
  const provozovateli = (): Array<{ subject: string; text: string }> =>
    emails().filter((m) => m.to === 'provoz@example.test');
  const uzivateli = (): Array<{ subject: string }> =>
    emails().filter((m) => m.to === 'test@danero.cz');
  const radek = async (db: Db, caseId: string) => {
    const [row] = await db.select().from(failedImports).where(eq(failedImports.id, caseId));
    return row!;
  };

  it('fixed: opakované selhání případ znovu otevře a provozovatel dostane druhé upozornění', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);
    await reportFailedImport(db, 'u1', item!.id, { platform: 'Fio e-Broker', note: '' });
    await resolveCase(db, item!.id, { status: 'fixed', note: 'Formát doplněn.' });
    // případ vznikl dávno — retence (90 dní od `createdAt`) by čerstvě
    // uschovaný soubor smazala dřív, než se na něj kdo podívá
    await db
      .update(failedImports)
      .set({ createdAt: new Date(Date.now() - 80 * 24 * 60 * 60_000) })
      .where(eq(failedImports.id, item!.id));
    const upozorneniPred = provozovateli().length;
    const zpravPred = uzivateli().length;

    const druhy = await importFileIsolated(db, 'u1', 'vypis-znovu.csv', bytes(NEZNAMY_VYPIS));

    // pořád JEDEN případ (klíč je otisk obsahu), ale zase otevřený a u nové dávky
    const cases = await listOpenCases(db);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.id).toBe(item!.id);
    expect(cases[0]!.batchId).toBe(druhy.batchId);
    expect(cases[0]!.filename).toBe('vypis-znovu.csv');
    expect(cases[0]!.resolutionNote).toBeNull();
    expect(cases[0]!.resolvedBatchId).toBeNull();
    // co nám uživatel o výpisu řekl, platí dál — neptáme se podruhé
    expect(cases[0]!.reportedPlatform).toBe('Fio e-Broker');

    // panel „pracujeme na tom“ visí u importu, který má uživatel před očima
    const panel = await casesForBatches(db, 'u1', [druhy.batchId]);
    expect(panel.get(druhy.batchId)?.status).toBe('open');

    // originál je zpátky — uzavřením se smazal a bez něj není co rozebírat
    const detail = await loadOpenCase(db, item!.id);
    expect(new TextDecoder().decode(detail!.data)).toBe(NEZNAMY_VYPIS);

    const row = await radek(db, item!.id);
    expect(row.resolvedAt).toBeNull();
    expect(row.notifiedAt).not.toBeNull();
    expect(row.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    // druhé upozornění: čerstvý nález, ne hlášení od uživatele, a je z něj
    // poznat, že jde o formát, který už jsme jednou opravili
    expect(provozovateli()).toHaveLength(upozorneniPred + 1);
    const alert = provozovateli().at(-1)!;
    expect(alert.subject).toContain('nepřečetli jsme výpis (vypis-znovu.csv)');
    expect(alert.text).toContain('Opakované selhání');
    expect(alert.text).toContain('Fio e-Broker');
    expect(alert.text).toContain('Obchodni den');
    expect(alert.text).not.toContain('1050,50');
    // uživateli o znovuotevření nic nechodí
    expect(uzivateli()).toHaveLength(zpravPred);
  });

  it('rejected: případ zůstává zavřený — bez panelu, bez souboru a bez upozornění', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const prvni = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    const [item] = await listOpenCases(db);
    await resolveCase(db, item!.id, { status: 'rejected', note: 'Tohle je potvrzení, ne výpis.' });
    const pred = await radek(db, item!.id);
    const upozorneniPred = provozovateli().length;

    const druhy = await importFileIsolated(db, 'u1', 'vypis-znovu.csv', bytes(NEZNAMY_VYPIS));

    expect(druhy.unrecognized).toBe(true);
    expect(await listOpenCases(db)).toHaveLength(0);
    expect(await radek(db, item!.id)).toEqual(pred);
    expect(pred.status).toBe('rejected');
    expect(pred.content).toBeNull();
    // vysvětlení dál visí u původní dávky, u nové nic neslibujeme
    const panel = await casesForBatches(db, 'u1', [prvni.batchId, druhy.batchId]);
    expect(panel.get(prvni.batchId)?.status).toBe('rejected');
    expect(panel.has(druhy.batchId)).toBe(false);
    expect(provozovateli()).toHaveLength(upozorneniPred);
  });

  it('znovuotevření ukládá soubor, takže se na něj vztahuje strop otevřených případů', {
    timeout: 60_000,
  }, async () => {
    const db = await freshDb();
    const opraveny = bytes(`${NEZNAMY_VYPIS}\n;;;opraveny;;`);
    await importFileIsolated(db, 'u1', 'opraveny.csv', opraveny);
    const [item] = await listOpenCases(db);
    await resolveCase(db, item!.id, { status: 'fixed' });
    for (let i = 0; i < MAX_OPEN_CASES_PER_USER; i += 1) {
      await importFileIsolated(db, 'u1', `vypis-${i}.csv`, bytes(`${NEZNAMY_VYPIS}\n;;;${i};;`));
    }

    await importFileIsolated(db, 'u1', 'opraveny-znovu.csv', opraveny);

    expect(await listOpenCases(db)).toHaveLength(MAX_OPEN_CASES_PER_USER);
    const row = await radek(db, item!.id);
    expect(row.status).toBe('fixed');
    expect(row.content).toBeNull();
  });
});

describe('výpis stažený z API brokera', () => {
  it('nese původ i platformu, takže se uživatele nemáme nač ptát', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 't212-api-2019.csv', bytes(NEZNAMY_VYPIS));
    // simulace cesty ze syncu: tam keepFailedUpload dostane source i platformu
    await db.delete(failedImports);
    const { keepFailedUpload } = await import('@/lib/failed-imports');
    await keepFailedUpload(db, {
      userId: 'u1',
      batchId: summary.batchId,
      filename: 't212-api-2019.csv',
      data: bytes(NEZNAMY_VYPIS),
      reason: 'Formát exportu z API nepoznáváme.',
      source: 'sync',
      platform: 'Trading 212',
    });

    const [item] = await listOpenCases(db);
    expect(item!.source).toBe('sync');
    expect(item!.reportedPlatform).toBe('Trading 212');

    // …ale upozornění nesmí tvrdit, že to nahlásil uživatel — ten neudělal nic
    const alert = emails().at(-1)!;
    expect(alert.subject).not.toContain('uživatel nahlásil');
    expect(alert.text).not.toContain('Uživatel doplnil');
  });

  it('obří export se neschovává (base64 v jednom řádku)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const { keepFailedUpload } = await import('@/lib/failed-imports');
    const obri = new TextEncoder().encode('x'.repeat(9 * 1024 * 1024)).buffer as ArrayBuffer;
    const kept = await keepFailedUpload(db, {
      userId: 'u1',
      batchId: 'b1',
      filename: 't212-api-2019.csv',
      data: obri,
      reason: 'Formát exportu z API nepoznáváme.',
      source: 'sync',
    });
    expect(kept).toBeNull();
    expect(await listOpenCases(db)).toHaveLength(0);
  });
});

describe('retence', () => {
  it('případ starší 90 dnů se smaže', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    expect(await pruneFailedImports(db)).toBe(0);

    const zaDeset = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
    expect(await pruneFailedImports(db, zaDeset)).toBe(1);
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('smazání účtu vezme uložený výpis s sebou (FK kaskáda)', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    await db.delete(user).where(eq(user.id, 'u1'));
    expect(await db.select().from(failedImports)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
  });
});

/**
 * K5-08 (levná půlka): výpadek databáze uprostřed importu se tvářil stejně
 * jako rozbitý výpis.
 *
 * Naměřeno v auditu na skutečně zabitém spojení: uživatel četl „Soubor se
 * nepodařilo zpracovat — nejspíš je poškozený… Stáhni ho od brokera znovu“,
 * originál se uschoval do `failed_imports` a provozovateli přišel poplach
 * o formátu, který ve skutečnosti umíme přečíst. Tři nepravdy z jedné příčiny,
 * a k tomu uložené osobní údaje, které tam nemají co dělat.
 *
 * Atomicita importu (osiřelé transakce) je samostatná, dražší položka —
 * tohle řeší jen rozlišení „spadl parser“ vs. „spadla databáze“.
 */
describe('výpadek databáze není vada souboru (K5-08)', () => {
  const dbChyba = () => {
    const error = new Error('write CONNECTION_CLOSED');
    (error as { code?: string }).code = 'CONNECTION_CLOSED';
    return error;
  };

  it('chyba z databáze: soubor se neschovává a hláška neobviňuje broker', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const puvodni = db.insert.bind(db);
    let pad = true;
    // Soubor je čitelný T212 export — jediné, co selže, je zápis do databáze.
    (db as unknown as { insert: typeof puvodni }).insert = ((table: never) => {
      if (pad) {
        pad = false;
        throw dbChyba();
      }
      return puvodni(table);
    }) as typeof puvodni;

    const summary = await importFileIsolated(db, 'u1', 't212.csv', bytes(T212_VYPIS));
    (db as unknown as { insert: typeof puvodni }).insert = puvodni;

    // `unrecognized` je v souhrnu jen když se opravdu schovává (viz importParsed)
    expect(summary.unrecognized).not.toBe(true);
    expect(summary.errors[0]!.message).toContain('databáze');
    expect(summary.errors[0]!.message).not.toContain('poškozený');
    expect(await listOpenCases(db)).toHaveLength(0);
  });

  it('výjimka v parseru se schovává dál', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const summary = await importFileIsolated(db, 'u1', 'vypis.csv', bytes(NEZNAMY_VYPIS));
    expect(summary.unrecognized).toBe(true);
    expect(await listOpenCases(db)).toHaveLength(1);
  });
});
