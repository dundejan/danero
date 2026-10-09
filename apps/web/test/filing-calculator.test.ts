import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { d } from '@danero/shared';
import {
  evaluateCalculator as evaluateWithLimits,
  incomeQuestions,
  KalkulackaPriznani,
  OZNAMENI_5M,
  type CalculatorAnswers,
} from '@/components/filing-calculator';
import { filingLimitTexts, type FilingLimitTexts } from '@/lib/filing-limits';
import { czk } from '@/lib/format';
import { configForYear } from '@/lib/tax-config';

/**
 * Kalkulačka drží odpovědi v `useState` a otázku s částkou ukáže až po několika
 * kliknutích — a klikat tu není čím (testy běží bez DOM). `useState` si proto
 * první hodnoty vezme z téhle fronty: komponenta se vykreslí rovnou v rozehraném
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

/** Nic nezodpovězeno — základ, na kterém se skládají jednotlivé scénáře. */
const nothingAnswered: CalculatorAnswers = {
  situation: null,
  salesOver100k: null,
  allHeldThreeYears: null,
  kryptoNad100k: null,
  kryptoDrzeno3Roky: null,
  prijmy: null,
};

const answers = (over: Partial<CalculatorAnswers>): CalculatorAnswers => ({
  ...nothingAnswered,
  ...over,
});

/**
 * Verdikt s limity § 38g daného roku. Starší scénáře na částce limitu
 * nestojí, takže jim stačí výchozí rok 2026.
 */
const evaluateCalculator = (given: CalculatorAnswers, year = 2026) =>
  evaluateWithLimits(given, filingLimitTexts(year));

