import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { parseTransactions, roundBaseDownTo100 } from '@danero/shared';
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
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
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
    // ř. 323 už po smluvním stropu 15 % z 2 466 Kč (R-07c) — sraženo bylo 739.80;
    // 369,90 se zaokrouhluje na celé Kč DOLŮ (konzervativně)
    expect(de.da_zahr).toBe('369');
    expect(de.da_uznzap).toBe('369'); // min(323, 325 = 370.43)

    // úhrny a přenos na ř. 58
    expect(vetaW.uhrn_uzndan).toBe('3643.79');
    expect(vetaW.da_zazahr).toBe('14251.21');
    expect(vetaD.da_slezap).toBe('14251.21');

    const vetad = toArray(dp.Vetad);
    expect(vetad.map((row) => row.k_stat_zdroj)).toEqual(['DE', 'US']);
    expect(vetad[1]!.prijmy_seznam).toBe('21840');
    expect(vetad[1]!.dan_seznam).toBe('3276');
    expect(vetad[1]!.zapl_dan).toBe('3276'); // podatelna vyžaduje všech 5 údajů seznamu
    expect((dp.VetaB as Attrs).pril3_samlist).toBe('2');
    expect((dp.VetaB as Attrs).seznam).toBe('1');
  });

  it('ř. 60 celé Kč nahoru, sleva na poplatníka přesně 30 840', () => {
    expect(vetaD.da_celod13).toBe('14252'); // ceil(14251.21)
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
    expect(vetaZ.kc_zahr415).toBe('3645'); // ř. 412: srážka po stropech smluv (3276 + 369 dolů)
    expect(vetaZ.kc_uznzap415).toBe('3645'); // ř. 413 = min(ř. 412, 15 % × ř. 411 = 3645.90)
    expect(vetaZ.da_samzakl4).toBe('30'); // ř. 414 = ceil(3675 − 3645)
  });

  it('ř. 74a a daň celkem; Příloha 3 se nevyplňuje', () => {
    expect(vetaD.da_samzakl).toBe('30');
    expect(vetaD.da_slezap).toBe('14220'); // 15 % z 94 800 (jen § 10)
    expect(vetaD.da_slevy35ba).toBe('0');
    expect(vetaD.kc_dan_celk).toBe('30'); // ř. 75 = ř. 74 + ř. 74a
    // ř. 91 = 0, protože ř. 77 = 30 Kč nepřesáhne hranici 200 Kč (§ 38b, R-14e).
    // ⚠️ Právě tahle fixtura vadu K3-01 MASKOVALA: v okně § 38b dá starý
    // i opravený vzorec shodně nulu. Rozdíl pozná až fixtura níž.
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
    expect(vetaP.dic).toBe('8501011233'); // bez „CZ“
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

describe('generateDpfdp7: základ daně sedí na engine (A3-08)', () => {
  // Prodej CP se ziskem přesně 94 800 Kč + úrok 9,14 USD (= 199,6176 Kč).
  // § 16 zaokrouhluje ZÁKLAD DANĚ jedinkrát a na celá sta dolů:
  // 94 999,6176 → 94 900. Kdyby se každý dílčí základ zaokrouhlil zvlášť
  // matematicky (200 + 94 800), vyjde základ 95 000 — o stovku vyšší, než
  // § 16 dovoluje, a daň o 15 Kč vyšší, než ukazuje report ze stejných dat.
  const urokTxs = parseTransactions([
    { type: 'INTEREST', id: 'i9', amount: '9.14', currency: 'USD', date: '2025-08-01' },
  ]);
  const cpOnly = TXS.filter((tx) => tx.type === 'BUY' || tx.type === 'SELL');
  const res = analyzeTaxYear(engineInputForUser([...cpOnly, ...urokTxs], PROFILE, 2025));
  const { dp } = (() => {
    const { xml } = generateDpfdp7({ year: 2025, result: res, personal: {}, varianta: 'GENERAL' });
    return { dp: (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost.DPFDP7 };
  })();
  const nezaokrouhlenyZaklad = res.securities.base10Czk
    .plus(res.crypto.base10Czk)
    .plus(res.derivatives.base10Czk)
    .plus(res.dividends.base8Czk);

  it('dílčí základy se do celých Kč rozdělí tak, aby úhrn nepřeskočil stovku nahoru', () => {
    expect(nezaokrouhlenyZaklad.toFixed(4)).toBe('94999.6176');
    const vetaO = dp.VetaO as Attrs;
    expect(vetaO.kc_zakldan8).toBe('199'); // ne 200: celé Kč dolů
    expect(vetaO.kc_zd10).toBe('94800');
    expect(vetaO.kc_uhrn).toBe('94999');
  });

  it('ř. 56 a ř. 57 dají tentýž základ i daň jako engine v reportu', () => {
    const vetaS = dp.VetaS as Attrs;
    expect(vetaS.kc_zdzaokr).toBe(roundBaseDownTo100(nezaokrouhlenyZaklad).toFixed(0));
    expect(vetaS.kc_zdzaokr).toBe('94900'); // bez opravy 95 000
    expect(vetaS.da_dan16).toBe(res.tax.general.taxBeforeCreditCzk.toDecimalPlaces(2).toString());
    expect(vetaS.da_dan16).toBe('14235'); // bez opravy 14 250
    // report ukazuje `tax.general.taxCzk`; bez zápočtu je to totéž číslo
    expect((dp.VetaD as Attrs).da_celod13).toBe(res.tax.general.taxCzk.toFixed(0));
  });
});

describe('generateDpfdp7: úroky zdaněné v zahraničí v Příloze 3 (A3-12)', () => {
  // JP úrok 100 USD se srážkou 10 USD — čl. 11 smlouvy s Japonskem zdanění
  // u zdroje do 10 % dovoluje, takže patří do ř. 321 (§ 38f odst. 3).
  // US úrok 100 USD se srážkou 30 USD naopak ne: smlouva s USA nechává právo
  // zdanit úrok jen státu rezidenta (strop 0 %), sražené se žádá zpět v USA.
  const uroky = parseTransactions([
    { type: 'INTEREST', id: 'i-jp', amount: '100', currency: 'USD', withholdingTax: '10', sourceCountry: 'JP', date: '2025-08-01' },
    { type: 'INTEREST', id: 'i-us', amount: '100', currency: 'USD', withholdingTax: '30', sourceCountry: 'US', date: '2025-08-02' },
  ]);
  const res = analyzeTaxYear(engineInputForUser([...TXS, ...uroky], PROFILE, 2025));
  const { dp } = (() => {
    const { xml } = generateDpfdp7({ year: 2025, result: res, personal: {}, varianta: 'GENERAL' });
    return { dp: (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost.DPFDP7 };
  })();
  const rows = Object.fromEntries(toArray(dp.VetaL).map((row) => [row.kod_statu!, row]));

  it('úrok zdanitelný ve státě zdroje jde na ř. 321 a zápočet z něj projde', () => {
    const jp = rows.JP!;
    expect(jp.kc_prijzap).toBe('2184'); // 100 USD × 21,84 — bez opravy „0“
    expect(jp.da_zahr).toBe('218'); // sraženo 10 USD, celé v mezích smlouvy
    expect(jp.da_uznzap).toBe('218'); // bez opravy 0 = zápočet by celý propadl
  });

  it('úrok sražený proti smlouvě koeficient zápočtu nezvyšuje', () => {
    // US: jen dividenda 1 000 USD; úrok 100 USD do ř. 321 nepatří, jinak by
    // zvedl strop zápočtu i pro dividendu (§ 38f odst. 3)
    expect(rows.US!.kc_prijzap).toBe('21840');
    expect(rows.DE!.kc_prijzap).toBe('2466');
  });
});

describe('generateDpfdp7: kryptoaktiva v Příloze 2 (R-10c)', () => {
  // ke standardní fixtuře přidán BTC: nákup 1 × 50 000 EUR (2025 → 24.66 Kč/EUR
  // = výdaj 1 233 000 Kč), prodej 1 × 60 000 EUR = 1 479 600 Kč (nad 100k →
  // zdanitelné). Krypto zisk 246 600 Kč, CP zisk 94 800 Kč.
  const cryptoTxs = parseTransactions([
    { type: 'BUY', id: 'cb1', isin: 'BTC', ticker: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '50000', currency: 'EUR', tradeDate: '2025-03-01' },
    { type: 'SELL', id: 'cs1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '60000', currency: 'EUR', tradeDate: '2025-06-15' },
  ]);
  const mixedResult = analyzeTaxYear(
    engineInputForUser([...TXS, ...cryptoTxs], PROFILE, 2025),
  );
  const { dp } = (() => {
    const { xml } = generateDpfdp7({ year: 2025, result: mixedResult, personal: {}, varianta: 'GENERAL' });
    return { dp: (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost.DPFDP7 };
  })();

  it('ř. 207–209 sčítají CP + krypto, druhy se nekompenzují', () => {
    const vetaV = dp.VetaV as Attrs;
    expect(vetaV.kc_prij10).toBe('1807200'); // 327 600 + 1 479 600
    expect(vetaV.kc_vyd10).toBe('1465800'); // 232 800 + 1 233 000
    expect(vetaV.kc_zd10p).toBe('341400'); // 94 800 + 246 600
    expect((dp.VetaO as Attrs).kc_zd10).toBe('341400'); // ř. 40 = ř. 209
  });

  it('VetaJ má dva řádky: D (cenné papíry) a C (kryptoaktiva = movitá věc)', () => {
    const vetaJ = toArray(dp.VetaJ);
    expect(vetaJ.map((row) => row.kod_dr_prij10)).toEqual(['D', 'C']);
    const [cp, krypto] = vetaJ as [Attrs, Attrs];
    expect(cp.rozdil10).toBe('94800');
    expect(krypto.prijmy10).toBe('1479600');
    expect(krypto.vydaje10).toBe('1233000');
    expect(krypto.rozdil10).toBe('246600');
    expect(krypto.kod10).toBe('Z');
  });
});

describe('generateDpfdp7: deriváty v Příloze 2 (R-12n)', () => {
  // opce: nákup 1 kontrakt à 10 000 Kč (2025-02), prodej à 15 000 Kč (2025-06)
  // → druh F: příjmy 15 000, výdaje 10 000, rozdíl 5 000
  const derivTxs = parseTransactions([
    { type: 'BUY', id: 'db1', isin: 'OPT:TEST-C100', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '10000', currency: 'CZK', tradeDate: '2025-02-03' },
    { type: 'SELL', id: 'ds1', isin: 'OPT:TEST-C100', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '15000', currency: 'CZK', tradeDate: '2025-06-10' },
  ]);
  const derivResult = analyzeTaxYear(engineInputForUser([...TXS, ...derivTxs], PROFILE, 2025));
  const { dp } = (() => {
    const { xml } = generateDpfdp7({ year: 2025, result: derivResult, personal: {}, varianta: 'GENERAL' });
    return { dp: (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost.DPFDP7 };
  })();

  it('druhý řádek VetaJ má kód F a druhy se sčítají do ř. 207–209', () => {
    const vetaJ = toArray(dp.VetaJ);
    expect(vetaJ.map((row) => row.kod_dr_prij10)).toEqual(['D', 'F']);
    const deriv = vetaJ[1]!;
    expect(deriv.prijmy10).toBe('15000');
    expect(deriv.vydaje10).toBe('10000');
    expect(deriv.rozdil10).toBe('5000');
    expect(deriv.kod10).toBe('Z');

    const vetaV = dp.VetaV as Attrs;
    expect(vetaV.kc_prij10).toBe('342600'); // 327 600 (CP) + 15 000
    expect(vetaV.kc_vyd10).toBe('242800'); // 232 800 + 10 000
    expect(vetaV.kc_zd10p).toBe('99800'); // 94 800 + 5 000
    expect((dp.VetaO as Attrs).kc_zd10).toBe('99800');
  });
});

/**
 * K3-01 + K3-02 (R-14d, R-14e): ř. 91 „zbývá doplatit".
 *
 * Do 23. 8. 2026 se počítalo `max(0, ř.60 − sleva + ř.74a)` — nevyčerpaný
 * zbytek slevy na poplatníka tedy umořoval i daň ze samostatného základu.
 * Zkušební podatelna takové XML ODMÍTÁ (`[N] kc_zbyvpred :: Oddíl 7/ř.91`)
 * a § 35ba odst. 1 to nedovoluje (sleva se váže k dani podle § 16).
 *
 * Fixtura MUSÍ mít zároveň `ř.60 < 30 840` (aby zbytek slevy vůbec existoval)
 * a `ř.414 > 200 Kč` (aby výsledek vypadl z okna § 38b) — jinak oba vzorce
 * dají shodně nulu a vada zůstane neviditelná. Přesně tak přežila dvě revize.
 */
describe('ř. 91: sleva se do § 16a nepřelévá (K3-01, R-14b)', () => {
  // jediná zahraniční dividenda BEZ srážky, žádný prodej:
  // 1 000 USD × 21,84 = 21 840 Kč → ř. 409 = 21 800, ř. 410 = ř. 414 = 3 270 Kč
  const dividendOnly = parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'd-only',
      isin: 'IE00B4L5Y983',
      gross: '1000',
      withholdingTax: '0',
      currency: 'USD',
      sourceCountry: 'IE',
      date: '2025-05-10',
    },
  ]);
  const onlyResult = analyzeTaxYear(engineInputForUser(dividendOnly, PROFILE, 2025));
  const dp = (() => {
    const { xml } = generateDpfdp7({
      year: 2025,
      result: onlyResult,
      personal: {},
      varianta: 'SEPARATE_16A',
    });
    return (parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } }).Pisemnost
      .DPFDP7;
  })();

  it('daň § 16a se do ř. 91 propíše celá, i když sleva zůstala nevyčerpaná', () => {
    const vetaD = dp.VetaD as Attrs;
    expect(vetaD.da_celod13).toBe('0'); // ř. 60 — žádný prodej, daň § 16 nulová
    expect(vetaD.uhrn_slevy35ba).toBe('30840'); // sleva zůstává celá nevyužitá
    expect((dp.VetaZ as Attrs).da_samzakl4).toBe('3270'); // ř. 414 > 200 Kč
    expect(vetaD.da_samzakl).toBe('3270'); // ř. 74a
    expect(vetaD.kc_dan_celk).toBe('3270'); // ř. 77
    // starý vzorec `max(0, 0 − 30 840 + 3 270)` tu dával 0 → podatelna [N]
    expect(vetaD.kc_zbyvpred).toBe('3270');
  });
});

/**
 * K3-02 (R-14e): hranice § 38b se týká i běžné varianty GENERAL. Změřeno
 * sondou na podatelně: ř. 77 = 195/199/**200** → ř. 91 = 0; ř. 77 = 201 a výš
 * → ř. 91 = ř. 77.
 */
describe('ř. 91: daň do 200 Kč se nepředepisuje (K3-02, § 38b)', () => {
  /** Prodej českých akcií se ziskem `gainCzk` — základ i daň vyjdou v celých Kč. */
  const czechSale = (gainCzk: number) =>
    analyzeTaxYear(
      engineInputForUser(
        parseTransactions([
          {
            type: 'BUY',
            id: 'cz-b',
            isin: 'CZ0005112300',
            ticker: 'CEZ',
            quantity: '100',
            pricePerShare: '1000',
            currency: 'CZK',
            tradeDate: '2024-01-10',
            settlementDate: '2024-01-12',
          },
          {
            type: 'SELL',
            id: 'cz-s',
            isin: 'CZ0005112300',
            quantity: '100',
            pricePerShare: String(1000 + gainCzk / 100),
            currency: 'CZK',
            tradeDate: '2025-03-05',
            settlementDate: '2025-03-06',
          },
        ]),
        PROFILE,
        2025,
      ),
    );

  const vetaDFor = (gainCzk: number): Attrs => {
    const { xml } = generateDpfdp7({
      year: 2025,
      result: czechSale(gainCzk),
      personal: {},
      varianta: 'GENERAL',
    });
    const parsed = parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } };
    return parsed.Pisemnost.DPFDP7.VetaD as Attrs;
  };

  it('ř. 77 = 195 Kč → ř. 91 = 0', () => {
    const vetaD = vetaDFor(206_900);
    expect(vetaD.da_celod13).toBe('31035'); // ř. 60 = 15 % z 206 900
    expect(vetaD.kc_dan_celk).toBe('195'); // ř. 77 = 31 035 − 30 840
    expect(vetaD.kc_zbyvpred).toBe('0');
  });

  it('ř. 77 = 210 Kč → ř. 91 = 210', () => {
    const vetaD = vetaDFor(207_000);
    expect(vetaD.kc_dan_celk).toBe('210');
    expect(vetaD.kc_zbyvpred).toBe('210');
  });
});

