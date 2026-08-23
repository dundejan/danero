import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createPgliteDb, type Db } from '@/db';
import { notificationPrefs, notifications, taxpayerProfiles, user } from '@/db/schema';
import { filingDeadlines } from '@danero/engine';
import { czDate } from '@/lib/format';
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
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
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

/**
 * K6b-02b: `applicable: true` bylo u obou stovek natvrdo, takže poplatník
 * s cennými papíry v obchodním majetku dostával e-mailem i v měsíčním přehledu
 * měřák „limit 100 000 Kč pro osvobození prodejů: X ze 100 000" — limit, na
 * který podle R-02f nemá nárok. Na přehledu v aplikaci se přitom správně
 * nezobrazoval a nahrazovala ho karta „Obchodní majetek: osvobození neexistuje".
 */
describe('měřák limitu, na který není nárok, se hlídačem neposílá (K6b-02b)', () => {
  const profil = (over: Record<string, unknown>) => ({
    userId: 'u1',
    regime: 'PAUSAL' as const,
    hasBusinessAssets: false,
    w8benFiled: true,
    otherIncomeCzk: '0',
    matchingMethod: 'FIFO' as const,
    fxMethod: 'UNIFIED' as const,
    limit100kStrict: true,
    derivativesExpensesPerType: false,
    emtTimeTestExempt: false,
    returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
    timeTestBasis: 'settlement' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  const kandidati = async (hasBusinessAssets: boolean, year = 2026) => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const txs = parseTransactions([
      { type: 'BUY', id: 'b', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1000', currency: 'CZK', tradeDate: `${year - 1}-01-10` },
      { type: 'SELL', id: 's', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1500', currency: 'CZK', tradeDate: `${year}-04-01` },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, profil({ hasBusinessAssets }), year),
    );
    return computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map(),
      today: `${year}-07-20`,
    });
  };

  it('bez obchodního majetku měřák stovky chodí', async () => {
    const candidates = await kandidati(false);
    expect(candidates.some((c) => c.dedupeKey.startsWith('limit|100k|'))).toBe(true);
  });

  /**
   * Obchodní majetek + short: pool 100k je nenulový (samostatný nález K6b-02,
   * kde docs/02 zatím nerozhodly), takže by se měřák bez příznaku rozjel
   * a poslal „Prolomen limit 100 000 Kč" člověku, který na osvobození nemá nárok.
   */
  it('s obchodním majetkem se měřák stovky neposílá ani při nenulovém poolu', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const txs = parseTransactions([
      { type: 'SELL', id: 'so', isin: 'CZ0005112300', positionEffect: 'OPEN', quantity: '200', pricePerShare: '1000', currency: 'CZK', tradeDate: '2026-03-03' },
      { type: 'BUY', id: 'sc', isin: 'CZ0005112300', positionEffect: 'CLOSE', quantity: '200', pricePerShare: '800', currency: 'CZK', tradeDate: '2026-05-05' },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, profil({ hasBusinessAssets: true }), 2026),
    );
    expect(result.limits.limit100k.applicable).toBe(false);
    expect(result.limits.limit100k.usedCzk.gt(0)).toBe(true); // K6b-02, řeší docs/02

    const candidates = computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map(),
      today: '2026-07-20',
    });
    expect(candidates.some((c) => c.dedupeKey.startsWith('limit|100k|'))).toBe(false);
  });

  it('měsíční přehled řádek se stovkou u obchodního majetku nemá', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { summaryCandidate } = await import('@/lib/notifications');
    const txs = parseTransactions([
      { type: 'BUY', id: 'b', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1000', currency: 'CZK', tradeDate: '2025-01-10' },
      { type: 'SELL', id: 's', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1500', currency: 'CZK', tradeDate: '2026-04-01' },
    ]);
    const bez = summaryCandidate({
      result: analyzeTaxYear(engineInputForUser(txs, profil({}), 2026)),
      positions: [],
      labels: new Map(),
      today: '2026-07-20',
      period: '2026-07',
    });
    expect(bez.body).toContain('limit 100 000 Kč pro osvobození prodejů');

    const sMajetkem = summaryCandidate({
      result: analyzeTaxYear(engineInputForUser(txs, profil({ hasBusinessAssets: true }), 2026)),
      positions: [],
      labels: new Map(),
      today: '2026-07-20',
      period: '2026-07',
    });
    expect(sMajetkem.body).not.toContain('limit 100 000 Kč pro osvobození prodejů');
  });

  it('v roce bez krypto osvobození (2024) se neposílá ani krypto stovka', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const txs = parseTransactions([
      { type: 'BUY', id: 'cb', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '100000', currency: 'CZK', tradeDate: '2024-01-10' },
      { type: 'SELL', id: 'cs', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: '2024-04-01' },
    ]);
    const result = analyzeTaxYear(engineInputForUser(txs, profil({}), 2024));
    expect(result.limits.cryptoLimit100k.applicable).toBe(false);
    const candidates = computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map(),
      today: '2024-07-20',
    });
    expect(candidates.some((c) => c.dedupeKey.startsWith('limit|krypto100k|'))).toBe(false);
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
        derivativesExpensesPerType: false,
        emtTimeTestExempt: false,
        returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
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

/**
 * Nález V-4 právního auditu (docs/13), znovu otevřený jako E-12: e-mail
 * s konkrétními čísly uživatele smí nést fakt a termín, ale ne pokyn, co má
 * udělat („zvaž, zda další prodeje letos počkají"). Individualizovaná rada je
 * za hranicí § 1 zákona 523/1992 Sb. o daňovém poradenství — obecná doporučení
 * patří jen do marketingu.
 */
describe('hlídací e-maily nesou fakt, ne pokyn (E-12 / V-4)', () => {
  /** Slovesa, kterými bychom uživateli radili, co má udělat. */
  const POKYN = /zvaž|počkej|prodej si|nech si|raději|doporuč|radíme|měl bys/i;

  it('události k limitům neobsahují radu, co má uživatel udělat', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');

    // prodej CP za 150 000 Kč (limit 100k prolomený) i krypta za 150 000 Kč
    // (vlastní limit 100k prolomený) — obě události musí vzniknout naráz
    const txs = parseTransactions([
      { type: 'BUY', id: 'b1', isin: 'US0378331005', quantity: '10', pricePerShare: '10000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 's1', isin: 'US0378331005', quantity: '10', pricePerShare: '15000', currency: 'CZK', tradeDate: '2026-04-01' },
      { type: 'BUY', id: 'cb1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '100000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 'cs1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: '2026-04-01' },
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
        derivativesExpensesPerType: false,
        emtTimeTestExempt: false,
        returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
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

    const limity = candidates.filter((c) => c.type.startsWith('LIMIT_'));
    expect(limity.length).toBeGreaterThanOrEqual(2);
    for (const event of limity) {
      expect(`${event.title} ${event.body}`, event.dedupeKey).not.toMatch(POKYN);
    }
    // fakt a termín naopak zůstávají: kolik z limitu je vyčerpáno a co to znamená
    const stovka = limity.find((c) => c.dedupeKey === 'limit|100k|EXCEEDED|2026');
    expect(stovka).toBeDefined();
    expect(stovka!.body).toContain('Čerpání je');
    expect(stovka!.body).toContain('bez splněného časového testu');
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
    // flaky (1/16 podpisů nulou končí a „padělek“ byl identický s originálem)
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
    // 25. 4. = okno připomínky elektronického přiznání (aktivita v 2025 ve fixtuře je).
    // Fixtura je paušalista, tedy OSVČ — ta má datovou schránku ze zákona a podává
    // jen elektronicky (§ 72 odst. 6 DŘ), takže upomínku na písemný termín nedostane
    // vůbec (E-23); jediné okno, ve kterém jí DEADLINE vzniká, je tohle.
    const outcome = await processUserNotifications(db, { id: 'u6', email: 'kalendar@danero.cz' }, {
      send: async (m) => {
        sent.push(m);
      },
      today: '2026-04-25',
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
    // termín se odvozuje z pravidla (R-09e), ne z konstanty v testu
    expect(brezen[0]!.title).toContain(czDate(filingDeadlines(2026).paper));

    const duben = calendarCandidates({ today: '2027-04-20', hadActivityLastYear: true });
    expect(duben[0]!.title).toContain(czDate(filingDeadlines(2026).electronic));

    expect(calendarCandidates({ today: '2027-07-15', hadActivityLastYear: true })).toEqual([]);
    expect(calendarCandidates({ today: '2027-01-05', hadActivityLastYear: false })).toEqual([]);
  });

  it('upomínka na elektronický termín chodí až do dne termínu (R-09e)', async () => {
    const { calendarCandidates } = await import('@/lib/notifications');
    // Za ZO 2025 vychází elektronický termín na pondělí 4. 5. 2026 (1. 5. je
    // pátek a svátek). Dřív bylo okno natvrdo do „2. 5.“, takže poslední dva
    // dny před termínem už uživatel nedostal nic.
    const termin = filingDeadlines(2025).electronic;
    expect(termin).toBe('2026-05-04');
    for (const den of ['2026-05-02', '2026-05-03', '2026-05-04']) {
      const events = calendarCandidates({ today: den, hadActivityLastYear: true });
      expect(events.map((c) => c.dedupeKey), `${den} musí ještě upomínat`).toContain(
        'termin|elektronicky|2026',
      );
    }
    // den po termínu už nic
    expect(
      calendarCandidates({ today: '2026-05-05', hadActivityLastYear: true }).map((c) => c.type),
    ).toEqual([]);
  });

  it('E-23: OSVČ nedostane upomínku na písemný termín — podat ho nesmí (§ 72/6 DŘ)', async () => {
    const { calendarCandidates } = await import('@/lib/notifications');
    // OSVČ má od 1. 1. 2023 datovou schránku zřízenou ze zákona, takže podává
    // jen elektronicky; písemné podání je vada podání (§ 74 DŘ) s pokutou.
    const { paper, electronic } = filingDeadlines(2026);

    expect(
      calendarCandidates({ today: paper, hadActivityLastYear: true, selfEmployed: true }),
    ).toEqual([]);
    // ostatní režimy (zaměstnanec, jiné) upomínku dál dostávají
    expect(
      calendarCandidates({ today: paper, hadActivityLastYear: true }).map((c) => c.dedupeKey),
    ).toContain('termin|papir|2027');

    // elektronický termín má OSVČ i s poznámkou o přehledech ČSSZ a ZP
    const elektronicky = calendarCandidates({
      today: electronic,
      hadActivityLastYear: true,
      selfEmployed: true,
    });
    expect(elektronicky.map((c) => c.dedupeKey)).toEqual(['termin|elektronicky|2027']);
    expect(elektronicky[0]!.body).toContain('§ 72 odst. 6');

    // lednové shrnutí OSVČ písemný termín vůbec nenabízí
    const leden = calendarCandidates({
      today: '2027-01-05',
      hadActivityLastYear: true,
      selfEmployed: true,
    });
    expect(leden[0]!.body).toContain(czDate(electronic));
    expect(leden[0]!.body).not.toContain(czDate(paper));
  });
});

/**
 * A2-3-04: hlídač posílal „osvobozeno 🎉 … prodej je osvobozený od daně“
 * i k pozicím, které osvobození nemají nikdy — doloženo na USDT drženém
 * od 1. 6. 2021, jehož prodej za 220 000 Kč znamená základ 20 000 Kč
 * a daň 3 000 Kč.
 */
describe('hlídač neslibuje osvobození tam, kde nepřijde (A2-3-04)', () => {
  it('stablecoin držený čtyři roky nedostane ani odpočet, ani „osvobozeno“', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');

    const txs = parseTransactions([
      {
        type: 'BUY',
        id: 'usdt-buy',
        isin: 'USDT',
        assetClass: 'CRYPTO',
        quantity: '10000',
        pricePerShare: '1',
        currency: 'USD',
        tradeDate: '2021-06-01',
      },
    ]);
    const profil = {
      userId: 'u-emt',
      regime: 'PAUSAL',
      hasBusinessAssets: false,
      w8benFiled: true,
      otherIncomeCzk: '0',
      matchingMethod: 'FIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
      derivativesExpensesPerType: false,
      emtTimeTestExempt: false,
      returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
      timeTestBasis: 'settlement',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof analyzeForUser>[1];

    const analysis = analyzeForUser(txs, profil, 2026, '2026-08-09');
    const lot = analysis.positions[0]!.lots[0]!;
    expect(lot.exemptionPossible).toBe(false);
    expect(lot.isExempt).toBe(false);

    const candidates = computeNotificationCandidates({
      result: analysis.result,
      positions: analysis.positions,
      labels: analysis.labels,
      today: '2026-08-09',
    });
    expect(candidates.some((c) => c.type.startsWith('TIME_TEST'))).toBe(false);
  });
});

/**
 * D-3-06: odhlašovací token neměl časovou složku — platil věčně a zneplatnit
 * ho šlo jedině výměnou BETTER_AUTH_SECRET, tedy odhlášením všech uživatelů.
 * Zároveň to byl trvalý identifikátor člověka putující v URL každého e-mailu.
 */
describe('odhlašovací token má omezenou platnost (D-3-06)', () => {
  it('čerstvý token platí, roční ještě taky, starší už ne', async () => {
    const { unsubscribeToken, verifyUnsubscribeToken, UNSUBSCRIBE_TOKEN_TTL_DAYS } = await import(
      '@/lib/notifications'
    );
    const vydan = new Date('2026-01-01T00:00:00Z');
    const token = await unsubscribeToken('u-ttl', vydan);

    expect(await verifyUnsubscribeToken(token, vydan)).toBe('u-ttl');

    const denPredKoncem = new Date(vydan.getTime() + (UNSUBSCRIBE_TOKEN_TTL_DAYS - 1) * 86_400_000);
    expect(await verifyUnsubscribeToken(token, denPredKoncem)).toBe('u-ttl');

    const poVyprseni = new Date(vydan.getTime() + (UNSUBSCRIBE_TOKEN_TTL_DAYS + 1) * 86_400_000);
    expect(await verifyUnsubscribeToken(token, poVyprseni)).toBeNull();
  });

  it('podvržené datum vydání podpis neprojde', async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import('@/lib/notifications');
    const token = await unsubscribeToken('u-ttl2', new Date('2026-01-01T00:00:00Z'));
    const [encoded, , sig] = token.split('.');
    // posunuté datum s původním podpisem — útočník by si tím prodloužil platnost
    expect(await verifyUnsubscribeToken(`${encoded}.99999.${sig}`)).toBeNull();
  });

  it('token bez data (starý tvar) už neplatí', async () => {
    const { verifyUnsubscribeToken } = await import('@/lib/notifications');
    expect(await verifyUnsubscribeToken('dS1hYmM.abcdef')).toBeNull();
  });
});

/**
 * Vlastní pravidla hlídače: co si uživatel nastaví na /nastaveni/upozorneni,
 * musí se projevit na tom, jaké události vůbec vzniknou. Výchozí hodnoty
 * schválně opisují dřívější natvrdo zadané chování — to hlídají testy výš,
 * které tahle sada nechává být.
 */
describe('vlastní pravidla hlídače (lhůty, hranice, přehled)', () => {
  /** Analýza jedné pozice koupené tak, aby jí test doběhl za 20 dní. */
  async function pozice(today: string) {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeForUser } = await import('@/lib/portfolio');
    const txs = parseTransactions([
      {
        type: 'BUY',
        id: 'aapl',
        isin: 'US0378331005',
        quantity: '10',
        pricePerShare: '100',
        currency: 'CZK',
        tradeDate: '2023-08-08',
        settlementDate: '2023-08-08',
      },
    ]);
    const profil = {
      userId: 'u-pravidla',
      regime: 'PAUSAL',
      hasBusinessAssets: false,
      w8benFiled: true,
      otherIncomeCzk: '0',
      matchingMethod: 'FIFO',
      fxMethod: 'UNIFIED',
      limit100kStrict: true,
      derivativesExpensesPerType: false,
      emtTimeTestExempt: false,
      returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
      timeTestBasis: 'settlement',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof analyzeForUser>[1];
    return analyzeForUser(txs, profil, 2026, today);
  }

  it('lhůta 90 dní zachytí pozici, kterou výchozích 30 dní ještě nevidí', async () => {
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const { DEFAULT_NOTIFICATION_RULES } = await import('@/lib/notification-rules');
    // osvobození 2026-08-09, dnes 2026-06-01 → zbývá 69 dní
    const today = '2026-06-01';
    const analysis = await pozice(today);
    const args = {
      result: analysis.result,
      positions: analysis.positions,
      labels: analysis.labels,
      today,
    };

    expect(computeNotificationCandidates(args).some((c) => c.type.startsWith('TIME_TEST'))).toBe(
      false,
    );

    const sDelsiLhutou = computeNotificationCandidates({
      ...args,
      rules: { ...DEFAULT_NOTIFICATION_RULES, timeTestLeadDays: [90, 30, 7] },
    });
    const event = sDelsiLhutou.find((c) => c.type === 'TIME_TEST_90');
    expect(event).toBeDefined();
    expect(event!.dedupeKey).toBe('tt90|US0378331005|2026-08-09');
    expect(event!.title).toContain('za 69 dní');
  });

  it('vypnuté „osvobozeno“ událost nevytvoří', async () => {
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const { DEFAULT_NOTIFICATION_RULES } = await import('@/lib/notification-rules');
    const today = '2026-08-10'; // den po osvobození
    const analysis = await pozice(today);
    const args = {
      result: analysis.result,
      positions: analysis.positions,
      labels: analysis.labels,
      today,
    };
    expect(computeNotificationCandidates(args).some((c) => c.type === 'TIME_TEST_DONE')).toBe(true);
    expect(
      computeNotificationCandidates({
        ...args,
        rules: { ...DEFAULT_NOTIFICATION_RULES, timeTestDone: false },
      }).some((c) => c.type === 'TIME_TEST_DONE'),
    ).toBe(false);
  });

  it('vlastní hranice limitu: 90 % vydá vlastní klíč, 50 % se ozve dřív než výchozí 60 %', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const { DEFAULT_NOTIFICATION_RULES } = await import('@/lib/notification-rules');

    // prodej CP za 55 000 Kč = 55 % limitu 100k
    const txs = parseTransactions([
      { type: 'BUY', id: 'b', isin: 'US0378331005', quantity: '10', pricePerShare: '5000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 's', isin: 'US0378331005', quantity: '10', pricePerShare: '5500', currency: 'CZK', tradeDate: '2026-04-01' },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, {
        userId: 'u-hranice',
        regime: 'OSVC',
        hasBusinessAssets: false,
        w8benFiled: true,
        otherIncomeCzk: '0',
        matchingMethod: 'FIFO',
        fxMethod: 'UNIFIED',
        limit100kStrict: true,
        derivativesExpensesPerType: false,
        emtTimeTestExempt: false,
        returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true,
        timeTestBasis: 'settlement',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Parameters<typeof engineInputForUser>[1], 2026),
    );
    const args = { result, positions: [], labels: new Map<string, string>(), today: '2026-07-20' };

    // výchozí hranice (60/85/100) ještě mlčí
    expect(computeNotificationCandidates(args).some((c) => c.dedupeKey.startsWith('limit|100k|'))).toBe(
      false,
    );

    const opatrny = computeNotificationCandidates({
      ...args,
      rules: { ...DEFAULT_NOTIFICATION_RULES, limitThresholdsPct: [50, 90] },
    });
    const event = opatrny.find((c) => c.dedupeKey === 'limit|100k|P50|2026');
    expect(event).toBeDefined();
    expect(event!.type).toBe('LIMIT_WARNING');
    expect(event!.body).toContain('přes 50 %');
    // vyšší hranice zatím dosažená není — vzniká jen ta nejvyšší dosažená
    expect(opatrny.some((c) => c.dedupeKey === 'limit|100k|P90|2026')).toBe(false);
  });

  it('naléhavá událost otevře i zavřené týdenní okno (a bez volby počká)', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u-urgent', 'urgent@danero.cz');
    await db.insert(notificationPrefs).values({ userId: 'u-urgent', emailFrequency: 'WEEKLY' });
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u-urgent', email: 'urgent@danero.cz' };

    // první běh vyprázdní frontu a nastaví lastDigestAt
    await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(sent).toHaveLength(1);

    // den nato přijde prolomený limit — okno je zavřené, ale naléhavé se posílá hned
    await db.insert(notifications).values({
      userId: 'u-urgent', dedupeKey: 'test|urgent', type: 'LIMIT_EXCEEDED',
      title: 'Prolomen limit', body: 'naléhavé', urgent: true,
    });
    const hned = await processUserNotifications(db, target, { send, today: '2026-07-21' });
    expect(hned.emailed).toBe(1);
    expect(sent).toHaveLength(2);

    // s vypnutou volbou počká naléhavá událost na týdenní souhrn jako ostatní
    await db
      .update(notificationPrefs)
      .set({ urgentImmediately: false })
      .where(eq(notificationPrefs.userId, 'u-urgent'));
    await db.insert(notifications).values({
      userId: 'u-urgent', dedupeKey: 'test|urgent2', type: 'LIMIT_EXCEEDED',
      title: 'Prolomen další limit', body: 'naléhavé', urgent: true,
    });
    const ceka = await processUserNotifications(db, target, { send, today: '2026-07-22' });
    expect(ceka.emailed).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it('pravidelný přehled odejde jednou za období a nese čísla i beze změn', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u-souhrn', 'souhrn@danero.cz');
    await db
      .insert(notificationPrefs)
      .values({ userId: 'u-souhrn', summaryFrequency: 'MONTHLY' });
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u-souhrn', email: 'souhrn@danero.cz' };

    await processUserNotifications(db, target, { send, today: '2026-07-20' });
    const souhrny = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, 'u-souhrn'), eq(notifications.type, 'SUMMARY')));
    expect(souhrny).toHaveLength(1);
    expect(souhrny[0]!.dedupeKey).toBe('souhrn|2026-07');
    // titulek nese DEN, ne období: přehled odchází první den období a nesl by
    // jinak název měsíce, který ještě nezačal
    expect(souhrny[0]!.title).toBe('Přehled k 20. 7. 2026');
    expect(souhrny[0]!.body).toContain('limit 100 000 Kč pro osvobození prodejů');

    // druhý běh v témž měsíci nic nepřidá, další měsíc ano
    await processUserNotifications(db, target, { send, today: '2026-07-25' });
    await processUserNotifications(db, target, { send, today: '2026-08-03' });
    const vsechny = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, 'u-souhrn'), eq(notifications.type, 'SUMMARY')));
    expect(vsechny.map((n) => n.dedupeKey).sort()).toEqual(['souhrn|2026-07', 'souhrn|2026-08']);
  });

  it('bez volby přehledu nevzniká žádný SUMMARY', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u-bez', 'bez@danero.cz');
    const send = async () => {};
    await processUserNotifications(db, { id: 'u-bez', email: 'bez@danero.cz' }, { send, today: '2026-07-20' });
    const souhrny = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, 'u-bez'), eq(notifications.type, 'SUMMARY')));
    expect(souhrny).toHaveLength(0);
  });
});

