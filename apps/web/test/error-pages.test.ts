import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AppError from '@/app/(app)/error';
import DemoError from '@/app/demo/error';
import RootError from '@/app/error';
import GlobalError from '@/app/global-error';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement('a', { href, ...props }, children),
}));

/**
 * Chybové obrazovky (`error.tsx`, `global-error.tsx`) se vykreslí jen při
 * pádu, takže je při redesignu nikdo neviděl a nehlídal je žádný test ani
 * průchod přístupnosti. Tady se aspoň vykreslí všechny čtyři a hlídá se, co
 * každá musí umět: říct, co se stalo, nabídnout opakování a cestu ven —
 * a kód chyby ukázat jen tehdy, když nějaký je.
 */
type ErrorPage = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

const PAGES: Array<[string, ErrorPage, string]> = [
  ['kořenová (veřejné a přihlašovací stránky)', RootError, '/'],
  ['aplikace', AppError, '/prehled'],
  ['demo', DemoError, '/'],
  ['pád kořenového layoutu', GlobalError, '/'],
];

const render = (Page: ErrorPage, digest?: string): string =>
  renderToStaticMarkup(
    createElement(Page, {
      error: Object.assign(new Error('interní znění, které uživatel vidět nemá'), { digest }),
      reset: () => undefined,
    }),
  );

describe('chybové obrazovky', () => {
  it.each(PAGES)('%s: nadpis, opakování a cesta ven', (_, Page, wayOut) => {
    const html = render(Page);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Zkusit znovu<\/button>/);
    expect(html).toContain(`href="${wayOut}"`);
    // znění výjimky je pro log, ne pro čtenáře
    expect(html).not.toContain('interní znění');
  });

  it.each(PAGES)('%s: kód chyby jen tehdy, když ho Next dodal', (_, Page) => {
    expect(render(Page)).not.toContain('Kód chyby');
    expect(render(Page, '1234567890')).toContain('Kód chyby: 1234567890');
  });

  it('pád kořenového layoutu si nese vlastní dokument v češtině', () => {
    const html = render(GlobalError);
    expect(html).toMatch(/^<html lang="cs">/);
    expect(html).toContain('<body');
  });
});
