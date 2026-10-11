import { describe, expect, it } from 'vitest';
import { d, parseTransactions } from '@danero/shared';
import { analyzeTaxYear } from '@danero/engine';
import { groupByCode, groupTitle } from '@/components/warnings-list';
import { LIMIT_NAME, limitWithAmount, type LimitKind } from '@/lib/limit-names';
import {
  calendarCandidates,
  computeNotificationCandidates,
  summaryCandidate,
} from '@/lib/notifications';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { withoutLawRefs } from '@/lib/typography';

/**
 * Upozornění hlídače a kontroly výpočtu jmenují limity stejně jako aplikace
 * (`lib/limit-names.ts`).
 *
 * Do 11. 10. 2026 je jmenovaly po staru: „Prolomen limit 50 000 Kč pro paušální
 * daň“, „Blížíš se: limit 100 000 Kč pro osvobození prodejů“, kontrola enginu
 * „Prolomen limit 50 000 Kč pro daň rovnou paušální dani“. Na přehledu stály
 * hned vedle seznamu limitů, kde se týž limit jmenuje „Limit paušální daně“,
 * a čtenář hledal rozdíl, který není. Titulek upozornění je zároveň předmět
 * e-mailu.
 *
 * Očekávání se skládají z `LIMIT_NAME`, ne z opsaných řetězců: přejmenování
 * limitu má projít jedním souborem.
 */
const YEAR = 2026;
const TODAY = `${YEAR}-07-20`;
type Regime = ProfileRow['regime'];

