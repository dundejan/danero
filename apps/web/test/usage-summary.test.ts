import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import {
  appRateLimits,
  brokerAccounts,
  failedImports,
  importBatches,
  transactions,
  user,
} from '@/db/schema';
import {
  computeUsageSummary,
  isSummaryDay,
  sendWeeklyUsageSummary,
  USAGE_SUMMARY_CLAIM,
  usageSummaryEmail,
} from '@/lib/usage-summary';
import { emailsIn } from './auth-helpers';

/** Pondělí 9. 11. 2026, 1:30 UTC — tak, jak běží cron údržby. */
const MONDAY = new Date('2026-11-09T01:30:00Z');
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

async function seed(db: Db): Promise<void> {
  await db.insert(user).values([
    // starší účet s daty z importu
    { id: 'stary', name: 'A', email: 'stary@example.cz', emailVerified: true, createdAt: day('2026-10-01') },
    // v týdnu: potvrzený s importem
    { id: 'novy-import', name: 'B', email: 'b@example.cz', emailVerified: true, createdAt: day('2026-11-03') },
    // v týdnu: potvrzený s napojeným brokerem, bez transakcí (sync ještě neběžel)
    { id: 'novy-broker', name: 'C', email: 'c@example.cz', emailVerified: true, createdAt: day('2026-11-05') },
    // v týdnu: nepotvrzený
    { id: 'novy-nepotvrzeny', name: 'D', email: 'd@example.cz', emailVerified: false, createdAt: day('2026-11-08') },
    // neděle 23:30 UTC je v Praze už pondělí 0:30 — patří do dalšího týdne
    { id: 'po-pulnoci', name: 'E', email: 'e@example.cz', emailVerified: true, createdAt: new Date('2026-11-08T23:30:00Z') },
    // před začátkem týdne: neděle 1. 11. 23:30 pražského času (22:30 UTC)
    { id: 'pred-tydnem', name: 'F', email: 'f@example.cz', emailVerified: false, createdAt: new Date('2026-11-01T22:30:00Z') },
  ]);
  await db.insert(importBatches).values([
    { id: 'b-stara', userId: 'stary', broker: 'trading212', filename: 'a.csv', added: 1, duplicates: 0, errorCount: 0, skippedCount: 0, warningCount: 0, issues: {}, createdAt: day('2026-10-01') },
    { id: 'b-tyden', userId: 'novy-import', broker: 'xtb', filename: 'b.xlsx', added: 1, duplicates: 0, errorCount: 0, skippedCount: 0, warningCount: 0, issues: {}, createdAt: day('2026-11-04') },
  ]);
  await db.insert(transactions).values([
    { userId: 'stary', dedupeKey: 'trading212|a|1', batchId: 'b-stara', broker: 'trading212', type: 'BUY', txDate: '2026-01-02', payload: {} },
    { userId: 'novy-import', dedupeKey: 'xtb|b|1', batchId: 'b-tyden', broker: 'xtb', type: 'BUY', txDate: '2026-02-03', payload: {} },
  ]);
  await db.insert(brokerAccounts).values({
    id: 'ba1',
    userId: 'novy-broker',
    broker: 'trading212',
    credentialsEncrypted: 'x',
    createdAt: day('2026-11-05'),
  });
  await db.insert(failedImports).values({
    id: 'f1',
    userId: 'novy-nepotvrzeny',
    batchId: 'nic',
    filename: 'divny.csv',
    byteSize: 10,
    contentHash: 'h',
    reason: 'Nepoznaný formát',
    createdAt: day('2026-11-08'),
  });
}

