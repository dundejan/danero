import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASELINE_FIELD, CHANGED_FIELD } from '@/lib/form-baseline';
import type { getNotificationPrefs as GetNotificationPrefs } from '@/lib/notifications';
import type { ProfileRow } from '@/lib/portfolio';

/**
 * Skrytý stav formuláře musí říkat přesně to, co by neupravený formulář
 * odeslal.
 *
 * Server zapisuje jen pole, která se od stavu při vykreslení liší
 * (`lib/form-baseline.ts`). Kdyby pole mělo jinou výchozí hodnotu, než jakou
 * nese skrytý stav, tvářilo by se jako změněné při každém uložení — a přesně
 * tím by se vrátila chyba, kterou to celé řeší: zastaralý panel by cizí změnu
 * přepsal. Test proto čte vykreslené HTML tak, jak ho čte prohlížeč, a obojí
 * porovná. Totéž naživo hlídá `e2e/nastaveni.spec.ts`.
 */
type Prefs = Awaited<ReturnType<typeof GetNotificationPrefs>>;

const getProfile = vi.fn<() => Promise<ProfileRow | null>>();
const getPrefs = vi.fn<() => Promise<Prefs>>();

vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: 'u-stav', email: 'nikdo@example.com', name: 'Nikdo' }),
}));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => ({}) };
});
vi.mock('@/lib/portfolio', async () => {
  const actual = await vi.importActual<typeof import('@/lib/portfolio')>('@/lib/portfolio');
  return { ...actual, getProfile: () => getProfile(), listPinnedTaxYears: async () => [] };
});
vi.mock('@/lib/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications')>('@/lib/notifications');
  return { ...actual, getNotificationPrefs: () => getPrefs() };
});
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: () => createElement('span'),
}));

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decodeHtml(match[1]!) : null;
};
const hasFlag = (tag: string, name: string): boolean => new RegExp(`\\s${name}(=""|[\\s>/])`).test(tag);
const decodeHtml = (text: string): string =>
  text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<');

/**
 * Dvojice, které by prohlížeč odeslal z neupraveného formuláře: zaškrtnutá
 * políčka, textová pole a vybraná položka každé nabídky (bez vybrané položky
 * první nezakázaná; zakázaná vybraná se neodesílá).
 */
function untouchedSubmission(formHtml: string): Array<[string, string]> {
  const entries: Array<[number, string, string]> = [];
  for (const match of formHtml.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    const name = attribute(tag, 'name');
    const type = attribute(tag, 'type') ?? 'text';
    if (!name || type === 'hidden' || type === 'submit') continue;
    if (type === 'checkbox' || type === 'radio') {
      if (hasFlag(tag, 'checked')) entries.push([match.index, name, attribute(tag, 'value') ?? 'on']);
    } else {
      entries.push([match.index, name, attribute(tag, 'value') ?? '']);
    }
  }
  for (const match of formHtml.matchAll(/<select\b[^>]*>(.*?)<\/select>/gs)) {
    const name = attribute(match[0].slice(0, match[0].indexOf('>') + 1), 'name');
    if (!name) continue;
    const options = [...match[1]!.matchAll(/<option\b[^>]*>/g)].map((option) => option[0]);
    const selected =
      options.find((tag) => hasFlag(tag, 'selected')) ??
      options.find((tag) => !hasFlag(tag, 'disabled'));
    if (selected && !hasFlag(selected, 'disabled')) {
      entries.push([match.index, name, attribute(selected, 'value') ?? '']);
    }
  }
  return entries.sort((a, b) => a[0] - b[0]).map(([, name, value]) => [name, value]);
}

/** Formulář, který nese skrytý stav, a ten stav. */
function formWithBaseline(html: string): { formHtml: string; baseline: Array<[string, string]> } {
  const forms = [...html.matchAll(/<form\b.*?<\/form>/gs)]
    .map((match) => match[0])
    .filter((form) => form.includes(`name="${BASELINE_FIELD}"`));
  expect(forms).toHaveLength(1);
  const formHtml = forms[0]!;
  const hidden = new RegExp(`<input\\b[^>]*name="${BASELINE_FIELD}"[^>]*>`).exec(formHtml)![0];
  return { formHtml, baseline: [...new URLSearchParams(attribute(hidden, 'value') ?? '')] };
}

const sorted = (entries: Array<[string, string]>): string[] =>
  entries.map(([name, value]) => `${name}=${value}`).sort();

