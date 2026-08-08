import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { analyzeTaxYear } from '@danero/engine';
import { parseTransactions } from '@danero/shared';
import { generateDpfdp7, PROGRESSIVE_THRESHOLD } from '@/lib/epo';
import { configForYear, isRateVerified } from '@/lib/tax-config';
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
  timeTestBasis: 'settlement',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
type Attrs = Record<string, string>;

const xmlFor = (transactions: unknown[], personal: Record<string, string> = {}) => {
  const result = analyzeTaxYear(engineInputForUser(parseTransactions(transactions), PROFILE, 2025));
  const { xml } = generateDpfdp7({ year: 2025, result, personal, varianta: 'GENERAL' });
  return { xml, dp: (parser.parse(xml) as { Pisemnost: { DPFDP7: Attrs } }).Pisemnost.DPFDP7 };
};

/**
 * Vady, které odhalilo až odeslání vygenerovaného XML na zkušební podatelnu
 * finanční správy (`https://adisspr.mfcr.cz/dpr/epo_podani?test=1`).
 * Unit test je nechytil, protože XML bylo „hezké“ — jen ho podatelna odmítla.
 */
describe('EPO: co odmítla zkušební podatelna (A3-01, A3-07)', () => {
  it('A3-01: rok bez zdanitelných příjmů má vyplněné i sčítance ř. 41, ne jen úhrn', () => {
    // Buy-and-hold investor: jediný prodej je osvobozený časovým testem.
    // Podatelna kontroluje ř. 41 jako součet ř. 38–40 — chybějící sčítanec
    // NENÍ nula a podání spadlo na „hodnota se nerovná hodnotě vzorce“.
    const { dp } = xmlFor([
      {
        type: 'BUY', id: 'b1', isin: 'CZ0008019106', quantity: '100',
        pricePerShare: '100', currency: 'CZK',
        tradeDate: '2020-01-10', settlementDate: '2020-01-14',
      },
      {
        type: 'SELL', id: 's1', isin: 'CZ0008019106', quantity: '100',
        pricePerShare: '150', currency: 'CZK',
        tradeDate: '2025-03-05', settlementDate: '2025-03-07',
      },
    ]);
    const vetaO = dp.VetaO as unknown as Attrs;
    expect(vetaO.kc_uhrn).toBe('0');
    expect(vetaO.kc_zakldan8).toBe('0');
    expect(vetaO.kc_zd10).toBe('0');
    // ř. 41 musí sedět na součet sčítanců, jinak podatelna podání odmítne
    expect(Number(vetaO.kc_uhrn)).toBe(Number(vetaO.kc_zakldan8) + Number(vetaO.kc_zd10));
  });

  it('A3-07: řídicí znak ve jméně nesmí udělat z písemnosti nevalidní XML', () => {
    // U+0001 se do jména dostane kopírováním z PDF nebo z Wordu; XML 1.0 ho
    // v obsahu nepřipouští vůbec, takže podatelna soubor ani nenačte.
    const { xml } = xmlFor([], { jmeno: `Jan${String.fromCharCode(1)}`, prijmeni: 'Novák' });
    const jenPovolene = [...xml].every(
      (znak) => (znak.codePointAt(0) ?? 0) > 0x1f || '\t\n\r'.includes(znak),
    );
    expect(jenPovolene, 'XML obsahuje řídicí znak, který XML 1.0 nedovoluje').toBe(true);
    expect(xml).toContain('jmeno="Jan"');
    // a soubor pořád musí jít načíst jako XML
    expect(() => parser.parse(xml)).not.toThrow();
  });
});

