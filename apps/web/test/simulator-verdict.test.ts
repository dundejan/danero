import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { d, parseTransactions, ZERO, type Money, type Transaction } from '@danero/shared';
import { simulateSale } from '@danero/engine';
import { TAX_NAME } from '@/components/tax-figure';
import { optionLabel, SimulatorView, verdictText } from '@/components/views/simulator-view';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { czk } from '@/lib/format';
import { LIMIT_NAME } from '@/lib/limit-names';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import { answeredSubmissions, simulationKey } from '@/lib/simulator-input';
import {
  regimeLimitFor,
  simulatorVerdict,
  type RegimeLimit,
  type VerdictInput,
} from '@/lib/simulator-verdict';

/**
 * Výklad k orientační dani (kdy se neplatí) je v simulátoru ve vysvětlivce,
 * která se vykreslí až po otevření; u čísla stojí jen krátká výhrada. Test
 * proto vysvětlivku nahrazuje obyčejným obalem, aby šlo ověřit i její obsah —
 * hlídá, CO simulátor říká, ne v jaké vrstvě (vzor: `payable-tax.test.ts`).
 */
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: React.ReactNode }) =>
    createElement('span', { 'data-info': '' }, children),
}));

/**
 * Verdikt simulátoru (nález z panelového testování): prodej osvobozený
 * časovým testem, který prolomí úhrn 100k, NESMÍ hlásit „limity ani daň
 * nečerpá“ — zpětně zdaňuje dřívější letošní prodeje.
 */