describe('kalkulačka „Musím podat přiznání?“', () => {
  it('H-24: přeskočená otázka na tříleté držení řekne, co doplnit (dřív se nevykreslilo nic)', () => {
    // uživatel prodal nad 100k, otázku na 3 roky přeskočil a odpověděl až na
    // krypto a na ostatní příjmy — verdict tím pádem vzniknout nemůže
    const outcome = evaluateCalculator(
      answers({
        situation: 'pausal',
        salesOver100k: true,
        allHeldThreeYears: null,
        kryptoNad100k: false,
        prijmy: 'ne',
      }),
    );

    expect(outcome.verdict).toBeNull();
    expect(outcome.skippedQuestion).toBe('Držel jsi všechny prodané kusy déle než 3 roky?');
  });

  it('H-24: přeskočená otázka na držení krypta se ohlásí stejně', () => {
    const outcome = evaluateCalculator(
      answers({
        situation: 'zamestnanec',
        salesOver100k: false,
        kryptoNad100k: true,
        kryptoDrzeno3Roky: null,
      }),
    );

    expect(outcome.verdict).toBeNull();
    // otázka na příjmy se u nezodpovězeného držení krypta vůbec neukazuje,
    // takže „přeskočená“ je až ta, za kterou uživatel odpověděl dřív —
    // tady nic dalšího nezodpověděl a hláška se tedy nevnucuje
    expect(outcome.skippedQuestion).toBeNull();
  });

  it('rozdělaná kalkulačka bez přeskočení na nic neupozorňuje', () => {
    expect(evaluateCalculator(nothingAnswered).skippedQuestion).toBeNull();
    expect(evaluateCalculator(answers({ situation: 'jine' })).skippedQuestion).toBeNull();
    expect(
      evaluateCalculator(answers({ situation: 'jine', salesOver100k: true })).skippedQuestion,
    ).toBeNull();
  });

  it('hotový verdict hlášku o chybějící odpovědi nikdy nezobrazuje', () => {
    const outcome = evaluateCalculator(
      answers({
        situation: 'pausal',
        salesOver100k: true,
        allHeldThreeYears: true,
        kryptoNad100k: false,
        prijmy: 'ne',
      }),
    );

    expect(outcome.verdict).toBe('osvobozeno');
    expect(outcome.skippedQuestion).toBeNull();
  });

  it('zlaté pravidlo: prodeje do 100 000 Kč a nic dalšího → bez přiznání', () => {
    const outcome = evaluateCalculator(
      answers({
        situation: 'pausal',
        salesOver100k: false,
        kryptoNad100k: false,
        prijmy: 'ne',
      }),
    );

    expect(outcome.verdict).toBe('osvobozeno');
    expect(outcome.reason).toContain('Do 100 000 Kč tržeb');
  });

  it('krypto nad limit bez tří let držení → přiznání', () => {
    const outcome = evaluateCalculator(
      answers({ situation: 'jine', kryptoNad100k: true, kryptoDrzeno3Roky: false }),
    );

    expect(outcome.verdict).toBe('priznani');
    expect(outcome.skippedQuestion).toBeNull();
  });

  it('„Nevím“ u dividend a úroků → poctivé „bez dat to nejde říct“', () => {
    const outcome = evaluateCalculator(
      answers({
        situation: 'zamestnanec',
        salesOver100k: false,
        kryptoNad100k: false,
        prijmy: 'nevim',
      }),
    );

    expect(outcome.verdict).toBe('nejasne');
  });

  it('E-33: nápověda k limitu příjmů jmenuje deriváty u všech tří situací', () => {
    // R-08d/R-10f počítá kladná plnění z derivátů do limitů 50k i 20k. Dokud je
    // nápověda vyjmenovávala jako „dividendy, úroky nebo nájem“, odpověděl
    // obchodník s CFD poctivě „Ne“ — a dostal verdikt, že přiznání řešit nemusí.
    for (const situation of ['pausal', 'zamestnanec', 'jine'] as const) {
      const { hint } = incomeQuestions(filingLimitTexts(2026))[situation];
      expect(hint, situation).toContain('derivát');
      expect(hint, situation).toContain('CFD');
    }
  });

  it('E-33: zaměstnanec s plněním z derivátů 25 000 Kč → přiznání, ne „řešit nemusíš“', () => {
    // scénář z nálezu: žádné prodeje, žádné krypto, jen CFD za 25 000 Kč —
    // nápověda teď říká, že takové plnění patří do limitu 20 000 Kč (rok 2026),
    // takže uživatel odpoví „Ano“
    const outcome = evaluateCalculator(
      answers({
        situation: 'zamestnanec',
        salesOver100k: false,
        kryptoNad100k: false,
        prijmy: 'ano',
      }),
      2026,
    );

    expect(outcome.verdict).toBe('priznani');
    expect(outcome.reason).toContain(filingLimitTexts(2026).employee);
  });

  it('R-09d/K7a-03: oznámení § 38v netvrdí, že lhůta je stejná jako u přiznání', () => {
    // Text patří k verdiktu „přiznání řešit nemusíš“ — a právě u toho, kdo
    // přiznání nepodává, se lhůty rozcházejí: prodloužení na čtyři měsíce dává
    // § 136 odst. 2 písm. a) daňového řádu jen tomu, kdo přiznání „následně"
    // podá elektronicky (pokyn GFŘ D-59, str. 45). Rozdíl je až měsíc a sankce
    // podle § 38w je 0,1–15 % z neoznámeného příjmu.
    expect(OZNAMENI_5M).not.toContain('lhůta je ale stejná');
    expect(OZNAMENI_5M).toContain('§ 38v');
    // musí říct, že lhůta je KRATŠÍ, a jednou větou proč
    expect(OZNAMENI_5M).toContain('tři měsíce');
    expect(OZNAMENI_5M).toContain('kdo přiznání opravdu podá');
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
  const withIncome = (situation: 'zamestnanec' | 'jine'): CalculatorAnswers =>
    answers({ situation, salesOver100k: false, kryptoNad100k: false, prijmy: 'ano' });

  for (const year of [2026, 2027]) {
    const { limits } = configForYear(year);
    const employeeLimit = czk(d(limits.employeeSideIncome));
    const generalLimit = czk(d(limits.generalFiling));

    it(`rok ${year}: otázka na ostatní příjmy jmenuje limit toho roku`, () => {
      const questions = incomeQuestions(filingLimitTexts(year));
      expect(questions.zamestnanec.question).toBe(
        `Máš letos vedle zaměstnání jiné zdanitelné příjmy nad ${employeeLimit}?`,
      );
      expect(questions.jine.question).toBe(`Máš letos zdanitelné příjmy nad ${generalLimit} celkem?`);
    });

    it(`rok ${year}: zdůvodnění verdiktu jmenuje tentýž limit jako otázka`, () => {
      expect(evaluateCalculator(withIncome('zamestnanec'), year).reason).toContain(
        `nad ${employeeLimit} vedle zaměstnání`,
      );
      expect(evaluateCalculator(withIncome('jine'), year).reason).toContain(
        `nad ${generalLimit} za rok`,
      );
    });
  }

  it('limit paušální daně (§ 7a) se rokem nemění', () => {
    for (const year of [2026, 2027]) {
      expect(incomeQuestions(filingLimitTexts(year)).pausal.question).toContain('nad 50 000 Kč');
    }
  });

  it('nápověda je bez roku, dokud se limit proti loňsku nezměnil', () => {
    // rok 2026 má stejné limity jako 2025 — věta o roce by jen překážela
    const plain = incomeQuestions(filingLimitTexts(2026));
    const withPrevious = incomeQuestions(filingLimitTexts(2026), filingLimitTexts(2025));
    expect(filingLimitTexts(2025).employee).toBe(filingLimitTexts(2026).employee);
    expect(withPrevious).toEqual(plain);
    expect(plain.zamestnanec.hint).not.toMatch(/20\d\d/);
  });
});

/**
 * A20-R1-02: od 1. 1. 2027 se kalkulačka ptá na limit roku 2027 („letos“), jenže
 * v lednu až květnu na ni lidé chodí kvůli přiznání za rok 2026, kde platí
 * limit poloviční. Nápověda proto v roce změny řekne, kterého roku se částka
 * týká a kolik to bylo loni (R-09a, R-09b).
 */
describe('kalkulačka v roce změny limitů § 38g (A20-R1-02, R-09a, R-09b)', () => {
  const current = filingLimitTexts(2027);
  const previous = filingLimitTexts(2026);

  /** Kalkulačka vykreslená s hotovými odpověďmi (viz `seededState`), jako text bez značek. */
  const renderAnswered = (
    given: CalculatorAnswers,
    limits: FilingLimitTexts = current,
    previousLimits: FilingLimitTexts = previous,
  ): string => {
    // pořadí = pořadí `useState` v komponentě
    seededState.queue = [
      given.situation,
      given.salesOver100k,
      given.allHeldThreeYears,
      given.kryptoNad100k,
      given.kryptoDrzeno3Roky,
      given.prijmy,
    ];
    const html = renderToStaticMarkup(
      createElement(KalkulackaPriznani, {
        filingLimits: limits,
        previousFilingLimits: previousLimits,
      }),
    );
    // kdyby komponenta přibrala další stav, fronta by se rozešla s pořadím
    expect(seededState.queue).toEqual([]);
    return html.replace(/<[^>]+>/g, ' ');
  };

  const employeeNote = `Limit ${current.employee} platí pro příjmy za rok 2027 — za rok 2026 to bylo ještě ${previous.employee}.`;
  const generalNote = `Limit ${current.general} platí pro příjmy za rok 2027 — za rok 2026 to bylo ještě ${previous.general}.`;

  it('konfigurace: limity roku 2027 se od roku 2026 liší', () => {
    // bez rozdílu by testy níž neměly co hlídat
    expect(current.employee).not.toBe(previous.employee);
    expect(current.general).not.toBe(previous.general);
  });

  it('nápověda řekne rok limitu i loňskou částku — zaměstnanci i ostatním', () => {
    const questions = incomeQuestions(current, previous);
    expect(questions.zamestnanec.hint.startsWith(`${employeeNote} Třeba `)).toBe(true);
    expect(questions.jine.hint.startsWith(`${generalNote} Včetně `)).toBe(true);
    // limit paušální daně (§ 7a) se nezměnil, rok k němu nepatří
    expect(questions.pausal.hint).not.toMatch(/20\d\d/);
    // samotná otázka zůstává stejná — podle ní se pozná přeskočená odpověď
    expect(questions.zamestnanec.question).toBe(incomeQuestions(current).zamestnanec.question);
  });

  it('zaměstnanec, který odpoví „Ne“, vidí vedle verdiktu i limit za rok 2026', () => {
    // scénář z nálezu: 30 000 Kč dividend za rok 2026, únor 2027
    const text = renderAnswered(
      answers({ situation: 'zamestnanec', salesOver100k: false, kryptoNad100k: false, prijmy: 'ne' }),
    );
    expect(text).toContain(`Máš letos vedle zaměstnání jiné zdanitelné příjmy nad ${current.employee}?`);
    expect(text).toContain(employeeNote);
    expect(text).toContain('Vypadá to, že přiznání kvůli investicím řešit nemusíš.');
  });

  it('otázka i zdůvodnění verdiktu jmenují limit běžného roku, ne loňský', () => {
    const employee = renderAnswered(
      answers({ situation: 'zamestnanec', salesOver100k: false, kryptoNad100k: false, prijmy: 'ano' }),
    );
    expect(employee).toContain(`nad ${current.employee}?`);
    expect(employee).toContain(`Vedlejší zdanitelné příjmy nad ${current.employee} vedle zaměstnání`);
    expect(employee).not.toContain(`nad ${previous.employee}`);

    const other = renderAnswered(
      answers({ situation: 'jine', salesOver100k: false, kryptoNad100k: false, prijmy: 'ano' }),
    );
    expect(other).toContain(`Máš letos zdanitelné příjmy nad ${current.general} celkem?`);
    expect(other).toContain(generalNote);
    expect(other).toContain(`Zdanitelné příjmy nad ${current.general} za rok`);
    expect(other).not.toContain(`nad ${previous.general}`);
  });

  it('v roce beze změny kalkulačka žádný rok nejmenuje', () => {
    const text = renderAnswered(
      answers({ situation: 'zamestnanec', salesOver100k: false, kryptoNad100k: false, prijmy: 'ne' }),
      filingLimitTexts(2026),
      filingLimitTexts(2025),
    );
    expect(text).toContain(`nad ${previous.employee}?`);
    expect(text).not.toMatch(/za rok 20\d\d/);
  });
});
