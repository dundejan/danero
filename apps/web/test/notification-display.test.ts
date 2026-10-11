import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { d, parseTransactions } from '@danero/shared';
import { OverviewView } from '@/components/views/overview-view';
import { createPgliteDb } from '@/db';
import { notifications, user } from '@/db/schema';
import { LIMIT_NAME, limitWithAmount } from '@/lib/limit-names';
import {
  currentNotificationText,
  LIMIT_EVENT_KIND,
  type StoredNotificationText,
} from '@/lib/notification-display';
import {
  calendarCandidates,
  computeNotificationCandidates,
  processUserNotifications,
  summaryCandidate,
  type EmailMessage,
} from '@/lib/notifications';
import { analyzeForUser, engineInputForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * Uložená upozornění se zobrazují dnešními názvy limitů.
 *
 * Titulek a text upozornění se ukládají při vzniku události. Po přejmenování
 * limitů (11. 10. 2026) si dřív uložené řádky nesly stará jména a na přehledu
 * stály vedle nových: „Prolomen limit 50 000 Kč pro paušální daň“ nad
 * „Prolomen limit paušální daně (50 000 Kč)“. Odeslaný záznam se nepřepisuje —
 * znění se odvozuje při zobrazení z druhu události.
 *
 * Stará znění jsou tu opsaná schválně: jsou to data, která v databázi leží.
 */
const YEAR = 2026;
const TODAY = `${YEAR}-07-20`;
type Regime = ProfileRow['regime'];

const profile = (regime: Regime): ProfileRow => ({
  userId: 'u-display',
  regime,
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const stored = (
  dedupeKey: string,
  type: string,
  title: string,
  body = 'Čerpání je 60 000 Kč z 50 000 Kč (2026). Při překročení za rok podáváš přiznání.',
): StoredNotificationText => ({ dedupeKey, type, title, body });

const withAmount = (kind: keyof typeof LIMIT_NAME, czk: string): string =>
  limitWithAmount(kind, d(czk));

describe('uložená událost limitu dostane titulek z dnešních názvů', () => {
  const cases: Array<[StoredNotificationText, string]> = [
    [
      stored('limit|50k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 50 000 Kč pro paušální daň'),
      `Prolomen ${withAmount('FLAT_TAX', '50000')}`,
    ],
    [
      stored('limit|50k|CRITICAL|2026', 'LIMIT_CRITICAL', 'Blížíš se: limit 50 000 Kč pro paušální daň'),
      `Blížíš se: ${withAmount('FLAT_TAX', '50000')}`,
    ],
    [
      stored('limit|20k|WARNING|2026', 'LIMIT_WARNING', 'Za polovinou: limit 20 000 Kč vedlejších příjmů'),
      `Za polovinou: ${withAmount('EMPLOYEE_SIDE_INCOME', '20000')}`,
    ],
    [
      stored('limit|filing50k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 50 000 Kč pro podání přiznání'),
      `Prolomen ${withAmount('GENERAL_FILING', '50000')}`,
    ],
    [
      stored('limit|100k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 100 000 Kč pro osvobození prodejů'),
      `Zrušeno ${withAmount('SECURITIES', '100000')}`,
    ],
    [
      stored('limit|100k|CRITICAL|2026', 'LIMIT_CRITICAL', 'Blížíš se: limit 100 000 Kč pro osvobození prodejů'),
      `Skoro vyčerpáno: ${withAmount('SECURITIES', '100000')}`,
    ],
    [
      stored('limit|krypto100k|P70|2026', 'LIMIT_WARNING', 'Za polovinou: limit 100 000 Kč pro osvobození krypta'),
      `Za polovinou: ${withAmount('CRYPTO', '100000')}`,
    ],
  ];

  it.each(cases)('$0.title', (row, expected) => {
    const shown = currentNotificationText(row);
    expect(shown.title).toBe(expected);
    // text události limit nejmenuje („Čerpání je X z Y“) — zůstává uložený
    expect(shown.body).toBe(row.body);
  });

  it('částku bere z uloženého titulku, ne z dnešní konfigurace (limity § 38g se mění)', () => {
    // od roku 2027 je limit vedlejších příjmů 40 000 Kč; titulek s pevnými
    // mezerami, jak je píše `czk()`
    const shown = currentNotificationText(
      stored('limit|20k|EXCEEDED|2027', 'LIMIT_EXCEEDED', 'Prolomen limit 40\u00a0000\u00a0Kč vedlejších příjmů'),
    );
    expect(shown.title).toBe(`Prolomen ${withAmount('EMPLOYEE_SIDE_INCOME', '40000')}`);
  });

  it('každý klíč limitu, který hlídač vydává, má svůj druh', () => {
    // nový limit v hlídači bez řádku tady by se zobrazoval uloženým zněním
    const keys = new Set<string>();
    for (const regime of ['PAUSAL', 'ZAMESTNANEC', 'JINE'] as const) {
      const rows = parseTransactions([
        { type: 'DIVIDEND', id: 'd1', sourceCountry: 'US', gross: '80000', currency: 'CZK', withholdingTax: '0', date: `${YEAR}-03-10` },
        { type: 'BUY', id: 'b1', isin: 'CZ0005112300', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: `${YEAR}-02-01` },
        { type: 'SELL', id: 's1', isin: 'CZ0005112300', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: `${YEAR}-04-01` },
        { type: 'BUY', id: 'b2', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: `${YEAR}-02-01` },
        { type: 'SELL', id: 's2', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '150000', currency: 'CZK', tradeDate: `${YEAR}-04-01` },
      ]);
      const result = analyzeTaxYear(engineInputForUser(rows, profile(regime), YEAR));
      for (const candidate of computeNotificationCandidates({ result, positions: [], labels: new Map(), today: TODAY })) {
        if (candidate.dedupeKey.startsWith('limit|')) keys.add(candidate.dedupeKey.split('|')[1]!);
      }
    }
    expect([...keys].sort()).toEqual(Object.keys(LIMIT_EVENT_KIND).sort());
  });
});

describe('co poznat nejde, zůstane uložené', () => {
  it.each([
    ['neznámý limit', stored('limit|novy|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 50 000 Kč pro něco')],
    ['titulek bez částky', stored('limit|50k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Nová událost')],
    ['klíč jiného tvaru', stored('test|retrigger', 'LIMIT_CRITICAL', 'Limit 50 000 Kč')],
    ['časový test', stored('tt30|US0378331005|2026-08-09', 'TIME_TEST_30', 'AAPL: osvobození za 20 dní', '10 ks AAPL splní tříletý časový test 9. 8. 2026 — od té doby je prodej bez daně.')],
    ['termín', stored('termin|elektronicky|2026', 'DEADLINE', 'Blíží se termín elektronického přiznání: 4. 5. 2026', 'Elektronické přiznání za rok 2025 se podává do 4. 5. 2026.')],
    ['neznámý typ', stored('neco|1', 'NECO', 'Limit 50 000 Kč pro paušální daň', 'limit 50 000 Kč pro paušální daň: 1 Kč')],
  ])('%s', (_, row) => {
    expect(currentNotificationText(row)).toEqual({ title: row.title, body: row.body });
  });
});

describe('pravidelný přehled a lednové shrnutí', () => {
  it('řádky přehledu se jmenují jako seznam limitů, čísla zůstávají uložená', () => {
    const shown = currentNotificationText(
      stored(
        'souhrn|2026-07',
        'SUMMARY',
        'Přehled k 1. 7. 2026',
        'Stav k 1. 7. 2026 za rok 2026. limit 50\u00a0000\u00a0Kč pro paušální daň: 12\u00a0000\u00a0Kč z 50\u00a0000\u00a0Kč (24 %). limit 100 000 Kč pro osvobození prodejů: 30 000 Kč z 100 000 Kč (30 %). limit 100 000 Kč pro osvobození krypta: 5 000 Kč z 100 000 Kč (5 %). Žádná pozice zatím na tříletý časový test nečeká. Orientační daň z investic zatím 1 800 Kč.',
      ),
    );
    expect(shown.title).toBe('Přehled k 1. 7. 2026');
    expect(shown.body).toBe(
      `Stav k 1. 7. 2026 za rok 2026. ${LIMIT_NAME.FLAT_TAX}: 12\u00a0000\u00a0Kč z 50\u00a0000\u00a0Kč (24 %). ${LIMIT_NAME.SECURITIES}: 30 000 Kč z 100 000 Kč (30 %). ${LIMIT_NAME.CRYPTO}: 5 000 Kč z 100 000 Kč (5 %). Žádná pozice zatím na tříletý časový test nečeká. Orientační daň z investic zatím 1 800 Kč.`,
    );
  });

  it('přehled zaměstnance a režimu „Jiné“', () => {
    const body = currentNotificationText(
      stored('souhrn|2026-Q3', 'SUMMARY', 'Přehled k 1. 7. 2026', 'Stav. limit 20 000 Kč vedlejších příjmů: 1 Kč z 20 000 Kč (0 %). limit 50 000 Kč pro podání přiznání: 1 Kč z 50 000 Kč (0 %).'),
    ).body;
    expect(body).toBe(
      `Stav. ${LIMIT_NAME.EMPLOYEE_SIDE_INCOME}: 1 Kč z 20 000 Kč (0 %). ${LIMIT_NAME.GENERAL_FILING}: 1 Kč z 50 000 Kč (0 %).`,
    );
  });

  it('lednové shrnutí jmenuje stránku „Report“', () => {
    const shown = currentNotificationText(
      stored(
        'rocni|2025',
        'YEAR_SUMMARY',
        'Podklady za rok 2025 jsou připravené',
        'Daňový report za 2025 máš hotový v aplikaci — čísla do přiznání, srovnání variant výpočtu i XML pro mojedane.cz. Písemné přiznání se podává do 1. 4. 2026.',
      ),
    );
    expect(shown.title).toBe('Podklady za rok 2025 jsou připravené');
    expect(shown.body).toBe(
      'Report za rok 2025 máš hotový v aplikaci — čísla do přiznání, srovnání variant výpočtu i XML pro mojedane.cz. Písemné přiznání se podává do 1. 4. 2026.',
    );
  });
});

describe('dnešní znění převod nemění', () => {
  // Pojistka proti rozejití: kdyby hlídač začal psát titulek jinak, než ho
  // převod skládá, zobrazoval by přehled něco jiného, než odešlo e-mailem.
  const rows = parseTransactions([
    { type: 'DIVIDEND', id: 'd1', sourceCountry: 'US', gross: '33000', currency: 'CZK', withholdingTax: '0', date: `${YEAR}-03-10` },
    { type: 'BUY', id: 'b1', isin: 'CZ0005112300', quantity: '1', pricePerShare: '90000', currency: 'CZK', tradeDate: `${YEAR}-02-01` },
    { type: 'SELL', id: 's1', isin: 'CZ0005112300', quantity: '1', pricePerShare: '90000', currency: 'CZK', tradeDate: `${YEAR}-04-01` },
    { type: 'BUY', id: 'b2', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '120000', currency: 'CZK', tradeDate: `${YEAR}-02-01` },
    { type: 'SELL', id: 's2', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '120000', currency: 'CZK', tradeDate: `${YEAR}-04-01` },
    { type: 'BUY', id: 'b3', isin: 'US0378331005', quantity: '10', pricePerShare: '100', currency: 'CZK', tradeDate: '2023-08-08' },
  ]);

  it.each(['PAUSAL', 'ZAMESTNANEC', 'JINE', 'OSVC'] as const)('%s', (regime) => {
    const analysis = analyzeForUser(rows, profile(regime), YEAR, TODAY);
    const candidates = [
      ...computeNotificationCandidates({
        result: analysis.result,
        positions: analysis.positions,
        labels: analysis.labels,
        today: TODAY,
      }),
      ...calendarCandidates({ today: `${YEAR}-01-15`, hadActivityLastYear: true }),
      ...calendarCandidates({ today: `${YEAR}-04-20`, hadActivityLastYear: true, selfEmployed: true }),
      summaryCandidate({
        result: analysis.result,
        positions: analysis.positions,
        labels: analysis.labels,
        today: TODAY,
        period: '2026-07',
      }),
    ];
    expect(candidates.length).toBeGreaterThan(3);
    for (const candidate of candidates) {
      expect(currentNotificationText(candidate), candidate.dedupeKey).toEqual({
        title: candidate.title,
        body: candidate.body,
      });
    }
  });
});

describe('přehled', () => {
  it('starší uložené upozornění stojí v seznamu pod dnešním jménem limitu', () => {
    const txs = parseTransactions([
      { type: 'DIVIDEND', id: 'd1', sourceCountry: 'US', gross: '60000', currency: 'CZK', withholdingTax: '0', date: `${YEAR}-03-10` },
    ]);
    const html = renderToStaticMarkup(
      createElement(OverviewView, {
        txs,
        analysis: analyzeForUser(txs, profile('PAUSAL'), YEAR, TODAY),
        prices: new Map(),
        years: [YEAR],
        year: YEAR,
        today: TODAY,
        notifications: [
          {
            ...stored('limit|50k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 50 000 Kč pro paušální daň'),
            createdAt: new Date('2026-05-02T08:00:00Z'),
          },
          {
            ...stored('souhrn|2026-07', 'SUMMARY', 'Přehled k 1. 7. 2026', 'Stav k 1. 7. 2026 za rok 2026. limit 50 000 Kč pro paušální daň: 60 000 Kč z 50 000 Kč (120 %).'),
            createdAt: new Date('2026-07-01T08:00:00Z'),
          },
        ],
      }),
    ).replace(/\u00a0/g, ' ');
    expect(html).toContain(`Prolomen ${withAmount('FLAT_TAX', '50000').replace(/\u00a0/g, ' ')}`);
    expect(html).toContain(`${LIMIT_NAME.FLAT_TAX}: 60 000 Kč z 50 000 Kč`);
    // („Platí jen pro paušální daň“ ve výkladu limitu je jiná věta)
    expect(html).not.toMatch(/Kč pro paušální daň/);
  });
});

describe('fronta e-mailů (in-memory PGlite)', () => {
  it('upozornění, které ještě neodešlo, odejde s dnešním názvem a tak i zůstane uložené', { timeout: 30_000 }, async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: 'u-fronta', name: 'Test', email: 'fronta@danero.cz' });
    // bez daňového profilu: běh nic nepočítá, jen pošle, co ve frontě čeká
    await db.insert(notifications).values([
      {
        userId: 'u-fronta',
        ...stored('limit|50k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 50 000 Kč pro paušální daň'),
        createdAt: new Date('2026-07-19T05:00:00Z'),
      },
      {
        // tohle už odešlo — záznam se nepřepisuje
        userId: 'u-fronta',
        ...stored('limit|100k|EXCEEDED|2026', 'LIMIT_EXCEEDED', 'Prolomen limit 100 000 Kč pro osvobození prodejů'),
        createdAt: new Date('2026-07-10T05:00:00Z'),
        emailedAt: new Date('2026-07-10T06:00:00Z'),
      },
    ]);
    const sent: EmailMessage[] = [];
    const outcome = await processUserNotifications(
      db,
      { id: 'u-fronta', email: 'fronta@danero.cz' },
      { send: async (message) => void sent.push(message), today: TODAY },
    );
    expect(outcome.emailed).toBe(1);
    const expected = `Prolomen ${withAmount('FLAT_TAX', '50000')}`;
    expect(sent[0]!.subject).toBe(`Danero: ${expected}`);
    expect(sent[0]!.text).toContain(expected);
    expect(sent[0]!.text).not.toContain('pro paušální daň');

    const titleOf = async (key: string) =>
      (
        await db
          .select({ title: notifications.title })
          .from(notifications)
          .where(and(eq(notifications.userId, 'u-fronta'), eq(notifications.dedupeKey, key)))
      )[0]!.title;
    // co odešlo teď, je uložené tak, jak odešlo …
    expect(await titleOf('limit|50k|EXCEEDED|2026')).toBe(expected);
    // … a co odešlo dřív, zůstalo, jak odešlo tehdy
    expect(await titleOf('limit|100k|EXCEEDED|2026')).toBe('Prolomen limit 100 000 Kč pro osvobození prodejů');
    // druhý běh nic nepošle ani nepřepíše
    const again = await processUserNotifications(
      db,
      { id: 'u-fronta', email: 'fronta@danero.cz' },
      { send: async (message) => void sent.push(message), today: '2026-07-21' },
    );
    expect(again.emailed).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
