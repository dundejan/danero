import { d, type Transaction } from '@danero/shared';
import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  dedupeTransactions,
  parseFioCsv,
  parseRevolutInvestCsv,
  parseSchwabCsv,
  parseTastytradeCsv,
} from '../src';
import { FIO_FIXTURE, FIO_SYMBOL_MAP } from './fixtures/fio';
import { REVOLUT_INSTRUMENT_MAP, REVOLUT_INVEST_CSV } from './fixtures/revolut';
import { SCHWAB_HEADER } from './fixtures/schwab';
import { TASTY_INSTRUMENT_MAP, TASTY_V2 } from './fixtures/tastytrade';

/**
 * Dividenda uložená bez ISIN a tatáž dividenda po doplnění číselníku (L14-02).
 *
 * Fio, Schwab, Tastytrade a Revolut ISIN neexportují. Obchod bez něj skončí
 * chybou „doplň ISIN“, dividenda se ale uloží hned — a /import radí „po uložení
 * nahraj soubor znovu“. ISIN je součást otisku dividendy, takže druhé nahrání
 * dalo jiný klíč a tatáž výplata se uložila podruhé: dvojnásobný příjem
 * i sražená daň v § 8 a dvojnásobné čerpání hranice 50 000 Kč u paušálu.
 */

const BROKER = 'schwab';
const ISIN_A = 'US0000000018';
const ISIN_B = 'US0000000026';

const dividend = (
  id: string,
  overrides: Partial<Extract<Transaction, { type: 'DIVIDEND' }>> = {},
): Transaction => ({
  type: 'DIVIDEND',
  id,
  date: '2025-05-02',
  gross: d('20'),
  withholdingTax: d('3'),
  currency: 'USD',
  returnOfCapital: false,
  ...overrides,
});

/** Co by po importu leželo v databázi: uložené klíče po zapsání výsledku. */
const applyOutcome = (
  stored: string[],
  outcome: ReturnType<typeof dedupeTransactions>,
): string[] => {
  const moved = new Map(outcome.promoted.map(({ from, to }) => [from, to]));
  return [...stored.map((key) => moved.get(key) ?? key), ...outcome.fresh.map((item) => item.key)];
};

