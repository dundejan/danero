import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { analyzeTaxYear } from '@danero/engine';
import { d, parseTransactions } from '@danero/shared';
import {
  applyAnswer,
  DISPUTED_LIMIT,
  evaluateCalculator as evaluateWithLimits,
  EXEMPT_SALE_NOTICES,
  FilingCalculator,
  incomeQuestion,
  NOTHING_ANSWERED,
  QUESTIONS,
  verdictCopy,
  type CalculatorAnswers,
  type Situation,
  type Step,
} from '@/components/filing-calculator';
import { filingLimitTexts, type FilingLimitTexts } from '@/lib/filing-limits';
import { czk } from '@/lib/format';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { regimeLimitFor } from '@/lib/simulator-verdict';
import { configForYear, LAST_CONFIGURED_TAX_YEAR } from '@/lib/tax-config';

/**
 * Kalkulačka drží odpovědi v `useState` a otázku s částkou ukáže až po několika
 * kliknutích — a klikat tu není čím (testy běží bez DOM). `useState` si proto
 * první hodnotu vezme z téhle fronty: komponenta se vykreslí rovnou v rozehraném
 * stavu a je vidět, co z předaných limitů opravdu doteče do otázky, nápovědy
 * a verdiktu. Prázdná fronta = obyčejný `useState`.
 */
const seededState = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      seededState.queue.length > 0
        ? [seededState.queue.shift(), () => {}]
        : actual.useState(initial),
  };
});

const answers = (over: Partial<CalculatorAnswers>): CalculatorAnswers => ({
  ...NOTHING_ANSWERED,
  ...over,
});

/**
 * Verdikt s limity § 38g daného roku. Scénáře, které na částce limitu
 * nestojí, si vystačí s výchozím rokem 2026.
 */
const evaluateCalculator = (given: CalculatorAnswers, year = 2026) =>
  evaluateWithLimits(given, filingLimitTexts(year));

/** Pole stavu, do kterého se zapisuje odpověď na danou otázku. */
const FIELD = {
  work: 'work',
  flatTax: 'flatTax',
  sales: 'salesOver100k',
  salesHeld: 'salesHeld',
  crypto: 'cryptoOver100k',
  cryptoHeld: 'cryptoHeld',
  income: 'income',
} as const satisfies Record<Step, keyof CalculatorAnswers>;

/** Všechny odpovědi, které otázka nabízí. */
const OPTIONS: Record<Step, Array<Partial<CalculatorAnswers>>> = {
  work: [{ work: 'employee' }, { work: 'selfEmployed' }, { work: 'neither' }],
  flatTax: [{ flatTax: true }, { flatTax: false }],
  sales: [{ salesOver100k: false }, { salesOver100k: true }],
  salesHeld: [{ salesHeld: 'all' }, { salesHeld: 'some' }, { salesHeld: 'none' }],
  crypto: [{ cryptoOver100k: false }, { cryptoOver100k: true }],
  cryptoHeld: [{ cryptoHeld: 'all' }, { cryptoHeld: 'some' }, { cryptoHeld: 'none' }],
  income: [{ income: 'no' }, { income: 'yes' }, { income: 'unknown' }],
};

const openStep = (given: CalculatorAnswers): Step | undefined =>
  evaluateCalculator(given).steps.find((step) => given[FIELD[step]] === null);

/**
 * Každý průchod kalkulačkou od první otázky po verdikt: na otázku, která je
 * zrovna otevřená, se zkusí všechny odpovědi. Průchod jde přes `applyAnswer`
 * i `evaluateCalculator`, tedy stejnou cestou jako klikání na stránce.
 */
function* everyPath(given: CalculatorAnswers = NOTHING_ANSWERED): Generator<CalculatorAnswers> {
  const open = openStep(given);
  if (!open) {
    yield given;
    return;
  }
  for (const option of OPTIONS[open]) yield* everyPath(applyAnswer(given, option));
}
const ALL_PATHS = [...everyPath()];

const describePath = (given: CalculatorAnswers): string =>
  Object.entries(given)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');

