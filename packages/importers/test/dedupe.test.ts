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
const TICKER_A = 'ZZTA';
const TICKER_B = 'ZZTB';

const dividend = (
  id: string,
  overrides: Partial<Extract<Transaction, { type: 'DIVIDEND' }>> = {},
): Transaction => ({
  type: 'DIVIDEND',
  id,
  date: '2025-05-02',
  ticker: TICKER_A,
  gross: d('20'),
  withholdingTax: d('3'),
  currency: 'USD',
  returnOfCapital: false,
  ...overrides,
});

/** Co po importu leží v databázi: klíče a u dividend bez ISIN i jejich ticker. */
interface Stored {
  keys: string[];
  bare: Map<string, string | undefined>;
}
const EMPTY: Stored = { keys: [], bare: new Map() };

const run = (broker: string, incoming: Transaction[], stored: Stored = EMPTY) =>
  dedupeTransactions(broker, incoming, stored.keys, [], stored.bare);

const applyOutcome = (stored: Stored, outcome: ReturnType<typeof dedupeTransactions>): Stored => {
  const moved = new Map(outcome.promoted.map(({ from, to }) => [from, to]));
  const bare = new Map([...stored.bare].filter(([key]) => !moved.has(key)));
  for (const { tx, key } of outcome.fresh) {
    if (tx.type === 'DIVIDEND' && !tx.isin) bare.set(key, tx.ticker);
  }
  return {
    keys: [...stored.keys.map((key) => moved.get(key) ?? key), ...outcome.fresh.map((i) => i.key)],
    bare,
  };
};

const store = (broker: string, incoming: Transaction[]): Stored =>
  applyOutcome(EMPTY, run(broker, incoming));