describe('dedupeTransactions: dividenda uložená bez ISIN po doplnění číselníku (L14-02)', () => {
  it('tatáž dividenda s ISIN je duplicita a uložený řádek se povýší na klíč s ISIN', () => {
    const bare = dividend('d1');
    const withIsin = dividend('d1', { isin: ISIN_A });
    const first = dedupeTransactions(BROKER, [bare]);
    expect(first.fresh).toHaveLength(1);
    expect(first.promoted).toEqual([]);

    const second = dedupeTransactions(BROKER, [withIsin], applyOutcome([], first));
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toBe(1);
    expect(second.promoted).toEqual([
      { from: dedupeKey(BROKER, bare, 1), to: dedupeKey(BROKER, withIsin, 1), isin: ISIN_A },
    ]);

    // třetí nahrání: klíč s ISIN už je uložený, nic se nepovyšuje ani nepřidává
    const stored = applyOutcome(applyOutcome([], first), second);
    expect(stored).toEqual([dedupeKey(BROKER, withIsin, 1)]);
    const third = dedupeTransactions(BROKER, [withIsin], stored);
    expect(third).toMatchObject({ fresh: [], duplicates: 1, promoted: [] });
  });

  it('dvě legitimně shodné dividendy téhož dne se nesloučí — povýší se obě, každá na své pořadí', () => {
    const first = dedupeTransactions(BROKER, [dividend('d1'), dividend('d2')]);
    expect(first.fresh).toHaveLength(2);

    const incoming = [dividend('d1', { isin: ISIN_A }), dividend('d2', { isin: ISIN_A })];
    const second = dedupeTransactions(BROKER, incoming, applyOutcome([], first));
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toBe(2);
    expect(second.promoted).toEqual([
      {
        from: dedupeKey(BROKER, dividend('x'), 1),
        to: dedupeKey(BROKER, incoming[0]!, 1),
        isin: ISIN_A,
      },
      {
        from: dedupeKey(BROKER, dividend('x'), 2),
        to: dedupeKey(BROKER, incoming[0]!, 2),
        isin: ISIN_A,
      },
    ]);
  });

  it('uložená je jedna, výpis nese dvě shodné → jedna se povýší, druhá je nová', () => {
    const stored = applyOutcome([], dedupeTransactions(BROKER, [dividend('d1')]));
    const outcome = dedupeTransactions(
      BROKER,
      [dividend('d1', { isin: ISIN_A }), dividend('d2', { isin: ISIN_A })],
      stored,
    );
    expect(outcome.promoted).toHaveLength(1);
    expect(outcome.fresh).toHaveLength(1);
    expect(outcome.duplicates).toBe(1);
    expect(new Set(applyOutcome(stored, outcome)).size).toBe(2);
  });

  it('shodná částka u dvou titulů, ISIN doplněný jen jednomu: jedna se povýší, druhá zůstane — a dál už jsou to duplicity', () => {
    const stored = applyOutcome([], dedupeTransactions(BROKER, [dividend('d1'), dividend('d2')]));
    // titul první dividendy má ISIN, titul druhé na číselník pořád čeká
    const incoming = [dividend('d1', { isin: ISIN_A }), dividend('d2')];
    const second = dedupeTransactions(BROKER, incoming, stored);
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toBe(2);
    expect(second.promoted).toHaveLength(1);

    const afterSecond = applyOutcome(stored, second);
    expect(new Set(afterSecond).size).toBe(2);
    const third = dedupeTransactions(BROKER, incoming, afterSecond);
    expect(third).toMatchObject({ fresh: [], duplicates: 2, promoted: [] });

    // číselník doplněný i pro druhý titul: povýší se zbývající řádek, nic nepřibude
    const completed = [dividend('d1', { isin: ISIN_A }), dividend('d2', { isin: ISIN_B })];
    const fourth = dedupeTransactions(BROKER, completed, afterSecond);
    expect(fourth.fresh).toEqual([]);
    expect(fourth.promoted).toEqual([
      {
        from: dedupeKey(BROKER, dividend('x'), 1),
        to: dedupeKey(BROKER, completed[1]!, 1),
        isin: ISIN_B,
      },
    ]);
  });

  it('dividenda bez ISIN a shodná dividenda jiného titulu s ISIN v TÉMŽE výpisu jsou dvě události', () => {
    const outcome = dedupeTransactions(BROKER, [dividend('d1'), dividend('d2', { isin: ISIN_A })]);
    expect(outcome.fresh).toHaveLength(2);
    expect(outcome.promoted).toEqual([]);

    // a opakované nahrání téhož výpisu z nich nic nepovýší
    const again = dedupeTransactions(
      BROKER,
      [dividend('d1'), dividend('d2', { isin: ISIN_A })],
      applyOutcome([], outcome),
    );
    expect(again).toMatchObject({ fresh: [], duplicates: 2, promoted: [] });
  });

  it('jiná dividenda (jiný den, jiná částka, jiná srážka, jiná měna, jiný broker) se uložené bez ISIN nedotkne', () => {
    const stored = applyOutcome([], dedupeTransactions(BROKER, [dividend('d1')]));
    const others = [
      dividend('o1', { isin: ISIN_A, date: '2025-05-03' }),
      dividend('o2', { isin: ISIN_A, gross: d('20.01') }),
      dividend('o3', { isin: ISIN_A, withholdingTax: d('0') }),
      dividend('o4', { isin: ISIN_A, currency: 'EUR' }),
    ];
    const outcome = dedupeTransactions(BROKER, others, stored);
    expect(outcome.fresh).toHaveLength(4);
    expect(outcome.promoted).toEqual([]);

    const otherBroker = dedupeTransactions('fio', [dividend('d1', { isin: ISIN_A })], stored);
    expect(otherBroker.fresh).toHaveLength(1);
    expect(otherBroker.promoted).toEqual([]);
  });

  it('nová dividenda s ISIN bez uloženého protějšku je prostě nová', () => {
    const outcome = dedupeTransactions(BROKER, [dividend('d1', { isin: ISIN_A })]);
    expect(outcome.fresh).toHaveLength(1);
    expect(outcome.promoted).toEqual([]);
  });

  it('navazující výpis s překryvem: stará dividenda se povýší, nová se uloží (jiné id řádku nevadí)', () => {
    const stored = applyOutcome([], dedupeTransactions(BROKER, [dividend('prvni-vypis-7')]));
    const overlap = dividend('druhy-vypis-2', { isin: ISIN_A });
    const later = dividend('druhy-vypis-3', { isin: ISIN_A, date: '2025-08-01' });
    const outcome = dedupeTransactions(BROKER, [overlap, later], stored);
    expect(outcome.promoted).toEqual([
      { from: stored[0], to: dedupeKey(BROKER, overlap, 1), isin: ISIN_A },
    ]);
    expect(outcome.fresh.map((item) => item.tx.id)).toEqual(['druhy-vypis-3']);
    expect(outcome.duplicates).toBe(1);
  });
});