describe('kalkulačka: otázky jdou za sebou', () => {
  it('na začátku je vidět jen první otázka a žádný verdikt', () => {
    const outcome = evaluateCalculator(NOTHING_ANSWERED);
    expect(outcome.steps).toEqual(['work']);
    expect(outcome.verdict).toBeNull();
    expect(outcome.reason).toBeNull();
  });

  it('na paušální režim se ptá jen OSVČ — a dokud neodpoví, dál se nejde', () => {
    expect(evaluateCalculator(answers({ work: 'employee' })).steps).toEqual(['work', 'sales']);
    expect(evaluateCalculator(answers({ work: 'neither' })).steps).toEqual(['work', 'sales']);
    expect(evaluateCalculator(answers({ work: 'selfEmployed' })).steps).toEqual(['work', 'flatTax']);
    expect(evaluateCalculator(answers({ work: 'selfEmployed', flatTax: true })).steps).toEqual([
      'work',
      'flatTax',
      'sales',
    ]);
  });

  it('první dvě odpovědi určí, kdo se ptá', () => {
    const situation = (given: Partial<CalculatorAnswers>) =>
      evaluateCalculator(answers(given)).situation;
    expect(situation({ work: 'employee' })).toBe('employee');
    expect(situation({ work: 'neither' })).toBe('other');
    expect(situation({ work: 'selfEmployed' })).toBeNull();
    expect(situation({ work: 'selfEmployed', flatTax: true })).toBe('flatTax');
    expect(situation({ work: 'selfEmployed', flatTax: false })).toBe('selfEmployed');
  });

  it('H-24: otevřená je vždy jen poslední otázka — přeskočit žádnou nejde', () => {
    // Dřív se krypto ukázalo dřív, než uživatel odpověděl na tříleté držení,
    // a kalkulačka pak s nezodpovězenou otázkou uprostřed mlčela.
    const outcome = evaluateCalculator(
      answers({ work: 'employee', salesOver100k: true, cryptoOver100k: false, income: 'no' }),
    );
    expect(outcome.steps).toEqual(['work', 'sales', 'salesHeld']);
    expect(outcome.verdict).toBeNull();
  });

  it('po jistém verdiktu se už na nic dalšího neptá', () => {
    const outcome = evaluateCalculator(
      answers({ work: 'employee', salesOver100k: true, salesHeld: 'none' }),
    );
    expect(outcome.verdict).toBe('filing');
    expect(outcome.steps).toEqual(['work', 'sales', 'salesHeld']);
  });

  it('změna odpovědi zahodí ty, které na ní stály', () => {
    const done = answers({
      work: 'selfEmployed',
      flatTax: true,
      salesOver100k: true,
      salesHeld: 'all',
      cryptoOver100k: true,
      cryptoHeld: 'all',
      income: 'no',
    });
    // jiná situace = jiný limit v otázce na příjmy; paušál se zaměstnance netýká
    expect(applyAnswer(done, { work: 'employee' })).toMatchObject({
      flatTax: null,
      income: null,
      salesHeld: 'all',
    });
    expect(applyAnswer(done, { flatTax: false })).toMatchObject({ income: null, salesHeld: 'all' });
    // podotázka na držení patří jen k odpovědi „Ano“
    expect(applyAnswer(done, { salesOver100k: false })).toMatchObject({ salesHeld: null });
    expect(applyAnswer(done, { cryptoOver100k: false })).toMatchObject({ cryptoHeld: null });
    // „jen část“ přidává do otázky na příjmy zbylé prodeje — stará odpověď by patřila jiné otázce
    expect(applyAnswer(done, { salesHeld: 'some' }).income).toBeNull();
    expect(applyAnswer(done, { cryptoHeld: 'some' }).income).toBeNull();
    // odpověď, která na otázce nic nemění, ostatní nechává být
    expect(applyAnswer(done, { income: 'yes' })).toEqual({ ...done, income: 'yes' });
    expect(applyAnswer(done, { cryptoOver100k: true })).toEqual(done);
  });
});

describe('kalkulačka: každá kombinace odpovědí', () => {
  it('průchodů je 111 a každý končí verdiktem se zdůvodněním', () => {
    // 3 situace s limitem × 31 průchodů + OSVČ mimo paušál 18 — kdyby přibyla
    // otázka nebo odpověď, tenhle počet řekne, že je čas projít znění znovu
    expect(ALL_PATHS).toHaveLength(111);
    for (const path of ALL_PATHS) {
      const outcome = evaluateCalculator(path);
      expect(outcome.verdict, describePath(path)).not.toBeNull();
      expect(outcome.reason, describePath(path)).toMatch(/\.$/);
      expect(outcome.situation, describePath(path)).not.toBeNull();
    }
  });

  it('rozdělaný průchod verdikt nemá', () => {
    const unfinished = new Set<string>();
    const walk = (given: CalculatorAnswers) => {
      const open = openStep(given);
      if (!open) return;
      unfinished.add(JSON.stringify(given));
      for (const option of OPTIONS[open]) walk(applyAnswer(given, option));
    };
    walk(NOTHING_ANSWERED);
    expect(unfinished.size).toBeGreaterThan(30);
    for (const state of unfinished) {
      expect(evaluateCalculator(JSON.parse(state) as CalculatorAnswers).verdict, state).toBeNull();
    }
  });

  it('„Nevím“ je jediná cesta k „nedá se určit“ a „Ano“ vždy znamená přiznání', () => {
    for (const path of ALL_PATHS) {
      const { verdict } = evaluateCalculator(path);
      expect(verdict === 'unclear', describePath(path)).toBe(path.income === 'unknown');
      if (path.income === 'yes') expect(verdict, describePath(path)).toBe('filing');
      if (path.income === 'no') expect(verdict, describePath(path)).toBe('noFiling');
    }
  });
});

/**
 * Nezávislá kontrola: každý průchod se přeloží na skutečné transakce a verdikt
 * kalkulačky se porovná s tím, co z nich spočítá daňový engine (R-01, R-02,
 * R-08, R-09, R-10). Částky sedí přesně na hranách — „Ne“ znamená příjem
 * rovný limitu, „Ano“ o korunu víc — takže se chytí i chyba o jedničku.
 */
