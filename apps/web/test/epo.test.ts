import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { parseTransactions } from '@danero/shared';
import { analyzeTaxYear } from '@danero/engine';
import { generateDpfdp7 } from '@/lib/epo';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '0',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Fixture s ručně dopočitatelnými čísly (jednotné kurzy: USD 2024 = 23.28,
// USD 2025 = 21.84, EUR 2025 = 24.66):
// § 10: prodej 100 ks à 150 USD (2025) = 327 600 Kč, výdaj 100 × 100 USD (2024)
//       = 232 800 Kč → ř. 209 = 94 800 Kč
// § 8:  US dividenda 1 000 USD (srážka 150 USD) = 21 840 / 3 276 Kč,
//       DE dividenda 100 EUR (srážka 30 EUR, smluvní strop 15 %) = 2 466 / 739.80 Kč,
//       US úrok 10 USD = 218.40 Kč → základ § 8 = 24 524.40 → 24 524 Kč
const TXS = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'US0378331005',
    ticker: 'AAPL',
    quantity: '100',
    pricePerShare: '100',
    currency: 'USD',
    tradeDate: '2024-01-10',
    settlementDate: '2024-01-12',
  },
  {
    type: 'SELL',
    id: 's1',
    isin: 'US0378331005',
    quantity: '100',
    pricePerShare: '150',
    currency: 'USD',
    tradeDate: '2025-03-05',
    settlementDate: '2025-03-06',
  },
  {
    type: 'DIVIDEND',
    id: 'd1',
    isin: 'US0378331005',
    gross: '1000',
    withholdingTax: '150',
    currency: 'USD',
    date: '2025-05-10',
  },
  {
    type: 'DIVIDEND',
    id: 'd2',
    isin: 'DE0007164600',
    gross: '100',
    withholdingTax: '30',
    currency: 'EUR',
    date: '2025-06-01',
  },
  {
    type: 'INTEREST',
    id: 'i1',
    amount: '10',
    currency: 'USD',
    sourceCountry: 'US',
    date: '2025-07-01',
  },
]);

const result = analyzeTaxYear(engineInputForUser(TXS, PROFILE, 2025));

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
});

type Attrs = Record<string, string>;
const toArray = (value: unknown): Attrs[] =>
  value === undefined ? [] : Array.isArray(value) ? (value as Attrs[]) : [value as Attrs];

function generate(varianta: 'GENERAL' | 'SEPARATE_16A', personal = {}) {
  const { xml } = generateDpfdp7({ year: 2025, result, personal, varianta });
  const parsed = parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } };
  return { xml, dp: parsed.Pisemnost.DPFDP7 };
}