const PROFILE: ProfileRow = {
  userId: 'u-stav',
  regime: 'ZAMESTNANEC',
  hasBusinessAssets: true,
  w8benFiled: true,
  otherIncomeCzk: '45000.50',
  matchingMethod: 'MAX_LOSS',
  fxMethod: 'CNB_DAILY',
  limit100kStrict: false,
  derivativesExpensesPerType: true,
  emtTimeTestExempt: true,
  returnOfCapitalReducesBasis: true,
  timeTestBasis: 'trade',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SAFE_PROFILE: ProfileRow = {
  ...PROFILE,
  regime: 'PAUSAL',
  hasBusinessAssets: false,
  otherIncomeCzk: '0.00',
  matchingMethod: 'FIFO',
  fxMethod: 'UNIFIED',
  limit100kStrict: true,
  derivativesExpensesPerType: false,
  emtTimeTestExempt: false,
  returnOfCapitalReducesBasis: false,
  timeTestBasis: 'settlement',
};

describe('daňový profil: skrytý stav odpovídá polím', () => {
  beforeEach(() => getProfile.mockReset());

  for (const [label, profile] of [
    ['formulář prvního uložení', null],
    ['profil s bezpečnými předvolbami', SAFE_PROFILE],
    ['profil se vším přepnutým', PROFILE],
  ] as const) {
    it(label, { timeout: 30_000 }, async () => {
      getProfile.mockResolvedValue(profile);
      const { default: SettingsPage } = await import('@/app/(app)/nastaveni/page');
      const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
      const { formHtml, baseline } = formWithBaseline(html);

      expect(sorted(untouchedSubmission(formHtml))).toEqual(sorted(baseline));
      // režim nemá předvolbu (L7i-01) — dokud ho člověk nevybere, neodesílá se
      expect(baseline.some(([name]) => name === 'rezim')).toBe(profile !== null);
      // pole se jménem právě změněného pole patří jen k auto-save a je bez hodnoty
      const changedField = new RegExp(`<input\\b[^>]*name="${CHANGED_FIELD}"[^>]*>`).exec(formHtml);
      expect(changedField !== null).toBe(profile !== null);
      if (changedField) expect(attribute(changedField[0], 'value')).toBeNull();
    });
  }

  it('každé pole, které akce ukládá, je ve formuláři', { timeout: 30_000 }, async () => {
    getProfile.mockResolvedValue(PROFILE);
    const { default: SettingsPage } = await import('@/app/(app)/nastaveni/page');
    const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    const { PROFILE_FIELDS } = await import('@/app/(app)/nastaveni/form-state');
    const { baseline } = formWithBaseline(html);
    expect([...new Set(baseline.map(([name]) => name))].sort()).toEqual(
      Object.values(PROFILE_FIELDS).sort(),
    );
  });
});

describe('upozornění: skrytý stav odpovídá polím', () => {
  const DEFAULTS: Prefs = {
    userId: 'u-stav',
    emailEnabled: true,
    timeTestEvents: true,
    limitEvents: true,
    calendarEmails: true,
    emailFrequency: 'DAILY',
    lastDigestAt: null,
    timeTestLeadDays: '30,7',
    timeTestDone: true,
    limitThresholdsPct: '60,85,100',
    deadlineLeadDays: 30,
    summaryFrequency: 'OFF',
    urgentImmediately: true,
  } as Prefs;

  beforeEach(() => getPrefs.mockReset());

  for (const [label, prefs] of [
    ['výchozí pravidla', DEFAULTS],
    [
      'všechno přepnuté a nic vybraného',
      {
        ...DEFAULTS,
        emailEnabled: false,
        timeTestEvents: false,
        limitEvents: false,
        calendarEmails: false,
        emailFrequency: 'WEEKLY',
        timeTestLeadDays: '',
        timeTestDone: false,
        limitThresholdsPct: '',
        deadlineLeadDays: 7,
        summaryFrequency: 'QUARTERLY',
        urgentImmediately: false,
      },
    ],
    [
      // lhůta mimo nabídku (starší data): pole i stav padnou na tutéž volbu
      'hodnoty mimo nabídku',
      { ...DEFAULTS, timeTestLeadDays: '90,45,1', limitThresholdsPct: '50,55,100', deadlineLeadDays: 17 },
    ],
  ] as const) {
    it(label, { timeout: 30_000 }, async () => {
      getPrefs.mockResolvedValue(prefs as Prefs);
      const { default: NotificationSettingsPage } = await import(
        '@/app/(app)/nastaveni/upozorneni/page'
      );
      const html = renderToStaticMarkup(
        await NotificationSettingsPage({ searchParams: Promise.resolve({}) }),
      );
      const { formHtml, baseline } = formWithBaseline(html);
      expect(sorted(untouchedSubmission(formHtml))).toEqual(sorted(baseline));
    });
  }

  it('každé pole, které akce ukládá, je ve formuláři', { timeout: 30_000 }, async () => {
    getPrefs.mockResolvedValue({
      ...DEFAULTS,
      timeTestLeadDays: '30',
      limitThresholdsPct: '60',
    } as Prefs);
    const { default: NotificationSettingsPage } = await import(
      '@/app/(app)/nastaveni/upozorneni/page'
    );
    const html = renderToStaticMarkup(
      await NotificationSettingsPage({ searchParams: Promise.resolve({}) }),
    );
    const { NOTIFICATION_FIELDS } = await import('@/app/(app)/nastaveni/form-state');
    const { baseline } = formWithBaseline(html);
    expect([...new Set(baseline.map(([name]) => name))].sort()).toEqual(
      Object.values(NOTIFICATION_FIELDS).sort(),
    );
  });
});
