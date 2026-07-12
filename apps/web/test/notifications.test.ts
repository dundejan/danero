import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createPgliteDb, type Db } from '@/db';
import { notificationPrefs, notifications, taxpayerProfiles, user } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
import {
  getNotificationPrefs,
  processUserNotifications,
  type EmailMessage,
} from '@/lib/notifications';

/** Založí uživatele s profilem (paušál) a fixturou CSV. */
async function seedUser(db: Db, id: string, email: string): Promise<void> {
  await db.insert(user).values({ id, name: 'Test', email });
  await db.insert(taxpayerProfiles).values({ userId: id, regime: 'PAUSAL' });
  await importCsvText(db, id, 'fixtura.csv', CSV);
}

/**
 * Scénář (dnes 2026-07-20, paušál):
 * - AAPL koupeno 2023-08-08 (settle) → osvobozeno od 2026-08-09 = za 20 dní → TT30
 * - prodej MSFT za 120 000 CZK (drženo <3 roky) → prolomený limit 50k → LIMIT_EXCEEDED
 *   a zároveň tržby 120k > 100k → LIMIT_EXCEEDED pro 100k
 */
const CSV = [
  'type,date,settlement_date,isin,ticker,name,quantity,price,currency,fee,fee_currency,amount,withholding_tax,source_country,note',
  'BUY,2023-08-08,2023-08-08,US0378331005,AAPL,Apple,10,100,CZK,,,,,,',
  'BUY,2025-02-03,2025-02-03,US5949181045,MSFT,Microsoft,100,1150,CZK,,,,,,',
  'SELL,2026-03-05,2026-03-05,US5949181045,MSFT,Microsoft,100,1200,CZK,,,,,,',
].join('\n');

