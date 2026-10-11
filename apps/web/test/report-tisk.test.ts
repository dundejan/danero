import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions } from '@danero/shared';
import { filingVerdictHeadline } from '@/components/filing-verdict';
import { OverviewView } from '@/components/views/overview-view';
import { printedRangeNote, disposalPage, ReportView } from '@/components/views/report-view';
import { analyzeForUser, type ProfileRow } from '@/lib/portfolio';

/**
 * H-3-01: vytištěný podklad k přiznání musí říct, kolik prodejů obsahuje.
 *
 * Stránkovací lišta reportu je `print:hidden`, takže výtisk u velkého portfolia
 * vypadal kompletně, přestože nesl jen 200 řádků z 25 000 — a aplikace nad ním
 * tvrdila, že „tisk i XML obsahují všechny prodeje“. Neúplný podklad odnesený
 * na finanční úřad v domnění, že je úplný, je tichá ztráta dat na tom nejhorším
 * možném místě.
 */
describe('rozsah vytištěného podkladu (H-3-01)', () => {
  it('věta na papíře nese skutečný rozsah strany i celek', () => {
    const { totalPages, currentPage, fromRow } = disposalPage(25_000, 1);
    const veta = printedRangeNote({
      fromRow,
      onPage: 200,
      total: 25_000,
      page: currentPage,
      totalPages,
    });

    // podstata, ne formulace: musí být vidět rozsah řádků i počet stran
    expect(veta).toContain('1–200');
    expect(veta).toContain('25000');
    expect(veta).toContain('125');
  });

  it('na poslední straně sedí rozsah na zbytek řádků', () => {
    const { totalPages, currentPage, fromRow } = disposalPage(25_050, 126);
    expect(currentPage).toBe(126);
    const veta = printedRangeNote({
      fromRow,
      onPage: 50,
      total: 25_050,
      page: currentPage,
      totalPages,
    });
    expect(veta).toContain('25001–25050');
  });

  it('report tu větu vykresluje jen pro tisk a stránkovací lištu naopak skrývá', () => {
    const zdroj = readFileSync(
      join(import.meta.dirname, '..', 'components', 'views', 'report-view.tsx'),
      'utf8',
    );
    // odstavec s rozsahem musí být v tiskové větvi (`print:block`)
    const tiskovyOdstavec = zdroj
      .split('\n')
      .findIndex((radek) => radek.includes('print:block') && radek.includes('text-ink-muted'));
    expect(tiskovyOdstavec).toBeGreaterThan(-1);
    expect(zdroj).toContain('printedRangeNote({');
    // a nesmí se vrátit tvrzení, že tisk obsahuje všechny prodeje
    expect(zdroj).not.toContain('Tisk\n                i XML pro podatelnu obsahují všechny prodeje');
  });

  it('rozbalení (rozpad prodeje na nákupy) se pro tisk otevřou i bez `::details-content`', () => {
    const root = join(import.meta.dirname, '..');
    // novější prohlížeče: styl
    const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/details::details-content\s*\{[^}]*display:\s*block/);
    // starší (před Chromium 131, Safari 18.4, Firefox 143): skript před tiskem —
    // bez něj by na papíře mlčky chyběla část podkladu
    const fallback = readFileSync(join(root, 'components', 'print-button.tsx'), 'utf8');
    expect(fallback).toContain("CSS.supports('selector(::details-content)')");
    expect(fallback).toContain("addEventListener('beforeprint'");
    expect(fallback).toContain("addEventListener('afterprint'");
    const report = readFileSync(join(root, 'components', 'views', 'report-view.tsx'), 'utf8');
    expect(report).toContain('<OpenDetailsForPrint />');
  });
});

