import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeTaxYear, LAST_VERIFIED_RATE_YEAR, UNIFIED_RATE_SOURCES } from '@danero/engine';
import { d, parseTransactions, type Transaction } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { dateLabel, msLabel, toMs } from '@/components/charts';
import { engineInputForUser, type ProfileRow } from '@/lib/portfolio';
import {
  FIRST_UNIFIED_RATE_YEAR,
  isRateVerified,
  UNIFIED_RATES,
  verifiedRateSourceNote,
} from '@/lib/tax-config';

/**
 * K1-03 a K1-04: deklarace původu kurzů v podkladu k přiznání.
 *
 * Report je dokument, který má být průkazný — musí tedy říct, čím se přepočítávalo,
 * a ta věta se nesmí rozejít s tabulkou, podle které se doopravdy počítá. Do
 * 31. 8. 2026 měla patička rozsah „(2020–2025)“ i čísla pokynů natvrdo, takže by
 * po lednové údržbě zůstala pozadu; a u roku před prvním jednotným kurzem se karta
 * „Použité kurzy“ schovala celá, takže uživatel s prodejem z roku 2019 nedostal
 * důkazní tabulku vůbec.
 */

const PROFILE: ProfileRow = {
  userId: 'u1',
  regime: 'JINE',
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

/** Prodej v roce 2019 — jednotný kurz za ten rok v tabulce nemáme. */
const TXS_2019: Transaction[] = parseTransactions([
  {
    type: 'BUY',
    id: 'b1',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '1000',
    currency: 'CZK',
    tradeDate: '2019-02-04',
    settlementDate: '2019-02-06',
  },
  {
    type: 'SELL',
    id: 's1',
    isin: 'CZ0000000001',
    quantity: '100',
    pricePerShare: '3000',
    currency: 'CZK',
    tradeDate: '2019-11-04',
    settlementDate: '2019-11-06',
  },
]);

const render = (txs: Transaction[], year: number): string =>
  renderToStaticMarkup(createElement(ReportView, { txs, profile: PROFILE, year, years: [year] }));

describe('deklarace původu kurzů v reportu (K1-03)', () => {
  it('věta o pokynech GFŘ se odvozuje z tabulky, ne z ručně zapsaného rozsahu', () => {
    const note = verifiedRateSourceNote();
    expect(note).toContain(UNIFIED_RATE_SOURCES[FIRST_UNIFIED_RATE_YEAR]);
    expect(note).toContain(UNIFIED_RATE_SOURCES[LAST_VERIFIED_RATE_YEAR]);
    expect(note).toContain(String(LAST_VERIFIED_RATE_YEAR));
    expect(note).toContain(String(FIRST_UNIFIED_RATE_YEAR));
  });

  it('tištěná patička nese odvozenou větu, ne zapsaný rozsah let', () => {
    const out = render(TXS_2019, 2019);
    expect(out).toContain(verifiedRateSourceNote());
  });

  it('rozsah let ani čísla pokynů nejsou nikde v kódu natvrdo', () => {
    // pojistka proti návratu: po lednové údržbě by ručně zapsaná věta zůstala
    // pozadu za tabulkou a nikdo by si toho nevšiml (text nehlídal žádný test)
    const podezrele = ['(2020–2025)', '2020–2025', 'D-49…D-75', 'D-49 až D-75'];
    for (const soubor of ['components/views/report-view.tsx', 'app/jak-pocitame/page.tsx']) {
      const zdroj = readFileSync(join(import.meta.dirname, '..', soubor), 'utf8');
      for (const vzorek of podezrele) {
        expect(zdroj, `${soubor} má rozsah kurzů natvrdo: ${vzorek}`).not.toContain(vzorek);
      }
    }
  });
});

describe('karta „Použité kurzy“ u roku bez jednotného kurzu (K1-04)', () => {
  it('report za rok 2019 kartu ukáže a vysvětlí, čím se tedy přepočítávalo', () => {
    const out = render(TXS_2019, 2019);
    expect(out).toContain('Použité kurzy');
    expect(out).toContain('Za rok 2019 jednotný kurz GFŘ nemáme');
    expect(out).toContain(`začíná rokem ${FIRST_UNIFIED_RATE_YEAR}`);
    expect(out).toContain('denními kurzy ČNB');
  });

  it('u starého roku karta neslibuje, že čísla teprve vyjdou (R-15e)', () => {
    // rok 2019 stát vyhlásil dávno — Danero ho jen nemá v registru; věta
    // „vyhlásí se na podzim 2019“ by v roce 2026 byla nesmysl
    const out = render(TXS_2019, 2019);
    expect(out).toContain('nemáme dvě čísla, která se vyhlašují na každý rok zvlášť');
    expect(out).not.toContain('na podzim 2019');
  });

  it('report za rok s kurzy pořád nese důkazní tabulku', () => {
    const out = render(TXS_2019, 2025);
    expect(out).toContain('pokyn GFŘ D-75');
    expect(out).not.toContain('jednotný kurz GFŘ nemáme');
  });
});

/**
 * Kurzy ČNB k poslední kotaci každého měsíce leden–září 2026 (30. 1., 27. 2.,
 * 31. 3., 30. 4., 29. 5., 30. 6., 31. 7., 31. 8., 30. 9.), tak jak je ČNB
 * kotuje — za `unit` jednotek měny. Veřejný roční kurzovní lístek ČNB.
 */
const CNB_MONTH_ENDS_2026: Record<string, { unit: number; rates: string[] }> = {
  USD: { unit: 1, rates: ['20.413', '20.541', '21.333', '20.813', '20.851', '21.287', '21.076', '20.800', '21.522'] },
  EUR: { unit: 1, rates: ['24.330', '24.245', '24.515', '24.360', '24.285', '24.260', '24.210', '24.125', '24.440'] },
  GBP: { unit: 1, rates: ['28.093', '27.667', '28.232', '28.116', '28.000', '28.153', '28.286', '28.171', '28.596'] },
  PLN: { unit: 1, rates: ['5.783', '5.739', '5.712', '5.719', '5.744', '5.647', '5.613', '5.575', '5.593'] },
  CHF: { unit: 1, rates: ['26.572', '26.631', '26.666', '26.519', '26.667', '26.302', '26.015', '25.732', '25.790'] },
  AUD: { unit: 1, rates: ['14.318', '14.592', '14.670', '14.881', '14.958', '14.662', '14.791', '14.900', '15.000'] },
  CAD: { unit: 1, rates: ['15.091', '15.025', '15.311', '15.229', '15.107', '14.954', '15.012', '14.981', '15.172'] },
  JPY: { unit: 100, rates: ['13.251', '13.164', '13.372', '13.307', '13.092', '13.106', '13.152', '13.024', '13.707'] },
  NOK: { unit: 1, rates: ['2.137', '2.163', '2.186', '2.232', '2.254', '2.145', '2.212', '2.226', '2.242'] },
  SEK: { unit: 1, rates: ['2.313', '2.273', '2.237', '2.245', '2.254', '2.187', '2.203', '2.171', '2.157'] },
  DKK: { unit: 1, rates: ['3.258', '3.245', '3.280', '3.260', '3.250', '3.246', '3.239', '3.227', '3.269'] },
};

/** Dividenda v dolarech z ledna 2027 — první transakce, kterou nový rok potká. */
const TXS_2027: Transaction[] = parseTransactions([
  {
    type: 'DIVIDEND',
    id: 'd2027',
    isin: 'US0378331005',
    gross: '100',
    withholdingTax: '15',
    currency: 'USD',
    date: '2027-01-15',
  },
]);

describe('orientační kurzy běžného a příštího roku (R-06a)', () => {
  it.skipIf(isRateVerified(2026))(
    'odhad 2026 je průměr kurzů ČNB ke koncům měsíců leden–září (L3-05)',
    () => {
      // metoda, kterou jednotný kurz počítá GFŘ (§ 38 odst. 1 ZDP) — nad lístkem
      // ČNB za rok 2025 dává vyhlášený pokyn D-75 s odchylkou do 0,21 %. Do
      // 9. 10. 2026 tu byl lednový spot: AUD a NOK ležely na ročním minimu
      // a JPY nad ročním maximem, hlídač limitu tak byl o 6–7 % vedle.
      // Po lednovém pokynu rok 2026 přejde mezi ověřené a test se sám vypne.
      expect(Object.keys(UNIFIED_RATES[2026]!).sort()).toEqual(
        Object.keys(CNB_MONTH_ENDS_2026).sort(),
      );
      for (const [currency, { unit, rates }] of Object.entries(CNB_MONTH_ENDS_2026)) {
        const average = rates
          .reduce((sum, rate) => sum.plus(rate), d('0'))
          .div(rates.length)
          .div(unit);
        // pokyny GFŘ kotují na dvě desetinná místa za jednotku z lístku (JPY za 100)
        const places = unit === 100 ? 4 : 2;
        expect(
          d(UNIFIED_RATES[2026]![currency]!).toFixed(places),
          `orientační kurz ${currency} 2026`,
        ).toBe(average.toFixed(places));
      }
    },
  );

  it('rok 2027 má orientační kurz pro každou měnu roku 2026 (L3-03)', () => {
    expect(Object.keys(UNIFIED_RATES[2027] ?? {}).sort()).toEqual(
      Object.keys(UNIFIED_RATES[2026]!).sort(),
    );
    // odhad, ne pokyn — UI ho musí umět označit
    expect(isRateVerified(2027)).toBe(LAST_VERIFIED_RATE_YEAR >= 2027);
  });

  it('dolarová dividenda z ledna 2027 se spočítá a report kurz označí za orientační', () => {
    // bez kurzu 2027 končil výpočet výjimkou FX_RATE_MISSING a uživatel s cizí
    // měnou viděl 1. ledna místo čísel kartu „Výpočet teď nejde dokončit“
    const result = analyzeTaxYear(engineInputForUser(TXS_2027, PROFILE, 2027));
    expect(result.dividends.foreignGrossCzk.toString()).toBe(
      d('100').mul(UNIFIED_RATES[2027]!.USD!).toString(),
    );

    const out = render(TXS_2027, 2027);
    expect(out).toContain('Použité kurzy');
    if (!isRateVerified(2027)) {
      expect(out).toContain('kurz roku 2027 je orientační do vydání pokynu');
    }
    expect(out).not.toContain('jednotný kurz GFŘ nemáme');
  });
});

describe('osa grafu horizontu ukazuje totéž datum jako tooltip (K1-06)', () => {
  it('popisek osy se čte v UTC — stejně, jak se datum na osu převedlo', () => {
    // `toMs` dělá z ISO data UTC půlnoc; kdyby se popisek formátoval v místní
    // zóně, ukázala by osa západně od Greenwiche den předem, zatímco tooltip
    // téhož grafu (dateLabel) správné datum
    for (const iso of ['2027-01-01', '2027-03-01', '2027-06-15', '2027-12-31']) {
      const ocekavane = `${Number(iso.slice(8, 10))}. ${Number(iso.slice(5, 7))}. ${iso.slice(0, 4)}`;
      expect(msLabel(toMs(iso)), `osa u ${iso}`).toBe(ocekavane);
      expect(dateLabel(iso), `tooltip u ${iso}`).toBe(ocekavane);
    }
  });

  it('formátování osy je ukotvené v UTC, ne v zóně prohlížeče', () => {
    // behaviorální test výš spadne jen západně od Greenwiche (na stroji
    // v Praze projde i s vadou), takže ukotvení hlídáme i ve zdroji
    const zdroj = readFileSync(
      join(import.meta.dirname, '..', 'components', 'charts.tsx'),
      'utf8',
    );
    const msLabelBlok = zdroj.slice(zdroj.indexOf('export const msLabel'));
    expect(msLabelBlok.slice(0, 300)).toContain("timeZone: 'UTC'");
  });
});
