import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateCalculator,
  INCOME_QUESTION,
  OZNAMENI_5M,
  type CalculatorAnswers,
} from '@/components/filing-calculator';

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
      const { hint } = INCOME_QUESTION[situation];
      expect(hint, situation).toContain('derivát');
      expect(hint, situation).toContain('CFD');
    }
  });

  it('E-33: zaměstnanec s plněním z derivátů 25 000 Kč → přiznání, ne „řešit nemusíš“', () => {
    // scénář z nálezu: žádné prodeje, žádné krypto, jen CFD za 25 000 Kč —
    // nápověda teď říká, že takové plnění patří do limitu 20 000 Kč, takže
    // uživatel odpoví „Ano“
    const outcome = evaluateCalculator(
      answers({
        situation: 'zamestnanec',
        salesOver100k: false,
        kryptoNad100k: false,
        prijmy: 'ano',
      }),
    );

    expect(outcome.verdict).toBe('priznani');
    expect(outcome.reason).toContain('20 000 Kč');
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
