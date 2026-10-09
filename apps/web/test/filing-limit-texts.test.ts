import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { d, parseTransactions, type Money, type Transaction } from '@danero/shared';
import { OverviewView } from '@/components/views/overview-view';
import { filingLimitTexts } from '@/lib/filing-limits';
import { czk } from '@/lib/format';
import { analyzeForUser, type ProfileRow } from '@/lib/portfolio';
import { configForYear } from '@/lib/tax-config';

/**
 * R-09a, R-09b: limity § 38g pro povinnost podat přiznání jsou do ZO 2026
 * 50 000 / 20 000 Kč a od ZO 2027 100 000 / 40 000 Kč (zák. č. 180/2026 Sb.).
 *
 * Engine je bere z konfigurace roku, ale popisky v aplikaci měly částku
 * natvrdo — v roce 2027 by tak odměrka s nadpisem „Vedlejší příjmy —
 * 20 000 Kč“ ukazovala čerpání ze 40 000 Kč (nález L3-01 revize 5). Testy
 * proto text porovnávají s konfigurací daného roku, ne s literálem: až se
 * limit změní příště, nespadnou a hlídat budou dál.
 */

// stránky nastavení a uvítání čtou uživatele a profil — tady jde jen o texty
vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: 'u-limity', email: 'nikdo@example.com', name: 'Nikdo' }),
}));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => ({}) };
});
// kalkulačka sama částku v prvním vykreslení neukazuje (otázka přijde až po
// první odpovědi) — místo ní proto zástupce, který vypíše, co jí stránka předala
vi.mock('@/components/filing-calculator', () => ({
  KalkulackaPriznani: ({ filingLimits }: { filingLimits: unknown }) =>
    createElement('pre', { 'data-filing-limits': '' }, JSON.stringify(filingLimits)),
}));
// rám marketingové stránky čte přihlášení (asynchronní komponenta) — k věci nepatří
vi.mock('@/components/marketing-page', () => ({
  MarketingPage: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  PageHero: () => null,
  MarketingCta: () => null,
}));
vi.mock('@/lib/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio')>('@/lib/portfolio');
  return { ...actual, getProfile: async () => null, listPinnedTaxYears: async () => [] };
});

const PROFILE: ProfileRow = {
  userId: 'u-limity',
  regime: 'ZAMESTNANEC',
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

/** Zahraniční dividenda v dané výši — čerpá limit, ale žádný prodej k ní není. */
const dividend = (year: number, gross: Money): Transaction[] =>
  parseTransactions([
    {
      type: 'DIVIDEND',
      id: `d-${year}`,
      sourceCountry: 'US',
      gross: gross.toFixed(0),
      currency: 'CZK',
      withholdingTax: '0',
      date: `${year}-03-10`,
    },
  ]);

/**
 * Text přehledu roku pro daný režim s dividendou ve výši 90 % jeho limitu.
 * Bez značek: nadpis karty obaluje „Kč“ do vlastního `<span>` (`keepCurrencyCase`).
 */
function overviewHtml(year: number, regime: 'ZAMESTNANEC' | 'JINE', limit: Money): string {
  const today = `${year}-07-20`;
  const txs = dividend(year, limit.mul('0.9'));
  const html = renderToStaticMarkup(
    createElement(OverviewView, {
      txs,
      analysis: analyzeForUser(txs, { ...PROFILE, regime }, year, today),
      prices: new Map(),
      years: [year],
      year,
      today,
      notifications: [],
    }),
  );
  return html.replace(/<[^>]+>/g, '');
}

describe('přehled: částka limitu § 38g v popiscích je z konfigurace roku (L3-01)', () => {
  for (const year of [2026, 2027]) {
    const { limits } = configForYear(year);

    it(`R-09b: zaměstnanec v roce ${year}`, { timeout: 30_000 }, () => {
      const limit = d(limits.employeeSideIncome);
      const html = overviewHtml(year, 'ZAMESTNANEC', limit);

      expect(html).toContain(`Vedlejší příjmy — ${czk(limit)}`);
      expect(html).toContain(`Nejblíž je limit ${czk(limit)} vedlejších příjmů`);
    });

    it(`R-09a: režim „jiné“ v roce ${year}`, { timeout: 30_000 }, () => {
      const limit = d(limits.generalFiling);
      const html = overviewHtml(year, 'JINE', limit);

      expect(html).toContain(`Podání přiznání — ${czk(limit)}`);
      expect(html).toContain(`zdanitelné příjmy do ${czk(limit)} za rok`);
      expect(html).toContain(`Nejblíž je limit ${czk(limit)} pro podání přiznání`);
    });
  }
});

/**
 * Nastavení a uvítání rok neznají (profil platí pro všechny roky), takže
 * jmenují limit běžného roku — čas si test podstrčí přes `DANERO_NOW`.
 */
describe('nastavení a uvítání: limity § 38g běžného roku (L3-01)', () => {
  afterEach(() => {
    delete process.env.DANERO_NOW;
  });

  // pražské poledne 1. července daného roku
  const midYear = (year: number): string => `${year}-07-01T10:00:00Z`;

  for (const year of [2026, 2027]) {
    const { limits } = configForYear(year);
    const employeeLimit = czk(d(limits.employeeSideIncome));
    const generalLimit = czk(d(limits.generalFiling));

    it(`volby daňového režimu v roce ${year}`, { timeout: 30_000 }, async () => {
      process.env.DANERO_NOW = midYear(year);
      const { default: SettingsPage } = await import('@/app/(app)/nastaveni/page');
      const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));

      expect(html).toContain(`Zaměstnanec (hlídá se limit ${employeeLimit})`);
      expect(html).toContain(`Jiné (hlídá se obecný limit ${generalLimit})`);
      // limit paušální daně (§ 7a) se nemění
      expect(html).toContain('OSVČ v paušálním režimu (hlídá se limit 50 000 Kč)');
    });

    it(`první krok uvítání v roce ${year}`, { timeout: 30_000 }, async () => {
      process.env.DANERO_NOW = midYear(year);
      const { default: WelcomePage } = await import('@/app/(app)/vitejte/page');
      const html = renderToStaticMarkup(await WelcomePage());

      expect(html).toContain(`příjmy ${employeeLimit}…`);
      expect(html).toContain('paušální daň 50 000 Kč');
    });
  }

  it('veřejná kalkulačka dostane limity běžného i následujícího roku', { timeout: 30_000 }, async () => {
    // stránka je statická — který z obou roků je „letos“, rozhodnou až hodiny
    // návštěvníka (`pickFilingLimits`), proto mu musí přijít oba
    process.env.DANERO_NOW = midYear(2026);
    const { default: KalkulackaPage } = await import('@/app/kalkulacka/page');
    const html = renderToStaticMarkup(createElement(KalkulackaPage));

    const passed = /<pre data-filing-limits="">(.*?)<\/pre>/.exec(html)?.[1] ?? '';
    expect(JSON.parse(passed.replaceAll('&quot;', '"'))).toEqual([
      filingLimitTexts(2026),
      filingLimitTexts(2027),
    ]);
  });
});