const FLAT_TAX: RegimeLimit = {
  kind: 'FLAT_TAX',
  label: LIMIT_NAME.FLAT_TAX,
  limitCzk: d('50000'),
};
const EMPLOYEE: RegimeLimit = {
  kind: 'EMPLOYEE_SIDE_INCOME',
  label: LIMIT_NAME.EMPLOYEE_SIDE_INCOME,
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
    ).toEqual({ kind: 'BREAKS_REGIME_LIMIT', limit: FLAT_TAX, brokenExemption: null });
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
    ).toEqual({ kind: 'BREAKS_REGIME_LIMIT', limit: EMPLOYEE, brokenExemption: null });
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
    expect(regimeLimitFor(limits('flat'))).toMatchObject({
      kind: 'FLAT_TAX',
      label: LIMIT_NAME.FLAT_TAX,
    });
    expect(regimeLimitFor(limits('employee'))).toMatchObject({
      kind: 'EMPLOYEE_SIDE_INCOME',
      label: LIMIT_NAME.EMPLOYEE_SIDE_INCOME,
    });
    expect(regimeLimitFor(limits('general'))).toMatchObject({
      kind: 'GENERAL_FILING',
      label: LIMIT_NAME.GENERAL_FILING,
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

  /**
   * Verdikt z vykreslené stránky: nadpis a případná věta pod ním (oblast
   * pojmenovaná „Verdikt“), spojené do jednoho textu bez pevných mezer.
   */
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
    const block = /aria-label="Verdikt"[^>]*>.*?<h2[^>]*>(.*?)<\/h2>(?:<p[^>]*>(.*?)<\/p>)?<\/section>/s.exec(
      html,
    );
    if (!block) throw new Error('Stránka simulátoru nevykreslila verdikt.');
    return [block[1], block[2]]
      .filter((part): part is string => part !== undefined)
      .map((part) => part.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const NEUTRAL = 'Prodej je zdanitelný';

  it('R-09b: zaměstnanec při přechodu přes 20 000 Kč čte o limitu vedlejších příjmů a o přiznání', () => {
    // 40 ks = 20 800 Kč a 50 ks = 26 000 Kč — obojí pod 50 000 Kč (L24-05)
    for (const quantity of [40, 50]) {
      const sentence = verdictSentence('ZAMESTNANEC', quantity);
      expect(sentence).toContain('prolomí limit vedlejších příjmů (20 000 Kč)');
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
    expect(sentence).toContain('prolomí limit pro podání přiznání (50 000 Kč)');
    expect(sentence).not.toContain('paušáln');
  });

  it('R-08b: paušalista čte totéž co dřív', () => {
    expect(verdictSentence('PAUSAL', 98)).toBe('Prodej prolomí limit paušální daně (50 000 Kč)');
    expect(verdictSentence('PAUSAL', 96)).toBe(NEUTRAL); // 49 920 Kč
  });

  it('OSVČ mimo paušál režimový limit nemá — verdikt o žádném nemluví', () => {
    expect(verdictSentence('OSVC', 250)).toBe(NEUTRAL); // 130 000 Kč
  });

  it('částka ve větě jde ze stavu limitu: v roce 2027 je to 40 000 Kč a 100 000 Kč (§ 38g)', () => {
    // zaměstnanec: 50 ks = 26 000 Kč už limit neprolomí, 80 ks = 41 600 Kč ano
    expect(verdictSentence('ZAMESTNANEC', 50, { year: 2027 })).toBe(NEUTRAL);
    expect(verdictSentence('ZAMESTNANEC', 80, { year: 2027 })).toContain(
      'prolomí limit vedlejších příjmů (40 000 Kč)',
    );
    // jiné: 98 ks = 50 960 Kč limit neprolomí, 200 ks = 104 000 Kč ano
    expect(verdictSentence('JINE', 98, { year: 2027 })).toBe(NEUTRAL);
    expect(verdictSentence('JINE', 200, { year: 2027 })).toContain(
      'prolomí limit pro podání přiznání (100 000 Kč)',
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
    // krátká výhrada stojí přímo u čísla, zbytek ve vysvětlivce
    expect(text).toContain('platí se jen při podání přiznání');
    expect(text).toContain('Pod limitem 20 000 Kč přiznání nepodáváš');
    expect(text).toContain('orientační daň neplatíš');
    expect(text).toContain('Počítáme jen s příjmy, o kterých Danero ví.');
  });

  it('R-09f: prodej přes limit vedlejších příjmů řekne, že se zdaní všechno letošní', () => {
    const text = pageText('ZAMESTNANEC', 40); // 20 800 Kč
    expect(text).toContain('překročíš limit vedlejších příjmů (20 000 Kč)');
    expect(text).toContain('všechny letošní zdanitelné příjmy z investic');
    expect(text).not.toContain('paušální zálohy');
  });

  it('R-09f × R-08f: paušalistovi prolomení neslibuje částku — přibude podnikání a pojistné', () => {
    const text = pageText('PAUSAL', 100); // 52 000 Kč, limit 50 000 Kč
    expect(text).toContain('překročíš limit paušální daně (50 000 Kč)');
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

/**
 * R1B-04 — částečně zdanitelný prodej, který zruší osvobození do 100 000 Kč.
 *
 * U VWCE v demu stálo „Prodej je zdanitelný“, „Základ daně 340 Kč“ a přitom
 * „Orientační daň +866 Kč“: prodej prolomí 100 000 Kč a zpětně zdaní dřívější
 * letošní prodeje, jenže to verdikt říkal jen u prodeje osvobozeného celého.
 */
describe('zdanitelný prodej, který zruší osvobození do 100 000 Kč (R1B-04)', () => {
  const plain = (text: string | undefined): string => (text ?? '').replace(/ /g, ' ');

  it('verdikt nese zrušené osvobození i změnu daně', () => {
    const verdict = simulatorVerdict(
      input({
        taxable: d('16774'),
        baselineExempt: true,
        simulatedExempt: false,
        taxDelta: d('866'),
        baselineUsed: d('64285'),
        simulatedUsed: d('107469'),
      }),
      FLAT_TAX,
    );
    expect(verdict.kind).toBe('TAXABLE');
    if (verdict.kind !== 'TAXABLE') return;
    expect(verdict.brokenExemption?.crypto).toBe(false);
    expect(verdict.brokenExemption?.taxDeltaCzk.toString()).toBe('866');
  });

  it('věta říká, že se zpětně zdaní dřívější prodeje a že daň není jen za tenhle', () => {
    const text = verdictText({
      kind: 'TAXABLE',
      brokenExemption: { crypto: false, taxDeltaCzk: d('866') },
    });
    expect(text.status).toBe('Přes limit');
    expect(text.tone).toBe('danger');
    // limit se jmenuje stejně jako v seznamu limitů na přehledu (R1B-10)
    expect(text.headline).toBe(`Prodej zruší ${LIMIT_NAME.SECURITIES.toLowerCase()}`);
    expect(plain(text.detail)).toContain('zpětně zdaní i ty dřívější');
    expect(plain(text.detail)).toContain('vzroste o 866 Kč');
    expect(plain(text.detail)).toContain('ne jen za tenhle');
  });

  it('krypto má vlastní osvobození a vlastní jméno', () => {
    const text = verdictText({
      kind: 'TAXABLE',
      brokenExemption: { crypto: true, taxDeltaCzk: d('0') },
    });
    expect(text.headline).toBe(`Prodej zruší ${LIMIT_NAME.CRYPTO.toLowerCase()}`);
    // bez nárůstu daně se o něm nemluví
    expect(plain(text.detail)).not.toContain('vzroste');
  });

  it('zdanitelný prodej, který osvobození neruší, zůstává bez dovětku a bez stavového slova (R1B-21)', () => {
    const text = verdictText({ kind: 'TAXABLE', brokenExemption: null });
    expect(text.headline).toBe('Prodej je zdanitelný');
    expect(text.detail).toBeUndefined();
    // „Zdanitelné“ nad „Prodej je zdanitelný“ bylo totéž dvakrát
    expect(text.status).toBeUndefined();
  });

  it('když prodej zároveň prolomí limit režimu, zrušené osvobození je ve větě pod ním', () => {
    const text = verdictText({
      kind: 'BREAKS_REGIME_LIMIT',
      limit: FLAT_TAX,
      brokenExemption: { crypto: false, taxDeltaCzk: d('500') },
    });
    expect(plain(text.headline)).toBe('Prodej prolomí limit paušální daně (50 000 Kč)');
    expect(plain(text.detail)).toContain(`zruší ${LIMIT_NAME.SECURITIES.toLowerCase()}`);
  });

  it('prodej osvobozený celý mluví o osvobození stejnými slovy', () => {
    const text = verdictText({ kind: 'EXEMPT_BREAKS_100K', crypto: false, taxDeltaCzk: d('811') });
    expect(text.headline).toBe(`Prodej zruší ${LIMIT_NAME.SECURITIES.toLowerCase()}`);
    expect(plain(text.detail)).toContain('osvobozený časovým testem');
    expect(plain(text.detail)).toContain('vzroste o 811 Kč');
  });

  /** Demo: prodej celé pozice VWCE je z části zdanitelný a 100 000 Kč prolomí. */
  const demoPage = (): { text: string; simulation: ReturnType<typeof simulateSale> } => {
    const today = demoToday(new Date('2026-07-10T10:00:00Z'));
    const { txs, profile, prices } = demoDataset(today);
    const input = engineInputForUser(txs, profile, Number(today.slice(0, 4)));
    const price = prices.get('IE00BK5BQT80')!.price.toString();
    const simulation = simulateSale(input, {
      isin: 'IE00BK5BQT80',
      quantity: '45.5',
      pricePerShare: price,
      currency: 'EUR',
      date: today,
      assetClass: 'ETF',
    });
    const text = renderToStaticMarkup(
      createElement(SimulatorView, {
        txs,
        profile,
        today,
        params: { isin: 'IE00BK5BQT80', kusy: '45.5', cena: price },
        prices,
      }),
    )
      .replace(/<!-- -->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ');
    return { text, simulation };
  };

  it('demo VWCE: stránka říká zrušené osvobození i přírůstek limitu (R5-18)', { timeout: 30_000 }, () => {
    const { text, simulation } = demoPage();
    // předpoklad sondy: prodej je z části zdanitelný a osvobození ruší
    expect(simulation.simulatedDisposal!.taxableProceedsCzk.gt(0)).toBe(true);
    expect(simulation.baseline.exemptUnder100k).toBe(true);
    expect(simulation.simulated.exemptUnder100k).toBe(false);

    expect(text).toContain(`Prodej zruší ${LIMIT_NAME.SECURITIES.toLowerCase()}`);
    expect(text).toContain('zpětně zdaní i ty dřívější');
    // o kolik prodej limity zvedne — víc než jeho vlastní tržba
    const kc = (value: Money): string => czk(value).replace(/ /g, ' ');
    const increase = simulation.deltas.limit100kUsedCzk;
    expect(increase.gt(simulation.simulatedDisposal!.taxableProceedsCzk)).toBe(true);
    expect(text).toContain(`+${kc(increase)}`);
    expect(text).toContain(`+${kc(simulation.deltas.flatTax50kUsedCzk)}`);
  });

  it('paušalista nad limitem: u daně stojí, že je před odečtením záloh (R1B-03)', { timeout: 30_000 }, () => {
    const { text } = demoPage();
    expect(text).toContain(TAX_NAME);
    expect(text).toMatch(/před odečtením záloh [\d ]+ Kč/);
  });
});

describe('řádek výběru pozice (R2-06)', () => {
  it('název se k tickeru připojí, jen když se liší', () => {
    expect(optionLabel('VWCE', 'Vanguard FTSE All-World')).toBe('VWCE — Vanguard FTSE All-World');
    expect(optionLabel('ČEZ', 'ČEZ')).toBe('ČEZ');
    expect(optionLabel('AMD', undefined)).toBe('AMD');
  });
});

/**
 * R4-06 — formulář simulátoru po navigaci odjinud. Rozhodnutí „je tenhle
 * výsledek odpověď na moje zadání, nebo někdo přešel jinam?“ je čistá funkce.
 */
describe('odpověď serveru × navigace odjinud (R4-06)', () => {
  const A = simulationKey('US0378331005', '3', '230');
  const B = simulationKey('US0378331005', '5', '230');
  const C = simulationKey('US0378331005', '7', '230');

  it('odpověď na poslední odeslané zadání: nic dalšího nečeká', () => {
    expect(answeredSubmissions([A], A)).toEqual([]);
  });

  it('odpověď na starší zadání: novější ještě čekají, formulář se nepřepisuje', () => {
    expect(answeredSubmissions([A, B, C], B)).toEqual([C]);
  });

  it('výsledek, který formulář neodeslal, je navigace odjinud', () => {
    // klik na „Simulátor“ v navigaci: adresa bez parametrů
    expect(answeredSubmissions([A], simulationKey('', '', ''))).toBeNull();
    expect(answeredSubmissions([], B)).toBeNull();
  });

  it('totéž zadání odeslané dvakrát se páruje s tím pozdějším', () => {
    expect(answeredSubmissions([A, B, A], A)).toEqual([]);
  });
});
