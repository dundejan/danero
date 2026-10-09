import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { d, parseTransactions, ZERO, type Money, type Transaction } from '@danero/shared';
import { simulateSale } from '@danero/engine';
import { SimulatorView } from '@/components/views/simulator-view';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import {
  regimeLimitFor,
  simulatorVerdict,
  type RegimeLimit,
  type VerdictInput,
} from '@/lib/simulator-verdict';

/**
 * Verdikt simulátoru (nález z panelového testování): prodej osvobozený
 * časovým testem, který prolomí úhrn 100k, NESMÍ hlásit „limity ani daň
 * nečerpá“ — zpětně zdaňuje dřívější letošní prodeje.
 */

const FLAT_TAX: RegimeLimit = { kind: 'FLAT_TAX', label: 'Paušální daň', limitCzk: d('50000') };
const EMPLOYEE: RegimeLimit = {
  kind: 'EMPLOYEE_SIDE_INCOME',
  label: 'Vedlejší příjmy',
  limitCzk: d('20000'),
};

/** Stavebnice vstupu verdiktu — výchozí stav „nic se neděje“. */
function input(over: {
  taxable?: Money;
  taxDelta?: Money;
  limit100kDelta?: Money;
  cryptoDelta?: Money;
  baselineExempt?: boolean;
  simulatedExempt?: boolean;
  baselineCryptoExempt?: boolean;
  simulatedCryptoExempt?: boolean;
  /** Čerpání režimového limitu (příjmy § 8–10) před prodejem a po něm. */
  baselineUsed?: Money;
  simulatedUsed?: Money;
  noDisposal?: boolean;
}): VerdictInput {
  return {
    baseline: {
      exemptUnder100k: over.baselineExempt ?? true,
      cryptoExemptUnder100k: over.baselineCryptoExempt ?? true,
      flatTax50kUsedCzk: over.baselineUsed ?? ZERO,
    },
    simulated: {
      exemptUnder100k: over.simulatedExempt ?? over.baselineExempt ?? true,
      cryptoExemptUnder100k: over.simulatedCryptoExempt ?? over.baselineCryptoExempt ?? true,
      flatTax50kUsedCzk: over.simulatedUsed ?? over.baselineUsed ?? ZERO,
    },
    deltas: {
      taxCzk: over.taxDelta ?? ZERO,
      flatTax50kUsedCzk: ZERO,
      limit100kUsedCzk: over.limit100kDelta ?? ZERO,
      cryptoLimit100kUsedCzk: over.cryptoDelta ?? ZERO,
    },
    simulatedDisposal: over.noDisposal ? undefined : { taxableProceedsCzk: over.taxable ?? ZERO },
  };
}

