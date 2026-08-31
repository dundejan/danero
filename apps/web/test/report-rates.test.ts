import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LAST_VERIFIED_RATE_YEAR, UNIFIED_RATE_SOURCES } from '@danero/engine';
import { parseTransactions, type Transaction } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { dateLabel, msLabel, toMs } from '@/components/charts';
import { type ProfileRow } from '@/lib/portfolio';
import { FIRST_UNIFIED_RATE_YEAR, verifiedRateSourceNote } from '@/lib/tax-config';

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
