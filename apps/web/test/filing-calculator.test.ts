import { describe, expect, it } from 'vitest';
import {
  evaluateCalculator,
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
});