describe('simulatorVerdict — čistá logika verdiktu', () => {
  it('celý osvobozený bez zhoršení → EXEMPT_CLEAN', () => {
    expect(simulatorVerdict(input({}), FLAT_TAX)).toEqual({ kind: 'EXEMPT_CLEAN' });
  });

  it('osvobozený, ale prolomí úhrn 100k → EXEMPT_BREAKS_100K s delta daní (knock-on)', () => {
    const verdict = simulatorVerdict(
      input({
        baselineExempt: true,
        simulatedExempt: false,
        limit100kDelta: d('17000'),
        taxDelta: d('473'),
      }),
      FLAT_TAX,
    );
    expect(verdict.kind).toBe('EXEMPT_BREAKS_100K');
    if (verdict.kind === 'EXEMPT_BREAKS_100K') {
      expect(verdict.crypto).toBe(false);
      expect(verdict.taxDeltaCzk.toString()).toBe('473');
    }
  });

  it('osvobozený, prolomí krypto úhrn → EXEMPT_BREAKS_100K s crypto=true', () => {
    const verdict = simulatorVerdict(
      input({ baselineCryptoExempt: true, simulatedCryptoExempt: false, cryptoDelta: d('60000') }),
      FLAT_TAX,
    );
    expect(verdict).toMatchObject({ kind: 'EXEMPT_BREAKS_100K', crypto: true });
  });

  it('osvobozený, čerpá limit bez prolomení → EXEMPT_DRAWS_LIMIT (zhoršení bez prolomení)', () => {
    const verdict = simulatorVerdict(input({ limit100kDelta: d('5000') }), FLAT_TAX);
    expect(verdict).toMatchObject({ kind: 'EXEMPT_DRAWS_LIMIT', crypto: false });
  });

  it('osvobozený se zvýšením daně (bez nového prolomení) → EXEMPT_DRAWS_LIMIT', () => {
    const verdict = simulatorVerdict(
      input({ baselineExempt: false, simulatedExempt: false, taxDelta: d('120') }),
      FLAT_TAX,
    );
    expect(verdict.kind).toBe('EXEMPT_DRAWS_LIMIT');
  });

  it('R-08b: zdanitelný prodej, který nově prolomí limit paušální daně → BREAKS_REGIME_LIMIT; jinak TAXABLE', () => {
    expect(
      simulatorVerdict(
        input({ taxable: d('30000'), baselineUsed: d('25000'), simulatedUsed: d('55000') }),
        FLAT_TAX,
      ),
    ).toEqual({ kind: 'BREAKS_REGIME_LIMIT', limit: FLAT_TAX });
    // limit byl prolomený už před prodejem — nic nového se neděje
    expect(
      simulatorVerdict(
        input({ taxable: d('30000'), baselineUsed: d('55000'), simulatedUsed: d('85000') }),
        FLAT_TAX,
      ).kind,
    ).toBe('TAXABLE');
  });

  it('R-09b: prolomení se počítá proti stropu limitu režimu, ne proti 50 000 Kč paušální daně', () => {
    // zaměstnanec: 10 000 → 21 000 Kč přechází jeho 20 000 Kč, i když je hluboko pod 50 000 Kč
    expect(
      simulatorVerdict(
        input({ taxable: d('11000'), baselineUsed: d('10000'), simulatedUsed: d('21000') }),
        EMPLOYEE,
      ),
    ).toEqual({ kind: 'BREAKS_REGIME_LIMIT', limit: EMPLOYEE });
    // … a přechod přes 50 000 Kč u něj nové prolomení není (svůj limit už prolomený měl)
    expect(
      simulatorVerdict(
        input({ taxable: d('30000'), baselineUsed: d('25000'), simulatedUsed: d('55000') }),
        EMPLOYEE,
      ).kind,
    ).toBe('TAXABLE');
  });

  it('limit je „do částky včetně“ — přesně na stropu ještě prolomený není', () => {
    expect(
      simulatorVerdict(
        input({ taxable: d('10000'), baselineUsed: d('10000'), simulatedUsed: d('20000') }),
        EMPLOYEE,
      ).kind,
    ).toBe('TAXABLE');
  });

  it('bez režimového limitu (OSVČ mimo paušál) je zdanitelný prodej vždy jen TAXABLE', () => {
    expect(
      simulatorVerdict(
        input({ taxable: d('300000'), baselineUsed: ZERO, simulatedUsed: d('300000') }),
        null,
      ).kind,
    ).toBe('TAXABLE');
  });
});

describe('regimeLimitFor — který limit pro režim platí (R-08b, R-09a, R-09b)', () => {
  /** Stavy limitů z enginu — čerpání je pro všechny stejné, liší se strop a platnost. */
  const limits = (applicable: 'flat' | 'employee' | 'general' | 'none', employeeCzk = '20000') => ({
    flatTax50k: { applicable: applicable === 'flat', status: { limitCzk: d('50000') } },
    employee20k: { applicable: applicable === 'employee', status: { limitCzk: d(employeeCzk) } },
    generalFiling50k: { applicable: applicable === 'general', status: { limitCzk: d('50000') } },
  });

  it('paušál → limit paušální daně, zaměstnanec → vedlejší příjmy, jiné → podání přiznání', () => {
    expect(regimeLimitFor(limits('flat'))).toMatchObject({ kind: 'FLAT_TAX', label: 'Paušální daň' });
    expect(regimeLimitFor(limits('employee'))).toMatchObject({
      kind: 'EMPLOYEE_SIDE_INCOME',
      label: 'Vedlejší příjmy',
    });
    expect(regimeLimitFor(limits('general'))).toMatchObject({
      kind: 'GENERAL_FILING',
      label: 'Podání přiznání',
    });
  });

  it('OSVČ mimo paušál žádný režimový limit nemá', () => {
    expect(regimeLimitFor(limits('none'))).toBeNull();
  });

  it('strop bere ze stavu limitu (od roku 2027 se částky § 38g mění)', () => {
    expect(regimeLimitFor(limits('employee', '40000'))?.limitCzk.toString()).toBe('40000');
  });
});

