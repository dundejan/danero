import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb, type Db } from '@/db';
import {
  appRateLimits,
  brokerAccounts,
  importBatches,
  notifications,
  rateLimit,
  session,
  user,
  verification,
} from '@/db/schema';
import { checkRateLimit, pruneRateLimits } from '@/lib/rate-limit';
import { resolveEmailSender } from '@/lib/email';
import {
  pruneAuthRateLimits,
  pruneImportBatches,
  pruneNotifications,
  pruneSessions,
  pruneVerifications,
  reencryptBrokerCredentials,
} from '@/lib/retention';

describe('úklid provozních tabulek', () => {
  it('prošlá okna rate limitů se smažou, běžící zůstanou', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    // prošlá okna se mažou bez ohledu na tvar klíče — i kdyby v něm někdy
    // zase byla syrová IP (anonymní limit), tohle je jediné, co ji uklidí
    await db.insert(appRateLimits).values([
      { key: 'epo:203.0.113.7', count: 1, resetAt: new Date('2026-01-01T00:00:00Z') },
      { key: 'upload:smazany-uzivatel', count: 3, resetAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    await checkRateLimit(db, 'upload:aktivni', { max: 10, windowMs: 600_000 });

    const deleted = await pruneRateLimits(db, new Date('2026-08-06T00:00:00Z'));

    expect(deleted).toBe(2);
    const zbytek = await db.select({ key: appRateLimits.key }).from(appRateLimits);
    expect(zbytek.map((r) => r.key)).toEqual(['upload:aktivni']);
  });
});

describe('pojistka na DANERO_EMAIL_LOG', () => {
  afterEach(() => {
    delete process.env.DANERO_EMAIL_LOG;
    delete process.env.RESEND_API_KEY;
  });

  it('vedle nastaveného Resendu se e-maily nesmí přesměrovat do souboru', () => {
    process.env.DANERO_EMAIL_LOG = '/tmp/danero-e2e-maily.log';
    process.env.RESEND_API_KEY = 're_testovaci_klic';
    expect(() => resolveEmailSender()).toThrow(/DANERO_EMAIL_LOG/);
  });

  it('bez Resendu soubor dál funguje — E2E (i to produkční) ho potřebuje', () => {
    process.env.DANERO_EMAIL_LOG = '/tmp/danero-e2e-maily.log';
    expect(resolveEmailSender()).toBeTypeOf('function');
  });
});

describe('retence záznamů o synchronizacích (E-16)', () => {
  it('smaže staré joby, ale poslední u každého účtu nechá', { timeout: 30_000 }, async () => {
    const { jobs } = await import('@/db/schema');
    const { pruneJobs } = await import('@/lib/jobs');
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'T', email: 't@danero.cz' });

    const den = (iso: string) => new Date(iso);
    await db.insert(jobs).values([
      // starý neúspěšný plný sync — je to POSLEDNÍ u svého účtu, drží resume stav
      { id: 'stary-posledni', userId: 'u1', type: 't212-sync', dedupeKey: 'acc-a', status: 'error', createdAt: den('2025-01-01') },
      // starší joby téhož účtu už držet nemusíme
      { id: 'stary-predchozi', userId: 'u1', type: 't212-sync', dedupeKey: 'acc-b', status: 'success', createdAt: den('2025-01-02') },
      { id: 'novejsi', userId: 'u1', type: 't212-sync', dedupeKey: 'acc-b', status: 'success', createdAt: den('2026-08-01') },
    ]);

    const smazano = await pruneJobs(db, den('2026-08-07'));

    expect(smazano).toBe(1);
    const zbyle = (await db.select({ id: jobs.id }).from(jobs)).map((j) => j.id).sort();
    // resume stav posledního neúspěšného syncu musí přežít i po 90 dnech
    expect(zbyle).toEqual(['novejsi', 'stary-posledni']);
  });

  it(
    'úklid zvládne i backlog přes 65 534 jobů (G-R2)',
    { timeout: 120_000 },
    async () => {
      const { jobs } = await import('@/db/schema');
      const { pruneJobs } = await import('@/lib/jobs');
      const db = await createPgliteDb();
      await db.insert(user).values({ id: 'u1', name: 'T', email: 't@danero.cz' });

      // 70 002 jobů na třech účtech. Původní verze poslala všechna mazaná id do
      // jednoho `IN (…)` a spadla na MAX_PARAMETERS_EXCEEDED (limit 65 534) —
      // a protože pak nesmazala NIC, backlog už nikdy neklesl a denní údržba
      // byla rozbitá natrvalo.
      await db.execute(sql`
        insert into jobs (id, user_id, type, dedupe_key, status, created_at)
        select 'j-' || g, 'u1', 't212-sync', 'acc-' || (g % 3), 'success',
               now() - interval '400 days'
        from generate_series(1, 70002) g
      `);

      expect(await pruneJobs(db)).toBe(69_999);
      // po každém klíči zůstal právě jeden (nejnovější) job — nese resume stav
      const zbylo = await db.select({ dedupeKey: jobs.dedupeKey }).from(jobs);
      expect(zbylo.map((j) => j.dedupeKey).sort()).toEqual(['acc-0', 'acc-1', 'acc-2']);
      // druhý běh už nemá co mazat (idempotence denního cronu)
      expect(await pruneJobs(db)).toBe(0);
    },
  );
});

