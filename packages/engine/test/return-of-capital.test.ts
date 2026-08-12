import { describe, expect, it } from 'vitest';
import { buy, dividend, hasWarning, run, sell } from './helpers';

/**
 * R-07h: vratka kapitálu (return of capital) není podíl na zisku, ale vrácení
 * části vkladu — věcně snižuje nabývací cenu pozice, takže daň přijde až
 * s prodejem. ZDP to u zahraničních fondů neupravuje, proto přepínač
 * `returnOfCapitalReducesBasis` s bezpečným defaultem (zdanit jako dividendu).
 *
 * Scénář všech testů: 10 kusů za 100 CZK (nabývací cena 1 000 Kč) a vratka
 * kapitálu 200 Kč. Kurzy jsou v CFG_2025 fixturové, takže CZK = CZK.
 */
const nakup = () =>
  buy({
    isin: 'CZ0000000001',
    quantity: '10',
    pricePerShare: '100',
    currency: 'CZK',
    tradeDate: '2024-01-10',
    settlementDate: '2024-01-10',
  });

const vratka = (over: Record<string, unknown> = {}) =>
  dividend({
    isin: 'CZ0000000001',
    sourceCountry: 'US', // zahraniční zdroj: česká dividenda by se do § 8 nedostala vůbec (R-07a)
    gross: '200',
    currency: 'CZK',
    withholdingTax: '0',
    date: '2025-03-01',
    returnOfCapital: true,
    ...over,
  });

const MIRNEJSI = { options: { returnOfCapitalReducesBasis: true } };