describe('notifikace (in-memory PGlite)', () => {
  it('vypočte události, uloží jednou a pošle jeden digest', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u1', name: 'Test', email: 'notify@danero.cz' });
    await db.insert(taxpayerProfiles).values({ userId: 'u1', regime: 'PAUSAL' });
    await importCsvText(db, 'u1', 'fixtura.csv', CSV);

    const sent: EmailMessage[] = [];
    const send = async (message: EmailMessage) => {
      sent.push(message);
    };

    const first = await processUserNotifications(db, { id: 'u1', email: 'notify@danero.cz' }, {
      send,
      today: '2026-07-20',
    });
    expect(first.created).toBeGreaterThanOrEqual(3); // TT30 + 50k EXCEEDED + 100k EXCEEDED
    expect(first.emailed).toBe(first.created);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('notify@danero.cz');
    expect(sent[0]!.text).toContain('AAPL');
    expect(sent[0]!.text).toContain('50 000');
    expect(sent[0]!.text).toContain('daňové poradenství');

    // druhý běh týž den: nic nového, žádný e-mail (idempotence)
    const second = await processUserNotifications(db, { id: 'u1', email: 'notify@danero.cz' }, {
      send,
      today: '2026-07-20',
    });
    expect(second.created).toBe(0);
    expect(second.emailed).toBe(0);
    expect(sent).toHaveLength(1);

    // o 15 dní později: AAPL spadne do pásma 7 dní → nová událost TT7
    const later = await processUserNotifications(db, { id: 'u1', email: 'notify@danero.cz' }, {
      send,
      today: '2026-08-04',
    });
    expect(later.created).toBeGreaterThanOrEqual(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('časový test');

    // po osvobození: TT_DONE (do 3 dnů od data osvobození)
    const done = await processUserNotifications(db, { id: 'u1', email: 'notify@danero.cz' }, {
      send,
      today: '2026-08-10',
    });
    expect(done.created).toBeGreaterThanOrEqual(1);
    expect(sent[2]!.text).toContain('osvobozen');
  });

  it('uživatel bez profilu nebo dat se přeskočí', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u2', name: 'Bez', email: 'bez@danero.cz' });
    const sent: EmailMessage[] = [];
    const outcome = await processUserNotifications(db, { id: 'u2', email: 'bez@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
    });
    expect(outcome).toEqual({ created: 0, emailed: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe('krypto limit 100k v hlídači (R-10a)', () => {
  it('překročení krypto limitu vytvoří LIMIT_EXCEEDED s vlastním dedupe klíčem', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');

    const txs = parseTransactions([
      { type: 'BUY', id: 'cb', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '100000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 'cs', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: '2026-04-01' },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, {
        userId: 'u1',
        regime: 'PAUSAL',
        hasBusinessAssets: false,
        w8benFiled: true,
        otherIncomeCzk: '0',
        matchingMethod: 'FIFO',
        fxMethod: 'UNIFIED',
        limit100kStrict: true,
  derivativesExpensesPerDruh: false,
  emtTimeTestExempt: false,
        timeTestBasis: 'settlement',
        createdAt: new Date(),
        updatedAt: new Date(),
      }, 2026),
    );
    const candidates = computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map(),
      today: '2026-07-20',
    });
    const crypto = candidates.find((c) => c.dedupeKey === 'limit|krypto100k|EXCEEDED|2026');
    expect(crypto).toBeDefined();
    expect(crypto!.title).toContain('krypta');
    // CP limit zůstal nedotčený — krypto tržby ho nesmí prolomit
    expect(candidates.some((c) => c.dedupeKey === 'limit|100k|EXCEEDED|2026')).toBe(false);
  });
});

describe('60% pásmo hlídače (LIMIT_WARNING)', () => {
  it('čerpání přes 60 % limitu 100k vytvoří LIMIT_WARNING — web slibuje e-mail při 60/85/100 %', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');

    // prodej CP za 70 000 Kč = 70 % limitu 100k (pásmo WARNING); prodej je
    // hodnotově osvobozený → limit 50k pro paušál zůstává v pásmu OK
    const txs = parseTransactions([
      { type: 'BUY', id: 'wb', isin: 'US0378331005', quantity: '10', pricePerShare: '5000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 'ws', isin: 'US0378331005', quantity: '10', pricePerShare: '7000', currency: 'CZK', tradeDate: '2026-04-01' },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, {
        userId: 'u1',
        regime: 'PAUSAL',
        hasBusinessAssets: false,
        w8benFiled: true,
        otherIncomeCzk: '0',
        matchingMethod: 'FIFO',
        fxMethod: 'UNIFIED',
        limit100kStrict: true,
        derivativesExpensesPerDruh: false,
        emtTimeTestExempt: false,
        timeTestBasis: 'settlement',
        createdAt: new Date(),
        updatedAt: new Date(),
      }, 2026),
    );
    const candidates = computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map(),
      today: '2026-07-20',
    });
    const warning = candidates.find((c) => c.dedupeKey === 'limit|100k|WARNING|2026');
    expect(warning).toBeDefined();
    expect(warning!.type).toBe('LIMIT_WARNING');
    expect(warning!.body).toContain('přes 60 %');
    // 50k limit je v pásmu OK — žádná událost k němu
    expect(candidates.some((c) => c.dedupeKey.startsWith('limit|50k|'))).toBe(false);
  });
});

