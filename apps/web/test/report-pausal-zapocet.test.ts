import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseTransactions, type Transaction } from '@danero/shared';
import { ReportView } from '@/components/views/report-view';
import { czk } from '@/lib/format';
import { type ProfileRow } from '@/lib/portfolio';

/**
 * K7a-02 — § 7a odst. 5 ZDP: „Daň se nerovná paušální dani, pokud poplatník
 * podle odstavce 1 nebo 2, který je daňovým rezidentem České republiky, vyloučí
 * dvojí zdanění příjmů plynoucích ze zdrojů v zahraničí v daňovém přiznání."
 *
 * Report do 23. 8. 2026 nabízel paušalistovi zápočet zahraniční srážky bez
 * jediné výhrady — přitom si tu „výhodu" může vzít jen za cenu ztráty paušální
 * daně za celý rok, tedy přiznání, přehledů ČSSZ i ZP a doplatku pojistného.
 * A protože se mu v paušálu ty dividendy v ČR samostatně nedaní, není proti
 * čemu započítávat: rada by ho stála peníze, aniž by mu co ušetřila.
 *
 * Druhá polovina pravidla je stejně důležitá: odstavec 5 mluví o „poplatníkovi
 * podle odstavce 1 nebo 2", takže na toho, kdo limit 50 000 Kč PROLOMIL,
 * nedopadá vůbec — jemu daň paušální dani rovna není už podle odst. 1 a zápočet
 * má uplatnit v plné výši. Výhrada se mu proto ukázat nesmí.
 */
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

/** Zahraniční dividenda se srážkou; výší se řídí, jestli limit 50k padne. */
const dividendTxs = (grossCzk: string, withholdingCzk: string): Transaction[] =>
  parseTransactions([
    {
      type: 'DIVIDEND',
      id: 'd1',
      isin: 'US0378331005',
      sourceCountry: 'US',
      gross: grossCzk,
      withholdingTax: withholdingCzk,
      currency: 'CZK',
      date: '2025-04-01',
    },
  ]);

const render = (txs: Transaction[]): string =>
  renderToStaticMarkup(
    createElement(ReportView, { txs, profile: PROFILE, year: 2025, years: [2025] }),
  );

const VYHRADA = 'si letos v Česku nezapočteš';

describe('R-08b: paušalista a zápočet zahraniční daně v reportu (K7a-02)', () => {
  it('pod limitem 50k report u zápočtu i v průvodci řekne, že zápočet stojí paušální daň', () => {
    // 20 000 Kč brutto → limit 50 000 Kč zůstává nevyčerpaný, srážka 3 000 Kč
    const html = render(dividendTxs('20000', '3000'));

    // obě místa zvlášť: karta zápočtu („Příjmy podle států") i průvodce
    // „co kam zapsat". Ve výpisu kontrol výpočtu je navíc táž hláška z enginu —
    // proto se hledá po sekcích, ne prostým počtem výskytů.
    const sekce = (od: string, do_: string): string => {
      const from = html.indexOf(od);
      expect(from, od).toBeGreaterThan(-1);
      const to = html.indexOf(do_, from);
      return html.slice(from, to === -1 ? undefined : to);
    };
    expect(sekce('Příjmy podle států', 'Kontroly výpočtu')).toContain(VYHRADA);
    expect(sekce('Průvodce: co kam zapsat v přiznání', 'Konfigurace výpočtu')).toContain(
      VYHRADA,
    );

    // spouštěčem odst. 5 je UPLATNĚNÍ zápočtu v přiznání, ne samotné podání
    expect(html).toContain('v přiznání uplatnil');
    expect(html).toContain('§ 7a odst. 5');
    // paušální REŽIM tím nekončí (§ 2a odst. 8)
    expect(html).toContain('V paušálním režimu bys přitom zůstal');
    // co má dělat místo toho
    expect(html).toContain('Rozdíl se žádá zpět ve státě zdroje');
    // částka se doplňuje skutečnou sraženou daní (stejným `czk()` jako sousední
    // částky reportu — s pevnou mezerou v oddělovači tisíců)
    expect(html).toContain(czk(3000));
  });

  it('kdo limit 50k prolomil, výhradu nevidí — zápočet mu patří v plné výši', () => {
    // 60 000 Kč brutto → limit prolomen, daň paušální dani rovna není už podle
    // § 7a odst. 1, takže odst. 5 na poplatníka nedopadá
    const html = render(dividendTxs('60000', '9000'));

    expect(html).not.toContain(VYHRADA);
    // a zápočet se mu dál nabízí (karta Přílohy č. 3 zůstává)
    expect(html).toContain('Příjmy podle států');
  });

  it('mimo paušální režim se výhrada nevydá vůbec', () => {
    const html = renderToStaticMarkup(
      createElement(ReportView, {
        txs: dividendTxs('20000', '3000'),
        profile: { ...PROFILE, regime: 'ZAMESTNANEC' },
        year: 2025,
        years: [2025],
      }),
    );

    expect(html).not.toContain(VYHRADA);
  });

  it('výhrada je i na /jak-pocitame — stránka dřív slibovala zápočet bez omezení', () => {
    // třetí ze tří míst (vedle hlášky enginu a reportu); stránka je server
    // komponenta s daty v konstantě, takže se ověřuje znění zdroje
    // zalomení řádků ve zdroji je věc formátování, ne obsahu
    const text = readFileSync(
      join(import.meta.dirname, '..', 'app', 'jak-pocitame', 'page.tsx'),
      'utf8',
    ).replace(/\s+/g, ' ');
    expect(text).toContain('sraženou daň ze zahraničí v Česku nezapočteš');
    expect(text).toContain('§ 7a odst. 5');
    expect(text).toContain('V paušálním režimu bys přitom zůstal');
    // a musí říct i to, že na prolomivšího výhrada nedopadá
    expect(text).toContain('zápočet uplatní v plné výši');
  });
});
