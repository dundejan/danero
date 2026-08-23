import { describe, expect, it } from 'vitest';
import { TAX_YEAR_2026_DRAFT } from '../src';
import { buy, dividend, hasWarning, interest, run, sell, CFG_2025 } from './helpers';

describe('R-07 dividendy a úroky (§ 8)', () => {
  it('R-07b/c: zahraniční dividenda brutto, zápočet stropovaný smlouvou (15 %)', () => {
    // 1000 USD brutto, sraženo 150 USD; fixture kurz 2025 USD 20
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })]);
    expect(result.dividends.foreignGrossCzk.toString()).toBe('20000');
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.base8Czk.toString()).toBe('20000');
  });

  it('R-07c: sraženo 30 % bez W-8BEN → započíst lze jen 15 %, zbytek propadá + varování', () => {
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '300' })]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('6000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('3000');
    const warning = result.warnings.find((w) => w.code === 'WITHHOLDING_ABOVE_TREATY');
    // text lidsky (datum místo technického ID) + strukturovaný context pro agregaci v UI
    expect(warning?.message).toContain('Dividenda z 1. 4. 2025 (US)');
    expect(warning?.message).not.toContain('div-');
    expect(warning?.context).toMatchObject({ country: 'US', overCzk: '3000.00' });
  });

  it('WITHHOLDING_ABOVE_TREATY: s tickerem se v textu ukáže ticker', () => {
    const result = run([
      dividend({ ticker: 'AAPL', isin: 'US0378331005', gross: '1000', currency: 'USD', withholdingTax: '300' }),
    ]);
    const warning = result.warnings.find((w) => w.code === 'WITHHOLDING_ABOVE_TREATY');
    expect(warning?.message).toContain('Dividenda AAPL z');
    expect(warning?.context).toMatchObject({ isin: 'US0378331005', country: 'US' });
  });

  it('R-07c: NL má smluvní strop 10 % — při srážce 15 % lze započíst jen 10 % brutto', () => {
    // 1000 USD brutto, sraženo 150 USD (15 %); NL smlouva (138/1974 Sb.) dovoluje jen 10 %
    const result = run([
      dividend({ sourceCountry: 'NL', gross: '1000', currency: 'USD', withholdingTax: '150' }),
    ]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('3000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('2000'); // 10 % z 20 000
    expect(hasWarning(result, 'WITHHOLDING_ABOVE_TREATY')).toBe(true);
    expect(hasWarning(result, 'TREATY_RATE_UNVERIFIED')).toBe(false); // NL je v tabulce ověřených
  });

  it('R-07c: země mimo tabulku ověřených smluv → default 15 % + TREATY_RATE_UNVERIFIED jednou per země', () => {
    const result = run([
      dividend({ sourceCountry: 'PL', gross: '1000', withholdingTax: '190' }),
      dividend({ sourceCountry: 'PL', gross: '1000', withholdingTax: '190' }),
    ]);
    // default strop 15 %: z každé dividendy jde započíst max. 150 Kč
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('300');
    expect(result.warnings.filter((w) => w.code === 'TREATY_RATE_UNVERIFIED')).toHaveLength(1);
  });

  it('R-07c: zápočet po státech v celých Kč dolů — souhrn je součtem zaokrouhlených hodnot', () => {
    // 15 % z 503 = 75,45 → per stát 75; souhrn 150 (ne 151 ze zaokrouhleného součtu 150,90)
    const result = run([
      dividend({ sourceCountry: 'US', gross: '503', withholdingTax: '75.45' }),
      dividend({ sourceCountry: 'DE', gross: '503', withholdingTax: '75.45' }),
    ]);
    const perCountry = Object.values(result.dividends.creditableByCountry);
    expect(perCountry.map((c) => c.creditableCzk.toString())).toEqual(['75', '75']);
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('150');
  });

  it('R-07c: zaokrouhlení zápočtu vždy DOLŮ (NL 10 % z 26 = 2,6 → 2, ne 3)', () => {
    const result = run([dividend({ sourceCountry: 'NL', gross: '26', withholdingTax: '2.6' })]);
    expect(result.dividends.creditableByCountry['NL']?.creditableCzk.toString()).toBe('2');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('2');
  });

  it('creditableByCountry nese i úhrn sražené daně per země', () => {
    const result = run([
      dividend({ sourceCountry: 'US', gross: '1000', withholdingTax: '300' }),
      dividend({ sourceCountry: 'US', gross: '500', withholdingTax: '75' }),
    ]);
    const us = result.dividends.creditableByCountry['US'];
    expect(us?.grossCzk.toString()).toBe('1500');
    expect(us?.withholdingCzk.toString()).toBe('375');
    expect(us?.creditableCzk.toString()).toBe('225'); // strop 15 % z 1 500
  });

  it('sražená daň po státech v celých Kč (HALF_UP) — souhrn = součet zaokrouhlených', () => {
    // 150,3 per stát → řádky 150 + 150; souhrn 300 (ne 301 ze zaokrouhleného
    // součtu 300,6) — tabulka po státech musí korunově sedět na kartu § 8
    const result = run([
      dividend({ sourceCountry: 'US', gross: '1003', withholdingTax: '150.3' }),
      dividend({ sourceCountry: 'DE', gross: '1003', withholdingTax: '150.3' }),
    ]);
    expect(result.dividends.creditableByCountry['US']?.withholdingCzk.toString()).toBe('150');
    expect(result.dividends.creditableByCountry['DE']?.withholdingCzk.toString()).toBe('150');
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('300');

    // HALF_UP: 150,5 → 151 (matematicky, ne dolů jako zápočet)
    const halfUp = run([dividend({ sourceCountry: 'US', gross: '1010', withholdingTax: '150.5' })]);
    expect(halfUp.dividends.creditableByCountry['US']?.withholdingCzk.toString()).toBe('151');
    expect(halfUp.dividends.foreignWithholdingCzk.toString()).toBe('151');
  });

  it('R-07a: česká dividenda je srážková a do § 8 nevstupuje', () => {
    const result = run([dividend({ sourceCountry: 'CZ', gross: '5000', withholdingTax: '750' })]);
    expect(result.dividends.czechGrossCzk.toString()).toBe('5000');
    expect(result.dividends.base8Czk.toString()).toBe('0');
    expect(hasWarning(result, 'CZECH_DIVIDEND_WITHOUT_WITHHOLDING')).toBe(false);
  });

  it('R-07a: česká dividenda s NULOVOU srážkou se nesmí vypustit potichu (nález A1-06)', () => {
    // R-07a stojí na tom, že příjem vypořádala 15% srážka u zdroje. Nulová
    // srážka ten předpoklad boří — buď ji importér nepřečetl, nebo sražena
    // nebyla. Výpočet neměníme (nevíme které), ale mlčet nesmíme: tiše
    // vypuštěný příjem podhodnotí základ i všechny limity, tedy riziko doměrku.
    const result = run([dividend({ sourceCountry: 'CZ', gross: '80000', withholdingTax: '0' })]);
    expect(result.dividends.base8Czk.toString()).toBe('0');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('0');
    expect(hasWarning(result, 'CZECH_DIVIDEND_WITHOUT_WITHHOLDING')).toBe(true);
  });

  it('země zdroje se odvodí z ISIN; bez ISIN i země → varování a výchozí strop', () => {
    const fromIsin = run([dividend({ sourceCountry: undefined, isin: 'US0378331005', gross: '1000' })]);
    expect(fromIsin.dividends.items[0]!.country).toBe('US');

    const unknown = run([dividend({ sourceCountry: undefined, gross: '1000' })]);
    expect(hasWarning(unknown, 'DIVIDEND_UNKNOWN_COUNTRY')).toBe(true);
    expect(unknown.dividends.base8Czk.toString()).toBe('1000'); // zachází se s ní jako zahraniční
  });

  it('úroky: zahraniční vstupují do § 8 (a limitu 50k), český SE SRÁŽKOU ne', () => {
    const result = run([
      interest({ amount: '1500', sourceCountry: 'GB' }),
      // srážka 15 % u zdroje → § 36, vypořádáno (R-07g)
      interest({ amount: '1000', sourceCountry: 'CZ', withholdingTax: '150' }),
    ]);
    expect(result.dividends.taxableInterestCzk.toString()).toBe('1500');
    expect(result.dividends.base8Czk.toString()).toBe('1500');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('1500');
    // ve výpisu úroků ale zůstává, ať nemizí z časových řad v UI
    expect(result.dividends.interestItems).toHaveLength(2);
    expect(hasWarning(result, 'CZ_INTEREST_WITHHELD')).toBe(true);
  });

  /**
   * A1-3-03: český úrok se vyhazoval ze základu i ze všech limitů podle ZEMĚ,
   * bez ohledu na sraženou daň — takže 80 000 Kč úroku z P2P půjček (které
   * srážce nepodléhají) dalo „základ § 8 = 0, limit 50k nevyčerpán, paušál
   * v pořádku“. Rozhoduje sražená daň v datech, ne země (R-07g).
   */
  it('R-07g: český úrok BEZ srážky patří do § 8 i do limitu 50k', () => {
    const result = run([interest({ amount: '80000', sourceCountry: 'CZ' })]);
    expect(result.dividends.taxableInterestCzk.toString()).toBe('80000');
    expect(result.dividends.base8Czk.toString()).toBe('80000');
    expect(result.limits.flatTax50k.status.usedCzk.toString()).toBe('80000');
    expect(result.limits.flatTax50k.status.exceeded).toBe(true);
    expect(hasWarning(result, 'CZ_INTEREST_WITHOUT_WITHHOLDING')).toBe(true);
    // do rozpisu po státech nepatří — není co započítat
    expect(result.dividends.creditableByCountry['CZ']).toBeUndefined();
  });

  it('R-07f: sražená daň z úroku se do modelu vůbec dostane (nález A1-07)', () => {
    // Bez pole `withholdingTax` na INTEREST ji Zod potichu zahodí a informace
    // se ztratí už v importu — souhrn sražené daně pak lže, že sraženo nebylo.
    const result = run([interest({ amount: '10000', sourceCountry: 'JP', withholdingTax: '1000' })]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('1000');
    expect(result.dividends.interestItems[0]!.withholdingCzk.toString()).toBe('1000');
  });

  it('R-07f: úrok JP (čl. 11 dovoluje 10 %) — zápočet se uplatní celý', () => {
    // úrok 10 000 Kč, sraženo 1 000 Kč = přesně smluvních 10 %
    const result = run([interest({ amount: '10000', sourceCountry: 'JP', withholdingTax: '1000' })]);
    expect(result.dividends.base8Czk.toString()).toBe('10000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('1000');
    const jp = result.dividends.creditableByCountry['JP']!;
    expect(jp.interestGrossCzk.toString()).toBe('10000');
    expect(jp.creditableCzk.toString()).toBe('1000');
    expect(hasWarning(result, 'INTEREST_WITHHOLDING_ABOVE_TREATY')).toBe(false);
  });

  it('R-07f: úrok US — čl. 11 dává právo zdanit jen ČR, zápočet je 0 a řekneme to', () => {
    // Audit A1-07 počítal s 15% stropem jako u dividend; smlouva 32/1994 Sb.
    // ale úrok stát zdroje zdanit nenechá, takže srážka se žádá zpět v USA.
    const result = run([interest({ amount: '10000', sourceCountry: 'US', withholdingTax: '1000' })]);
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('1000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('0');
    // A1-3-05: úrok zdaněný proti smlouvě nesmí zvednout strop zápočtu
    // dividendám téhož státu — do koeficientu § 38f nevstupuje. Řádek proto
    // nevzniká vůbec: dřív tu stál s příjmem 0 a srážkou 1 000 Kč, což je
    // v Příloze 3 nesmyslná sazba a v součtu za stát čirý šum.
    expect(result.dividends.creditableByCountry['US']).toBeUndefined();
    const warning = result.warnings.find((w) => w.code === 'INTEREST_WITHHOLDING_ABOVE_TREATY');
    expect(warning?.context).toMatchObject({ country: 'US', overCzk: '1000.00' });
  });

  it('R-07f: varování o propadlé srážce je jedno per země, ne per úrok', () => {
    // T212 připisuje úrok z hotovosti denně — varování u každého řádku by
    // souhrn kontrol zavalilo; částky se proto sčítají do jednoho.
    const result = run([
      interest({ amount: '1000', sourceCountry: 'US', withholdingTax: '100' }),
      interest({ amount: '1000', sourceCountry: 'US', withholdingTax: '100' }),
      interest({ amount: '1000', sourceCountry: 'PL', withholdingTax: '190' }),
    ]);
    const forfeited = result.warnings.filter((w) => w.code === 'INTEREST_WITHHOLDING_ABOVE_TREATY');
    expect(forfeited).toHaveLength(2);
    expect(forfeited.find((w) => w.context?.country === 'US')?.context).toMatchObject({
      overCzk: '200.00',
    });
    // PL nemáme ověřenou → bezpečný default 0 %, propadá celá srážka
    expect(forfeited.find((w) => w.context?.country === 'PL')?.context).toMatchObject({
      overCzk: '190.00',
    });
  });

  it('R-07f: zápočet z úroku snižuje daň stejně jako u dividendy', () => {
    // úrok 100 000 Kč (JP), sraženo 10 000 Kč → daň 15 000 − zápočet 10 000
    const result = run([interest({ amount: '100000', sourceCountry: 'JP', withholdingTax: '10000' })]);
    expect(result.tax.general.taxBeforeCreditCzk.toString()).toBe('15000');
    expect(result.tax.general.foreignTaxCreditCzk.toString()).toBe('10000');
    expect(result.tax.general.taxCzk.toString()).toBe('5000');
  });

  it('R-07f: zápočet z úroku se zaokrouhluje po státech dolů jako u dividend', () => {
    // 10 % z 26 Kč = 2,6 → 2 Kč (nikdy nahoru — nárok se nenadhodnocuje)
    const result = run([interest({ amount: '26', sourceCountry: 'JP', withholdingTax: '2.6' })]);
    expect(result.dividends.creditableByCountry['JP']!.creditableCzk.toString()).toBe('2');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('2');
  });

  it('R-07f: úrok a dividenda z téhož státu se sčítají do jednoho řádku Přílohy 3', () => {
    const result = run([
      dividend({ sourceCountry: 'JP', gross: '1000', withholdingTax: '150' }),
      interest({ amount: '2000', sourceCountry: 'JP', withholdingTax: '200' }),
    ]);
    const jp = result.dividends.creditableByCountry['JP']!;
    expect(jp.grossCzk.toString()).toBe('1000'); // dividendy brutto zvlášť
    expect(jp.interestGrossCzk.toString()).toBe('2000');
    expect(jp.withholdingCzk.toString()).toBe('350');
    expect(jp.creditableCzk.toString()).toBe('350'); // 15 % z 1 000 + 10 % z 2 000
  });

  it('R-07f: úrok BEZ sražené daně řádek po státech nezakládá (nemá co započítat)', () => {
    const result = run([interest({ amount: '5000', sourceCountry: 'JP' })]);
    expect(result.dividends.taxableInterestCzk.toString()).toBe('5000');
    expect(Object.keys(result.dividends.creditableByCountry)).toEqual([]);
  });

  it('R-07f: srážka z úroku v cizí měně se přepočte kurzem jako částka úroku', () => {
    // fixture kurz 2025: USD 20 → úrok 500 USD = 10 000 Kč, srážka 50 USD = 1 000 Kč
    const result = run([
      interest({ amount: '500', currency: 'USD', sourceCountry: 'JP', withholdingTax: '50' }),
    ]);
    expect(result.dividends.taxableInterestCzk.toString()).toBe('10000');
    expect(result.dividends.creditableWithholdingCzk.toString()).toBe('1000');
  });

  it('R-07d: § 16a chrání před progresí — engine doporučí výhodnější variantu', () => {
    // uměle nízká hranice progrese, ať 23 % nastoupí už od 10 000 Kč základu
    const config = { ...CFG_2025, progressiveThreshold: '10000' };
    const result = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })], { config });

    // obecný základ: 10 000×15 % + 10 000×23 % = 3 800 − zápočet 3 000 = 800
    expect(result.tax.general.taxCzk.toString()).toBe('800');
    // § 16a: samostatný základ 20 000×15 % = 3 000 − zápočet 3 000 = 0
    expect(result.tax.separate16a.taxCzk.toString()).toBe('0');
    expect(result.tax.recommended).toBe('SEPARATE_16A');

    // s reálně vysokou hranicí jsou varianty rovnocenné → doporučení GENERAL
    const flat = run([dividend({ gross: '1000', currency: 'USD', withholdingTax: '150' })]);
    expect(flat.tax.general.taxCzk.toString()).toBe(flat.tax.separate16a.taxCzk.toString());
    expect(flat.tax.recommended).toBe('GENERAL');
  });

  it('R-07d: bez známé hranice progrese se § 16a nedoporučuje (rozdíl je jen zaokrouhlovací šum)', () => {
    const config = { ...CFG_2025, progressiveThreshold: null };
    const result = run(
      [
        // base10 = 110 050 − 100 000 = 10 050; base8 = 10 050 → oddělené zaokrouhlení
        // základů na stovky dolů dělá § 16a o pár Kč „levnější“ (3 000 vs. 3 015)
        buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
        sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
        dividend({ gross: '10050', withholdingTax: '0' }),
      ],
      { config },
    );
    expect(result.tax.separate16a.taxCzk.lt(result.tax.general.taxCzk)).toBe(true);
    // …ale bez hranice 23 % je to šum a § 16a znamená ztrátu slev → GENERAL
    expect(result.tax.recommended).toBe('GENERAL');
  });

  it('rok 2026 má hranici progrese v konfiguraci — bez varování, 23 % se počítá', () => {
    // 36 × 48 967 Kč (NV č. 365/2025 Sb.) = 1 762 812 Kč
    const config = { ...TAX_YEAR_2026_DRAFT, unifiedRatesByYear: CFG_2025.unifiedRatesByYear };
    const result = run(
      [dividend({ gross: '2000000', withholdingTax: '0', date: '2026-04-01' })],
      { config },
    );
    expect(hasWarning(result, 'PROGRESSIVE_THRESHOLD_UNKNOWN')).toBe(false);
    // 1 762 812 × 15 % + (2 000 000 − 1 762 812) × 23 % = 264 421,80 + 54 553,24
    expect(result.tax.general.taxCzk.toString()).toBe('318975.04');
  });

  it('R-07d: těsně nad hranicí progrese se § 16a nedoporučuje kvůli 18,84 Kč (nález A1-04)', () => {
    // base10 = 110 050 − 100 000 = 10 050; base8 = 1 666 050 → obecný základ
    // 1 676 100 Kč, tedy 48 Kč nad hranicí 2025 (1 676 052).
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '1666050', withholdingTax: '0' }),
    ]);
    // obecná: 1 676 052 × 15 % + 48 × 23 % = 251 418,84
    expect(result.tax.general.taxCzk.toString()).toBe('251418.84');
    // § 16a: floor100(10 050) × 15 % + floor100(1 666 050) × 15 % = 1 500 + 249 900
    expect(result.tax.separate16a.taxCzk.toString()).toBe('251400');
    // rozdíl 18,84 Kč, z toho 15 Kč jen oddělené zaokrouhlení na stovky —
    // za to nemá cenu ztratit slevy na dani a nezdanitelné části
    expect(result.tax.recommended).toBe('GENERAL');
  });

  it('R-07d: nad mezí významnosti se § 16a doporučí (úspora přes 100 Kč)', () => {
    // base8 o 2 000 Kč výš: 2 000 × (23 − 15) % = 160 Kč skutečné úspory
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '1668050', withholdingTax: '0' }),
    ]);
    const uspora = result.tax.general.taxCzk.sub(result.tax.separate16a.taxCzk);
    expect(uspora.toString()).toBe('178.84'); // 160 skutečných + 18,84 z hraniční části
    expect(result.tax.recommended).toBe('SEPARATE_16A');
  });

  /**
   * R-07i (nález R1-N1): porovnání dvou daní ztrátu slevy na poplatníka NEVIDÍ.
   * Sleva podle § 35ba odst. 1 se uplatní jen proti dani podle § 16 — a ta
   * ve variantě § 16a klesá. Kdo jiné příjmy nemá, o nevyčerpaný zbytek přijde
   * a § 16a ho vyjde dráž, než kolik ukazuje prosté porovnání.
   *
   * Do 23. 8. 2026 to maskoval vadný ř. 91 v generátoru XML (K3-01), který
   * zbytek slevy počítal proti dani § 16a — proto se obojí opravovalo naráz.
   */
  it('R-07i: doporučené § 16a varuje, když tím propadne sleva na poplatníka', () => {
    // veškerý základ jsou dividendy: ve variantě § 16a klesne daň podle § 16
    // na nulu a celá sleva 30 840 Kč propadne. Základ musí přesáhnout hranici
    // progrese, jinak se § 16a nedoporučuje vůbec (R-07d).
    const result = run([dividend({ gross: '1800000', withholdingTax: '0' })]);
    expect(result.tax.recommended).toBe('SEPARATE_16A');
    const varovani = result.warnings.find((w) => w.code === 'SEPARATE_16A_CREDIT_LOSS');
    expect(varovani?.level).toBe('WARNING');
    // částky formátuje engine s nezlomitelnou mezerou (format.ts)
    expect(varovani?.message).toContain('30\u00a0840\u00a0Kč');
    expect(varovani?.message).toContain('propadne a § 16a tě vyjde dráž');
    expect(varovani?.context?.unusedCreditCzk).toBe('30840.00');
    expect(varovani?.context?.taxUnderSection16Czk).toBe('0.00');
  });

  it('R-07i: se základem § 10 nad slevou se nevaruje — sleva se vyčerpá tak jako tak', () => {
    // base10 = 2 000 000 − 100 000 = 1 900 000 → daň § 16 hluboko nad slevou
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '20000', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '90000', withholdingTax: '0' }),
    ]);
    expect(result.tax.recommended).toBe('SEPARATE_16A');
    expect(hasWarning(result, 'SEPARATE_16A_CREDIT_LOSS')).toBe(false);
  });

  it('R-07i: u doporučeného obecného základu se nevaruje vůbec', () => {
    const result = run([dividend({ gross: '10050', withholdingTax: '0' })]);
    expect(result.tax.recommended).toBe('GENERAL');
    expect(hasWarning(result, 'SEPARATE_16A_CREDIT_LOSS')).toBe(false);
  });

  it('R-07d: pod známou hranicí progrese se § 16a nedoporučuje ani při šumově nižší dani', () => {
    // CFG_2025 má reálnou hranici (základ 20 100 je hluboko pod ní) — obě
    // varianty počítají 15 % a rozdíl dělá jen oddělené zaokrouhlení na sta dolů
    const result = run([
      buy({ quantity: '100', pricePerShare: '1000', tradeDate: '2024-01-10', settlementDate: '2024-01-10' }),
      sell({ quantity: '100', pricePerShare: '1100.5', tradeDate: '2025-03-05', settlementDate: '2025-03-05' }),
      dividend({ gross: '10050', withholdingTax: '0' }),
    ]);
    expect(result.tax.separate16a.taxCzk.lt(result.tax.general.taxCzk)).toBe(true);
    expect(result.tax.recommended).toBe('GENERAL');
  });
});