/**
 * L12-01 a L24-05: věta verdiktu ve skutečné stránce simulátoru. Do 9. 10. 2026
 * četla jen stav limitu paušální daně, který engine počítá pro každý režim —
 * zaměstnanec tak při přechodu přes 50 000 Kč četl o paušální dani, kterou
 * neplatí, a o prolomení vlastních 20 000 Kč se z verdiktu nedozvěděl vůbec.
 *
 * Data jsou smyšlená a v korunách, ať částky vycházejí přesně: letošní prodej
 * starého lotu za 120 000 Kč je osvobozený časovým testem, ale při bezpečném
 * výkladu vyčerpá úhrn 100 000 Kč (R-02c), takže každý další prodej letošního
 * lotu po 520 Kč je celý zdanitelný a čerpá limit režimu korunu za korunu.
 */
describe('věta verdiktu jmenuje limit, který pro režim platí (L12-01, L24-05)', () => {
  const OLD_LOT = 'XX0000000017';
  const NEW_LOT = 'XX0000000025';

  const profileFor = (regime: ProfileRow['regime']): ProfileRow => ({
    userId: 'u1',
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

  /** Portfolio pro daný rok; `dividendCzk` přidá zahraniční dividendu (brutto) do čerpání. */
  const portfolio = (year: number, dividendCzk?: string): Transaction[] =>
    parseTransactions([
      {
        type: 'BUY',
        id: 'b-old',
        isin: OLD_LOT,
        ticker: 'STARY',
        quantity: '300',
        pricePerShare: '300',
        currency: 'CZK',
        tradeDate: '2020-01-10',
        settlementDate: '2020-01-14',
      },
      {
        type: 'SELL',
        id: 's-old',
        isin: OLD_LOT,
        ticker: 'STARY',
        quantity: '300',
        pricePerShare: '400',
        currency: 'CZK',
        tradeDate: `${year}-02-03`,
        settlementDate: `${year}-02-05`,
      },
      {
        type: 'BUY',
        id: 'b-new',
        isin: NEW_LOT,
        ticker: 'NOVY',
        quantity: '250',
        pricePerShare: '500',
        currency: 'CZK',
        tradeDate: `${year}-01-15`,
        settlementDate: `${year}-01-17`,
      },
      ...(dividendCzk
        ? [
            {
              type: 'DIVIDEND',
              id: 'd1',
              isin: NEW_LOT,
              sourceCountry: 'US',
              gross: dividendCzk,
              withholdingTax: '0',
              currency: 'CZK',
              date: `${year}-03-10`,
            },
          ]
        : []),
    ]);

  /** Věta verdiktu z vykreslené stránky (první odstavec karty „Verdikt“), bez pevných mezer. */
  const verdictSentence = (
    regime: ProfileRow['regime'],
    quantity: number,
    options: { year?: number; dividendCzk?: string } = {},
  ): string => {
    const year = options.year ?? 2025;
    const html = renderToStaticMarkup(
      createElement(SimulatorView, {
        txs: portfolio(year, options.dividendCzk),
        profile: profileFor(regime),
        today: `${year}-10-08`,
        params: { isin: NEW_LOT, kusy: String(quantity), cena: '520' },
      }),
    );
    const block = /Verdikt<\/[a-z0-9]+>\s*<p[^>]*>(.*?)<\/p>/s.exec(html);
    if (!block) throw new Error('Stránka simulátoru nevykreslila kartu Verdikt.');
    return block[1]!
      .replace(/<[^>]+>/g, '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const NEUTRAL = 'Prodej je zdanitelný — dopad níže.';

  it('R-09b: zaměstnanec při přechodu přes 20 000 Kč čte o limitu vedlejších příjmů a o přiznání', () => {
    // 40 ks = 20 800 Kč a 50 ks = 26 000 Kč — obojí pod 50 000 Kč (L24-05)
    for (const quantity of [40, 50]) {
      const sentence = verdictSentence('ZAMESTNANEC', quantity);
      expect(sentence).toContain('prolomí limit 20 000 Kč vedlejších příjmů');
      expect(sentence).toContain('daňové přiznání');
      expect(sentence).not.toContain('paušáln');
    }
  });

  it('R-09b: zaměstnanec pod 20 000 Kč dostane neutrální verdikt (38 ks = 19 760 Kč)', () => {
    expect(verdictSentence('ZAMESTNANEC', 38)).toBe(NEUTRAL);
  });

  it('R-09b: přechod přes 50 000 Kč není u zaměstnance nové prolomení — jeho limit padl už dřív', () => {
    // dividenda 25 000 Kč jeho 20 000 Kč prolomila; prodej 50 ks dá celkem 51 000 Kč
    const sentence = verdictSentence('ZAMESTNANEC', 50, { dividendCzk: '25000' });
    expect(sentence).toBe(NEUTRAL);
    // tatáž data v paušálu prolomením jsou (25 000 → 51 000 Kč)
    expect(verdictSentence('PAUSAL', 50, { dividendCzk: '25000' })).toContain('prolomí limit');
  });

  it('R-09a: režim „jiné“ při přechodu přes 50 000 Kč čte o limitu pro podání přiznání', () => {
    const sentence = verdictSentence('JINE', 98); // 50 960 Kč
    expect(sentence).toContain('prolomí limit 50 000 Kč pro podání přiznání');
    expect(sentence).not.toContain('paušáln');
  });

  it('R-08b: paušalista čte totéž co dřív', () => {
    expect(verdictSentence('PAUSAL', 98)).toBe(
      'Tento prodej prolomí limit 50 000 Kč pro paušální daň.',
    );
    expect(verdictSentence('PAUSAL', 96)).toBe(NEUTRAL); // 49 920 Kč
  });

  it('OSVČ mimo paušál režimový limit nemá — verdikt o žádném nemluví', () => {
    expect(verdictSentence('OSVC', 250)).toBe(NEUTRAL); // 130 000 Kč
  });

  it('částka ve větě jde ze stavu limitu: v roce 2027 je to 40 000 Kč a 100 000 Kč (§ 38g)', () => {
    // zaměstnanec: 50 ks = 26 000 Kč už limit neprolomí, 80 ks = 41 600 Kč ano
    expect(verdictSentence('ZAMESTNANEC', 50, { year: 2027 })).toBe(NEUTRAL);
    expect(verdictSentence('ZAMESTNANEC', 80, { year: 2027 })).toContain(
      'prolomí limit 40 000 Kč vedlejších příjmů',
    );
    // jiné: 98 ks = 50 960 Kč limit neprolomí, 200 ks = 104 000 Kč ano
    expect(verdictSentence('JINE', 98, { year: 2027 })).toBe(NEUTRAL);
    expect(verdictSentence('JINE', 200, { year: 2027 })).toContain(
      'prolomí limit 100 000 Kč pro podání přiznání',
    );
  });

  /** Celý text vykreslené stránky simulátoru, bez značek a pevných mezer. */
  const pageText = (regime: ProfileRow['regime'], quantity: number): string =>
    renderToStaticMarkup(
      createElement(SimulatorView, {
        txs: portfolio(2025),
        profile: profileFor(regime),
        today: '2025-10-08',
        params: { isin: NEW_LOT, kusy: String(quantity), cena: '520' },
      }),
    )
      .replace(/<!-- -->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');

  /**
   * R-09f (L24-02): „Orientační daň“ je daň, kdyby se podávalo přiznání. Pod
   * limitem režimu se neplatí a prodej, který limit prolomí, spustí daň ze
   * všech letošních příjmů. Simulátor to říká větou — druhé číslo „k zaplacení“
   * by se u paušalisty hádalo s odhadem doplatku z přehledu (recenze oprav).
   */
  it('R-09f: zaměstnanec pod limitem čte, že orientační daň neplatí', () => {
    const text = pageText('ZAMESTNANEC', 10); // 5 200 Kč, limit 20 000 Kč
    expect(text).toContain('Pod limitem 20 000 Kč přiznání nepodáváš');
    expect(text).toContain('orientační daň výš neplatíš');
    expect(text).toContain('Počítáme jen s příjmy, o kterých Danero ví.');
  });

  it('R-09f: prodej přes limit vedlejších příjmů řekne, že se zdaní všechno letošní', () => {
    const text = pageText('ZAMESTNANEC', 40); // 20 800 Kč
    expect(text).toContain('překročíš limit 20 000 Kč');
    expect(text).toContain('všechny letošní zdanitelné příjmy z investic');
    expect(text).not.toContain('paušální zálohy');
  });

  it('R-09f × R-08f: paušalistovi prolomení neslibuje částku — přibude podnikání a pojistné', () => {
    const text = pageText('PAUSAL', 100); // 52 000 Kč, limit 50 000 Kč
    expect(text).toContain('překročíš limit 50 000 Kč pro paušální daň');
    expect(text).toContain('doplatíš i pojistné');
    expect(text).toContain('Tu část Danero spočítat neumí.');
    expect(text).not.toContain('proto daň skočí');
  });

  it('R-09f: karta daně zůstává „Orientační daň“, žádné druhé číslo k zaplacení', () => {
    for (const regime of ['PAUSAL', 'ZAMESTNANEC', 'OSVC'] as const) {
      const text = pageText(regime, 40);
      expect(text).toContain('Orientační daň');
      expect(text).not.toContain('Daň k zaplacení');
    }
  });

  it('R-09f: OSVČ mimo paušál podává vždy — věta o limitu se jí netýká', () => {
    const text = pageText('OSVC', 40);
    expect(text).not.toContain('přiznání nepodáváš');
    expect(text).not.toContain('překročíš limit');
  });
});

describe('regresní scénář z panelu: demo VWCE 5 ks @ 140 EUR', () => {
  // Y0 v demu: prodeje CP ~91k (osvobozeno úhrnem), VWCE lot splňuje časový
  // test — prodej za ~17k prolomí úhrn a zpětně zdaní letošní prodej AAPL.
  it('verdikt je EXEMPT_BREAKS_100K s kladnou delta daní', { timeout: 30_000 }, () => {
    const today = demoToday(new Date('2026-07-10T10:00:00Z'));
    const { txs, profile } = demoDataset(today);
    const input = engineInputForUser(txs, profile, Number(today.slice(0, 4)));
    const simulation = simulateSale(input, {
      isin: 'IE00BK5BQT80',
      quantity: '5',
      pricePerShare: '140',
      currency: 'EUR',
      date: today,
      assetClass: 'ETF',
    });
    expect(simulation.simulatedDisposal?.taxableProceedsCzk.lte(0)).toBe(true); // sám o sobě osvobozený
    expect(simulation.simulated.exemptUnder100k).toBe(false); // ale prolomil úhrn

    const verdict = simulatorVerdict(simulation, FLAT_TAX);
    expect(verdict.kind).toBe('EXEMPT_BREAKS_100K');
    if (verdict.kind === 'EXEMPT_BREAKS_100K') {
      expect(verdict.taxDeltaCzk.gt(0)).toBe(true); // knock-on: daň se zpětně zvýší
    }
  });
});