describe('dedupeTransactions: dividenda uložená bez ISIN po doplnění číselníku (L14-02)', () => {
  it('tatáž dividenda s ISIN je duplicita a uložený řádek se povýší na klíč s ISIN', () => {
    const bare = dividend('d1');
    const withIsin = dividend('d1', { isin: ISIN_A });
    const first = run(BROKER, [bare]);
    expect(first.fresh).toHaveLength(1);
    expect(first.promoted).toEqual([]);

    const second = run(BROKER, [withIsin], applyOutcome(EMPTY, first));
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toBe(1);
    expect(second.ambiguous).toEqual([]);
    expect(second.promoted).toEqual([
      { from: dedupeKey(BROKER, bare, 1), to: dedupeKey(BROKER, withIsin, 1), isin: ISIN_A },
    ]);

    // třetí nahrání: klíč s ISIN už je uložený, nic se nepovyšuje ani nepřidává
    const stored = applyOutcome(applyOutcome(EMPTY, first), second);
    expect(stored.keys).toEqual([dedupeKey(BROKER, withIsin, 1)]);
    expect(stored.bare.size).toBe(0);
    const third = run(BROKER, [withIsin], stored);
    expect(third).toMatchObject({ fresh: [], duplicates: 1, promoted: [], ambiguous: [] });
  });

  it('dvě legitimně shodné dividendy téhož dne se nesloučí — povýší se obě, každá na své pořadí', () => {
    const first = run(BROKER, [dividend('d1'), dividend('d2')]);
    expect(first.fresh).toHaveLength(2);

    const incoming = [dividend('d1', { isin: ISIN_A }), dividend('d2', { isin: ISIN_A })];
    const second = run(BROKER, incoming, applyOutcome(EMPTY, first));
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
    const stored = store(BROKER, [dividend('d1')]);
    const outcome = run(
      BROKER,
      [dividend('d1', { isin: ISIN_A }), dividend('d2', { isin: ISIN_A })],
      stored,
    );
    expect(outcome.promoted).toHaveLength(1);
    expect(outcome.fresh).toHaveLength(1);
    expect(outcome.duplicates).toBe(1);
    // druhá je prostě další výplata téhož titulu, ne nejistá dvojnice
    expect(outcome.ambiguous).toEqual([]);
    expect(new Set(applyOutcome(stored, outcome).keys).size).toBe(2);
  });

  it('shodná částka u dvou titulů, ISIN doplněný jen jednomu: povýší se řádek TOHO titulu, druhý zůstane — a dál už jsou to duplicity', () => {
    const other = dividend('d1', { ticker: TICKER_B });
    const stored = store(BROKER, [other, dividend('d2')]);
    // titul druhé dividendy má ISIN, titul první na číselník pořád čeká
    const incoming = [other, dividend('d2', { isin: ISIN_A })];
    const second = run(BROKER, incoming, stored);
    expect(second.fresh).toEqual([]);
    expect(second.duplicates).toBe(2);
    expect(second.ambiguous).toEqual([]);
    expect(second.promoted).toEqual([
      { from: dedupeKey(BROKER, other, 2), to: dedupeKey(BROKER, incoming[1]!, 1), isin: ISIN_A },
    ]);
    // povýšený řádek opravdu patřil titulu A
    expect(stored.bare.get(second.promoted[0]!.from)).toBe(TICKER_A);

    const afterSecond = applyOutcome(stored, second);
    expect(new Set(afterSecond.keys).size).toBe(2);
    expect([...afterSecond.bare.values()]).toEqual([TICKER_B]);
    const third = run(BROKER, incoming, afterSecond);
    expect(third).toMatchObject({ fresh: [], duplicates: 2, promoted: [], ambiguous: [] });

    // číselník doplněný i pro druhý titul: povýší se zbývající řádek, nic nepřibude
    const completed = [
      dividend('d1', { ticker: TICKER_B, isin: ISIN_B }),
      dividend('d2', { isin: ISIN_A }),
    ];
    const fourth = run(BROKER, completed, afterSecond);
    expect(fourth.fresh).toEqual([]);
    expect(fourth.ambiguous).toEqual([]);
    expect(fourth.promoted).toEqual([
      { from: dedupeKey(BROKER, other, 1), to: dedupeKey(BROKER, completed[0]!, 1), isin: ISIN_B },
    ]);
  });

  it('dividenda bez ISIN a shodná dividenda jiného titulu s ISIN v TÉMŽE výpisu jsou dvě události', () => {
    const statement = [dividend('d1', { ticker: TICKER_B }), dividend('d2', { isin: ISIN_A })];
    const outcome = run(BROKER, statement);
    expect(outcome.fresh).toHaveLength(2);
    expect(outcome.promoted).toEqual([]);

    // a opakované nahrání téhož výpisu z nich nic nepovýší
    const again = run(BROKER, statement, applyOutcome(EMPTY, outcome));
    expect(again).toMatchObject({ fresh: [], duplicates: 2, promoted: [], ambiguous: [] });
  });

  it('jiná dividenda (jiný den, jiná částka, jiná srážka, jiná měna, jiný broker) se uložené bez ISIN nedotkne', () => {
    const stored = store(BROKER, [dividend('d1')]);
    const others = [
      dividend('o1', { isin: ISIN_A, date: '2025-05-03' }),
      dividend('o2', { isin: ISIN_A, gross: d('20.01') }),
      dividend('o3', { isin: ISIN_A, withholdingTax: d('0') }),
      dividend('o4', { isin: ISIN_A, currency: 'EUR' }),
    ];
    const outcome = run(BROKER, others, stored);
    expect(outcome.fresh).toHaveLength(4);
    expect(outcome.promoted).toEqual([]);
    expect(outcome.ambiguous).toEqual([]);

    const otherBroker = run('fio', [dividend('d1', { isin: ISIN_A })], stored);
    expect(otherBroker.fresh).toHaveLength(1);
    expect(otherBroker.promoted).toEqual([]);
    expect(otherBroker.ambiguous).toEqual([]);
    // ani broker se stejně dlouhým jménem (klíč se dělí podle prefixu brokera)
    const sameLength = run('degiro', [dividend('d1', { isin: ISIN_A })], stored);
    expect(sameLength.fresh).toHaveLength(1);
    expect(sameLength.promoted).toEqual([]);
  });

  it('nová dividenda s ISIN bez uloženého protějšku je prostě nová', () => {
    const outcome = run(BROKER, [dividend('d1', { isin: ISIN_A })]);
    expect(outcome.fresh).toHaveLength(1);
    expect(outcome.promoted).toEqual([]);
    expect(outcome.ambiguous).toEqual([]);
  });

  it('navazující výpis s překryvem: stará dividenda se povýší, nová se uloží (jiné id řádku nevadí)', () => {
    const stored = store(BROKER, [dividend('prvni-vypis-7')]);
    const overlap = dividend('druhy-vypis-2', { isin: ISIN_A });
    const later = dividend('druhy-vypis-3', { isin: ISIN_A, date: '2025-08-01' });
    const outcome = run(BROKER, [overlap, later], stored);
    expect(outcome.promoted).toEqual([
      { from: stored.keys[0], to: dedupeKey(BROKER, overlap, 1), isin: ISIN_A },
    ]);
    expect(outcome.fresh.map((item) => item.tx.id)).toEqual(['druhy-vypis-3']);
    expect(outcome.duplicates).toBe(1);
  });

  it('výpis řazený od nejnovějšího: nová dividenda s ISIN PŘED tou, která se povyšuje, povýšení nezastaví', () => {
    const stored = store(BROKER, [dividend('prvni-vypis-7')]);
    const later = dividend('druhy-vypis-1', { isin: ISIN_A, date: '2025-08-01' });
    // shodná částka jiného titulu téhož dne, taky před povyšovanou
    const lookalike = dividend('druhy-vypis-2', { ticker: TICKER_B, isin: ISIN_B });
    const overlap = dividend('druhy-vypis-3', { isin: ISIN_A });
    const outcome = run(BROKER, [later, lookalike, overlap], stored);
    expect(outcome.promoted).toEqual([
      { from: stored.keys[0], to: dedupeKey(BROKER, overlap, 1), isin: ISIN_A },
    ]);
    expect(outcome.fresh.map((item) => item.tx.id)).toEqual(['druhy-vypis-1', 'druhy-vypis-2']);
    expect(outcome.duplicates).toBe(1);
    expect(outcome.ambiguous).toEqual([]);
  });
});