/**
 * K3-06: `/api/epo` zabalilo KAŽDOU výjimku generátoru do „Export se nepodařil.
 * Zkus to prosím znovu." — jenže u kódu státu mimo číselník (`XS` u eurobondů)
 * je to vada deterministická: uživatel klikne podesáté a dostane totéž.
 * Generátor přitom umí říct přesně, co má opravit.
 */
describe('vada vstupu se uživateli dostane celá (K3-06)', () => {
  const eurobond = parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'xs1',
      isin: 'XS0000000001',
      gross: '10000',
      withholdingTax: '1500',
      currency: 'USD',
      date: '2025-05-10',
    },
  ]);
  const xsResult = analyzeTaxYear(engineInputForUser(eurobond, PROFILE, 2025));

  it('neznámý kód státu vyhodí EpoInputError s návodem, co doplnit', async () => {
    const { EpoInputError } = await import('@/lib/epo');
    let caught: unknown;
    try {
      generateDpfdp7({ year: 2025, result: xsResult, personal: {}, varianta: 'GENERAL' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EpoInputError);
    expect((caught as Error).message).toContain('XS');
    expect((caught as Error).message).toContain('zemi zdroje v importu');
  });

  it('nepodporovaný rok je taky vada vstupu, ne selhání serveru', async () => {
    const { EpoInputError } = await import('@/lib/epo');
    expect(() =>
      generateDpfdp7({ year: 2026, result, personal: {}, varianta: 'GENERAL' }),
    ).toThrow(EpoInputError);
  });

  it('API tuhle hlášku předá dál, místo aby ji přebilo „zkus to znovu“', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const route = readFileSync(
      join(import.meta.dirname, '..', 'app', 'api', 'epo', 'route.ts'),
      'utf8',
    );
    expect(route).toContain('error instanceof EpoInputError');
    expect(route).toContain('chyba(error.message, 400)');
  });
});