describe('notifikační preference + odhlášení (G8d, H3)', () => {
  it('vypnutý e-mail (master): události vzniknou všechny, nic se neodešle a fronta se označí', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u3', 'pref@danero.cz');
    // master vypnutý — události se přesto zakládají (přehled v aplikaci je úplný)
    await db.insert(notificationPrefs).values({
      userId: 'u3',
      emailEnabled: false,
      timeTestEvents: false,
      limitEvents: true,
    });

    const sent: EmailMessage[] = [];
    const outcome = await processUserNotifications(db, { id: 'u3', email: 'pref@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
      today: '2026-07-20',
    });
    expect(outcome.created).toBeGreaterThanOrEqual(3); // TT30 + limity 50k a 100k
    expect(outcome.emailed).toBe(0);
    expect(sent).toHaveLength(0);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, 'u3'));
    // H3: i vypnuté typy se do DB založí…
    expect(rows.some((r) => r.type.startsWith('TIME_TEST'))).toBe(true);
    // …a celá fronta se označí emailedAt (po zapnutí nesmí přijít staré události)
    expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
  });

  it('odhlašovací token: podepsaný projde, zfalšovaný ne', async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import('@/lib/notifications');
    const token = await unsubscribeToken('u-abc');
    expect(await verifyUnsubscribeToken(token)).toBe('u-abc');
    // padělek: poslední znak VŽDY přepnout na jiný — replace(/.$/, '0') byl
    // flaky (1/16 podpisů nulou končí a „padělek" byl identický s originálem)
    const forged = token.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
    expect(await verifyUnsubscribeToken(forged)).toBeNull();
    expect(await verifyUnsubscribeToken('nesmysl')).toBeNull();
  });

  it('e-mail obsahuje odhlašovací odkaz', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u4', name: 'Link', email: 'link@danero.cz' });
    await db.insert(taxpayerProfiles).values({ userId: 'u4', regime: 'PAUSAL' });
    await importCsvText(db, 'u4', 'fixtura.csv', CSV);

    const sent: EmailMessage[] = [];
    await processUserNotifications(db, { id: 'u4', email: 'link@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
      today: '2026-07-20',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('/api/odhlasit?token=');
  });
});

