import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { operatorFromEnv } from '@/lib/contact';

/**
 * Identifikace provozovatele ve veřejných právních textech (nálezy L7s-05
 * a L7s-09). Údaje jdou z prostředí (`lib/contact.ts`), takže text kolem nich
 * musí dávat smysl pro JAKOUKOLI hodnotu — cizí instance pod AGPL má jiné
 * jméno a telefon mít nemusí vůbec.
 *
 * Stránky se vykreslují doopravdy: `OPERATOR` se čte při načtení modulu, proto
 * si každý test nastaví prostředí a stránku naimportuje znovu. Smyšlené údaje
 * se berou z `vitest.config.ts` — opsané sem by je strážce identity
 * v `email-legal.test.ts` právem nahlásil.
 */
const CONFIGURED = operatorFromEnv();

// rám marketingové stránky čte přihlášení (asynchronní komponenta) — k věci nepatří
vi.mock('@/components/marketing-page', () => ({
  MarketingPage: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  PageHero: () => null,
  MarketingCta: () => null,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Vykreslená stránka jako prostý text: bez značek, entity rozbalené, mezery srovnané. */
async function pageText(
  page: '@/app/podminky/page' | '@/app/soukromi/page',
  env: Record<string, string>,
): Promise<{ html: string; text: string }> {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.resetModules();
  const { default: Page } =
    page === '@/app/podminky/page'
      ? await import('@/app/podminky/page')
      : await import('@/app/soukromi/page');
  const html = renderToStaticMarkup(createElement(Page));
  const text = html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ');
  return { html, text };
}

describe('/podminky: věta o telefonu jen s telefonem (L7s-05)', () => {
  /** Článek 8 — jinde na stránce slovo „telefon“ znamená zařízení, ne kontakt. */
  const contactArticle = (text: string): string => {
    const start = text.indexOf('8. Provozovatel a kontakt');
    const end = text.indexOf('9. Když se neshodneme');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  it('bez nastaveného telefonu o něm článek 8 nemluví vůbec', { timeout: 30_000 }, async () => {
    const { html, text } = await pageText('@/app/podminky/page', { DANERO_CONTACT_PHONE: '' });
    const article = contactArticle(text);

    expect(html).not.toContain('href="tel:');
    expect(article).not.toMatch(/telefon/i);
    // e-mail jako kontakt zůstává, i s důvodem, proč psát
    expect(article).toContain('Piš e-mailem — na zprávu odpovím a zůstane z ní stopa');
    expect(article).toContain(`Připomínky a chyby posílej na ${CONFIGURED.email}.`);
  });

  it('s telefonem vypíše číslo i radu, že e-mail je jistější', { timeout: 30_000 }, async () => {
    const phone = CONFIGURED.phone;
    expect(phone, 'vitest.config.ts má nést smyšlený telefon').not.toBeNull();
    const { html, text } = await pageText('@/app/podminky/page', {});
    const article = contactArticle(text);

    expect(html).toContain(`href="tel:${phone!.replace(/\s/g, '')}"`);
    expect(article).toContain('Piš radši e-mailem — na telefon se nedovoláš vždycky');
    expect(article).toContain(`${CONFIGURED.email}, telefon ${phone}.`);
  });
});

describe('/soukromi: jméno správce doslova, bez strojového skloňování (L7s-09)', () => {
  // tři slova s titulem, ženské jméno, název firmy a výchozí stav bez proměnné
  const names = ['Ing. Zkušební Provozovatel', 'Zkušební Provozovatelová', 'Zkušební s.r.o.', ''];

  for (const name of names) {
    const shown = name || 'nenastaveno';

    it(`„${shown}“ stojí v 1. pádě a beze změny`, { timeout: 30_000 }, async () => {
      const { text } = await pageText('@/app/soukromi/page', { DANERO_OPERATOR_NAME: name });

      expect(text).toContain(
        `správcem tvých údajů je ${shown} (IČO ${CONFIGURED.ico}, ${CONFIGURED.address}).`,
      );
      // žádné přilepené „a“ ke slovům jména ani rod napevno
      const [first] = shown.split(' ');
      expect(text).not.toContain(`${first}a `);
      expect(text).not.toContain('on je i správcem');
    });
  }
});
