import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import { importBatches, user } from '@/db/schema';
import {
  capStoredIssues,
  MAX_STORED_ISSUES,
  MAX_STORED_TEXT,
  MAX_STORED_UNMAPPED,
  type StoredIssues,
} from '@/lib/import-issues';
import { importFileIsolated } from '@/lib/import-service';

/**
 * Strop na chyby uložené u dávky (L8b-02).
 *
 * Dávka si do `issues` ukládala VŠECHNY hlášky parseru a hláška smí citovat
 * buňku. Výpis s tisíci vadnými řádky (nebo s jednou obří buňkou) tak nechal
 * v historii importů megabajty JSON, které stránka /import i export načítají
 * celé. Počty dál nesou sloupce `error_count` a spol. — krátí se jen seznam.
 */

const TEMPLATE_HEADER =
  'type,date,isin,ticker,name,quantity,price,currency,amount,withholding_tax,source_country,note';

/** Pevná mez na velikost `issues` jedné dávky (znaků JSON). */
const MAX_ISSUES_JSON = 400_000;

const withUser = async (): Promise<Db> => {
  const db = await createPgliteDb();
  await db.insert(user).values({ id: 'u1', name: 'Test', email: 'test@danero.cz' });
  return db;
};

const uploadText = (db: Db, lines: string[]) =>
  importFileIsolated(
    db,
    'u1',
    'sablona.csv',
    new TextEncoder().encode(lines.join('\n')).buffer as ArrayBuffer,
  );

const storedBatch = async (db: Db) => {
  const [batch] = await db.select().from(importBatches).where(eq(importBatches.userId, 'u1'));
  return { batch: batch!, issues: batch!.issues as StoredIssues };
};

describe('strop na uložené chyby dávky (L8b-02)', () => {
  it(
    'výpis s 5 000 vadnými řádky: počet zůstane, uložených chyb je nejvýš strop a dávka to o sobě ví',
    { timeout: 120_000 },
    async () => {
      const db = await withUser();
      const lines = [TEMPLATE_HEADER];
      for (let i = 0; i < 5000; i += 1) {
        lines.push(`DIVIDEND,neplatne-datum-${i},US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,`);
      }
      const summary = await uploadText(db, lines);
      // hlášky hned po nahrání se nekrátí
      expect(summary.errors).toHaveLength(5000);

      const { batch, issues } = await storedBatch(db);
      expect(batch.errorCount).toBe(5000);
      expect(issues.errors.length).toBeLessThanOrEqual(100);
      expect(issues.errors.length).toBe(MAX_STORED_ISSUES);
      expect(issues.truncated).toContain('errors');
      // uložené jsou první chyby v pořadí souboru
      expect(issues.errors[0]).toMatchObject({ line: summary.errors[0]!.line });
      expect(JSON.stringify(batch.issues).length).toBeLessThan(MAX_ISSUES_JSON);
    },
  );

  it(
    'řádek s buňkou o desítkách tisíc znaků: uložená hláška má nejvýš stanovenou délku',
    { timeout: 60_000 },
    async () => {
      const db = await withUser();
      const huge = 'x'.repeat(40_000);
      const summary = await uploadText(db, [
        TEMPLATE_HEADER,
        `DIVIDEND,${huge},US0000000026,BETA,Beta Test,,,USD,12.00,1.80,US,`,
      ]);
      expect(summary.errors).toHaveLength(1);

      const { batch, issues } = await storedBatch(db);
      expect(batch.errorCount).toBe(1);
      expect(issues.errors).toHaveLength(1);
      for (const issue of issues.errors) {
        expect(issue.message.length).toBeLessThanOrEqual(MAX_STORED_TEXT);
        expect((issue.raw ?? '').length).toBeLessThanOrEqual(MAX_STORED_TEXT);
      }
      expect(JSON.stringify(batch.issues).length).toBeLessThan(10_000);
    },
  );

  it('běžná dávka se nemění a příznak zkrácení nemá', () => {
    const issues = {
      errors: [{ line: 2, message: 'Chybí datum.' }],
      skipped: [],
      warnings: [{ line: 1, message: 'Pozor.', raw: 'a,b' }],
      unmapped: [{ broker: 'schwab', symbol: 'ZZTA', needsCurrency: false }],
      crossBroker: ['Shoda s jiným brokerem.'],
    };
    expect(capStoredIssues(issues)).toEqual(issues);
  });

  it('prázdné seznamy unmapped a crossBroker se neukládají vůbec', () => {
    const stored = capStoredIssues({
      errors: [],
      skipped: [],
      warnings: [],
      unmapped: [],
      crossBroker: [],
    });
    expect(stored).toEqual({ errors: [], skipped: [], warnings: [] });
  });

  it('každý seznam má svůj strop, číselník štědřejší, a nejhorší případ se vejde pod mez', () => {
    const text = 'ž'.repeat(50_000);
    const many = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ line: i + 2, message: text, raw: text }));
    const stored = capStoredIssues({
      errors: many(5000),
      skipped: many(5000),
      warnings: many(5000),
      unmapped: Array.from({ length: 5000 }, (_, i) => ({
        broker: 'schwab',
        symbol: `SYM${i}`,
        needsCurrency: false,
      })),
      crossBroker: Array.from({ length: 5000 }, () => text),
    });
    expect(stored.errors).toHaveLength(MAX_STORED_ISSUES);
    expect(stored.skipped).toHaveLength(MAX_STORED_ISSUES);
    expect(stored.warnings).toHaveLength(MAX_STORED_ISSUES);
    expect(stored.crossBroker).toHaveLength(MAX_STORED_ISSUES);
    expect(stored.unmapped).toHaveLength(MAX_STORED_UNMAPPED);
    expect(MAX_STORED_UNMAPPED).toBeGreaterThan(MAX_STORED_ISSUES);
    expect(stored.truncated).toEqual(['errors', 'skipped', 'warnings', 'unmapped', 'crossBroker']);
    expect(stored.errors[0]!.message.length).toBe(MAX_STORED_TEXT);
    expect(stored.errors[0]!.message.endsWith('…')).toBe(true);
    expect(stored.crossBroker![0]!.length).toBe(MAX_STORED_TEXT);
    expect(JSON.stringify(stored).length).toBeLessThan(MAX_ISSUES_JSON);
  });

  it('symbol delší než strop se do číselníku neukládá — zkrácený by se už nikdy nespároval', () => {
    const stored = capStoredIssues({
      errors: [],
      skipped: [],
      warnings: [],
      unmapped: [
        { broker: 'schwab', symbol: 'Q'.repeat(5000), needsCurrency: false },
        { broker: 'schwab', symbol: 'ZZTA', needsCurrency: false },
      ],
      crossBroker: [],
    });
    expect(stored.unmapped).toEqual([{ broker: 'schwab', symbol: 'ZZTA', needsCurrency: false }]);
    expect(stored.truncated).toEqual(['unmapped']);
  });
});