/**
 * Nálezy z code review: pravidelný přehled a naléhavost se musí řídit tím,
 * co má uživatel nastavené TEĎ, ne tím, co platilo ve chvíli, kdy událost
 * vznikla.
 */
describe('pravidla platí i na už založené události', () => {
  it('vypnutý přehled se neodešle, ani když už řádek vznikl', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u-off', 'off@danero.cz');
    await db.insert(notificationPrefs).values({
      userId: 'u-off',
      emailFrequency: 'WEEKLY',
      summaryFrequency: 'MONTHLY',
    });
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u-off', email: 'off@danero.cz' };

    // 1. běh: souhrn i přehled odejdou, okno se zavře na týden
    await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(sent).toHaveLength(1);

    // nový měsíc → vznikne další přehled, ale uživatel si ho mezitím vypne
    await processUserNotifications(db, target, { send, today: '2026-08-01' });
    const [pred] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, 'u-off'), eq(notifications.dedupeKey, 'souhrn|2026-08')));
    expect(pred).toBeDefined();
    await db
      .update(notificationPrefs)
      .set({ summaryFrequency: 'OFF' })
      .where(eq(notificationPrefs.userId, 'u-off'));

    const posledni = sent.length;
    await processUserNotifications(db, target, { send, today: '2026-08-02' });
    expect(sent.map((m) => m.text).slice(posledni).join('')).not.toContain('Přehled k');
  });

  it('naléhavost termínu se rozhoduje předstihem už při vzniku události', async () => {
    const { calendarCandidates } = await import('@/lib/notifications');
    const { addDays } = await import('@danero/shared');
    const { electronic } = filingDeadlines(2026);
    // pět dní před termínem: spadá do 30denního i 7denního okna upomínky
    const today = addDays(electronic, -5);
    const args = { today, hadActivityLastYear: true, selfEmployed: true };

    const dlouhy = calendarCandidates({ ...args, deadlineLeadDays: 30 }).find(
      (c) => c.type === 'DEADLINE',
    );
    const kratky = calendarCandidates({ ...args, deadlineLeadDays: 7 }).find(
      (c) => c.type === 'DEADLINE',
    );
    expect(dlouhy?.urgent).toBe(false);
    expect(kratky?.urgent).toBe(true);
  });

  it('nenaléhavá událost týdenní okno neprorazí', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await seedUser(db, 'u-termin', 'termin@danero.cz');
    await db.insert(notificationPrefs).values({ userId: 'u-termin', emailFrequency: 'WEEKLY' });
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => {
      sent.push(m);
    };
    const target = { id: 'u-termin', email: 'termin@danero.cz' };
    await processUserNotifications(db, target, { send, today: '2026-07-20' });
    expect(sent).toHaveLength(1);

    await db.insert(notifications).values({
      userId: 'u-termin', dedupeKey: 'test|termin', type: 'DEADLINE',
      title: 'Blíží se termín přiznání', body: 'za měsíc', urgent: false,
    });
    expect((await processUserNotifications(db, target, { send, today: '2026-07-21' })).emailed).toBe(0);

    // tentýž typ s příznakem naléhavosti (krátký předstih) jde hned
    await db.insert(notifications).values({
      userId: 'u-termin', dedupeKey: 'test|termin-blizko', type: 'DEADLINE',
      title: 'Termín je za týden', body: 'naléhavé', urgent: true,
    });
    expect((await processUserNotifications(db, target, { send, today: '2026-07-22' })).emailed).toBe(2);
  });
});

