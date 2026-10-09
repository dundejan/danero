import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { d } from '@danero/shared';
import {
  evaluateCalculator as evaluateWithLimits,
  incomeQuestions,
  pickFilingLimits,
  OZNAMENI_5M,
  type CalculatorAnswers,
} from '@/components/filing-calculator';
import { currentTaxYear } from '@/lib/clock';
import { filingLimitTexts } from '@/lib/filing-limits';
import { czk } from '@/lib/format';
import { configForYear } from '@/lib/tax-config';

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
  afterEach(() => {
    delete process.env.DANERO_NOW;
  });

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

  /**
   * /kalkulacka je statická stránka: dostane limity roku sestavení i roku
   * následujícího a „letos“ určí až hodiny návštěvníka. Bez toho by si přes
   * Nový rok nesla loňský limit až do dalšího nasazení.
   */
  it('na Nový rok 2027 platí nový limit i na stránce sestavené v roce 2026', () => {
    const built2026 = [filingLimitTexts(2026), filingLimitTexts(2027)] as const;

    process.env.DANERO_NOW = '2026-12-31T18:00:00Z';
    expect(pickFilingLimits(built2026, currentTaxYear()).employee).toBe(
      czk(d(configForYear(2026).limits.employeeSideIncome)),
    );
    // pražská 00:30 na Nový rok — v UTC je pořád Silvestr
    process.env.DANERO_NOW = '2026-12-31T23:30:00Z';
    expect(pickFilingLimits(built2026, currentTaxYear()).employee).toBe(
      czk(d(configForYear(2027).limits.employeeSideIncome)),
    );
  });

  it('rok, který tabulka nezná, dostane limity roku sestavení', () => {
    const built2026 = [filingLimitTexts(2026), filingLimitTexts(2027)] as const;
    expect(pickFilingLimits(built2026, 2031).year).toBe(2026);
  });
});