/**
 * K3-07: typ přiznání chodil natvrdo jako `B` (řádné), přestože aplikace jinde
 * navádí i na dodatečné přiznání. XSD připouští `B|O|D|E`; `D` a `E` navíc
 * vyžadují datum zjištění důvodů (§ 141 odst. 1 daňového řádu).
 */
describe('typ přiznání ve formuláři pro XML (K3-07)', () => {
  const dp = (
    dapTyp?: 'B' | 'O' | 'D' | 'E',
    dodatecne?: {
      zjistenoDne: string;
      posledniZnamaDanCzk?: string;
      posledniZnamaZtrataCzk?: string;
    },
  ) => {
    const { xml } = generateDpfdp7({
      year: 2025,
      result,
      personal: {},
      varianta: 'GENERAL',
      ...(dapTyp ? { dapTyp } : {}),
      ...(dodatecne ? { dodatecne } : {}),
    });
    const parsed = parser.parse(xml) as { Pisemnost: { DPFDP7: Record<string, unknown> } };
    return parsed.Pisemnost.DPFDP7.VetaD as Attrs;
  };

  it('bez volby zůstává řádné přiznání a 6. oddíl se nevyplňuje', () => {
    expect(dp().dap_typ).toBe('B');
    expect(dp().d_zjist).toBeUndefined();
    expect(dp().kc_zjidp).toBeUndefined();
  });

  it('opravné přiznání se propíše a 6. oddíl nevyžaduje', () => {
    expect(dp('O').dap_typ).toBe('O');
    expect(dp('O').d_zjist).toBeUndefined();
    expect(dp('O').kc_zjidp).toBeUndefined();
  });

  /**
   * ⚠️ Změřeno na zkušební podatelně: samotný `dap_typ="D"` nestačí, podatelna
   * kontroluje i vzorce 6. oddílu (ř. 80 = ř. 79 − ř. 78, ř. 83 = ř. 82 − ř. 81).
   * Backlog počítal jen s datem zjištění.
   */
  it('dodatečné přiznání nese datum i celý 6. oddíl', () => {
    const vetaD = dp('D', {
      zjistenoDne: '2026-08-05',
      posledniZnamaDanCzk: '100',
      posledniZnamaZtrataCzk: '5000',
    });
    expect(vetaD.dap_typ).toBe('D');
    expect(vetaD.d_zjist).toBe('5.8.2026');
    expect(vetaD.kc_pzdp).toBe('100'); // ř. 78
    expect(vetaD.kc_zjidp).toBe(vetaD.kc_dan_po_db); // ř. 79 = nově zjištěná daň (ř. 77)
    expect(vetaD.kc_rozdil_dp).toBe('-100'); // ř. 80 = ř. 79 (0) − ř. 78 (100)
    expect(vetaD.kc_pzzt).toBe('5000'); // ř. 81
    expect(vetaD.kc_zjizt).toBe('0'); // ř. 82 = naše ř. 61
    expect(vetaD.kc_rozdil_zt).toBe('-5000'); // ř. 83 = ř. 82 − ř. 81
  });

  it('nevyplněná poslední daň znamená nulu, ne chybu', () => {
    const vetaD = dp('D', { zjistenoDne: '2026-08-05' });
    expect(vetaD.kc_pzdp).toBe('0');
    expect(vetaD.kc_rozdil_dp).toBe(vetaD.kc_dan_po_db); // ř. 79 − 0
  });

  it('dodatečné bez data zjištění se negeneruje — podatelna by ho odmítla', async () => {
    const { EpoInputError } = await import('@/lib/epo');
    expect(() => dp('D')).toThrow(EpoInputError);
    expect(() => dp('E')).toThrow(EpoInputError);
  });
});