describe('výpis → číselník → týž výpis: dividenda nepřibude (parsery bez ISIN v exportu)', () => {
  interface Parsed {
    transactions: Transaction[];
  }

  const schwabCsv = [
    SCHWAB_HEADER,
    '"05/02/2025","Qualified Dividend","ZZTA","ZETA TEST CORP","","","","$20.00"',
    '"05/02/2025","NRA Tax Adj","ZZTA","ZETA TEST CORP","","","","-$3.00"',
    '"03/03/2025","Buy","ZZTA","ZETA TEST CORP","40","$70.00","","-$2800.00"',
  ].join('\n');

  const cases: Array<{ broker: string; before: Parsed; after: Parsed }> = [
    {
      broker: 'fio',
      before: parseFioCsv(FIO_FIXTURE),
      after: parseFioCsv(FIO_FIXTURE, { symbolMap: FIO_SYMBOL_MAP }),
    },
    {
      broker: 'schwab',
      before: parseSchwabCsv(schwabCsv),
      after: parseSchwabCsv(schwabCsv, { ZZTA: { isin: ISIN_A } }),
    },
    {
      broker: 'tastytrade',
      before: parseTastytradeCsv(TASTY_V2),
      // dividendový titul fixtury v testovací mapě záměrně chybí — doplníme ho
      after: parseTastytradeCsv(TASTY_V2, { ...TASTY_INSTRUMENT_MAP, ICSH: { isin: ISIN_B } }),
    },
    {
      broker: 'revolut',
      before: parseRevolutInvestCsv(REVOLUT_INVEST_CSV),
      after: parseRevolutInvestCsv(REVOLUT_INVEST_CSV, REVOLUT_INSTRUMENT_MAP),
    },
  ];

  it.each(cases)('$broker', ({ broker, before, after }) => {
    const dividendsInFile = after.transactions.filter((tx) => tx.type === 'DIVIDEND');
    const promotable = dividendsInFile.filter((tx) => tx.type === 'DIVIDEND' && tx.isin);
    // fixtura musí vadu umět ukázat: dividenda poprvé bez ISIN, podruhé s ním
    expect(promotable.length).toBeGreaterThan(0);
    expect(
      before.transactions.filter((tx) => tx.type === 'DIVIDEND' && !tx.isin).length,
    ).toBeGreaterThanOrEqual(promotable.length);

    const first = dedupeTransactions(broker, before.transactions);
    const stored = applyOutcome([], first);
    const second = dedupeTransactions(broker, after.transactions, stored);

    expect(second.fresh.filter((item) => item.tx.type === 'DIVIDEND')).toEqual([]);
    expect(second.promoted).toHaveLength(promotable.length);
    for (const item of second.promoted) expect(stored).toContain(item.from);

    // třetí nahrání jsou samé duplicity
    const third = dedupeTransactions(broker, after.transactions, applyOutcome(stored, second));
    expect(third.fresh).toEqual([]);
    expect(third.promoted).toEqual([]);
    expect(third.duplicates).toBe(after.transactions.length);
  });
});
