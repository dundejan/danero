import { describe, expect, it } from 'vitest';
import {
  digestEmail,
  summaryBody,
  syncFailureCandidates,
  type DigestEntry,
  type SummaryContent,
} from '@/lib/notifications';

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

/** Textová verze láme řádky — věty se porovnávají bez zalomení. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

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

describe('časové testy jednoho titulu se v e-mailu slijí (pravidelné nákupy)', () => {
  const tt = (lead: string, isin: string, date: string, title: string, urgent = false): DigestEntry => ({
    type: lead === 'done' ? 'TIME_TEST_DONE' : `TIME_TEST_${lead}`,
    dedupeKey: `tt${lead}|${isin}|${date}`,
    title,
    body: `Jednotlivě: ${title}.`,
    urgent,
  });

  it('pět nákupů téhož ETF je jedna položka s rozpětím dat, jiný titul zůstane zvlášť', () => {
    const message = digestEmail({
      entries: [
        tt('7', 'IE0000000001', '2026-08-11', 'Meridian ETF: osvobození už za 5 dní', true),
        tt('30', 'IE0000000001', '2026-08-09', 'Meridian ETF: osvobození za 3 dny'),
        tt('30', 'IE0000000001', '2026-08-15', 'Meridian ETF: osvobození za 9 dní'),
        tt('30', 'IE0000000001', '2026-08-12', 'Meridian ETF: osvobození za 6 dní'),
        tt('30', 'IE0000000001', '2026-08-10', 'Meridian ETF: osvobození za 4 dny'),
        tt('30', 'US0000000002', '2026-08-20', 'Nordwind Corp: osvobození za 14 dní'),
      ],
      weekly: true,
      ...URLS,
    });
    expect(flat(message.text)).toContain('Meridian ETF: blíží se osvobození 5 nákupů');
    expect(flat(message.text)).toContain('5 nákupů Meridian ETF splní časový test postupně mezi 9. 8. 2026 a 15. 8. 2026');
    expect(flat(message.text)).not.toContain('Jednotlivě: Meridian');
    // naléhavost jednoho nákupu nese celá položka
    expect(flat(message.text)).toContain('(naléhavé) Meridian ETF: blíží se osvobození');
    expect(flat(message.text)).toContain('Jednotlivě: Nordwind Corp');
    // předmět počítá položky, které e-mail ukazuje
    expect(message.subject).toBe('Danero: souhrn upozornění za týden');
    const daily = digestEmail({
      entries: [
        tt('30', 'IE0000000001', '2026-08-09', 'Meridian ETF: osvobození za 3 dny'),
        tt('30', 'IE0000000001', '2026-08-10', 'Meridian ETF: osvobození za 4 dny'),
      ],
      weekly: false,
      ...URLS,
    });
    expect(daily.subject).toBe('Danero: Meridian ETF: blíží se osvobození 2 nákupů');
  });

  it('dvě lhůty téhož nákupu jsou jeden nákup, ne dva', () => {
    const message = digestEmail({
      entries: [
        tt('7', 'IE0000000001', '2026-11-20', 'Meridian ETF: osvobození už za 7 dní', true),
        tt('1', 'IE0000000001', '2026-11-20', 'Meridian ETF: osvobození už za 1 den', true),
      ],
      weekly: true,
      ...URLS,
    });
    expect(flat(message.text)).toContain('Jednotlivě: Meridian ETF: osvobození už za 1 den');
    expect(message.text).not.toContain('2 nákup');
    expect(message.subject).toBe('Danero: Meridian ETF: osvobození už za 1 den');
  });

  it('splněné testy se slijí zvlášť a nesou výhradu o úhrnu 100 000 Kč', () => {
    const message = digestEmail({
      entries: [
        tt('done', 'IE0000000001', '2026-08-09', 'Meridian ETF: osvobozeno 🎉'),
        tt('done', 'IE0000000001', '2026-08-10', 'Meridian ETF: osvobozeno 🎉'),
        tt('7', 'IE0000000001', '2026-08-14', 'Meridian ETF: osvobození už za 4 dny', true),
      ],
      weekly: false,
      ...URLS,
    });
    expect(flat(message.text)).toContain('Meridian ETF: osvobozeno (2 nákupy) 🎉');
    expect(flat(message.text)).toContain('2 nákupy Meridian ETF splnily časový test (9. 8. 2026 až 10. 8. 2026)');
    expect(flat(message.text)).toContain('100 000 Kč');
    // nákup, kterému test teprve doběhne, zůstává jako vlastní položka
    expect(flat(message.text)).toContain('Jednotlivě: Meridian ETF: osvobození už za 4 dny');
  });
});

describe('selhávající synchronizace brokera', () => {
  const account = (overrides: Partial<Parameters<typeof syncFailureCandidates>[0]['accounts'][number]>) => ({
    id: 'acc1',
    label: 'Trading 212',
    lastSyncStatus: 'error',
    lastSyncedAt: new Date('2026-07-14T03:10:00Z'),
    lastSyncError: 'Klíč k API přestal platit — vlož nový v Importu',
    failingSince: new Date('2026-07-15T03:10:00Z'),
    ...overrides,
  });

  it('po třech dnech selhávání vznikne jedna naléhavá událost na výpadek', () => {
    const [event] = syncFailureCandidates({ accounts: [account({})], today: '2026-07-18' });
    expect(event).toMatchObject({
      type: 'SYNC_FAILING',
      dedupeKey: 'sync|acc1|2026-07-15',
      title: 'Trading 212: synchronizace nefunguje od 15. 7. 2026',
      urgent: true,
    });
    expect(flat(event!.body)).toBe(
      'Synchronizace účtu Trading 212 od 15. 7. 2026 selhává, takže výpočty nevidí nové obchody ani dividendy. Naposledy se data podařilo stáhnout 14. 7. 2026. Klíč k API přestal platit — vlož nový v Importu. Stav účtu a obnovení klíče najdeš v Importu.',
    );
    // další dny téhož výpadku dají týž klíč — upozornění přijde jednou
    expect(syncFailureCandidates({ accounts: [account({})], today: '2026-07-25' })[0]!.dedupeKey).toBe(
      'sync|acc1|2026-07-15',
    );
  });

  it('krátký výpadek, fungující účet a neznámý začátek nic nezakládají', () => {
    expect(syncFailureCandidates({ accounts: [account({})], today: '2026-07-17' })).toEqual([]);
    expect(
      syncFailureCandidates({ accounts: [account({ lastSyncStatus: 'ok' })], today: '2026-07-25' }),
    ).toEqual([]);
    expect(
      syncFailureCandidates({ accounts: [account({ failingSince: null })], today: '2026-07-25' }),
    ).toEqual([]);
  });

  it('po vrácení importu (lastSyncedAt prázdné) netvrdí, že se nikdy nic nestáhlo', () => {
    const [event] = syncFailureCandidates({
      accounts: [account({ lastSyncedAt: null, lastSyncError: null })],
      today: '2026-07-18',
    });
    expect(event!.body).not.toContain('nepodařilo stáhnout žádná');
    expect(event!.body).not.toContain('Naposledy');
  });

  it('den začátku je v pražském čase, ne v UTC', () => {
    // 23:30 UTC 14. 7. = 1:30 v Praze 15. 7.
    const [event] = syncFailureCandidates({
      accounts: [account({ failingSince: new Date('2026-07-14T23:30:00Z') })],
      today: '2026-07-18',
    });
    expect(event!.dedupeKey).toBe('sync|acc1|2026-07-15');
  });
});
