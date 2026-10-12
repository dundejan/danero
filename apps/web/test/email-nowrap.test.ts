import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FormPage } from '@/components/form-page';
import { Toast } from '@/components/toast';
import { FieldError } from '@/components/ui/field';
import type { getNotificationPrefs as GetNotificationPrefs } from '@/lib/notifications';

/**
 * „e-mail“ se v textech aplikace nesmí zlomit ve spojovníku („e- / mailem“).
 *
 * Do 11. 10. 2026 to hlídal nezlomitelný spojovník, který vkládala sazba —
 * jenže ten rozbíjel hledání v prohlížeči i kopírování, a tak odešel. Slovo
 * teď drží pohromadě styl (`typeset()` ho obalí `whitespace-nowrap`), a to jen
 * tam, kde text přes `typeset()` opravdu jde. Texty aplikace, které dřív
 * chránil znak, by bez toho zůstaly nechráněné: hlášky po uložení, chyby
 * u polí, titulky a věty přihlašovacích stránek, vysvětlivky v Nastavení.
 */
type Prefs = Awaited<ReturnType<typeof GetNotificationPrefs>>;

vi.mock('@/lib/session', () => ({
  requireUser: async () => ({ id: 'u-sazba', email: 'nikdo@example.com', name: 'Nikdo' }),
}));
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: async () => ({}) };
});
vi.mock('@/lib/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notifications')>('@/lib/notifications');
  return {
    ...actual,
    getNotificationPrefs: async (): Promise<Prefs> =>
      ({
        userId: 'u-sazba',
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
      }) as Prefs,
  };
});
// obsah vysvětlivky se vykreslí až po otevření — test ho chce vidět hned
vi.mock('@/components/ui/info-popover', () => ({
  InfoPopover: ({ children }: { children: ReactNode }) => createElement('div', null, children),
}));

const NOWRAP = /<span class="whitespace-nowrap">([^<]*)<\/span>/g;

/** Výskyty „e-mail“ ve viditelném textu, které nedrží pohromadě žádný obal. */
function unprotectedEmails(html: string): string[] {
  const text = html
    .replace(NOWRAP, '')
    // text uvnitř značek (atributy `aria-label`, `title`) se neláme
    .replace(/<[^>]+>/g, '\n');
  return [...text.matchAll(/[^\n]*[eE]-mail[^\n]*/g)].map((match) => match[0].trim());
}

/** Slova, která obal drží. */
const protectedWords = (html: string): string[] =>
  [...html.matchAll(NOWRAP)].map((match) => match[1]!);

describe('„e-mail“ v textech aplikace drží pohromadě', () => {
  it('hláška po akci', () => {
    const html = renderToStaticMarkup(
      createElement(Toast, {
        kind: 'ok',
        floating: true,
        text: 'Uloženo. E-maily se řídí novým nastavením.',
      }),
    );
    expect(protectedWords(html)).toEqual(['E-maily']);
    expect(unprotectedEmails(html)).toEqual([]);
    // znění zůstává obyčejné: spojovník jde najít i zkopírovat
    expect(html.replace(/<[^>]+>/g, '')).toContain('Uloženo. E-maily se řídí novým nastavením.');
  });

  it('chyba u pole', () => {
    const html = renderToStaticMarkup(
      createElement(FieldError, { id: 'chyba', children: 'Heslo nesedí — e-mail se nezměnil.' }),
    );
    expect(protectedWords(html)).toEqual(['e-mail']);
    expect(unprotectedEmails(html)).toEqual([]);
  });

  it('chyba u pole s odkazem uvnitř', () => {
    const html = renderToStaticMarkup(
      createElement(FieldError, {
        id: 'chyba',
        children: [
          'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.',
          ' ',
          createElement('a', { key: 'odkaz', href: '/zapomenute-heslo' }, 'Poslat odkaz e-mailem'),
        ],
      }),
    );
    expect(protectedWords(html)).toEqual(['e-mail', 'e-mailem']);
    expect(html).toContain('href="/zapomenute-heslo"');
  });

  it('titulek a věta stránky s formulářem', () => {
    const html = renderToStaticMarkup(
      createElement(FormPage, {
        title: 'Potvrď svůj e-mail',
        lede: createElement(
          'span',
          null,
          'Tahle instance nemá nastavené odesílání e-mailů, takže odkaz neodešel.',
        ),
        children: null,
      }),
    );
    expect(protectedWords(html)).toEqual(['e-mail', 'e-mailů']);
    expect(unprotectedEmails(html)).toEqual([]);
  });

  it('text bez „e-mailu“ žádný obal nedostane', () => {
    const html = renderToStaticMarkup(
      createElement(Toast, { kind: 'chyba', text: 'Nové heslo musí mít aspoň 10 znaků.' }),
    );
    expect(html).not.toContain('whitespace-nowrap');
  });

  it('Nastavení → Upozornění: popisky i vysvětlivky', { timeout: 30_000 }, async () => {
    const { default: NotificationSettingsPage } =
      await import('@/app/(app)/nastaveni/upozorneni/page');
    const html = renderToStaticMarkup(
      await NotificationSettingsPage(),
    );
    // stránka o e-mailech mluví na víc místech — kdyby test nic nenašel, nehlídá nic
    expect(protectedWords(html).length).toBeGreaterThanOrEqual(5);
    expect(unprotectedEmails(html)).toEqual([]);
  });
});