describe('EPO: dvě pravdy o téže hodnotě (A3-10, A3-11)', () => {
  it('A3-11: hranice progrese v EPO sedí na TaxYearConfig enginu', () => {
    // Hodnota je v repu podruhé. Runbook ji každý leden posouvá — tenhle test
    // spadne, kdyby se posunula jen jedna z nich.
    for (const [year, threshold] of Object.entries(PROGRESSIVE_THRESHOLD)) {
      expect(configForYear(Number(year)).progressiveThreshold, `rok ${year}`).toBe(threshold);
    }
  });

  it('A3-10: rok bez kurzů v tabulce se nesmí tvářit jako ověřený pokynem GFŘ', () => {
    expect(isRateVerified(2019)).toBe(false); // tabulka začíná rokem 2020
    expect(isRateVerified(2025)).toBe(true);
    expect(isRateVerified(2026)).toBe(false); // orientační odhad, ne pokyn
  });
});

describe('EPO: zdroj příjmu a kód státu (A3-05, A3-06)', () => {
  const cp = (isin: string, currency = 'CZK') => [
    {
      type: 'BUY', id: `b-${isin}`, isin, quantity: '100', pricePerShare: '1000',
      currency, tradeDate: '2024-01-10', settlementDate: '2024-01-12',
    },
    {
      type: 'SELL', id: `s-${isin}`, isin, quantity: '100', pricePerShare: '2000',
      currency, tradeDate: '2025-03-05', settlementDate: '2025-03-07',
    },
  ];

  it('A3-05: čistě český prodej se NEhlásí jako zahraniční zdroj', () => {
    // `kod10 = 'Z'` bylo natvrdo, takže i prodej českých akcií za koruny šel
    // do přiznání jako příjem ze zdrojů v zahraničí.
    const { dp } = xmlFor(cp('CZ0005112300'));
    const vetaJ = dp.VetaJ as unknown as Attrs;
    expect(vetaJ.kod_dr_prij10).toBe('D');
    expect(vetaJ.kod10).toBeUndefined();
  });

  it('A3-05: zahraniční prodej zahraniční zdroj přizná', () => {
    const { dp } = xmlFor(cp('US0378331005', 'USD'));
    expect((dp.VetaJ as unknown as Attrs).kod10).toBe('Z');
  });

  it('A3-06: prefix ISIN, který není zemí, skončí srozumitelnou chybou', () => {
    // `XS` jsou eurobondy, ne země. Podatelna na to odpoví kritickou chybou
    // a odmítne CELÉ podání — poznat to musíme dřív než ona.
    expect(() =>
      xmlFor([
        {
          type: 'DIVIDEND', id: 'd1', isin: 'XS1234567890', gross: '1000',
          withholdingTax: '150', currency: 'USD', date: '2025-05-10',
        },
      ]),
    ).toThrow(/není zemí podle číselníku/);
  });
});

describe('report: stránkování tabulky prodejů (G-P2 / H2-04)', () => {
  it('rozdělí prodeje po stranách, žádný nevynechá ani nezdvojí', async () => {
    const { strankaProdeju, PRODEJU_NA_STRANU } = await import(
      '@/components/views/report-view'
    );
    const celkem = 450;
    const videne: number[] = [];
    let stran = 0;
    for (let strana = 1; strana <= 10; strana += 1) {
      const { stranCelkem, aktualniStrana, odRadku } = strankaProdeju(celkem, strana);
      stran = stranCelkem;
      if (strana > stranCelkem) break;
      expect(aktualniStrana).toBe(strana);
      for (let i = odRadku; i < Math.min(odRadku + PRODEJU_NA_STRANU, celkem); i += 1) {
        videne.push(i);
      }
    }
    expect(stran).toBe(3); // 450 po 200
    expect(new Set(videne).size).toBe(celkem); // nic se nezdvojilo ani nechybí
    expect(Math.max(...videne)).toBe(celkem - 1);
  });

  it('strana mimo rozsah se ořízne, tabulka nikdy nevyjde prázdná', async () => {
    const { strankaProdeju } = await import('@/components/views/report-view');
    expect(strankaProdeju(450, 99).aktualniStrana).toBe(3);
    expect(strankaProdeju(450, 0).aktualniStrana).toBe(1);
    expect(strankaProdeju(450, -5).aktualniStrana).toBe(1);
    expect(strankaProdeju(0, 1)).toEqual({ stranCelkem: 1, aktualniStrana: 1, odRadku: 0 });
  });
});