describe('R-07h vratka kapitálu', () => {
  it('bezpečný default ji daní jako dividendu a řekne, že jde přepnout', () => {
    const result = run([nakup(), vratka()]);

    expect(result.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_TAXED_AS_DIVIDEND')).toBe(true);
    // nabývací cena zůstala nedotčená
    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('100');
  });

  it('mírnější výklad ji z § 8 vyjme a sníží nabývací cenu poměrně na kus', () => {
    const result = run([nakup(), vratka()], MIRNEJSI);

    expect(result.dividends.foreignGrossCzk.toString()).toBe('0');
    // 200 Kč na 10 kusů = 20 Kč na kus
    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('80');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_REDUCED_BASIS')).toBe(true);
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_EXCESS')).toBe(false);
  });

  it('daň se jen odloží: prodej po vratce vyjde o vratku vyšší', () => {
    const prodej = sell({
      isin: 'CZ0000000001',
      quantity: '10',
      pricePerShare: '150',
      currency: 'CZK',
      tradeDate: '2025-06-01',
      settlementDate: '2025-06-01',
    });
    // tržba 1 500 Kč je nad limitem 100k? Není — proto profil s obchodním
    // majetkem, aby hodnotové osvobození (R-02) základ nevynulovalo
    const profil = { hasSecuritiesInBusinessAssets: true };

    const bezpecny = run([nakup(), vratka(), prodej], { profile: profil });
    const mirnejsi = run([nakup(), vratka(), prodej], { profile: profil, ...MIRNEJSI });

    // bezpečný: § 8 = 200, § 10 = 1 500 − 1 000 = 500
    expect(bezpecny.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(bezpecny.securities.base10Czk.toString()).toBe('500');
    // mírnější: § 8 = 0, § 10 = 1 500 − 800 = 700 → dohromady o 0 Kč jinak,
    // jen se přesunulo mezi dílčími základy a v čase
    expect(mirnejsi.dividends.foreignGrossCzk.toString()).toBe('0');
    expect(mirnejsi.securities.base10Czk.toString()).toBe('700');
  });

  it('přebytek nad nabývací cenu se daní jako dividenda (mantinel 1)', () => {
    // vratka 1 500 Kč proti nabývací ceně 1 000 Kč → 500 Kč zbývá zdanit
    const result = run([nakup(), vratka({ gross: '1500' })], MIRNEJSI);

    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('0');
    expect(result.dividends.foreignGrossCzk.toString()).toBe('500');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_EXCESS')).toBe(true);
  });

  it('bez otevřené pozice se daní celá (mantinel 2)', () => {
    const result = run(
      [
        nakup(),
        sell({
          isin: 'CZ0000000001',
          quantity: '10',
          pricePerShare: '150',
          currency: 'CZK',
          tradeDate: '2025-02-01',
          settlementDate: '2025-02-01',
        }),
        vratka(),
      ],
      MIRNEJSI,
    );

    expect(result.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_NO_POSITION')).toBe(true);
  });

  it('vratka v jiné měně než pozice se daní celá (mantinel 3)', () => {
    const result = run([nakup(), vratka({ currency: 'USD', gross: '10' })], MIRNEJSI);

    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('100');
    // 10 USD × jednotný kurz 2025 (20) = 200 Kč
    expect(result.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_CURRENCY_MISMATCH')).toBe(true);
  });

  it('vratka se sraženou daní se daní celá (mantinel 4)', () => {
    const result = run([nakup(), vratka({ withholdingTax: '30' })], MIRNEJSI);

    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('100');
    expect(result.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_WITHHELD')).toBe(true);
    // srážka zůstává v zápočtu — příjem k ní totiž pořád existuje
    expect(result.dividends.foreignWithholdingCzk.toString()).toBe('30');
  });

  it('nedělitelný podíl nevyrobí haléřový přebytek ani falešné varování', () => {
    // 3 kusy a vratka 100 Kč → 33,333… Kč na kus; skládá-li se zbytek
    // z nevstřebaných kusů, vyjde přesná nula
    const result = run(
      [
        buy({
          isin: 'CZ0000000001',
          quantity: '3',
          pricePerShare: '100',
          currency: 'CZK',
          tradeDate: '2024-01-10',
          settlementDate: '2024-01-10',
        }),
        vratka({ gross: '100' }),
      ],
      MIRNEJSI,
    );

    expect(result.dividends.foreignGrossCzk.toString()).toBe('0');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_EXCESS')).toBe(false);
  });

  it('částky v hláškách jsou zaokrouhlené, ne syrový Decimal (A1-3-08)', () => {
    // 3 kusy a vratka 100 Kč → 33,333… na kus; hláška musí říct „100,00 CZK“,
    // ne periodický rozvoj na 34 míst
    const result = run(
      [
        buy({
          isin: 'CZ0000000001',
          quantity: '3',
          pricePerShare: '100',
          currency: 'CZK',
          tradeDate: '2024-01-10',
          settlementDate: '2024-01-10',
        }),
        vratka({ gross: '100' }),
      ],
      MIRNEJSI,
    );

    const hlaska = result.warnings.find((w) => w.code === 'RETURN_OF_CAPITAL_REDUCED_BASIS')!;
    // NBSP před jednotkou — formátování enginu je záměrně typograficky správné
    expect(hlaska.message).toContain('100,00\u00a0CZK');
    // žádný dlouhý desetinný rozvoj (číslic má dost i ISIN, proto se hlídá
    // až to, co je za desetinnou čárkou)
    expect(hlaska.message).not.toMatch(/,\d{3,}/);
  });

  it('cizí měna i přebytek se hlásí každý zvlášť a s vlastní částkou', () => {
    // dva loty: 10 kusů v CZK (nabývací cena 10 Kč/ks) a 10 kusů v USD;
    // vratka 400 CZK → 20 Kč na kus, CZK loty unesou jen 10 Kč/ks
    const result = run(
      [
        buy({
          isin: 'CZ0000000001',
          quantity: '10',
          pricePerShare: '10',
          currency: 'CZK',
          tradeDate: '2024-01-10',
          settlementDate: '2024-01-10',
        }),
        buy({
          isin: 'CZ0000000001',
          quantity: '10',
          pricePerShare: '5',
          currency: 'USD',
          tradeDate: '2024-02-10',
          settlementDate: '2024-02-10',
        }),
        vratka({ gross: '400' }),
      ],
      MIRNEJSI,
    );

    const kody = result.warnings.map((w) => w.code);
    expect(kody).toContain('RETURN_OF_CAPITAL_CURRENCY_MISMATCH');
    // dřív přebytek u smíšených měn mlčel — hlásila se jen cizí měna
    expect(kody).toContain('RETURN_OF_CAPITAL_EXCESS');
    expect(
      result.warnings.find((w) => w.code === 'RETURN_OF_CAPITAL_EXCESS')!.message,
    ).toContain('100,00\u00a0CZK'); // 10 kusů × (20 − 10)
    expect(
      result.warnings.find((w) => w.code === 'RETURN_OF_CAPITAL_CURRENCY_MISMATCH')!.message,
    ).toContain('200,00\u00a0CZK'); // 10 kusů × 20
    // zdanit se má obojí: 200 (cizí měna) + 100 (přebytek) = 300 CZK
    expect(result.dividends.foreignGrossCzk.toString()).toBe('300');
  });

  it('běžná dividenda se přepínačem nemění', () => {
    const bezna = dividend({
      isin: 'CZ0000000001',
      sourceCountry: 'US',
      gross: '200',
      currency: 'CZK',
      date: '2025-03-01',
    });
    const result = run([nakup(), bezna], MIRNEJSI);

    expect(result.dividends.foreignGrossCzk.toString()).toBe('200');
    expect(result.ledger.lots[0]!.costPerShare.toString()).toBe('100');
    expect(hasWarning(result, 'RETURN_OF_CAPITAL_REDUCED_BASIS')).toBe(false);
  });

  it('vratka se rozdělí mezi víc otevřených lotů poměrně podle kusů', () => {
    const result = run(
      [
        nakup(), // 10 kusů á 100
        buy({
          isin: 'CZ0000000001',
          quantity: '30',
          pricePerShare: '50',
          currency: 'CZK',
          tradeDate: '2024-06-10',
          settlementDate: '2024-06-10',
        }),
        vratka({ gross: '400' }), // 40 kusů → 10 Kč na kus
      ],
      MIRNEJSI,
    );

    expect(result.ledger.lots.map((lot) => lot.costPerShare.toString())).toEqual(['90', '40']);
    expect(result.dividends.foreignGrossCzk.toString()).toBe('0');
  });
});