describe('generateDpfdp7: varianta GENERAL', () => {
  const { xml, dp } = generate('GENERAL');
  const vetaD = dp.VetaD as Attrs;
  const vetaO = dp.VetaO as Attrs;
  const vetaS = dp.VetaS as Attrs;
  const vetaV = dp.VetaV as Attrs;
  const vetaW = dp.VetaW as Attrs;

  it('je well-formed XML s povinnou hlavičkou písemnosti', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((dp.VetaD as Attrs).k_uladis).toBe('DPF');
    expect(vetaD.dokument).toBe('DP7');
    expect(vetaD.rok).toBe('2025');
    expect(vetaD.dap_typ).toBe('B');
    expect(vetaD.zdobd_od).toBe('1.1.2025');
    expect(vetaD.zdobd_do).toBe('31.12.2025');
  });

  it('ř. 38 = základ § 8 brutto, ř. 40 = ř. 209 Přílohy 2', () => {
    expect(vetaO.kc_zakldan8).toBe('24524');
    expect(vetaO.kc_zd10).toBe('94800');
    expect(vetaO.kc_uhrn).toBe('119324');
    expect(vetaO.kc_zakldan23).toBe('119324');
    // provázanost s Přílohou 2 (EPO kontroluje ř. 40 = ř. 209)
    expect(vetaV.kc_zd10p).toBe(vetaO.kc_zd10);
  });

  it('Příloha 2: příjmy, výdaje max do výše příjmů, VetaJ druh D', () => {
    expect(vetaV.kc_prij10).toBe('327600');
    expect(vetaV.kc_vyd10).toBe('232800');
    const vetaJ = dp.VetaJ as Attrs;
    expect(vetaJ.kod_dr_prij10).toBe('D');
    expect(vetaJ.rozdil10).toBe('94800');
    expect((dp.VetaB as Attrs).priloha2).toBe('A');
  });

  it('ř. 56 zaokrouhlený na celá sta dolů, ř. 57 = 15 %', () => {
    expect(vetaS.kc_zdsniz).toBe('119324');
    expect(vetaS.kc_zdzaokr).toBe('119300');
    expect(vetaS.da_dan16).toBe('17895');
  });

  it('Příloha 3: VetaL po státech (DE, US) + Vetad seznam', () => {
    const vetaL = toArray(dp.VetaL);
    expect(vetaL.map((row) => row.kod_statu)).toEqual(['DE', 'US']);

    const us = vetaL[1]!;
    expect(us.kc_prijzap).toBe('21840'); // ř. 321
    expect(us.da_zahr).toBe('3276'); // ř. 323
    expect(us.proczahr).toBe('18.3'); // 21840 / 119324 × 100
    expect(us.da_uznzap).toBe('3274.79'); // min(323, 325)

    const de = vetaL[0]!;
    // ř. 323 už po smluvním stropu 15 % z 2 466 Kč (R-07c) — sraženo bylo 739.80
    expect(de.da_zahr).toBe('370');
    expect(de.da_uznzap).toBe('370'); // min(323, 325 = 370.43)

    // úhrny a přenos na ř. 58
    expect(vetaW.uhrn_uzndan).toBe('3644.79');
    expect(vetaW.da_zazahr).toBe('14250.21');
    expect(vetaD.da_slezap).toBe('14250.21');

    const vetad = toArray(dp.Vetad);
    expect(vetad.map((row) => row.k_stat_zdroj)).toEqual(['DE', 'US']);
    expect(vetad[1]!.prijmy_seznam).toBe('21840');
    expect(vetad[1]!.dan_seznam).toBe('3276');
    expect(vetad[1]!.zapl_dan).toBe('3276'); // podatelna vyžaduje všech 5 údajů seznamu
    expect((dp.VetaB as Attrs).pril3_samlist).toBe('2');
    expect((dp.VetaB as Attrs).seznam).toBe('1');
  });

  it('ř. 60 celé Kč nahoru, sleva na poplatníka přesně 30 840', () => {
    expect(vetaD.da_celod13).toBe('14251'); // ceil(14250.21)
    expect(vetaD.kc_op15_1a).toBe('30840');
    expect(vetaD.uhrn_slevy35ba).toBe('30840');
    expect(vetaD.da_slevy35ba).toBe('0'); // max(0, 14251 − 30840)
    expect(vetaD.kc_dan_celk).toBe('0');
    expect(vetaD.kc_zbyvpred).toBe('0');
    expect(vetaD.da_samzakl).toBeUndefined();
  });
});