describe('týdenní souhrn používání (K11)', () => {
  let logPath: string;

  beforeEach(() => {
    logPath = join(mkdtempSync(join(tmpdir(), 'danero-souhrn-')), 'emails.log');
    process.env.DANERO_EMAIL_LOG = logPath;
    process.env.DANERO_ALERT_EMAIL = 'provoz@example.cz';
  });

  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
    delete process.env.DANERO_ALERT_EMAIL;
    vi.unstubAllEnvs();
  });

  it('počítá kalendářní týden po–ne v pražském čase a celkový stav ke konci týdne', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seed(db);

    const summary = await computeUsageSummary(db, MONDAY);

    expect(summary.from.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(summary.to.toISOString()).toBe('2026-11-08T23:00:00.000Z');
    expect(summary).toMatchObject({
      signups: 3,
      signupsVerified: 2,
      signupsWithData: 2,
      accounts: 5,
      accountsVerified: 3,
      accountsWithData: 3,
      brokerConnections: 1,
      brokerConnectionsNew: 1,
      imports: 1,
      failedImports: 1,
    });
  });

  it('e-mail nese jen počty: žádnou adresu ani identifikátor účtu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seed(db);
    const message = usageSummaryEmail(await computeUsageSummary(db, MONDAY));

    expect(message.subject).toBe('Danero: týden v číslech (2. 11.–8. 11.)');
    for (const body of [message.text, message.html ?? '']) {
      expect(body).not.toMatch(/@example\.cz/);
      expect(body).not.toMatch(/novy-|stary|ba1/);
    }
    expect(message.text).toContain('Nové účty');
  });

  it('odejde jen v pondělí a jen jednou, i když cron běží dvakrát', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seed(db);

    expect(await sendWeeklyUsageSummary(db, new Date('2026-11-10T01:30:00Z'))).toBe('not-today');
    expect(await sendWeeklyUsageSummary(db, MONDAY)).toBe('sent');
    expect(await sendWeeklyUsageSummary(db, new Date('2026-11-09T01:50:00Z'))).toBe('already-sent');

    const sent = emailsIn(logPath);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('provoz@example.cz');
  });

  it('týden přes změnu času (25. 10. 2026) začíná i končí pražskou půlnocí', async () => {
    const { previousWeek } = await import('@/lib/usage-summary');
    const { from, to } = previousWeek(new Date('2026-10-26T01:30:00Z'));
    // 19. 10. 0:00 letního času (UTC+2) → 25. 10. 24:00 zimního času (UTC+1)
    expect(from.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(to.toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('data nahraná až po konci týdne se k němu nepočítají', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({
      id: 'pozdni',
      name: 'G',
      email: 'g@example.cz',
      emailVerified: true,
      createdAt: day('2026-11-06'),
    });
    // pondělí 9. 11. ve 2 h pražského času, tedy po konci týdne a před odesláním
    await db.insert(brokerAccounts).values({
      id: 'ba-pozdni',
      userId: 'pozdni',
      broker: 'trading212',
      credentialsEncrypted: 'x',
      createdAt: new Date('2026-11-09T01:00:00Z'),
    });

    const summary = await computeUsageSummary(db, MONDAY);

    expect(summary.signups).toBe(1);
    expect(summary.signupsWithData).toBe(0);
    expect(summary.accountsWithData).toBe(0);
  });

  it('pondělí se počítá v pražském čase, ne v UTC', () => {
    // neděle 23:30 UTC je v Praze už pondělí 0:30
    expect(isSummaryDay(new Date('2026-11-08T23:30:00Z'))).toBe(true);
    // pondělí 23:30 UTC je v Praze úterý
    expect(isSummaryDay(new Date('2026-11-09T23:30:00Z'))).toBe(false);
  });

  it('nedoručený souhrn vrátí claim, takže další běh téhož dne to zkusí znovu', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const broken = async () => {
      throw new Error('Resend nedostupný');
    };

    expect(await sendWeeklyUsageSummary(db, MONDAY, broken)).toBe('failed');
    const claims = await db.select().from(appRateLimits);
    expect(claims.map((c) => c.key)).not.toContain(USAGE_SUMMARY_CLAIM);

    expect(await sendWeeklyUsageSummary(db, MONDAY)).toBe('sent');
  });

  it('bez adresy provozovatele se nic neposílá ani nezabírá', { timeout: 30_000 }, async () => {
    delete process.env.DANERO_ALERT_EMAIL;
    // kontakt provozovatele se čte při načtení `lib/contact.ts` a vitest.config
    // ho nastavuje — modul se proto musí načíst znovu s prázdnou hodnotou
    vi.stubEnv('DANERO_CONTACT_EMAIL', '');
    vi.resetModules();
    const fresh = await import('@/lib/usage-summary');
    const db = await createPgliteDb();

    expect(await fresh.sendWeeklyUsageSummary(db, MONDAY)).toBe('no-recipient');
    expect(await db.select().from(appRateLimits)).toHaveLength(0);
    expect(emailsIn(logPath)).toHaveLength(0);
  });
});