/**
 * A1-3-05: srážka z úroku se přičítala do řádku státu, jehož příjem se tam
 * záměrně nepřičetl (strop čl. 11 = 0 %). US pak v Příloze 3 vycházel jako
 * příjem 100 000 / srážka 18 000, tedy 18 % nad smluvních 15 %.
 */
describe('R-07f: nezapočitatelná srážka z úroku nekazí rozpis po státech (A1-3-05)', () => {
  it('řádek US nese jen dividendu — srážka z úroku do sazby nevstoupí', () => {
    const result = run([
      dividend({ gross: '100000', sourceCountry: 'US', withholdingTax: '15000' }),
      interest({ amount: '10000', sourceCountry: 'US', withholdingTax: '3000' }),
    ]);
    const us = result.dividends.creditableByCountry['US']!;
    expect(us.grossCzk.toString()).toBe('100000');
    expect(us.interestGrossCzk.toString()).toBe('0');
    expect(us.withholdingCzk.toString()).toBe('15000');
    // celková sražená daň v zahraničí o propadlou část nepřijde
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('18000');
    expect(hasWarning(result, 'INTEREST_WITHHOLDING_ABOVE_TREATY')).toBe(true);
  });

  it('úrok bez určené země nezaloží řádek XX s nulovým příjmem', () => {
    const result = run([interest({ amount: '5000', sourceCountry: undefined, withholdingTax: '1500' })]);
    expect(result.dividends.creditableByCountry['XX']).toBeUndefined();
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('1500');
  });
});
