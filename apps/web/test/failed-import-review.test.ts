import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { auditLog, failedImports, user } from '@/db/schema';
import { eraseCase, rejectCase, retryCase } from '@/lib/failed-import-review';
import { listOpenCases, loadOpenCase, resolveCase } from '@/lib/failed-imports';
import { importFileIsolated } from '@/lib/import-service';

/**
 * Nástroj provozovatele nad nepřečteným výpisem (`lib/failed-import-review.ts`).
 *
 * Do 4. auditu tahle logika bydlela ve `scripts/failed-imports.ts`, kam žádný
 * test nedosáhl — a byly v ní tři nálezy naráz: druhý e-mail o uzavřeném
 * případu (K2-05), smazané cizí řádky auditu (K6a-13) a originál výpisu ležící
 * dál i po vyřízení případu (K4-05).
 */

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

/** Výpis od vymyšlené platformy: sniffery ho nepoznají, „type“ v něm není. */
const NEZNAMY_VYPIS = [
  'Obchodni den;Titul;Operace;Mnozstvi;Kurz;Mena',
  '2026-01-05;CEZ;Nakup;10;1050,50;CZK',
].join('\n');

const T212_VYPIS = [
  'Action,Time,ISIN,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Result,Currency (Result),Total,Currency (Total),Withholding tax,Currency (Withholding tax),Notes,ID',
  'Market buy,2024-06-10 14:30:02,US0378331005,AAPL,Apple Inc,100,185.50,USD,,,,,,,,,EOF1',
].join('\n');

let emailLog: string;

const emails = (): Array<{ to: string; subject: string; text: string }> =>
  readFileSync(emailLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; subject: string; text: string });

const uzivateli = (): Array<{ subject: string }> => emails().filter((m) => m.to === 'test@danero.cz');

async function freshDb(): Promise<Db> {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  return db;
}

/** Nepřečtený výpis + jeho případ, tak jak vznikne uživateli při nahrání. */
async function pripad(db: Db, filename = 'vypis.csv'): Promise<string> {
  await importFileIsolated(db, 'u1', filename, bytes(NEZNAMY_VYPIS));
  const [item] = await listOpenCases(db);
  return item!.id;
}

const obsah = async (db: Db, caseId: string): Promise<string | null> => {
  const [row] = await db
    .select({ content: failedImports.content })
    .from(failedImports)
    .where(eq(failedImports.id, caseId));
  return row!.content;
};

const auditniRadky = (db: Db) =>
  db.select().from(auditLog).where(and(eq(auditLog.userId, 'u1'), eq(auditLog.type, 'IMPORT')));

beforeEach(() => {
  emailLog = join(mkdtempSync(join(tmpdir(), 'danero-review-')), 'emails.log');
  process.env.DANERO_EMAIL_LOG = emailLog;
  process.env.DANERO_ALERT_EMAIL = 'provoz@example.test';
});

afterEach(() => {
  delete process.env.DANERO_EMAIL_LOG;
  delete process.env.DANERO_ALERT_EMAIL;
});

describe('uzavřený případ už žádný podpříkaz nevezme (K2-05)', () => {
  it('druhý reject neodešle druhý e-mail a řekne, v jakém stavu případ je', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);

    expect(await rejectCase(db, caseId, 'Je to potvrzení o obchodu.')).toEqual({
      outcome: 'rejected',
      email: 'test@danero.cz',
    });
    expect(uzivateli()).toHaveLength(1);

    expect(await rejectCase(db, caseId, 'Podruhé.')).toEqual({
      outcome: 'closed',
      status: 'rejected',
    });
    expect(uzivateli()).toHaveLength(1);
  });

  it('retry nad doimportovaným případem nepošle druhé „už umíme přečíst“', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db, 't212.csv');
    // „oprava parseru“: týž případ, ale soubor už přečteme
    await db
      .update(failedImports)
      .set({ content: Buffer.from(bytes(T212_VYPIS)).toString('base64') })
      .where(eq(failedImports.id, caseId));

    const prvni = await retryCase(db, caseId);
    expect(prvni.outcome).toBe('fixed');
    expect(uzivateli()).toHaveLength(1);

    expect(await retryCase(db, caseId)).toEqual({ outcome: 'closed', status: 'fixed' });
    expect(uzivateli()).toHaveLength(1);
  });

  it('neexistující případ se od uzavřeného pozná', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    expect(await retryCase(db, 'takovy-neni')).toEqual({ outcome: 'missing' });
    expect(await rejectCase(db, 'takovy-neni', 'x')).toEqual({ outcome: 'missing' });
  });

  /**
   * Obě poloviny kořene zvlášť. Testy nad `retryCase`/`rejectCase` výš samy
   * nestačí: obsah se při uzavření maže (K4-05), takže by jim uzavřený případ
   * propadl i bez filtru na `status` — a nález by se dal „opravit" jen tou
   * druhou opravou.
   */
  it('resolveCase uzavře jen otevřený případ — podruhé neuzavírá a neposílá', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);

    expect(await resolveCase(db, caseId, { status: 'rejected', note: 'Nečitelné.' })).toBe(true);
    expect(uzivateli()).toHaveLength(1);

    expect(await resolveCase(db, caseId, { status: 'fixed', added: 3 })).toBe(false);
    expect(uzivateli()).toHaveLength(1);
  });

  it('loadOpenCase nevydá uzavřený případ, ani když u něj obsah ještě leží', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);
    // stav se přepíše ručně, obsah zůstává — takhle vypadá případ uzavřený
    // ještě před tím, než se soubor při uzavírání začal mazat (migrace 0040)
    await db.update(failedImports).set({ status: 'fixed' }).where(eq(failedImports.id, caseId));

    expect(await obsah(db, caseId)).not.toBeNull();
    expect(await loadOpenCase(db, caseId)).toBeNull();
  });
});

