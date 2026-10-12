import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EpoExportForm } from '@/components/epo-export-form';
import { SUPPLEMENTARY_FILING_TYPES } from '@/lib/epo';
import { EPO_FORM_ID, epoFieldError, isSupplementaryFiling } from '@/lib/epo-form';

/**
 * Formulář exportu XML (nálezy R4-03 a R4-07).
 *
 * R4-03: neplatná hodnota v poli ve sbalené sekci zablokovala odeslání a nic
 * se neukázalo — „Stáhnout XML“ mlčky neudělalo nic. R4-07: typ „Dodatečné“
 * měl povinné údaje ve sbalené sekci a odeslání skončilo na holé stránce se
 * stavem 400.
 *
 * Chování v prohlížeči (rozbalení sekce, fokus) hlídá průchod naživo; tady se
 * hlídá to, co jde bez prohlížeče: znění hlášek, které typy povinné pole
 * vyžadují, a že se rozhraní endpointu `/api/epo` nezměnilo.
 */
const html = renderToStaticMarkup(
  createElement(EpoExportForm, {
    year: 2025,
    dividendChoice: { defaultValue: 'GENERAL', general: 'A', separate: 'B' },
    dividendInfo: null,
    contentInfo: null,
  }),
);

describe('rozhraní formuláře exportu se nezměnilo', () => {
  it('jména polí jsou ta, která čte /api/epo', () => {
    const names = [...html.matchAll(/<(?:input|select)[^>]*\sname="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      'rok',
      'varianta',
      'typ-priznani',
      'jmeno',
      'prijmeni',
      'rodneCislo',
      'dic',
      'obec',
      'ulice',
      'cisloPopisne',
      'psc',
      'ufoCil',
      'pracUfo',
      'email',
      'datum-zjisteni',
      'posledni-dan',
      'posledni-ztrata',
    ]);
  });

  it('každé jméno pole endpoint opravdu čte', () => {
    const route = readFileSync(join(import.meta.dirname, '..', 'app', 'api', 'epo', 'route.ts'), 'utf8');
    for (const [, name] of html.matchAll(/<(?:input|select)[^>]*\sname="([^"]+)"/g)) {
      expect(route, name).toContain(`'${name}'`);
    }
  });

  it('formulář má id, přes které ho odesílá tlačítko v liště, a posílá se na /api/epo', () => {
    expect(html).toContain(`id="${EPO_FORM_ID}"`);
    const form = /<form[^>]*>/.exec(html)![0];
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/api/epo"');
  });

  it('volby typu přiznání a varianty mají hodnoty, které endpoint zná', () => {
    const values = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(values).toEqual(['GENERAL', 'SEPARATE_16A', 'B', 'O', 'D', 'E']);
  });

  it('bez zahraničních dividend volba varianty není', () => {
    const plain = renderToStaticMarkup(
      createElement(EpoExportForm, {
        year: 2025,
        dividendChoice: null,
        dividendInfo: null,
        contentInfo: null,
      }),
    );
    expect(plain).not.toContain('name="varianta"');
  });
});

describe('dodatečné přiznání vyžaduje den zjištění důvodů (R4-07)', () => {
  it('povinné je u týchž typů, u kterých ho vyžaduje generátor XML', () => {
    for (const type of ['B', 'O', 'D', 'E']) {
      expect(isSupplementaryFiling(type), type).toBe(
        (SUPPLEMENTARY_FILING_TYPES as readonly string[]).includes(type),
      );
    }
  });

  it('u řádného přiznání pole povinné není (výchozí stav formuláře)', () => {
    const field = /<input[^>]*name="datum-zjisteni"[^>]*>/.exec(html)![0];
    expect(field).not.toContain('required');
  });

  it('formulář pole označí jako povinné podle zvoleného typu', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'components', 'epo-export-form.tsx'),
      'utf8',
    );
    expect(source).toContain('required={supplementary}');
    // sekce s povinným polem se po volbě typu otevře sama
    expect(source).toMatch(/supplementary && supplementaryRef\.current\)[\s\S]{0,40}\.open = true/);
  });
});

describe('neplatné pole dostane českou hlášku (R4-03)', () => {
  const ok = { valueMissing: false, typeMismatch: false };

  it('prázdný den zjištění u dodatečného přiznání', () => {
    const message = epoFieldError('datum-zjisteni', { ...ok, valueMissing: true }, 'Fill out this field');
    expect(message).toContain('den, kdy jsi zjistil důvody');
    expect(message).not.toContain('Fill out');
  });

  it('e-mail ve špatném tvaru', () => {
    const message = epoFieldError('email', { ...ok, typeMismatch: true }, "Please include an '@'");
    expect(message).toContain('E-mail nemá správný tvar');
    // pole je volitelné — hláška to musí říct, jinak ho uživatel vyplní nesmyslem
    expect(message).toContain('nech prázdné');
  });

  it('pole bez vlastního znění převezme hlášku prohlížeče, nikdy prázdný text', () => {
    expect(epoFieldError('psc', ok, 'Neplatná hodnota')).toBe('Neplatná hodnota');
    expect(epoFieldError('psc', ok, '')).not.toBe('');
  });

  it('formulář zachytává neplatné pole v zachytávací fázi a sekci rozbalí', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'components', 'epo-export-form.tsx'),
      'utf8',
    );
    // `invalid` nebublá — posluchač na formuláři bez `true` by se nikdy nezavolal
    expect(source).toMatch(/addEventListener\('invalid', onInvalid, true\)/);
    expect(source).toMatch(/closest\('details'\)/);
    expect(source).toContain('field.focus()');
  });
});
