import { describe, expect, it } from 'vitest';
import { createPgliteDb } from '@/db';
import { portfolios, taxpayerProfiles, user } from '@/db/schema';
import { importCsvText } from '@/lib/import-service';
import { processUserNotifications, type EmailMessage } from '@/lib/notifications';

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
    await db.insert(portfolios).values({ id: 'pf-u1', userId: 'u1', name: 'Moje portfolio' });
    await db.insert(taxpayerProfiles).values({ userId: 'u1', portfolioId: 'pf-u1', regime: 'PAUSAL' });
    await importCsvText(db, 'u1', 'pf-u1', 'fixtura.csv', CSV);

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
        portfolioId: 'pf-u1',
        regime: 'PAUSAL',
        hasBusinessAssets: false,
        w8benFiled: true,
        otherIncomeCzk: '0',
        matchingMethod: 'FIFO',
        fxMethod: 'UNIFIED',
        limit100kStrict: true,
  derivativesExpensesPerDruh: false,
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

describe('notifikační preference + odhlášení (G8d)', () => {
  it('vypnutý e-mail: události vzniknou, ale nic se neodešle; vypnuté typy se nezaloží', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const { notificationPrefs } = await import('@/db/schema');
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u3', name: 'Pref', email: 'pref@danero.cz' });
    await db.insert(portfolios).values({ id: 'pf-u3', userId: 'u3', name: 'Moje portfolio' });
    await db.insert(taxpayerProfiles).values({ userId: 'u3', portfolioId: 'pf-u3', regime: 'PAUSAL' });
    await importCsvText(db, 'u3', 'pf-u3', 'fixtura.csv', CSV);
    // vypnout e-mail i časové testy — zbydou jen limitové události
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
    expect(outcome.created).toBeGreaterThanOrEqual(2); // limity 50k + 100k
    expect(outcome.emailed).toBe(0);
    expect(sent).toHaveLength(0);

    const { notifications: notifTable } = await import('@/db/schema');
    const { eq: eqOp } = await import('drizzle-orm');
    const rows = await db.select().from(notifTable).where(eqOp(notifTable.userId, 'u3'));
    expect(rows.every((r) => r.type.startsWith('LIMIT'))).toBe(true);
  });

  it('odhlašovací token: podepsaný projde, zfalšovaný ne', async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import('@/lib/notifications');
    const token = await unsubscribeToken('u-abc');
    expect(await verifyUnsubscribeToken(token)).toBe('u-abc');
    expect(await verifyUnsubscribeToken(token.replace(/.$/, '0'))).toBeNull();
    expect(await verifyUnsubscribeToken('nesmysl')).toBeNull();
  });

  it('e-mail obsahuje odhlašovací odkaz', { timeout: 30_000 }, async () => {
    const { createPgliteDb } = await import('@/db');
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u4', name: 'Link', email: 'link@danero.cz' });
    await db.insert(portfolios).values({ id: 'pf-u4', userId: 'u4', name: 'Moje portfolio' });
    await db.insert(taxpayerProfiles).values({ userId: 'u4', portfolioId: 'pf-u4', regime: 'PAUSAL' });
    await importCsvText(db, 'u4', 'pf-u4', 'fixtura.csv', CSV);

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