/**
 * Nálezy druhého kola review: naléhavost i formulace se musí řídit skutečností
 * (kolik dní zbývá, jestli je limit opravdu prolomen), ne tím, do které
 * uživatelovy škatulky událost spadla.
 */
describe('naléhavost a formulace podle skutečnosti, ne podle škatulky', () => {
  it('pozice 3 dny před osvobozením je naléhavá i s jedinou 30denní lhůtou', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const { DEFAULT_NOTIFICATION_RULES } = await import('@/lib/notification-rules');

    const txs = parseTransactions([
      {
        type: 'BUY', id: 'aapl', isin: 'US0378331005', quantity: '10',
        pricePerShare: '100', currency: 'CZK',
        tradeDate: '2023-08-08', settlementDate: '2023-08-08',
      },
    ]);
    const profil = {
      userId: 'u-nal', regime: 'PAUSAL', hasBusinessAssets: false, w8benFiled: true,
      otherIncomeCzk: '0', matchingMethod: 'FIFO', fxMethod: 'UNIFIED', limit100kStrict: true,
      derivativesExpensesPerType: false, emtTimeTestExempt: false,
 returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true, timeTestBasis: 'settlement',
      createdAt: new Date(), updatedAt: new Date(),
    } as Parameters<typeof analyzeForUser>[1];
    // osvobození 2026-08-09, dnes 2026-08-06 → zbývají 3 dny
    const analysis = analyzeForUser(txs, profil, 2026, '2026-08-06');
    const [event] = computeNotificationCandidates({
      result: analysis.result,
      positions: analysis.positions,
      labels: analysis.labels,
      today: '2026-08-06',
      rules: { ...DEFAULT_NOTIFICATION_RULES, timeTestLeadDays: [30] },
    }).filter((c) => c.type.startsWith('TIME_TEST'));

    expect(event!.type).toBe('TIME_TEST_30');
    expect(event!.urgent).toBe(true);
    // čeština: 3 dny, ne „3 dní“
    expect(event!.title).toContain('už za 3 dny');
  });

  it('prolomený limit se hlásí jako prolomený, i když má uživatel zaškrtnuto jen 60 a 85 %', async () => {
    const { parseTransactions } = await import('@danero/shared');
    const { analyzeTaxYear } = await import('@danero/engine');
    const { engineInputForUser } = await import('@/lib/portfolio');
    const { computeNotificationCandidates } = await import('@/lib/notifications');
    const { DEFAULT_NOTIFICATION_RULES } = await import('@/lib/notification-rules');

    // prodej CP za 150 000 Kč = 150 % limitu 100k
    const txs = parseTransactions([
      { type: 'BUY', id: 'b', isin: 'US0378331005', quantity: '10', pricePerShare: '10000', currency: 'CZK', tradeDate: '2026-01-10' },
      { type: 'SELL', id: 's', isin: 'US0378331005', quantity: '10', pricePerShare: '15000', currency: 'CZK', tradeDate: '2026-04-01' },
    ]);
    const result = analyzeTaxYear(
      engineInputForUser(txs, {
        userId: 'u-prolom', regime: 'OSVC', hasBusinessAssets: false, w8benFiled: true,
        otherIncomeCzk: '0', matchingMethod: 'FIFO', fxMethod: 'UNIFIED', limit100kStrict: true,
        derivativesExpensesPerType: false, emtTimeTestExempt: false,
 returnOfCapitalReducesBasis: false,
    shortSaleIncomeOnSale: true, timeTestBasis: 'settlement',
        createdAt: new Date(), updatedAt: new Date(),
      } as Parameters<typeof engineInputForUser>[1], 2026),
    );
    const event = computeNotificationCandidates({
      result,
      positions: [],
      labels: new Map<string, string>(),
      today: '2026-07-20',
      rules: { ...DEFAULT_NOTIFICATION_RULES, limitThresholdsPct: [60, 85] },
    }).find((c) => c.dedupeKey.startsWith('limit|100k|'));

    expect(event).toBeDefined();
    expect(event!.title).toContain('Prolomen');
    expect(event!.type).toBe('LIMIT_EXCEEDED');
    expect(event!.urgent).toBe(true);
    // klíč nese hranici, která se ozvala — nižší, protože 100 % uživatel nechce
    expect(event!.dedupeKey).toBe('limit|100k|CRITICAL|2026');
  });
});
