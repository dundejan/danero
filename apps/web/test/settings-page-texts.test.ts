import { createElement } from 'react';
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

// Vysvětlivka se vykresluje až po otevření — test si ji nahradí obalem, aby
// její text ve statickém HTML byl (vzor: test/payable-tax.test.ts).
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: React.ReactNode }) =>
    createElement('span', { 'data-info': '' }, children),
}));

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

const plainText = (html: string): string =>
  html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** Text prvku s daným `id` bez značek; prázdný řetězec, když na stránce není. */
function textOfElement(html: string, id: string): string {
  const match = new RegExp(`<(\\w+)[^>]*\\sid="${id}"[^>]*>(.*?)</\\1>`, 's').exec(html);
  return plainText(match?.[2] ?? '');
}

/**
 * Text vysvětlivky u pole: v řádku nastavení stojí mezi popiskem pole
 * a tichou větou pod ním.
 */
function explanationOfField(html: string, fieldId: string, hintId: string): string {
  const row = html.slice(html.indexOf(`for="${fieldId}"`), html.indexOf(`id="${hintId}"`));
  return plainText(/<span data-info="">(.*?)<\/span>/s.exec(row)?.[1] ?? '');
}

/**
 * R-08f, R-09a, R-09b: limit se měří součtem příjmů za zdaňovací období,
 * jenže pole „Další zdanitelné příjmy“ má profil jen jedno a engine ho přičte
 * ke KAŽDÉMU roku — i ke skončenému a zafixovanému (fixace R-05c drží párování,
 * kurzy a výklad limitu 100 000 Kč, tohle pole ne). Popisek „Kč/rok“ to
 * neřekl: kdo si v říjnu zapsal letošní nájem, tomu loňský rok pod limitem
 * zpětně přeskočil na „podáš daňové přiznání“ a nevěděl proč (nález L24-03
 * revize 5). Dokud částka není vedená po rocích, musí to pole přiznat.
 *
 * Redesign (říjen 2026) rozdělil větu na dvě: výhrada, která chrání před
 * špatným závěrem, zůstává vidět přímo u pole a je na něj navázaná; co to
 * znamená prakticky, říká vysvětlivka hned vedle popisku (docs/07, textová
 * dieta, pravidlo 3).
 */
describe('nastavení: pole „Další zdanitelné příjmy“ říká, že platí pro všechny roky (L24-03)', () => {
  beforeEach(() => {
    getProfile.mockReset();
  });

  for (const [label, profile] of [
    ['před prvním uložením profilu', null],
    ['u uloženého profilu', PROFILE],
  ] as const) {
    it(`${label}: výhrada je navázaná na pole a vysvětlivka říká, co změna udělá`, { timeout: 30_000 }, async () => {
      getProfile.mockResolvedValue(profile);
      const html = await settingsHtml();

      const input = /<input[^>]*\sid="ostatni-prijmy"[^>]*>/.exec(html)?.[0] ?? '';
      expect(input).not.toBe('');
      // věta musí patřit k poli i pro odečítač obrazovky, ne jen stát poblíž
      const hintId = /aria-describedby="([^"]+)"/.exec(input)?.[1] ?? '';
      expect(hintId).not.toBe('');

      // vidět vždy: částka není jen za letošek
      const hint = textOfElement(html, hintId);
      expect(hint).toMatch(/všechny roky/);
      expect(hint).toMatch(/skončen/);
      expect(hint).toMatch(/zafixovan/);

      // na požádání: jak přesně se částka přičítá a co to znamená prakticky —
      // změna přepíše i minulé roky
      const explanation = explanationOfField(html, 'ostatni-prijmy', hintId);
      expect(explanation).toMatch(/ke každému roku/);
      expect(explanation).toMatch(/minulé roky/);
    });
  }
});
