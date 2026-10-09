import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRow } from '@/lib/portfolio';

/**
 * Strážce textů stránky Nastavení → Daň a výpočet. Stránka je serverová
 * a čte uživatele i profil, takže si test obojí podstrčí a hlídá vykreslené
 * HTML — ne zdroj, ve kterém by hledanou větu splnil i komentář.
 */

const getProfile = vi.fn<() => Promise<ProfileRow | null>>();

vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: 'u-texty', email: 'nikdo@example.com', name: 'Nikdo' }),
}));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => ({}) };
});
vi.mock('@/lib/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio')>('@/lib/portfolio');
  return { ...actual, getProfile: () => getProfile(), listPinnedTaxYears: async () => [] };
});

const PROFILE: ProfileRow = {
  userId: 'u-texty',
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  w8benFiled: true,
  otherIncomeCzk: '45000.00',
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

async function settingsHtml(): Promise<string> {
  const { default: SettingsPage } = await import('@/app/(app)/nastaveni/page');
  return renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
}

/** Text prvku s daným `id` bez značek; prázdný řetězec, když na stránce není. */
function textOfElement(html: string, id: string): string {
  const match = new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>(.*?)</\\1>`, 's').exec(html);
  return (match?.[2] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * R-08f, R-09a, R-09b: limit se měří součtem příjmů za zdaňovací období,
 * jenže pole „Další zdanitelné příjmy“ má profil jen jedno a engine ho přičte
 * ke KAŽDÉMU roku — i ke skončenému a zafixovanému (fixace R-05c drží párování,
 * kurzy a výklad limitu 100 000 Kč, tohle pole ne). Popisek „Kč/rok“ to
 * neřekl: kdo si v říjnu zapsal letošní nájem, tomu loňský rok pod limitem
 * zpětně přeskočil na „podáš daňové přiznání“ a nevěděl proč (nález L24-03
 * revize 5). Dokud částka není vedená po rocích, musí to pole přiznat.
 */
describe('nastavení: pole „Další zdanitelné příjmy“ říká, že platí pro všechny roky (L24-03)', () => {
  beforeEach(() => {
    getProfile.mockReset();
  });

  for (const [label, profile] of [
    ['před prvním uložením profilu', null],
    ['u uloženého profilu', PROFILE],
  ] as const) {
    it(`${label}: vysvětlení je navázané na pole a mluví o skončených rocích`, { timeout: 30_000 }, async () => {
      getProfile.mockResolvedValue(profile);
      const html = await settingsHtml();

      const input = /<input[^>]*\sid="ostatni-prijmy"[^>]*>/.exec(html)?.[0] ?? '';
      expect(input).not.toBe('');
      // věta musí patřit k poli i pro odečítač obrazovky, ne jen stát poblíž
      const hintId = /aria-describedby="([^"]+)"/.exec(input)?.[1] ?? '';
      expect(hintId).not.toBe('');

      const hint = textOfElement(html, hintId);
      expect(hint).toMatch(/všechny roky/);
      expect(hint).toMatch(/ke každému roku/);
      expect(hint).toMatch(/skončen/);
      expect(hint).toMatch(/zafixovan/);
      // a co to znamená prakticky: změna částky přepíše i minulé roky
      expect(hint).toMatch(/minulé roky/);
    });
  }
});