/**
 * Povýšení nesmí spolknout JINOU dividendu (A25-R1-01).
 *
 * Den, brutto, srážka a měna nestačí: shodnou částku ve společný výplatní den
 * mívají i dva různé tituly. Když uložená dividenda bez ISIN v příchozím
 * souboru vůbec není (druhý účet, druhý soubor šablony), spárovala se s ní
 * dividenda jiného titulu a neuložila se — tiše chybějící příjem. Páruje se
 * proto jen při shodě tickeru; kde titul porovnat nejde, dividenda se uloží
 * a vrátí se v `ambiguous`, aby na ni volající upozornil.
 */
describe('dedupeTransactions: povýšení jen při shodě titulu (A25-R1-01)', () => {
  it('uložená bez ISIN v souboru není, shodná dividenda JINÉHO titulu s ISIN se uloží jako nová', () => {
    const stored = store(BROKER, [dividend('ucet-1-1', { ticker: 'ZZTC' })]);
    const outcome = run(BROKER, [dividend('ucet-2-1', { isin: ISIN_A })], stored);
    expect(outcome.fresh).toHaveLength(1);
    expect(outcome.duplicates).toBe(0);
    expect(outcome.promoted).toEqual([]);
    // oba tituly jsou známé a různé — o dvojnici nejde, varování by jen mátlo
    expect(outcome.ambiguous).toEqual([]);
    expect(applyOutcome(stored, outcome).keys).toHaveLength(2);
  });

  it('navazující výpis jen s jedním ze dvou shodných titulů: povýší se řádek toho titulu, ne první v pořadí', () => {
    const first = dividend('d1', { ticker: TICKER_B });
    const stored = store(BROKER, [first, dividend('d2')]);
    const incoming = dividend('dalsi-1', { isin: ISIN_A });
    const outcome = run(BROKER, [incoming], stored);
    expect(outcome.promoted).toEqual([
      { from: dedupeKey(BROKER, first, 2), to: dedupeKey(BROKER, incoming, 1), isin: ISIN_A },
    ]);
    expect(outcome.fresh).toEqual([]);
    expect([...applyOutcome(stored, outcome).bare.values()]).toEqual([TICKER_B]);
  });

  it('velikost písmen a okrajové mezery tickeru shodu nekazí', () => {
    const stored = store(BROKER, [dividend('d1', { ticker: ' zzta ' })]);
    const outcome = run(BROKER, [dividend('d1', { isin: ISIN_A })], stored);
    expect(outcome.promoted).toHaveLength(1);
    expect(outcome.fresh).toEqual([]);
  });

  it.each([
    { name: 'uloženému řádku', storedTicker: undefined, incomingTicker: TICKER_A },
    { name: 'příchozí dividendě', storedTicker: TICKER_A, incomingTicker: undefined },
    { name: 'oběma', storedTicker: undefined, incomingTicker: undefined },
    { name: 'příchozí dividendě (prázdný řetězec)', storedTicker: TICKER_A, incomingTicker: ' ' },
  ])(
    'ticker chybí $name: nepáruje se, dividenda se uloží a vrátí se jako nejistá',
    ({ storedTicker, incomingTicker }) => {
      const stored = store(BROKER, [dividend('d1', { ticker: storedTicker })]);
      const incoming = dividend('d1', { ticker: incomingTicker, isin: ISIN_A });
      const outcome = run(BROKER, [incoming], stored);
      expect(outcome.promoted).toEqual([]);
      expect(outcome.fresh.map((item) => item.tx)).toEqual([incoming]);
      expect(outcome.duplicates).toBe(0);
      expect(outcome.ambiguous).toEqual([incoming]);

      // po uložení je to obyčejná duplicita — varování se neopakuje donekonečna
      const again = run(BROKER, [incoming], applyOutcome(stored, outcome));
      expect(again).toMatchObject({ fresh: [], duplicates: 1, promoted: [], ambiguous: [] });
    },
  );

  it('volající, který tickery uložených řádků nepředá, nic nepovýší (bezpečný výchozí stav)', () => {
    const stored = store(BROKER, [dividend('d1')]);
    const outcome = dedupeTransactions(BROKER, [dividend('d1', { isin: ISIN_A })], stored.keys);
    expect(outcome.promoted).toEqual([]);
    expect(outcome.fresh).toHaveLength(1);
  });

  it('řádek téhož titulu leží pod pořadím, které si v dávce vzal jiný titul: nepáruje se, uloží se a hlásí', () => {
    // výpis: titul A, pak titul B — oba bez ISIN, shodná částka téhož dne
    const other = dividend('d2', { ticker: TICKER_B });
    const stored = store(BROKER, [dividend('d1'), other]);
    // číselník doplněný jen titulu A: B si teď bere pořadí 1, kde leží řádek A
    const withIsin = dividend('d1', { isin: ISIN_A });
    const outcome = run(BROKER, [withIsin, other], stored);
    expect(outcome.promoted).toEqual([]);
    expect(outcome.fresh.map((item) => item.tx)).toEqual([withIsin]);
    expect(outcome.duplicates).toBe(1);
    // řádek B se nepřepsal ISINem titulu A a o možné dvojnici se uživatel dozví
    expect(outcome.ambiguous).toEqual([withIsin]);

    const again = run(BROKER, [withIsin, other], applyOutcome(stored, outcome));
    expect(again).toMatchObject({ fresh: [], duplicates: 2, promoted: [], ambiguous: [] });
  });

  it('dividenda bez ISIN, která v dávce leží na řádku SVÉHO titulu, není důvod k varování', () => {
    // šablona: dvě shodné výplaty téhož titulu, uživatel ISIN vyplnil jen u druhé.
    // Uložený řádek bez ISIN má v dávce svůj protějšek (první výplatu), takže
    // druhá výplata je prostě další — ani k povýšení, ani k varování.
    const stored = store(BROKER, [dividend('d1')]);
    const second = dividend('d2', { isin: ISIN_A });
    const outcome = run(BROKER, [dividend('d1'), second], stored);
    expect(outcome.fresh.map((item) => item.tx)).toEqual([second]);
    expect(outcome.duplicates).toBe(1);
    expect(outcome.promoted).toEqual([]);
    expect(outcome.ambiguous).toEqual([]);
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

    const stored = store(broker, before.transactions);
    const second = run(broker, after.transactions, stored);

    expect(second.fresh.filter((item) => item.tx.type === 'DIVIDEND')).toEqual([]);
    expect(second.promoted).toHaveLength(promotable.length);
    expect(second.ambiguous).toEqual([]);
    for (const item of second.promoted) expect(stored.keys).toContain(item.from);

    // třetí nahrání jsou samé duplicity
    const third = run(broker, after.transactions, applyOutcome(stored, second));
    expect(third.fresh).toEqual([]);
    expect(third.promoted).toEqual([]);
    expect(third.duplicates).toBe(after.transactions.length);
  });
});