describe('neúspěšný retry uklidí jen po sobě (K6a-13)', () => {
  it('nesmaže uživatelův vlastní záznam o nahrání téhož souboru', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    // uživatelovo vlastní nahrání zapsalo do auditu „vypis.csv (…): 0 nových“
    const caseId = await pripad(db);
    expect(await auditniRadky(db)).toHaveLength(1);

    // provozovatel zkusí doimport, ale soubor pořád nepřečteme: jeho vlastní
    // (druhý) auditní řádek musí zmizet a ten uživatelův zůstat
    const result = await retryCase(db, caseId);
    expect(result.outcome).toBe('unresolved');

    const zbylo = await auditniRadky(db);
    expect(zbylo).toHaveLength(1);
    expect(zbylo[0]!.detail).toContain('vypis.csv');
  });
});

describe('uschovaný originál mizí, jakmile je případ vyřízený (K4-05)', () => {
  it('po doimportu (fixed) obsah v databázi nezůstává', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db, 't212.csv');
    await db
      .update(failedImports)
      .set({ content: Buffer.from(bytes(T212_VYPIS)).toString('base64') })
      .where(eq(failedImports.id, caseId));
    expect(await obsah(db, caseId)).not.toBeNull();

    expect((await retryCase(db, caseId)).outcome).toBe('fixed');
    expect(await obsah(db, caseId)).toBeNull();
  });

  it('po uzavření jako nečitelný (rejected) taky — číst ho stejně neumíme', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);
    expect(await obsah(db, caseId)).not.toBeNull();

    await rejectCase(db, caseId, 'Stáhni prosím Historii transakcí.');
    expect(await obsah(db, caseId)).toBeNull();
  });

  it('neúspěšný retry si soubor nechává — případ zůstává otevřený', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);
    expect((await retryCase(db, caseId)).outcome).toBe('unresolved');
    expect(await obsah(db, caseId)).not.toBeNull();
    expect(await listOpenCases(db)).toHaveLength(1);
  });
});

describe('výmaz na žádost uživatele (K4-05)', () => {
  it('smaže celý případ i s obsahem a neposílá žádný e-mail', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);
    const pred = emails().length;

    expect(await eraseCase(db, caseId)).toEqual({
      outcome: 'deleted',
      filename: 'vypis.csv',
      email: 'test@danero.cz',
    });
    expect(await db.select().from(failedImports)).toHaveLength(0);
    expect(emails()).toHaveLength(pred);
  });

  it('funguje i na už uzavřený případ — žádost o výmaz se stavem neřídí', {
    timeout: 30_000,
  }, async () => {
    const db = await freshDb();
    const caseId = await pripad(db);
    await rejectCase(db, caseId, 'Nečitelné.');

    expect((await eraseCase(db, caseId)).outcome).toBe('deleted');
    expect(await db.select().from(failedImports)).toHaveLength(0);
  });

  it('neexistující případ hlásí, ne mlčí', { timeout: 30_000 }, async () => {
    const db = await freshDb();
    expect(await eraseCase(db, 'takovy-neni')).toEqual({ outcome: 'missing' });
  });
});