describe('retence tabulek, které dosud neuklízel nikdo (G-R1)', () => {
  const DEN = 24 * 60 * 60 * 1000;
  const TED = new Date('2026-08-08T12:00:00Z');
  const pred = (dnu: number) => new Date(TED.getTime() - dnu * DEN);

  async function seed(): Promise<Db> {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'T', email: 't@danero.cz' });
    return db;
  }

  it('prošlé přihlašovací relace se smažou, živé zůstanou', { timeout: 30_000 }, async () => {
    const db = await seed();
    await db.insert(session).values([
      // /soukromi slibuje u záznamů o přihlášeních 90 dní; session žije 7 dní,
      // takže po expiraci je to jen záznam o dávno skončeném přihlášení
      { id: 'prosla', userId: 'u1', token: 't1', expiresAt: pred(400), createdAt: pred(407) },
      { id: 'ziva', userId: 'u1', token: 't2', expiresAt: pred(-5), createdAt: pred(2) },
    ]);

    expect(await pruneSessions(db, TED)).toBe(1);
    const zbyle = await db.select({ id: session.id }).from(session);
    expect(zbyle.map((s) => s.id)).toEqual(['ziva']);
  });

  it('prošlé ověřovací tokeny se smažou, platné zůstanou', { timeout: 30_000 }, async () => {
    const db = await seed();
    await db.insert(verification).values([
      { id: 'prosly', identifier: 'reset:t@danero.cz', value: 'x', expiresAt: pred(400) },
      { id: 'platny', identifier: 'verify:t@danero.cz', value: 'y', expiresAt: pred(-1) },
    ]);

    expect(await pruneVerifications(db, TED)).toBe(1);
    const zbyle = await db.select({ id: verification.id }).from(verification);
    expect(zbyle.map((v) => v.id)).toEqual(['platny']);
  });

  it('stará historie importů se smaže, čerstvá zůstane', { timeout: 30_000 }, async () => {
    const db = await seed();
    const davka = (id: string, dnu: number) => ({
      id,
      userId: 'u1',
      broker: 'trading212',
      filename: `${id}.csv`,
      added: 1,
      duplicates: 0,
      errorCount: 0,
      skippedCount: 0,
      warningCount: 0,
      issues: {},
      createdAt: pred(dnu),
    });
    await db.insert(importBatches).values([davka('stara', 91), davka('cerstva', 89)]);

    expect(await pruneImportBatches(db, TED)).toBe(1);
    const zbyle = await db.select({ id: importBatches.id }).from(importBatches);
    expect(zbyle.map((b) => b.id)).toEqual(['cerstva']);
  });

  it(
    'upozornění: smaže se jen odeslané a starší než rok, který by šel přepočítat',
    { timeout: 30_000 },
    async () => {
      const db = await seed();
      const zprava = (dedupeKey: string, dnu: number, emailedAt: Date | null) => ({
        userId: 'u1',
        dedupeKey,
        type: 'LIMIT_EXCEEDED',
        title: 't',
        body: 'b',
        createdAt: pred(dnu),
        ...(emailedAt ? { emailedAt } : {}),
      });
      await db.insert(notifications).values([
        zprava('limit|100k|EXCEEDED|2025', 401, pred(401)),
        // událost o limitu za BĚŽÍCÍ rok umí denní běh založit znovu — kdyby se
        // po 90 dnech smazala, přišel by uživateli druhý stejný e-mail
        zprava('limit|100k|EXCEEDED|2026', 200, pred(200)),
        // neodeslané čeká ve frontě na digest, to se nesmí smazat nikdy
        zprava('limit|50k|EXCEEDED|2024', 800, null),
      ]);

      expect(await pruneNotifications(db, TED)).toBe(1);
      const zbyle = await db.select({ dedupeKey: notifications.dedupeKey }).from(notifications);
      expect(zbyle.map((n) => n.dedupeKey).sort()).toEqual([
        'limit|100k|EXCEEDED|2026',
        'limit|50k|EXCEEDED|2024',
      ]);
    },
  );

  it('denní cron uklidí všechny tabulky naráz a vrátí počty', { timeout: 30_000 }, async () => {
    const db = await seed();
    await db.insert(session).values({
      id: 'prosla',
      userId: 'u1',
      token: 't1',
      expiresAt: pred(400),
    });
    await db.insert(verification).values({
      id: 'prosly',
      identifier: 'reset:t@danero.cz',
      value: 'x',
      expiresAt: pred(400),
    });

    process.env.CRON_SECRET = 'tajne';
    vi.doMock('@/db', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/db')>()),
      getDb: async () => db,
    }));
    const { GET } = await import('@/app/api/cron/maintenance/route');
    const odpoved = await GET(
      new Request('https://danero.cz/api/cron/maintenance', {
        headers: { authorization: 'Bearer tajne' },
      }),
    );
    vi.doUnmock('@/db');
    delete process.env.CRON_SECRET;

    expect(odpoved.status).toBe(200);
    expect(await odpoved.json()).toMatchObject({ sessionsDeleted: 1, verificationsDeleted: 1 });
    expect(await db.select().from(session)).toHaveLength(0);
    expect(await db.select().from(verification)).toHaveLength(0);
  });
});

