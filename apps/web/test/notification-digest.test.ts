import { describe, expect, it } from 'vitest';
import { digestEmail, summaryBody, type DigestEntry, type SummaryContent } from '@/lib/notifications';

/**
 * Souhrnný e-mail hlídače. Do 7. 11. 2026 odcházel jako holý text
 * s odrážkami — jediný e-mail z Danera bez HTML podoby, s událostmi v pořadí
 * vzniku a s pravidelným přehledem jako jednou dlouhou větou.
 */

const URLS = {
  baseUrl: 'https://danero.test',
  unsubscribeUrl: 'https://danero.test/api/odhlasit?token=t',
};

/** Tělo zprávy bez skrytého náhledu (preheader) nahoře. */
const bodyOf = (html: string): string => html.slice(html.indexOf('<table class="e-page"'));

const entry = (type: string, title: string, urgent = false): DigestEntry => ({
  type,
  title,
  body: `Text: ${title}.`,
  urgent,
});

const SUMMARY: SummaryContent = {
  title: 'Přehled k 1. 11. 2026',
  year: 2026,
  intro: 'Stav k 1. 11. 2026 za rok 2026.',
  meters: [
    {
      label: 'Limit paušální daně',
      usedCzk: '41 200 Kč',
      limitCzk: '50 000 Kč',
      percent: '82 %',
      ratio: 0.824,
      tone: 'normal',
    },
  ],
  next: 'Žádná pozice zatím na tříletý časový test nečeká.',
  tax: 'Orientační daň z investic zatím 0 Kč.',
};

describe('souhrnný e-mail hlídače', () => {
  it('má HTML podobu se skupinami a naléhavé události jdou ve skupině první', () => {
    const message = digestEmail({
      entries: [
        entry('TIME_TEST_30', 'Klidná pozice'),
        entry('LIMIT_WARNING', 'Za polovinou'),
        entry('TIME_TEST_7', 'Naléhavá pozice', true),
        entry('DEADLINE', 'Termín'),
      ],
      weekly: true,
      ...URLS,
    });
    expect(message.subject).toBe('Danero: souhrn upozornění za týden');
    expect(message.html).toBeDefined();
    const html = bodyOf(message.html!);
    // skupiny v pevném pořadí: limity, časový test, termíny
    const order = ['>Limity<', '>Časový test<', '>Termíny přiznání<'].map((h) => html.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html.indexOf('Naléhavá pozice')).toBeLessThan(html.indexOf('Klidná pozice'));
    expect(message.text.indexOf('(naléhavé) Naléhavá pozice')).toBeLessThan(
      message.text.indexOf('Klidná pozice'),
    );
  });

  it('jediná událost nemá nadpis skupiny a předmětem je její titulek', () => {
    const message = digestEmail({
      entries: [entry('LIMIT_EXCEEDED', 'Prolomen limit', true)],
      weekly: false,
      ...URLS,
    });
    expect(message.subject).toBe('Danero: Prolomen limit');
    expect(message.html).not.toContain('>Limity<');
  });

  it('nabízí nastavení upozornění i odhlášení, v textu i v HTML', () => {
    const message = digestEmail({ entries: [entry('LIMIT_WARNING', 'A')], weekly: false, ...URLS });
    for (const url of [`${URLS.baseUrl}/nastaveni/upozorneni`, URLS.unsubscribeUrl, `${URLS.baseUrl}/prehled`]) {
      expect(message.text).toContain(url);
      expect(message.html).toContain(url);
    }
    expect(message.text).toContain('nikoli daňové poradenství');
  });

  it('dnešní přehled má měřáky a rok; přehled, který čekal, odejde ze svého textu', () => {
    const message = digestEmail({
      entries: [
        entry('SUMMARY', 'Přehled k 1. 10. 2026'),
        entry('SUMMARY', 'Přehled k 1. 11. 2026'),
        entry('LIMIT_WARNING', 'Za polovinou'),
      ],
      weekly: true,
      summary: SUMMARY,
      ...URLS,
    });
    const html = bodyOf(message.html!);
    // dnešní přehled s měřáky právě jednou (v HTML s pevnými mezerami)
    expect(html.split('Přehled k\u00a01.\u00a011.\u00a02026').length - 1).toBe(1);
    expect(html).toContain('height:6px');
    expect(message.text).toContain('Čerpání ročních limitů za rok 2026.');
    expect(message.text).toContain('Limit paušální daně: 41 200 Kč z 50 000 Kč (82 %)');
    // starší přehled se nepřepisuje na dnešní stav — jde ze svého textu
    expect(message.text).toContain('Text: Přehled k 1. 10. 2026.');
  });

  it('naléhavost je v HTML i slovem (čtečka, Outlook), ne jen barevnou tečkou', () => {
    const message = digestEmail({
      entries: [entry('LIMIT_EXCEEDED', 'Prolomen', true), entry('LIMIT_WARNING', 'Půlka')],
      weekly: false,
      ...URLS,
    });
    expect(bodyOf(message.html!)).toContain('>Naléhavé<');
    expect(message.text).toContain('(naléhavé) Prolomen');
  });

  it('dlouhý seznam se zkrátí s odkazem do aplikace, ať Gmail neusekne patičku', () => {
    const many = Array.from({ length: 40 }, (_, i) => entry('TIME_TEST_30', `Pozice ${i}`));
    const message = digestEmail({ entries: many, weekly: true, ...URLS });
    expect(message.text).toContain('Pozice 14');
    expect(message.text).not.toContain('Pozice 15');
    expect(message.text).toContain('A dalších 25 upozornění');
    expect(message.text).toContain(URLS.unsubscribeUrl);
  });

  it('zkrácený náhled nerozsekne emoji', () => {
    const titles = Array.from({ length: 12 }, (_, i) => entry('TIME_TEST_DONE', `Titul číslo ${i}: osvobozeno 🎉`));
    const preheader = /<div style="display:none[^>]*>([^<]*)<\/div>/.exec(
      digestEmail({ entries: titles, weekly: false, ...URLS }).html!,
    )![1]!;
    expect(preheader).not.toMatch(/[\uD800-\uDFFF](?![\uDC00-\uDFFF])/u);
    expect(preheader).not.toContain('\uFFFD');
  });

  it('bez spočítaného přehledu ho vypíše z uloženého textu', () => {
    const message = digestEmail({
      entries: [entry('SUMMARY', 'Přehled k 1. 11. 2026')],
      weekly: false,
      ...URLS,
    });
    expect(message.text).toContain('Text: Přehled k 1. 11. 2026.');
    expect(message.html).not.toContain('height:6px');
  });

  it('titulek z dat se v HTML escapuje', () => {
    const message = digestEmail({ entries: [entry('LIMIT_WARNING', '<b>X</b> & Y')], weekly: false, ...URLS });
    expect(message.html).toContain('&lt;b&gt;X&lt;/b&gt; &amp; Y');
    expect(message.html).not.toContain('<b>X</b>');
  });

  it('text přehledu zůstává stejný jako před rozdělením na části', () => {
    expect(summaryBody(SUMMARY)).toBe(
      'Stav k 1. 11. 2026 za rok 2026. Limit paušální daně: 41 200 Kč z 50 000 Kč (82 %). Žádná pozice zatím na tříletý časový test nečeká. Orientační daň z investic zatím 0 Kč.',
    );
  });
});