describe('nastavitelné e-maily (H3)', () => {
  it('vypnutý typ: událost se založí, ale nemailuje a rovnou dostane emailedAt', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u5', 'typ@danero.cz');
    await db.insert(notificationPrefs).values({ userId: 'u5', timeTestEvents: false });

    const sent: EmailMessage[] = [];
    const outcome = await processUserNotifications(db, { id: 'u5', email: 'typ@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
      today: '2026-07-20',
    });
    expect(outcome.created).toBeGreaterThanOrEqual(3); // TT30 + limity 50k a 100k
    expect(outcome.emailed).toBe(2); // jen limity
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('50 000');
    expect(sent[0]!.text).not.toContain('splní tříletý časový test');

    const rows = await db.select().from(notifications).where(eq(notifications.userId, 'u5'));
    const timeTests = rows.filter((r) => r.type.startsWith('TIME_TEST'));
    expect(timeTests.length).toBeGreaterThanOrEqual(1);
    // potlačené preferencí typu → emailedAt, aby se po zapnutí nevylily zpětně
    expect(timeTests.every((r) => r.emailedAt !== null)).toBe(true);
  });

  it('calendarEmails=false: DEADLINE se založí, ale nemailuje', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u6', 'kalendar@danero.cz');
    await db.insert(notificationPrefs).values({ userId: 'u6', calendarEmails: false });

    const sent: EmailMessage[] = [];
    // 20. 3. = okno připomínky papírového přiznání (aktivita v 2025 ve fixtuře je)
    const outcome = await processUserNotifications(db, { id: 'u6', email: 'kalendar@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
      today: '2026-03-20',
    });
    expect(outcome.created).toBeGreaterThanOrEqual(3); // DEADLINE + limity 50k a 100k
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).not.toContain('1. dubna');

    const rows = await db.select().from(notifications).where(eq(notifications.userId, 'u6'));
    const deadline = rows.filter((r) => r.type === 'DEADLINE');
    expect(deadline).toHaveLength(1);
    expect(deadline[0]!.emailedAt).not.toBeNull();
  });

  it('WEEKLY: první běh odešle, mezitím fronta čeká, po 7 dnech odejde souhrn', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u7', 'tyden@danero.cz');
    await db.insert(notificationPrefs).values({ userId: 'u7', emailFrequency: 'WEEKLY' });

    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u7', email: 'tyden@danero.cz' };

    // 1. běh: lastDigestAt je null → odešle hned a nastaví lastDigestAt
    const first = await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(first.emailed).toBeGreaterThanOrEqual(3);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Danero: souhrn upozornění za týden');
    const [afterFirst] = await db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, 'u7'));
    expect(afterFirst!.lastDigestAt).not.toBeNull();

    // nové události další den — týdenní okno je zavřené: nic se neposílá
    // a fronta zůstává s emailedAt NULL (odejde v příštím souhrnu)
    await db.insert(notifications).values([
      { userId: 'u7', dedupeKey: 'test|a', type: 'LIMIT_CRITICAL', title: 'Událost A', body: 'čeká na týdenní souhrn' },
      { userId: 'u7', dedupeKey: 'test|b', type: 'TIME_TEST_30', title: 'Událost B', body: 'čeká na týdenní souhrn' },
    ]);
    const second = await processUserNotifications(db, target, { send, today: '2026-07-21' });
    expect(second.emailed).toBe(0);
    expect(sent).toHaveLength(1);
    const waiting = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, 'u7'), isNull(notifications.emailedAt)));
    expect(waiting.map((n) => n.dedupeKey).sort()).toEqual(['test|a', 'test|b']);

    // po 7 dnech: okno otevřené → vše nahromaděné odejde jedním digestem
    const third = await processUserNotifications(db, target, { send, today: '2026-07-27' });
    expect(third.emailed).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe('Danero: souhrn upozornění za týden');
    expect(sent[1]!.text).toContain('Událost A');
    expect(sent[1]!.text).toContain('Událost B');
    // lastDigestAt se posunul na 27. 7. — den nato okno zase zavřené
    // (kdyby zůstal 20. 7., rozdíl 8 dní by digest poslal)
    await db.insert(notifications).values({
      userId: 'u7', dedupeKey: 'test|c', type: 'LIMIT_CRITICAL', title: 'Událost C', body: 'čeká na týdenní souhrn',
    });
    const fourth = await processUserNotifications(db, target, { send, today: '2026-07-28' });
    expect(fourth.emailed).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('DAILY: druhý běh cronu týž den nepošle druhý e-mail ani s novými událostmi', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u8', 'denne@danero.cz');
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u8', email: 'denne@danero.cz' };

    const first = await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(first.emailed).toBeGreaterThan(0);
    expect(sent).toHaveLength(1);

    // ruční re-trigger cronu: mezitím přibyla nová událost — čeká do zítřka
    await db.insert(notifications).values({
      userId: 'u8', dedupeKey: 'test|retrigger', type: 'LIMIT_CRITICAL', title: 'Nová událost', body: 'nesmí odejít dnes podruhé',
    });
    const retrigger = await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(retrigger.emailed).toBe(0);
    expect(sent).toHaveLength(1);

    // další den okno zase otevřené — nahromaděné odejde
    const nextDay = await processUserNotifications(db, target, { send, today: '2026-07-21' });
    expect(nextDay.emailed).toBeGreaterThan(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('Nová událost');
  });

  it('chybějící řádek preferencí = vše zapnuté a denní souhrn', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    const prefs = await getNotificationPrefs(db, 'nikdo');
    expect(prefs).toMatchObject({
      emailEnabled: true,
      timeTestEvents: true,
      limitEvents: true,
      calendarEmails: true,
      emailFrequency: 'DAILY',
      lastDigestAt: null,
    });
  });
});

describe('kalendářní připomínky (G9c)', () => {
  it('leden = roční shrnutí, březen/duben = termíny; jen při loňské aktivitě', async () => {
    const { calendarCandidates } = await import('@/lib/notifications');
    const leden = calendarCandidates({ today: '2027-01-05', hadActivityLastYear: true });
    expect(leden.map((c) => c.type)).toEqual(['YEAR_SUMMARY']);
    expect(leden[0]!.title).toContain('2026');

    const brezen = calendarCandidates({ today: '2027-03-20', hadActivityLastYear: true });
    expect(brezen.map((c) => c.type)).toEqual(['DEADLINE']);
    expect(brezen[0]!.title).toContain('1. dubna');

    const duben = calendarCandidates({ today: '2027-04-20', hadActivityLastYear: true });
    expect(duben[0]!.title).toContain('2. května');

    expect(calendarCandidates({ today: '2027-07-15', hadActivityLastYear: true })).toEqual([]);
    expect(calendarCandidates({ today: '2027-01-05', hadActivityLastYear: false })).toEqual([]);
  });
});