/**
 * L5-02 — report musí nést tentýž verdikt o povinnosti podat přiznání jako
 * přehled (R-08b, R-09a, R-09b; § 38g ZDP).
 *
 * Paušalista pod limitem 50 000 Kč četl na /prehled „Zatím ti povinnost podat
 * přiznání nevzniká“, ale /report mu pro týž rok ukázal termín podání, ř. 86
 * a tlačítko na XML bez jediné věty o tom, že se ho netýkají. Výtisk pro
 * poradce na tom byl stejně — z papíru nešlo poznat, jestli povinnost vznikla.
 */
describe('verdikt o povinnosti podat přiznání v reportu (L5-02)', () => {
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
  const YEAR = 2025;
  const TODAY = `${YEAR}-07-20`;
  const UNDER_LIMIT = 'Zatím ti povinnost podat přiznání nevzniká';
  const OVER_LIMIT = `Za rok ${YEAR} podáš daňové přiznání`;
  const CAVEAT = 'příjmů, které Danero eviduje';
  /** Nadpis první sekce pod verdiktem — po redesignu „řádek formuláře → částka“. */
  const FIRST_SECTION = 'Co zapsat do přiznání';

  /** Jediný zdanitelný příjem roku: zahraniční dividenda v dané hrubé výši. */
  const dividend = (grossCzk: string) =>
    parseTransactions([
      {
        type: 'DIVIDEND',
        id: 'v1',
        isin: 'US0378331005',
        sourceCountry: 'US',
        gross: grossCzk,
        withholdingTax: '0',
        currency: 'CZK',
        date: `${YEAR}-04-01`,
      },
    ]);

  // „dnes“ je v běžícím roce — verdikt pod limitem je „zatím“; skončený rok
  // má vlastní znění a vlastní test níž
  const reportHtml = (grossCzk: string, regime: string = 'PAUSAL', today = TODAY): string =>
    renderToStaticMarkup(
      createElement(ReportView, {
        txs: dividend(grossCzk),
        profile: { ...PROFILE, regime },
        year: YEAR,
        years: [YEAR],
        today,
      }),
    );
  const overviewHtml = (grossCzk: string, regime: string = 'PAUSAL', today = TODAY): string => {
    const txs = dividend(grossCzk);
    return renderToStaticMarkup(
      createElement(OverviewView, {
        txs,
        analysis: analyzeForUser(txs, { ...PROFILE, regime }, YEAR, today),
        prices: new Map(),
        years: [YEAR],
        year: YEAR,
        today,
        notifications: [],
      }),
    );
  };

  /**
   * Třídy všech elementů, ve kterých je daný text zanořený — věta, která je
   * v HTML, ale v `print:hidden` nebo `hidden` předkovi, se na papír (resp. na
   * obrazovku) nedostane.
   */
  const ancestorClasses = (html: string, text: string): string[] => {
    const at = html.indexOf(text);
    expect(at, text).toBeGreaterThan(-1);
    const voidTags = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
    const open: string[] = [];
    for (const [, closing, tag, attrs] of html.slice(0, at).matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
      if (voidTags.has(tag!) || attrs!.endsWith('/')) continue;
      if (closing) open.pop();
      else open.push(/class="([^"]*)"/.exec(attrs!)?.[1] ?? '');
    }
    return open.flatMap((classes) => classes.split(/\s+/).filter(Boolean));
  };

  it('R-08b: paušalista pod limitem čte na obrazovce i v tisku, že povinnost nevznikla', { timeout: 30_000 }, () => {
    // 20 000 Kč brutto → limit 50 000 Kč paušální daně zůstává neprolomený
    const html = reportHtml('20000');
    expect(html).toContain(UNDER_LIMIT);
    expect(html).not.toContain(OVER_LIMIT);

    // jedna věta pro obě média: nesmí ji schovat tisk (`print:hidden`) ani
    // obrazovka (`hidden` s `print:block`)
    const classes = ancestorClasses(html, UNDER_LIMIT);
    expect(classes).not.toContain('print:hidden');
    expect(classes).not.toContain('hidden');

    // verdikt stojí nahoře — dřív než řádky přiznání i než termín podání
    expect(html.indexOf(UNDER_LIMIT)).toBeLessThan(html.indexOf(FIRST_SECTION));
    expect(html.indexOf(UNDER_LIMIT)).toBeLessThan(html.indexOf('Termín podání'));
  });

  it('verdikt nese výhradu, že platí jen pro příjmy, které Danero eviduje', { timeout: 30_000 }, () => {
    expect(reportHtml('20000')).toContain(CAVEAT);
    expect(reportHtml('60000')).toContain(CAVEAT);
  });

  it('R-08b: paušalista nad limitem čte, že přiznání podá', { timeout: 30_000 }, () => {
    const html = reportHtml('60000');
    expect(html).toContain(OVER_LIMIT);
    expect(html).not.toContain(UNDER_LIMIT);
  });

  it('R-09b, R-09a: zaměstnanec i režim „jiné“ pod svým limitem mají tentýž verdikt', { timeout: 30_000 }, () => {
    expect(reportHtml('5000', 'ZAMESTNANEC')).toContain(UNDER_LIMIT);
    expect(reportHtml('5000', 'JINE')).toContain(UNDER_LIMIT);
  });

  it('OSVČ mimo paušál verdikt nemá — přiznání podává tak jako tak, stejně jako na přehledu', { timeout: 30_000 }, () => {
    for (const html of [reportHtml('20000', 'OSVC'), overviewHtml('20000', 'OSVC')]) {
      expect(html).not.toContain(UNDER_LIMIT);
      expect(html).not.toContain(OVER_LIMIT);
    }
  });

  it('report a přehled se v nadpisu verdiktu shodují', { timeout: 30_000 }, () => {
    for (const [gross, headline] of [
      ['20000', UNDER_LIMIT],
      ['60000', OVER_LIMIT],
    ] as const) {
      expect(overviewHtml(gross)).toContain(headline);
      expect(reportHtml(gross)).toContain(headline);
    }
  });

  /**
   * R2-14: „Zatím ti povinnost … nevzniká“ platí jen pro rok, který ještě běží
   * a ve kterém se limit může prolomit zítřejším prodejem. U skončeného roku
   * je to hotová věc — a „zatím“ tam četl i ten, kdo si otevřel report za rok
   * 2022.
   */
  describe('skončený rok: povinnost „nevznikla“, ne „zatím nevzniká“ (R2-14)', () => {
    const NEXT_YEAR = `${YEAR + 1}-02-10`;
    const CLOSED = `Za rok ${YEAR} ti povinnost podat přiznání nevznikla`;
    const CLOSED_OVER_LIMIT = `Za rok ${YEAR} ti vznikla povinnost podat přiznání`;

    it('nadpis verdiktu se liší podle toho, jestli rok ještě běží', () => {
      expect(filingVerdictHeadline({ year: 2022, exceeded: false, closed: true })).toBe(
        'Za rok 2022 ti povinnost podat přiznání nevznikla',
      );
      expect(filingVerdictHeadline({ year: 2026, exceeded: false, closed: false })).toBe(
        UNDER_LIMIT,
      );
      // nad limitem v běžném roce je to úkol před uživatelem
      expect(filingVerdictHeadline({ year: YEAR, exceeded: true, closed: false })).toBe(OVER_LIMIT);
    });

    /**
     * „Za rok 2022 podáš daňové přiznání“ četl i ten, kdo ho podal před třemi
     * lety. Skončený rok nad limitem říká minulým časem, že povinnost vznikla
     * — a nesmí se splést s větví pod limitem („nevznikla“).
     */
    it('nad limitem říká skončený rok „vznikla“, ne „podáš“', { timeout: 30_000 }, () => {
      const headline = filingVerdictHeadline({ year: 2022, exceeded: true, closed: true });
      expect(headline).toContain('Za rok 2022');
      expect(headline).toMatch(/(?<!ne)vznikla povinnost podat přiznání/);
      expect(headline).not.toMatch(/podáš|nevznik|[Zz]atím/);

      for (const html of [
        reportHtml('60000', 'PAUSAL', NEXT_YEAR),
        overviewHtml('60000', 'PAUSAL', NEXT_YEAR),
      ]) {
        expect(html).toContain(CLOSED_OVER_LIMIT);
        expect(html).not.toContain(OVER_LIMIT);
        expect(html).not.toContain(CLOSED);
      }
      // tatáž částka zaměstnanci povinnost zakládá taky — stejné znění
      expect(reportHtml('30000', 'ZAMESTNANEC', NEXT_YEAR)).toContain(CLOSED_OVER_LIMIT);
    });

    it('nad limitem běžný rok beze změny — poslední den roku ještě „podáš“', { timeout: 30_000 }, () => {
      for (const html of [
        reportHtml('60000', 'PAUSAL', `${YEAR}-12-31`),
        overviewHtml('60000', 'PAUSAL', `${YEAR}-12-31`),
      ]) {
        expect(html).toContain(OVER_LIMIT);
        expect(html).not.toContain(CLOSED_OVER_LIMIT);
      }
    });

    it('report i přehled za skončený rok „zatím“ neříkají', { timeout: 30_000 }, () => {
      for (const html of [
        reportHtml('20000', 'PAUSAL', NEXT_YEAR),
        overviewHtml('20000', 'PAUSAL', NEXT_YEAR),
      ]) {
        expect(html).toContain(CLOSED);
        expect(html).not.toContain(UNDER_LIMIT);
      }
    });

    it('běžný rok beze změny — poslední den roku ještě „zatím“', { timeout: 30_000 }, () => {
      for (const html of [
        reportHtml('20000', 'PAUSAL', `${YEAR}-12-31`),
        overviewHtml('20000', 'PAUSAL', `${YEAR}-12-31`),
      ]) {
        expect(html).toContain(UNDER_LIMIT);
        expect(html).not.toContain(CLOSED);
      }
    });

    it('zaměstnanec i režim „jiné“ mají u skončeného roku totéž znění', { timeout: 30_000 }, () => {
      expect(reportHtml('5000', 'ZAMESTNANEC', NEXT_YEAR)).toContain(CLOSED);
      expect(reportHtml('5000', 'JINE', NEXT_YEAR)).toContain(CLOSED);
    });
  });

  /**
   * Text verdiktu bez značek — od nadpisu po první sekci s čísly. Celé znění
   * výhrady je na obrazovce ve vysvětlivce (ta se vykreslí až po otevření),
   * v HTML ho nese odstavec určený pro tisk; krátká výhrada a případné
   * sdělení o oznámení stojí vedle něj.
   */
  const verdictCard = (html: string, headline: string): string => {
    const text = html.replace(/<[^>]+>/g, '');
    const from = text.indexOf(headline);
    expect(from, headline).toBeGreaterThan(-1);
    const to = text.indexOf(FIRST_SECTION, from);
    expect(to, FIRST_SECTION).toBeGreaterThan(from);
    return text.slice(from, to);
  };
  const DEADLINE_ONLY_IF_FILING = /Termín podání a čísla k opsání níž na stránce potřebuješ jen tehdy/;

  it('A24-R1-02: každý nadpis má pod sebou větu své větve, ne té druhé', { timeout: 30_000 }, () => {
    const under = verdictCard(reportHtml('20000'), UNDER_LIMIT);
    expect(under).toMatch(/je čerpaný z 40\s%/);
    expect(under).toMatch(DEADLINE_ONLY_IF_FILING);
    expect(under).not.toContain('překročený');

    const over = verdictCard(reportHtml('60000'), OVER_LIMIT);
    expect(over).toMatch(/je překročený, čerpáno 60\s000\sKč/);
    expect(over).toContain('termín podání najdeš níž na stránce');
    expect(over).not.toContain('čerpaný z');
    expect(over).not.toMatch(DEADLINE_ONLY_IF_FILING);
  });

  it('R-08b: paušalista se soudí limitem 50 000 Kč, ne limitem zaměstnance', { timeout: 30_000 }, () => {
    // 30 000 Kč leží mezi oběma limity: nad 20 000 Kč zaměstnance (R-09b),
    // pod 50 000 Kč paušální daně — verdikt se podle nich liší
    for (const html of [reportHtml('30000'), overviewHtml('30000')]) {
      expect(html).toContain(UNDER_LIMIT);
      expect(html).not.toContain(OVER_LIMIT);
    }
    const card = verdictCard(reportHtml('30000'), UNDER_LIMIT);
    expect(card).toMatch(/limit paušální daně \(50\s000\sKč\) je čerpaný z 60\s%/);
    // tatáž částka zaměstnanci povinnost zakládá
    expect(reportHtml('30000', 'ZAMESTNANEC')).toContain(OVER_LIMIT);
  });

  /**
   * A24-R1-01 — oznámení osvobozeného příjmu nad 5 mil. Kč (§ 38v ZDP, R-09d).
   *
   * Prodej za 6 mil. Kč osvobozený časovým testem nechá limit čerpaný z 0 %,
   * takže verdikt vyjde „nevzniká“ — a věta pod ním tvrdila, že termín potřebuje
   * jen ten, kdo přiznání podává. Oznámení se přitom podává právě tehdy, a kdo
   * přiznání nepodává, má na ně jen tři měsíce po konci roku (sankce § 38w se
   * počítá z neoznámeného příjmu).
   */
  const exemptSaleOver5m = parseTransactions([
    { type: 'BUY', id: 'o1', isin: 'CZ0005112300', ticker: 'CEZ', quantity: '1000', pricePerShare: '1000', currency: 'CZK', tradeDate: '2020-02-03', settlementDate: '2020-02-05' },
    { type: 'SELL', id: 'o2', isin: 'CZ0005112300', quantity: '1000', pricePerShare: '6000', currency: 'CZK', tradeDate: `${YEAR}-04-01`, settlementDate: `${YEAR}-04-03` },
  ]);

  for (const regime of ['PAUSAL', 'ZAMESTNANEC', 'JINE']) {
    it(`R-09d: ${regime} pod limitem s osvobozeným prodejem nad 5 mil. Kč čte ve verdiktu lhůtu pro oznámení`, { timeout: 30_000 }, () => {
      const profile = { ...PROFILE, regime };
      // předpoklad sondy: engine oznamovací povinnost pro tenhle rok vrací
      expect(analyzeForUser(exemptSaleOver5m, profile, YEAR, TODAY).result.limits.reporting38v).toHaveLength(1);

      const card = verdictCard(
        renderToStaticMarkup(
          createElement(ReportView, {
            txs: exemptSaleOver5m,
            profile,
            year: YEAR,
            years: [YEAR],
            today: TODAY,
          }),
        ),
        UNDER_LIMIT,
      );
      expect(card).toContain('§ 38v');
      expect(card).toMatch(/oznam/i);
      // tři měsíce po konci roku, ne čtyřměsíční lhůta elektronického přiznání
      expect(card).toMatch(new RegExp(`1\\.\\s4\\.\\s${YEAR + 1}`));
      expect(card).not.toMatch(DEADLINE_ONLY_IF_FILING);
    });
  }

  it('R-09d: bez osvobozeného prodeje nad 5 mil. Kč verdikt o oznámení mlčí', { timeout: 30_000 }, () => {
    for (const gross of ['20000', '60000']) {
      const html = reportHtml(gross);
      const card = verdictCard(html, gross === '20000' ? UNDER_LIMIT : OVER_LIMIT);
      expect(card).not.toMatch(/38v|oznam/i);
    }
  });
});