describe('kalkulačka proti enginu: stejné odpovědi, stejný verdikt', () => {
  const PROFILE: ProfileRow = {
    userId: 'u-kalkulacka',
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
    timeTestBasis: 'settlement',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const REGIME: Record<Situation, string> = {
    employee: 'ZAMESTNANEC',
    flatTax: 'PAUSAL',
    selfEmployed: 'OSVC',
    other: 'JINE',
  };
  /** Tržba za kusy, které tři roky nevydržely, u odpovědi „jen část“. */
  const UNHELD_PART = 1000;

  const trade = (
    year: number,
    id: string,
    isin: string,
    crypto: boolean,
    proceedsCzk: number,
    heldLong: boolean,
  ) => {
    const common = {
      isin,
      ...(crypto ? { assetClass: 'CRYPTO' } : {}),
      quantity: '1',
      pricePerShare: String(proceedsCzk),
      currency: 'CZK',
    };
    return [
      { ...common, type: 'BUY', id: `b-${id}`, tradeDate: `${heldLong ? year - 4 : year}-01-10` },
      { ...common, type: 'SELL', id: `s-${id}`, tradeDate: `${year}-06-10` },
    ];
  };

  /** Prodeje jednoho druhu (cenné papíry / krypto) podle odpovědí. */
  const sales = (
    year: number,
    crypto: boolean,
    over100k: boolean | null,
    held: CalculatorAnswers['salesHeld'],
  ) => {
    const prefix = crypto ? 'c' : 's';
    const [longHeld, shortHeld] = crypto ? ['BTC', 'ETH'] : ['CZ0005112300', 'CZ0008019106'];
    if (over100k === null) return [];
    // do 100 000 Kč včetně — a schválně bez tří let, ať je vidět, že stačí limit
    if (!over100k) return trade(year, `${prefix}-do`, shortHeld, crypto, 100_000, false);
    if (held === 'all') return trade(year, `${prefix}-vse`, longHeld, crypto, 150_000, true);
    if (held === 'none') return trade(year, `${prefix}-nic`, shortHeld, crypto, 100_001, false);
    return [
      ...trade(year, `${prefix}-cast-dlouho`, longHeld, crypto, 140_000, true),
      ...trade(year, `${prefix}-cast-kratce`, shortHeld, crypto, UNHELD_PART, false),
    ];
  };

  const engineSays = (path: CalculatorAnswers, year: number): boolean => {
    const { situation } = evaluateCalculator(path, year);
    const regime = REGIME[situation!];
    const { limits } = configForYear(year);
    const limitCzk =
      situation === 'flatTax'
        ? Number(limits.flatTaxOtherIncome)
        : situation === 'employee'
          ? Number(limits.employeeSideIncome)
          : situation === 'other'
            ? Number(limits.generalFiling)
            : 0;
    const unheld =
      (path.salesHeld === 'some' ? UNHELD_PART : 0) + (path.cryptoHeld === 'some' ? UNHELD_PART : 0);
    // „Ne“ = zdanitelné příjmy přesně na limitu (OSVČ mimo paušál: žádné), „Ano“ = o korunu víc
    const dividendCzk =
      path.income === null ? 0 : limitCzk - unheld + (path.income === 'yes' ? 1 : 0);
    const rows = [
      ...sales(year, false, path.salesOver100k, path.salesHeld),
      ...sales(year, true, path.cryptoOver100k, path.cryptoHeld),
      ...(dividendCzk > 0
        ? [
            {
              type: 'DIVIDEND',
              id: 'dividenda',
              isin: 'US0378331005',
              sourceCountry: 'US',
              gross: String(dividendCzk),
              withholdingTax: '0',
              currency: 'CZK',
              date: `${year}-04-01`,
            },
          ]
        : []),
    ];
    const result = analyzeTaxYear(
      engineInputForUser(parseTransactions(rows), { ...PROFILE, regime }, year),
    );
    const taxableCzk = result.limits.flatTax50k.status.usedCzk;
    const limit = regimeLimitFor(result.limits);
    // OSVČ mimo paušál limit nemá: do přiznání patří jakýkoli zdanitelný příjem (R-09f)
    return limit ? taxableCzk.gt(limit.limitCzk) : taxableCzk.gt(0);
  };

  // od prvního roku s osvobozením krypta po celý rok (R-10b) po poslední v registru
  const YEARS = Array.from(
    { length: LAST_CONFIGURED_TAX_YEAR - 2026 + 1 },
    (_, index) => 2026 + index,
  );

  it('prodej nad 100 000 Kč bez tří let držení překročí limit každé situace', () => {
    // Na tom stojí verdikt, který padne hned u otázky na držení. Kdyby novela
    // některý limit zvedla nad hranici osvobození prodejů, přestal by platit.
    expect(YEARS).toContain(2027);
    for (const year of YEARS) {
      const { limits } = configForYear(year);
      const exemption = d(limits.securitiesProceedsExemption);
      expect(d(limits.cryptoProceedsExemption).eq(exemption), String(year)).toBe(true);
      for (const limit of [limits.flatTaxOtherIncome, limits.employeeSideIncome, limits.generalFiling]) {
        expect(d(limit).lte(exemption), `${year}: limit ${limit}`).toBe(true);
      }
    }
  });

  for (const year of YEARS) {
    it(`rok ${year}: verdikt všech průchodů bez „Nevím“ sedí s enginem`, { timeout: 60_000 }, () => {
      const decided = ALL_PATHS.filter((path) => path.income !== 'unknown');
      // 111 průchodů minus 31, které končí odpovědí „Nevím“
      expect(decided).toHaveLength(80);
      const disagreements = decided
        .map((path) => ({
          path: describePath(path),
          calculator: evaluateCalculator(path, year).verdict,
          engine: engineSays(path, year) ? 'filing' : 'noFiling',
        }))
        .filter((row) => row.calculator !== row.engine);
      expect(disagreements).toEqual([]);
    });
  }

  it('limity z konfigurace opravdu rozhodují (jinak by kontrola nic nehlídala)', () => {
    const justUnder = answers({
      work: 'employee',
      salesOver100k: false,
      cryptoOver100k: false,
      income: 'no',
    });
    expect(engineSays(justUnder, 2026)).toBe(false);
    expect(engineSays({ ...justUnder, income: 'yes' }, 2026)).toBe(true);
  });
});

describe('kalkulačka: znění verdiktů', () => {
  const limits = filingLimitTexts(2026);
  const base = { salesOver100k: false, cryptoOver100k: false } as const;
  const SITUATIONS: Array<[Situation, Partial<CalculatorAnswers>]> = [
    ['employee', { work: 'employee' }],
    ['flatTax', { work: 'selfEmployed', flatTax: true }],
    ['selfEmployed', { work: 'selfEmployed', flatTax: false }],
    ['other', { work: 'neither' }],
  ];

  it('zlaté pravidlo: prodeje do 100 000 Kč a nic dalšího → bez přiznání', () => {
    const outcome = evaluateCalculator(answers({ work: 'employee', ...base, income: 'no' }));
    expect(outcome.verdict).toBe('noFiling');
    expect(outcome.reason).toContain('Do 100 000 Kč tržeb');
    // a k tomu limit, pod kterým zůstaly ostatní příjmy
    expect(outcome.reason).toContain(`do ${limits.employee} vedle zaměstnání`);
  });

  it('osvobození tříletým testem se pozná i u krypta (dřív zdůvodnění mluvilo o stovce)', () => {
    const outcome = evaluateCalculator(
      answers({ work: 'neither', salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'all', income: 'no' }),
    );
    expect(outcome.verdict).toBe('noFiling');
    expect(outcome.reason).toContain('Po třech letech držení');
    expect(outcome.reason).not.toContain('Do 100 000 Kč tržeb');
  });

  it('„jen část“ držená tři roky verdikt nepředbíhá — zbytek se přičte k ostatním příjmům', () => {
    // Dřív „Ne“ na držení znamenalo rovnou „nejspíš podáš přiznání“, i když
    // šlo o pár kusů za tisícovku vedle dlouho drženého zbytku (R-02c).
    const partly = answers({ work: 'selfEmployed', flatTax: true, salesOver100k: true, salesHeld: 'some' });
    expect(evaluateCalculator(partly).verdict).toBeNull();
    const asked = evaluateCalculator({ ...partly, cryptoOver100k: false });
    expect(asked.steps.at(-1)).toBe('income');
    expect(asked.incomeQuestion?.hint).toContain(
      'Započítej celou tržbu (ne zisk) za akcie a ETF, které jsi nedržel déle než 3 roky.',
    );
    const under = evaluateCalculator({ ...partly, cryptoOver100k: false, income: 'no' });
    expect(under.verdict).toBe('noFiling');
    expect(under.reason).toContain('Co jsi držel déle než 3 roky, je osvobozené');
  });

  it('nápověda jmenuje právě ty prodeje, ze kterých vydržela jen část', () => {
    const hint = (sales: boolean, crypto: boolean) =>
      incomeQuestion('employee', limits, limits, { sales, crypto }).hint;
    expect(hint(false, false)).not.toContain('Započítej celou tržbu');
    expect(hint(true, false)).toContain('za akcie a ETF, které');
    expect(hint(false, true)).toContain('za krypto, které');
    expect(hint(true, true)).toContain('za akcie, ETF i krypto, které');
  });

  it('prodej nad 100 000 Kč bez tří let držení → přiznání a zdůvodnění jmenuje limit situace', () => {
    for (const asset of ['sales', 'crypto'] as const) {
      const sold =
        asset === 'sales'
          ? { salesOver100k: true, salesHeld: 'none' as const }
          : { salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'none' as const };
      const reason = (work: Partial<CalculatorAnswers>) => {
        const outcome = evaluateCalculator(answers({ ...work, ...sold }));
        expect(outcome.verdict).toBe('filing');
        return outcome.reason;
      };
      expect(reason({ work: 'employee' })).toContain(`limitu ${limits.employee} pro příjmy vedle zaměstnání`);
      expect(reason({ work: 'neither' })).toContain(`limitu ${limits.general} pro podání přiznání`);
      expect(reason({ work: 'selfEmployed', flatTax: true })).toContain('limitu 50 000 Kč pro paušální daň');
      // u limitů rozhoduje tržba, ne zisk (R-08d)
      expect(reason({ work: 'employee' })).toContain('celá tržba, ne jen zisk');
      expect(reason({ work: 'employee' })).toContain(asset === 'sales' ? 'Akcie nebo ETF' : 'Krypto');
    }
  });

  it('R-08a/R-08e: paušalista se u každého verdiktu „přiznání“ dozví o přehledech i o tom, že v režimu zůstává', () => {
    const flatTax = { work: 'selfEmployed', flatTax: true } as const;
    const reasons = [
      evaluateCalculator(answers({ ...flatTax, ...base, income: 'yes' })).reason,
      evaluateCalculator(answers({ ...flatTax, salesOver100k: true, salesHeld: 'none' })).reason,
      evaluateCalculator(
        answers({ ...flatTax, salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'none' }),
      ).reason,
    ];
    for (const reason of reasons) {
      expect(reason).toContain('přehledy pro sociální správu a zdravotní pojišťovnu');
      expect(reason).toContain('v paušálním režimu ale zůstáváš');
    }
  });

  it('R-09f: OSVČ mimo paušál neslyší „přiznání řešit nemusíš“ — podává ho kvůli podnikání', () => {
    // Do 13. 10. 2026 spadla pod „Jiné“ a s obecným limitem se dočetla, že
    // přiznání kvůli investicím řešit nemusí.
    const selfEmployed = { work: 'selfEmployed', flatTax: false } as const;
    const nothing = evaluateCalculator(answers({ ...selfEmployed, ...base, income: 'no' }));
    expect(nothing.verdict).toBe('noFiling');
    expect(nothing.reason).toContain('přiznání, které podáváš kvůli podnikání');
    expect(verdictCopy('noFiling', 'selfEmployed').title).toBe(
      'Vypadá to, že investice ti do přiznání nic nepřidají.',
    );
    expect(verdictCopy('filing', 'selfEmployed').title).toBe(
      'Investice nejspíš patří do tvého přiznání.',
    );
    // limit nemá: stačí jakákoli částka i jen část prodejů bez tří let držení
    const question = incomeQuestion('selfEmployed', limits);
    expect(question.question).toBe('Máš letos z investic nějaký zdanitelný příjem?');
    expect(question.hint).toContain('Stačí jakákoli částka');
    const partly = evaluateCalculator(
      answers({ ...selfEmployed, salesOver100k: true, salesHeld: 'some' }),
    );
    expect(partly.verdict).toBe('filing');
    expect(partly.reason).toContain('Část prodaných akcií nebo ETF');
    expect(partly.reason).toContain('bez ohledu na částku');
    const partlyCrypto = evaluateCalculator(
      answers({ ...selfEmployed, salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'some' }),
    );
    expect(partlyCrypto.verdict).toBe('filing');
    expect(partlyCrypto.reason).toContain('Část prodaného krypta');
  });

  it('„Nevím“ → poctivé „bez dat to nejde říct“', () => {
    for (const [situation, work] of SITUATIONS) {
      const outcome = evaluateCalculator(answers({ ...work, ...base, income: 'unknown' }));
      expect(outcome.verdict, situation).toBe('unclear');
      expect(outcome.reason, situation).toContain('zjistí Danero přesně z napojeného účtu nebo výpisu');
    }
    expect(verdictCopy('unclear', 'employee').title).toBe('Tohle bez dat s jistotou říct nejde.');
  });

  it('E-33: nápověda k příjmům jmenuje deriváty u všech situací', () => {
    // R-08d/R-10f počítá kladná plnění z derivátů do limitů 50k i 20k. Dokud je
    // nápověda vyjmenovávala jako „dividendy, úroky nebo nájem“, odpověděl
    // obchodník s CFD poctivě „Ne“ — a dostal verdikt, že přiznání řešit nemusí.
    for (const [situation] of SITUATIONS) {
      const { hint } = incomeQuestion(situation, limits);
      expect(hint, situation).toContain('derivát');
      expect(hint, situation).toContain('CFD');
      expect(hint, situation).toContain('stablecoin');
    }
  });

  it('R-07a/R-07g: české dividendy a úroky zdaněné srážkou nápověda z limitu vylučuje', () => {
    // „úroky“ bez přívlastku četl jako zdanitelné i ten, kdo je má ze
    // spořicího účtu — a ty do žádného limitu nevstupují
    for (const [situation] of SITUATIONS) {
      const { hint } = incomeQuestion(situation, limits);
      expect(hint, situation).toContain('české dividendy a úroky z banky, které už zdanila srážka');
      expect(hint, situation).toMatch(/zahraniční dividendy a úroky/);
    }
  });

  it('R-09d: oznámení nad 5 milionů Kč jen tam, kde takový osvobozený prodej může být', () => {
    const notice = (given: Partial<CalculatorAnswers>) =>
      evaluateCalculator(answers(given)).exemptSaleNotice;
    // prodeje do 100 000 Kč za rok pěti milionů dosáhnout nemůžou
    expect(notice({ work: 'employee', ...base, income: 'no' })).toBeNull();
    // nic nevydrželo tři roky → nic osvobozeného
    expect(notice({ work: 'employee', salesOver100k: true, salesHeld: 'none' })).toBeNull();
    // kdo přiznání nepodává, má jen tři měsíce (K7a-03)
    expect(notice({ work: 'employee', salesOver100k: true, salesHeld: 'all', cryptoOver100k: false, income: 'no' })).toBe('threeMonths');
    // „nedá se určit“: jestli podává, nevíme — oznámení nesmí tvrdit ani jedno
    expect(notice({ work: 'employee', salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'some', income: 'unknown' })).toBe('eitherWay');
    expect(EXEMPT_SALE_NOTICES.eitherWay.visible).toContain('bez přiznání do tří měsíců');
    expect(EXEMPT_SALE_NOTICES.eitherWay.detail).toContain('stejnou lhůtu jako na ně');
    // kdo přiznání podává, oznamuje v jeho lhůtě — a povinnost má taky
    expect(notice({ work: 'employee', salesOver100k: true, salesHeld: 'all', cryptoOver100k: false, income: 'yes' })).toBe('withReturn');
    expect(notice({ work: 'employee', salesOver100k: true, salesHeld: 'some', cryptoOver100k: true, cryptoHeld: 'none' })).toBe('withReturn');
    expect(notice({ work: 'selfEmployed', flatTax: false, salesOver100k: true, salesHeld: 'all', cryptoOver100k: false, income: 'no' })).toBe('withReturn');
  });

  it('R-09d: oznámení se řídí jen otázkami, které jsou vidět', () => {
    // Odpověď na krypto schovaná za verdiktem u akcií nesmí rozhodovat: stejné
    // viditelné odpovědi by jinak jednou oznámení ukázaly a jindy ne.
    const early = { work: 'employee', salesOver100k: true, salesHeld: 'none' } as const;
    const fresh = evaluateCalculator(answers(early));
    const stale = evaluateCalculator(answers({ ...early, cryptoOver100k: true, cryptoHeld: 'all' }));
    expect(stale.steps).toEqual(fresh.steps);
    expect(stale.exemptSaleNotice).toBeNull();
    expect(stale).toEqual(fresh);
  });

  it('R-02c: verdikt, který stojí na přísnějším výkladu stovky, to říká', () => {
    // pravidlo 2: sporný výklad se neschovává — default bezpečný, ale je vidět
    const partly = { work: 'employee', salesOver100k: true, salesHeld: 'some', cryptoOver100k: false } as const;
    expect(evaluateCalculator(answers({ ...partly, income: 'yes' })).disputedLimit).toBe(true);
    expect(evaluateCalculator(answers({ ...partly, income: 'unknown' })).disputedLimit).toBe(true);
    // pod limitem vyjde „bez přiznání“ podle obou výkladů
    expect(evaluateCalculator(answers({ ...partly, income: 'no' })).disputedLimit).toBe(false);
    // OSVČ mimo paušál: „jen část“ rozhoduje hned, a jen přísnějším výkladem
    expect(
      evaluateCalculator(
        answers({ work: 'selfEmployed', flatTax: false, salesOver100k: false, cryptoOver100k: true, cryptoHeld: 'some' }),
      ).disputedLimit,
    ).toBe(true);
    // kde na výkladu nezáleží, se o něm mlčí
    expect(evaluateCalculator(answers({ work: 'employee', salesOver100k: true, salesHeld: 'none' })).disputedLimit).toBe(false);
    expect(
      evaluateCalculator(answers({ work: 'employee', salesOver100k: true, salesHeld: 'all', cryptoOver100k: false, income: 'yes' })).disputedLimit,
    ).toBe(false);
    expect(DISPUTED_LIMIT.detail).toContain('Podle mírnějšího výkladu');
    expect(DISPUTED_LIMIT.detail).toContain('riziko doměrku');
  });

  it('R-09d/K7a-03: oznámení § 38v netvrdí, že lhůta je stejná jako u přiznání', () => {
    // Text patří k verdiktu „přiznání řešit nemusíš“ — a právě u toho, kdo
    // přiznání nepodává, se lhůty rozcházejí: prodloužení na čtyři měsíce dává
    // § 136 odst. 2 písm. a) daňového řádu jen tomu, kdo přiznání „následně"
    // podá elektronicky (pokyn GFŘ D-59, str. 45). Rozdíl je až měsíc a sankce
    // podle § 38w je 0,1–15 % z neoznámeného příjmu.
    const { visible, detail } = EXEMPT_SALE_NOTICES.threeMonths;
    expect(detail).not.toContain('lhůta je ale stejná');
    expect(detail).toContain('§ 38v');
    // musí říct, že lhůta je KRATŠÍ, a jednou větou proč
    expect(detail).toContain('tři měsíce');
    expect(detail).toContain('kdo přiznání opravdu podá');
    expect(visible).toContain('do tří měsíců po konci roku');
    // kdo přiznání podává, má lhůty totožné
    expect(EXEMPT_SALE_NOTICES.withReturn.visible).toContain('ve lhůtě pro přiznání');
    expect(EXEMPT_SALE_NOTICES.withReturn.detail).toContain('§ 38v');
  });

  it('R-09d/K7a-03: totéž vysvětluje i metodika /jak-pocitame', () => {
    // zalomení řádků ve zdroji je věc formátování, ne obsahu
    const text = readFileSync(
      join(import.meta.dirname, '..', 'app', 'jak-pocitame', 'page.tsx'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(text).not.toContain('ve stejné lhůtě jako přiznání. Pokuta');
    expect(text).toContain('Lhůta na oznámení je kratší');
    expect(text).toContain('jen tři měsíce po konci roku');
  });
});

/**
 * R-09a, R-09b: limity § 38g jsou do ZO 2026 50 000 / 20 000 Kč a od ZO 2027
 * 100 000 / 40 000 Kč (zák. č. 180/2026 Sb.). Kalkulačka se ptá na „letos“,
 * takže částku v otázce i ve zdůvodnění bere z konfigurace běžného roku —
 * s částkou natvrdo by od 1. 1. 2027 radila podle zrušeného limitu (nález
 * L3-01 revize 5). Očekávání je proto z konfigurace roku, ne literál.
 */
describe('kalkulačka: limity § 38g z konfigurace roku (R-09a, R-09b, L3-01)', () => {
  const withIncome = (work: 'employee' | 'neither'): CalculatorAnswers =>
    answers({ work, salesOver100k: false, cryptoOver100k: false, income: 'yes' });

  for (const year of [2026, 2027]) {
    const { limits } = configForYear(year);
    const employeeLimit = czk(d(limits.employeeSideIncome));
    const generalLimit = czk(d(limits.generalFiling));

    it(`rok ${year}: otázka na ostatní příjmy jmenuje limit toho roku`, () => {
      expect(incomeQuestion('employee', filingLimitTexts(year)).question).toBe(
        `Máš letos vedle zaměstnání zdanitelné příjmy nad ${employeeLimit}?`,
      );
      expect(incomeQuestion('other', filingLimitTexts(year)).question).toBe(
        `Máš letos zdanitelné příjmy nad ${generalLimit} celkem?`,
      );
    });

    it(`rok ${year}: zdůvodnění verdiktu jmenuje tentýž limit jako otázka`, () => {
      expect(evaluateCalculator(withIncome('employee'), year).reason).toContain(
        `nad ${employeeLimit} vedle zaměstnání`,
      );
      expect(evaluateCalculator(withIncome('neither'), year).reason).toContain(
        `nad ${generalLimit} za rok`,
      );
    });
  }

  it('limit paušální daně (§ 7a) se rokem nemění', () => {
    for (const year of [2026, 2027]) {
      expect(configForYear(year).limits.flatTaxOtherIncome).toBe('50000');
      expect(incomeQuestion('flatTax', filingLimitTexts(year)).question).toContain('nad 50 000 Kč');
    }
  });

  it('nápověda je bez roku, dokud se limit proti loňsku nezměnil', () => {
    // rok 2026 má stejné limity jako 2025 — věta o roce by jen překážela
    expect(filingLimitTexts(2025).employee).toBe(filingLimitTexts(2026).employee);
    for (const situation of ['employee', 'other'] as const) {
      const plain = incomeQuestion(situation, filingLimitTexts(2026));
      expect(incomeQuestion(situation, filingLimitTexts(2026), filingLimitTexts(2025))).toEqual(plain);
      expect(plain.hint).not.toMatch(/20\d\d/);
    }
  });
});

/**
 * Kalkulačka tak, jak ji vidí člověk. Limity roku 2027 proti 2026 hlídají
 * A20-R1-02: od 1. 1. 2027 se kalkulačka ptá na limit roku 2027 („letos“), jenže
 * v lednu až květnu na ni lidé chodí kvůli přiznání za rok 2026, kde platí
 * limit poloviční. Nápověda proto v roce změny řekne, kterého roku se částka
 * týká a kolik to bylo loni (R-09a, R-09b).
 */
describe('kalkulačka na stránce (vykreslení s hotovými odpověďmi)', () => {
  // Limity nesou pevné mezery (`50\u00a0000\u00a0Kč`) a sazba kalkulačky je doplní
  // i do okolního textu; porovnává se proto text s obyčejnými mezerami na obou stranách.
  const spaced = (limits: FilingLimitTexts): FilingLimitTexts =>
    JSON.parse(JSON.stringify(limits).replaceAll('\u00a0', ' ')) as FilingLimitTexts;
  const current = spaced(filingLimitTexts(2027));
  const previous = spaced(filingLimitTexts(2026));

  /** Kalkulačka vykreslená s hotovými odpověďmi (viz `seededState`), jako text bez značek. */
  const renderAnswered = (
    given: CalculatorAnswers,
    limits: FilingLimitTexts = current,
    previousLimits: FilingLimitTexts = previous,
  ): string => {
    // kalkulačka má jediný stav — objekt s odpověďmi
    seededState.queue = [given];
    const html = renderToStaticMarkup(
      createElement(FilingCalculator, {
        filingLimits: limits,
        previousFilingLimits: previousLimits,
      }),
    );
    // kdyby komponenta přibrala další stav, fronta by se rozešla s pořadím
    expect(seededState.queue).toEqual([]);
    // sazba (`tidy`) v textu vymění obyčejné mezery za pevné — tady jde o znění
    return html.replace(/<[^>]+>/g, ' ').replaceAll('\u00a0', ' ');
  };

  const employeeNote = `Limit ${current.employee} platí pro příjmy za rok 2027 — za rok 2026 to bylo ještě ${previous.employee}.`;
  const generalNote = `Limit ${current.general} platí pro příjmy za rok 2027 — za rok 2026 to bylo ještě ${previous.general}.`;
  const nothingSold = { salesOver100k: false, cryptoOver100k: false } as const;

  it('konfigurace: limity roku 2027 se od roku 2026 liší', () => {
    // bez rozdílu by testy níž neměly co hlídat
    expect(current.employee).not.toBe(previous.employee);
    expect(current.general).not.toBe(previous.general);
  });

  it('prázdná kalkulačka ukazuje první otázku se třemi odpověďmi a místo pro verdikt', () => {
    const text = renderAnswered(NOTHING_ANSWERED);
    expect(text).toContain(QUESTIONS.work.question);
    for (const option of ['Zaměstnanec', 'OSVČ', 'Ani jedno']) expect(text).toContain(option);
    expect(text).toContain('student, důchodce nebo rodič na rodičovské');
    expect(text).toContain('Ukáže se tady, jakmile odpovíš na všechny otázky.');
    // další otázky přijdou až po odpovědi
    expect(text).not.toContain(QUESTIONS.sales.question);
    expect(text).not.toContain('Začít znovu');
  });

  it('OSVČ dostane otázku na paušální režim dřív než cokoli dalšího', () => {
    const text = renderAnswered(answers({ work: 'selfEmployed' }));
    expect(text).toContain(QUESTIONS.flatTax.question);
    expect(text).toContain('jednu měsíční paušální zálohu');
    expect(text).not.toContain(QUESTIONS.sales.question);
    expect(renderAnswered(answers({ work: 'employee' }))).not.toContain(QUESTIONS.flatTax.question);
  });

  it('nápověda řekne rok limitu i loňskou částku — zaměstnanci i ostatním', () => {
    expect(incomeQuestion('employee', current, previous).hint.startsWith(`${employeeNote} Počítej `)).toBe(true);
    expect(incomeQuestion('other', current, previous).hint.startsWith(`${generalNote} Počítej `)).toBe(true);
    // limit paušální daně (§ 7a) se nezměnil, rok k němu nepatří
    expect(incomeQuestion('flatTax', current, previous).hint).not.toMatch(/20\d\d/);
    // samotná otázka zůstává stejná
    expect(incomeQuestion('employee', current, previous).question).toBe(
      incomeQuestion('employee', current).question,
    );
  });

  it('zaměstnanec, který odpoví „Ne“, vidí vedle verdiktu i limit za rok 2026', () => {
    // scénář z nálezu: 30 000 Kč dividend za rok 2026, únor 2027
    const text = renderAnswered(answers({ work: 'employee', ...nothingSold, income: 'no' }));
    expect(text).toContain(`Máš letos vedle zaměstnání zdanitelné příjmy nad ${current.employee}?`);
    expect(text).toContain(employeeNote);
    expect(text).toContain('Vypadá to, že přiznání kvůli investicím řešit nemusíš.');
  });

  it('A20-R1-02: i zdůvodnění „bez přiznání“ řekne, kterého roku se limit týká', () => {
    // verdikt limit jmenuje — bez roku by zaměstnanci s 30 000 Kč za rok 2026
    // v únoru 2027 tvrdil, že do 40 000 Kč přiznání nepodává
    const reason = (work: 'employee' | 'neither') =>
      evaluateWithLimits(answers({ work, ...nothingSold, income: 'no' }), current, previous).reason;
    expect(reason('employee')).toContain(`do ${current.employee} vedle zaměstnání`);
    expect(reason('employee')).toContain(employeeNote);
    expect(reason('neither')).toContain(generalNote);
    // paušální limit se nezměnil a v roce beze změny je zdůvodnění bez roku
    const flatTax = evaluateWithLimits(
      answers({ work: 'selfEmployed', flatTax: true, ...nothingSold, income: 'no' }),
      current,
      previous,
    ).reason;
    expect(flatTax).not.toMatch(/20\d\d/);
    expect(
      evaluateWithLimits(answers({ work: 'employee', ...nothingSold, income: 'no' }), previous, previous).reason,
    ).toMatch(/přiznání nevyžadují\.$/);
  });

  it('R-02c: sporný výklad stovky je u verdiktu vidět', () => {
    const partly = { work: 'employee', salesOver100k: true, salesHeld: 'some', cryptoOver100k: false } as const;
    expect(renderAnswered(answers({ ...partly, income: 'yes' }))).toContain(DISPUTED_LIMIT.visible);
    expect(renderAnswered(answers({ ...partly, income: 'no' }))).not.toContain(DISPUTED_LIMIT.visible);
  });

  it('odpovědi Ne / Ano stojí u všech otázek ve stejném pořadí', () => {
    // prohozené pořadí u jediné otázky vede k přehmatu na té další
    const text = renderAnswered(
      answers({ work: 'selfEmployed', flatTax: true, salesOver100k: false, cryptoOver100k: false }),
    );
    expect(text.match(/ Ne\s+Ano /g)).toHaveLength(4);
    expect(text).not.toMatch(/ Ano\s+Ne /);
  });

  it('otázka i zdůvodnění verdiktu jmenují limit běžného roku, ne loňský', () => {
    const employee = renderAnswered(answers({ work: 'employee', ...nothingSold, income: 'yes' }));
    expect(employee).toContain(`nad ${current.employee}?`);
    expect(employee).toContain(`Zdanitelné příjmy nad ${current.employee} vedle zaměstnání`);
    expect(employee).not.toContain(`nad ${previous.employee}`);

    const other = renderAnswered(answers({ work: 'neither', ...nothingSold, income: 'yes' }));
    expect(other).toContain(`Máš letos zdanitelné příjmy nad ${current.general} celkem?`);
    expect(other).toContain(generalNote);
    expect(other).toContain(`Zdanitelné příjmy nad ${current.general} za rok`);
    expect(other).not.toContain(`nad ${previous.general}`);
  });

  it('v roce beze změny kalkulačka žádný rok nejmenuje', () => {
    const text = renderAnswered(
      answers({ work: 'employee', ...nothingSold, income: 'no' }),
      filingLimitTexts(2026),
      filingLimitTexts(2025),
    );
    expect(text).toContain(`nad ${previous.employee}?`);
    expect(text).not.toMatch(/za rok 20\d\d/);
  });

  /**
   * Textová dieta (docs/07): výklad se z kalkulačky přestěhoval do vysvětlivek
   * a ty se vykreslí až po otevření. Výhrada, bez které člověk odpoví nebo
   * dopadne špatně, proto musí zůstat VIDITELNÁ — tady se hlídá, že je
   * v prvním vykreslení, ne jen v konstantě.
   */
  it('E-3-03: výjimka stablecoinů je vidět u otázky na krypto, ne až ve vysvětlivce', () => {
    const text = renderAnswered(
      answers({ work: 'employee', salesOver100k: false }),
      filingLimitTexts(2026),
      filingLimitTexts(2025),
    );
    expect(text).toContain('Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?');
    expect(text).toMatch(/Stablecoiny \(USDT, USDC…\) nepočítej/);
    expect(text).toContain('ostatním zdanitelným příjmům');
  });

  it('po jistém verdiktu na stránce další otázky nejsou', () => {
    const text = renderAnswered(
      answers({ work: 'employee', salesOver100k: true, salesHeld: 'none' }),
      filingLimitTexts(2026),
      filingLimitTexts(2025),
    );
    expect(text).toContain('Nejspíš podáš přiznání.');
    expect(text).toContain(QUESTIONS.salesHeld.question);
    expect(text).not.toContain(QUESTIONS.crypto.question);
    expect(text).not.toContain('vedle zaměstnání zdanitelné příjmy');
    // výhrada „orientačně“ stojí u verdiktu vždy
    expect(text).toContain('Orientačně — přesně to spočítá aplikace z tvých dat.');
    // nic osvobozeného tříletým testem → o oznámení nad 5 milionů Kč ani slovo
    expect(text).not.toContain('5 milionů Kč');
  });

  it('R-09d: oznámení nad 5 milionů Kč nese lhůtu podle toho, jestli se podává přiznání', () => {
    const longHeld = { salesOver100k: true, salesHeld: 'all', cryptoOver100k: false } as const;
    const render = (given: Partial<CalculatorAnswers>) =>
      renderAnswered(answers(given), filingLimitTexts(2026), filingLimitTexts(2025));

    const exempt = render({ work: 'neither', ...longHeld, income: 'no' });
    expect(exempt).toContain('Vypadá to, že přiznání kvůli investicím řešit nemusíš.');
    expect(exempt).toContain('osvobozený prodej nad 5 milionů Kč');
    expect(exempt).toContain('do tří měsíců po konci roku');

    const filing = render({ work: 'neither', ...longHeld, income: 'yes' });
    expect(filing).toContain('Nejspíš podáš přiznání.');
    expect(filing).toContain('osvobozený prodej nad 5 milionů Kč');
    expect(filing).toContain('ve lhůtě pro přiznání');
    expect(filing).not.toContain('do tří měsíců po konci roku');

    // prodeje do 100 000 Kč: oznámení se netýká
    expect(render({ work: 'neither', ...nothingSold, income: 'no' })).not.toContain('5 milionů Kč');
  });

  it('R-09f: OSVČ mimo paušál vidí vlastní verdikt i předpoklad, na kterém stojí', () => {
    const selfEmployed = { work: 'selfEmployed', flatTax: false } as const;
    const render = (given: Partial<CalculatorAnswers>) =>
      renderAnswered(answers(given), filingLimitTexts(2026), filingLimitTexts(2025));

    const nothing = render({ ...selfEmployed, ...nothingSold, income: 'no' });
    expect(nothing).toContain('Vypadá to, že investice ti do přiznání nic nepřidají.');
    expect(nothing).toContain('Vycházíme z toho, že přiznání kvůli podnikání podáváš.');
    expect(nothing).not.toContain('přiznání kvůli investicím řešit nemusíš');

    const taxable = render({ ...selfEmployed, ...nothingSold, income: 'yes' });
    expect(taxable).toContain('Investice nejspíš patří do tvého přiznání.');
    expect(taxable).toContain('bez ohledu na částku');

    // ostatním se předpoklad o podnikání neukazuje
    expect(render({ work: 'employee', ...nothingSold, income: 'no' })).not.toContain(
      'kvůli podnikání',
    );
  });
});