describe('generateDpfdp7: varianta SEPARATE_16A (§ 16a, Příloha 4)', () => {
  const { dp } = generate('SEPARATE_16A');
  const vetaD = dp.VetaD as Attrs;
  const vetaO = dp.VetaO as Attrs;
  const vetaZ = dp.VetaZ as Attrs;

  it('§ 8 jde do VetaZ, kc_zakldan8 se nevyplňuje', () => {
    expect(vetaO.kc_zakldan8).toBeUndefined();
    expect(vetaO.kc_uhrn).toBe('94800'); // jen § 10
    expect(vetaZ.kc_prij48).toBe('24524'); // ř. 401a
    expect(vetaZ.kc_zd48).toBe('24524'); // ř. 406
    expect(vetaZ.kc_uhrndzd).toBe('24500'); // ř. 409: celá sta dolů
    expect(vetaZ.kc_dan415).toBe('3675'); // 15 % z ř. 409
  });

  it('zápočet v Příloze 4: max 15 % ř. 411 a smluvní strop', () => {
    expect(vetaZ.kc_uh415).toBe('24306'); // ř. 411: US 21840 + DE 2466
    expect(vetaZ.kc_zahr415).toBe('3646'); // ř. 412: srážka po stropech smluv (3276 + 369.90)
    expect(vetaZ.kc_uznzap415).toBe('3645.9'); // ř. 413 = min(ř. 412, 15 % × ř. 411)
    expect(vetaZ.da_samzakl4).toBe('30'); // ř. 414 = ceil(3675 − 3645.90)
  });

  it('ř. 74a a daň celkem; Příloha 3 se nevyplňuje', () => {
    expect(vetaD.da_samzakl).toBe('30');
    expect(vetaD.da_slezap).toBe('14220'); // 15 % z 94 800 (jen § 10)
    expect(vetaD.da_slevy35ba).toBe('0');
    expect(vetaD.kc_dan_celk).toBe('30'); // ř. 75 = ř. 74 + ř. 74a
    // ř. 91: EPO počítá bez mezikroku „záporné = 0" — zbytek slevy na poplatníka
    // (30 840 − 14 220) pokryje i daň § 16a, proto 0 (ověřeno testovací podatelnou)
    expect(vetaD.kc_zbyvpred).toBe('0');
    expect(dp.VetaW).toBeUndefined();
    expect(dp.VetaL).toBeUndefined();
    expect((dp.VetaB as Attrs).priloha4).toBe('1');
  });
});

describe('generateDpfdp7: osobní údaje a chyby', () => {
  it('escapuje XML znaky a čistí DIČ/RČ/PSČ', () => {
    const { xml, dp } = generate('GENERAL', {
      jmeno: 'Jan & "Ámos" <Komenský>',
      prijmeni: 'Dvořák',
      dic: 'CZ8501011233',
      rodneCislo: '850101/1233',
      psc: '110 00',
      ufoCil: '451',
    });
    expect(xml).toContain('Jan &amp; &quot;Ámos&quot; &lt;Komenský&gt;');
    const vetaP = dp.VetaP as Attrs;
    expect(vetaP.jmeno).toBe('Jan & "Ámos" <Komenský>'); // po parsování zpět původní text
    expect(vetaP.dic).toBe('8501011233'); // bez „CZ"
    expect(vetaP.rod_c).toBe('8501011233'); // bez lomítka
    expect(vetaP.psc).toBe('11000'); // bez mezer
    expect(vetaP.stat).toBe('ČESKÁ REPUBLIKA');
    expect((dp.VetaD as Attrs).c_ufo_cil).toBe('451');
  });

  it('bez osobních údajů se VetaP ani c_ufo_cil nevyplní', () => {
    const { dp } = generate('GENERAL');
    expect(dp.VetaP).toBeUndefined();
    expect((dp.VetaD as Attrs).c_ufo_cil).toBeUndefined();
  });

  it('pro rok mimo 2024/2025 vyhodí srozumitelnou chybu', () => {
    expect(() => generateDpfdp7({ year: 2026, result, personal: {} })).toThrow(
      /rok 2026.*2024 a 2025/i,
    );
  });

  it('bez varianty se použije doporučená z enginu', () => {
    const { xml } = generateDpfdp7({ year: 2025, result, personal: {} });
    const expected = generateDpfdp7({
      year: 2025,
      result,
      personal: {},
      varianta: result.tax.recommended,
    });
    expect(xml).toBe(expected.xml);
  });
});
