import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážce nad zdrojem stránky Nastavení → Účet a nad sdíleným odhlášením.
 *
 * Obě vady, které hlídá, se projeví jen na telefonu, a E2E sada běží na
 * desktopové šířce — proto je před revizí 5 nic nechytilo. Vykreslit stránku
 * v unit testu nejde (serverová komponenta nad relací a databází), takže se
 * čte zdroják, stejně jako u vrácení importu (`import-vraceni.test.ts`).
 */
const WEB_ROOT = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(resolve(WEB_ROOT, path), 'utf8');

const ACCOUNT_PAGE = 'app/(app)/nastaveni/ucet/page.tsx';
const NAV_RAIL = 'components/nav-rail.tsx';
const SIGN_OUT_BUTTON = 'components/sign-out-button.tsx';

/** Otevírací značka prvku, který bezprostředně obaluje místo `index`. */
function enclosingOpeningTag(source: string, index: number): string {
  const start = source.lastIndexOf('<div', index);
  return source.slice(start, source.indexOf('>', start) + 1);
}

describe('L7-01: odhlášení je dosažitelné i na telefonu', () => {
  it('stránka účtu nabízí „Odhlásit se“ v sekci přihlášených zařízení', () => {
    const page = read(ACCOUNT_PAGE);
    expect(page).toContain("from '@/components/sign-out-button'");
    const button = page.indexOf('<SignOutButton');
    expect(button).toBeGreaterThan(-1);
    // mezi kartou zařízení a kartou vzhledu, ne někde nahoře u hesla
    expect(button).toBeGreaterThan(page.indexOf('id="aktivita"'));
    expect(button).toBeLessThan(page.indexOf('id="vzhled"'));
    // právě jednou — dvě tlačítka na jedné stránce by nedávala smysl
    expect(page.split('<SignOutButton').length - 1).toBe(1);
  });

  it('tlačítko na stránce účtu je vidět jen pod md, kde chybí rail', () => {
    const page = read(ACCOUNT_PAGE);
    const wrapper = enclosingOpeningTag(page, page.indexOf('<SignOutButton'));
    // Na desktopu má odhlášení rail. Druhé viditelné tlačítko téhož jména by
    // shodilo E2E, které na /nastaveni/ucet kliká na „Odhlásit se“ ve strict
    // režimu (ucet.spec.ts, dvoufaktor.spec.ts).
    expect(wrapper).toContain('md:hidden');
    // a rail se na téže hranici opravdu objevuje — jinak by mezi šířkami
    // vznikla díra, kde není vidět ani jedno
    expect(read(NAV_RAIL)).toMatch(/<aside className="hidden [^"]*\bmd:flex"/);
  });

  it('rail i stránka účtu používají totéž tlačítko, odhlášení se nekopíruje', () => {
    const rail = read(NAV_RAIL);
    expect(rail).toContain("from '@/components/sign-out-button'");
    expect(rail).toContain('<SignOutButton');
    // rail sám klienta Better Auth nevolá — ošetření neúspěchu (L12-04) žije
    // na jednom místě a platí pro obě tlačítka
    expect(rail).not.toContain('authClient');

    const shared = read(SIGN_OUT_BUTTON);
    expect(shared).toContain('attemptSignOut(() => authClient.signOut())');
    expect(shared).toContain('Odhlásit se');
    // neúspěšné odhlášení se musí ohlásit hned u tlačítka
    expect(shared).toContain('role="alert"');
  });
});

describe('L7-06: potvrzení smazání účtu na telefonu', () => {
  it('pole „Napiš SMAZAT“ si říká o velká písmena', () => {
    const page = read(ACCOUNT_PAGE);
    const id = page.indexOf('id="potvrzeni"');
    expect(id).toBeGreaterThan(-1);
    // celá značka pole, ať test nezávisí na tom, kolik řádků zabírá
    const start = page.lastIndexOf('<Input', id);
    const input = page.slice(start, page.indexOf('/>', start));
    expect(input).toContain('name="potvrzeni"');
    // bez toho iOS napíše „Smazat“ a první pokus o smazání skončí hláškou
    expect(input).toContain('autoCapitalize="characters"');
  });
});