/**
 * F-3-11: vlastní tabulka rate limitů Better Authu neuklízela nikoho.
 * D-3-03: rotace šifrovacího klíče neměla jak skončit — `reencryptSecret()`
 * nikdo nevolal, takže vyřazený klíč musel v konfiguraci zůstat navždy.
 */
describe('údržba: rate_limit Better Authu a dokončení rotace klíče', () => {
  it('maže jen prošlé řádky rate_limit, běžící okno nechá', async () => {
    const db = await createPgliteDb();
    const now = new Date('2026-08-10T12:00:00Z');
    const stary = Math.floor(now.getTime() / 1000) - 7200; // 2 hodiny zpět
    const cerstvy = Math.floor(now.getTime() / 1000) - 60;
    await db.insert(rateLimit).values([
      { id: 'rl-stary', key: 'ip:1.2.3.4/sign-in', count: 3, lastRequest: stary },
      { id: 'rl-cerstvy', key: 'ip:5.6.7.8/sign-in', count: 1, lastRequest: cerstvy },
    ]);

    expect(await pruneAuthRateLimits(db, now)).toBe(1);
    const zbylo = await db.select({ id: rateLimit.id }).from(rateLimit);
    expect(zbylo.map((r) => r.id)).toEqual(['rl-cerstvy']);
  });

  it('rotace přepíše tajemství na starém klíči a to na aktuálním nechá', async () => {
    const db = await createPgliteDb();
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const aktualni = encryptSecret('klic-na-aktualnim');
    await db.insert(user).values({
      id: 'u-rot',
      name: 'Rotace',
      email: 'rotace@danero.cz',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(brokerAccounts).values({
      id: 'ba-rot',
      userId: 'u-rot',
      broker: 'trading212',
      credentialsEncrypted: aktualni,
    });

    // nic k rotaci — všechno už je na aktuálním klíči
    expect(await reencryptBrokerCredentials(db)).toBe(0);
    const [row] = await db
      .select({ c: brokerAccounts.credentialsEncrypted })
      .from(brokerAccounts);
    expect(row!.c).toBe(aktualni);
    expect(decryptSecret(row!.c)).toBe('klic-na-aktualnim');
  });

  it('nedešifrovatelný záznam rotaci nezastaví', async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({
      id: 'u-rot2',
      name: 'Rotace',
      email: 'rotace2@danero.cz',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(brokerAccounts).values({
      id: 'ba-rozbity',
      userId: 'u-rot2',
      broker: 'trading212',
      credentialsEncrypted: 'v1.nesmysl.nesmysl.nesmysl',
    });
    await expect(reencryptBrokerCredentials(db)).resolves.toBe(0);
  });
});