const profile = (regime: Regime): ProfileRow => ({
  userId: 'u-names',
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

/** Zahraniční dividenda v korunách — čerpá limit režimu, osvobození ne. */
const dividend = (grossCzk: string) => ({
  type: 'DIVIDEND',
  id: `d-${grossCzk}`,
  sourceCountry: 'US',
  gross: grossCzk,
  currency: 'CZK',
  withholdingTax: '0',
  date: `${YEAR}-03-10`,
});

/** Prodej za danou tržbu — čerpá osvobození prodejů (cenné papíry, nebo krypto). */
const sale = (proceedsCzk: string, crypto = false) => [
  {
    type: 'BUY',
    id: `b-${proceedsCzk}-${crypto}`,
    isin: crypto ? 'BTC' : 'CZ0005112300',
    ...(crypto ? { assetClass: 'CRYPTO' } : {}),
    quantity: '1',
    pricePerShare: proceedsCzk,
    currency: 'CZK',
    tradeDate: `${YEAR}-02-01`,
  },
  {
    type: 'SELL',
    id: `s-${proceedsCzk}-${crypto}`,
    isin: crypto ? 'BTC' : 'CZ0005112300',
    ...(crypto ? { assetClass: 'CRYPTO' } : {}),
    quantity: '1',
    pricePerShare: proceedsCzk,
    currency: 'CZK',
    tradeDate: `${YEAR}-04-01`,
  },
];

const analyze = (regime: Regime, rows: unknown[]) =>
  analyzeTaxYear(engineInputForUser(parseTransactions(rows), profile(regime), YEAR));

const limitEvent = (regime: Regime, rows: unknown[], key: string) => {
  const event = computeNotificationCandidates({
    result: analyze(regime, rows),
    positions: [],
    labels: new Map(),
    today: TODAY,
  }).find((candidate) => candidate.dedupeKey.startsWith(`limit|${key}|`));
  expect(event, `událost limitu ${key}`).toBeDefined();
  return event!;
};

const name = (kind: LimitKind, limitCzk: string): string => limitWithAmount(kind, d(limitCzk));

/** Stará jména limitů — po sjednocení se nesmí objevit v titulku ani ve větě. */
const OLD_NAMES = [
  'pro paušální daň',
  'pro daň rovnou paušální dani',
  'pro osvobození prodejů',
  'pro osvobození krypta',
  /limit \d+\s\d+\sKč/,
];
const expectNoOldNames = (text: string) => {
  for (const old of OLD_NAMES) {
    if (typeof old === 'string') expect(text).not.toContain(old);
    else expect(text).not.toMatch(old);
  }
};

describe('upozornění na limit režimu nese jméno z aplikace', () => {
  it('paušál: prolomený limit paušální daně', () => {
    const event = limitEvent('PAUSAL', [dividend('60000')], '50k');
    expect(event.title).toBe(`Prolomen ${name('FLAT_TAX', '50000')}`);
    expectNoOldNames(`${event.title} ${event.body}`);
  });

  it('zaměstnanec: blížící se limit vedlejších příjmů', () => {
    const event = limitEvent('ZAMESTNANEC', [dividend('18000')], '20k');
    expect(event.title).toBe(`Blížíš se: ${name('EMPLOYEE_SIDE_INCOME', '20000')}`);
    expectNoOldNames(`${event.title} ${event.body}`);
  });

  it('jiné: limit pro podání přiznání za polovinou', () => {
    const event = limitEvent('JINE', [dividend('33000')], 'filing50k');
    expect(event.title).toBe(`Za polovinou: ${name('GENERAL_FILING', '50000')}`);
    expectNoOldNames(`${event.title} ${event.body}`);
  });
});

/**
 * Osvobození není limit, který se „prolomí“ — aplikace o něm mluví slovesem
 * „zrušit“ (simulátor: „Prodej zruší osvobození prodejů cenných papírů“).
 * A „Blížíš se: osvobození…“ by se četlo jako dobrá zpráva o časovém testu.
 */
describe('upozornění na osvobození prodejů nese jméno z aplikace', () => {
  it.each([
    ['150000', 'Zrušeno'],
    ['90000', 'Skoro vyčerpáno:'],
    ['70000', 'Za polovinou:'],
  ])('cenné papíry, tržby %s Kč → „%s“', (proceeds, lead) => {
    const event = limitEvent('OSVC', sale(proceeds), '100k');
    expect(event.title).toBe(`${lead} ${name('SECURITIES', '100000')}`);
    expectNoOldNames(`${event.title} ${event.body}`);
  });

  it('krypto má vlastní osvobození pod vlastním jménem', () => {
    const event = limitEvent('OSVC', sale('150000', true), 'krypto100k');
    expect(event.title).toBe(`Zrušeno ${name('CRYPTO', '100000')}`);
    expectNoOldNames(`${event.title} ${event.body}`);
  });
});

describe('pravidelný přehled jmenuje limity stejně jako seznam limitů na přehledu', () => {
  const summaryBody = (regime: Regime, rows: unknown[]): string =>
    summaryCandidate({
      result: analyze(regime, rows),
      positions: [],
      labels: new Map(),
      today: TODAY,
      period: `${YEAR}-07`,
    }).body;

  it.each([
    ['PAUSAL', 'FLAT_TAX'],
    ['ZAMESTNANEC', 'EMPLOYEE_SIDE_INCOME'],
    ['JINE', 'GENERAL_FILING'],
  ] as const)('režim %s → řádek „%s“', (regime, kind) => {
    const body = summaryBody(regime, [dividend('10000'), ...sale('30000'), ...sale('20000', true)]);
    expect(body).toContain(`${LIMIT_NAME[kind]}: `);
    expect(body).toContain(`${LIMIT_NAME.SECURITIES}: `);
    expect(body).toContain(`${LIMIT_NAME.CRYPTO}: `);
    expectNoOldNames(body);
  });
});

describe('lednové shrnutí mluví o „Reportu“, jak se stránka jmenuje', () => {
  it('ne „Daňový report“', () => {
    const [summary] = calendarCandidates({ today: '2026-01-10', hadActivityLastYear: true });
    expect(summary?.type).toBe('YEAR_SUMMARY');
    expect(summary?.body).toMatch(/^Report za rok 2025 /);
    expect(`${summary?.title} ${summary?.body}`).not.toContain('Daňový report');
  });
});

/**
 * Engine o `limit-names.ts` neví (nemá na web vidět), ale kontrola
 * `FLAT_TAX_BROKEN` stojí na přehledu hned pod seznamem limitů. Její titulek
 * je první věta hlášky — tenhle test drží obě strany u jednoho jména.
 */
describe('kontrola výpočtu o prolomeném paušálním limitu', () => {
  const result = analyze('PAUSAL', [dividend('60000')]);
  const group = groupByCode(result.warnings).find((g) => g.code === 'FLAT_TAX_BROKEN');
  const plain = (text: string): string => text.replace(/\s/g, ' ');

  it('titulek je „Prolomen“ + jméno limitu z aplikace', () => {
    expect(group).toBeDefined();
    const title = withoutLawRefs(groupTitle(group!));
    expect(plain(title)).toBe(plain(`Prolomen ${name('FLAT_TAX', '50000')}`));
    expectNoOldNames(plain(title));
  });

  it('odkaz na paragraf zůstal ve znění hlášky', () => {
    expect(group!.items[0]!.message).toContain('§ 7a');
    expectNoOldNames(plain(group!.items[0]!.message));
  });
});
