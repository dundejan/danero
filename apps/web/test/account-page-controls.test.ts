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
/** Formuláře stránky s chybou u pole (v prohlížeči — `lib/action-result.ts`). */
const ACCOUNT_FORMS = 'app/(app)/nastaveni/ucet/account-forms.tsx';
const NAV_RAIL = 'components/nav-rail.tsx';
const SIGN_OUT_BUTTON = 'components/sign-out-button.tsx';

/**
 * L7-01 (revize 5): na telefonu se nedalo odhlásit vůbec. Redesign přidal
 * odhlášení do sheetu „Více“ a to původní na stránce účtu zůstalo — na
 * telefonu tak byla dvě (R1B-08, rozhodnuto 11. 10. 2026). Pravidlo: v každé
 * šířce okna právě jedno místo, a to u účtu ve skořápce.
 */
describe('odhlášení: v každé šířce okna právě jedno', () => {
  it('stránka účtu vlastní „Odhlásit se“ nemá', () => {
    const page = read(ACCOUNT_PAGE);
    expect(page).not.toContain('<SignOutButton');
    expect(page).not.toContain("from '@/components/sign-out-button'");
  });

  it('skořápka ho má dvakrát: v panelu od md výš a v sheetu „Více“ pod md', () => {
    const rail = read(NAV_RAIL);
    expect(rail.split('<SignOutButton').length - 1).toBe(2);

    // postranní panel (s patičkou účtu) je vidět od md výš…
    expect(rail).toMatch(/<aside className="hidden [^"]*\bmd:flex"/);
    // …a spodní lišta s tlačítkem „Více“, které sheet otevírá, jen pod md —
    // na téže hranici, jinak by mezi šířkami bylo odhlášení dvakrát, nebo vůbec
    const tabBar = rail.slice(rail.indexOf('aria-label="Hlavní navigace"', rail.indexOf('function TabBar')));
    expect(tabBar.slice(0, tabBar.indexOf('>'))).toMatch(/\bmd:hidden\b/);
    const sheet = rail.slice(rail.indexOf('<Sheet'), rail.indexOf('</Sheet>'));
    expect(sheet).toContain('<SignOutButton');
    const footer = rail.slice(rail.indexOf('export function NavRail'));
    expect(footer).toContain('<SignOutButton');
  });

  it('obě místa používají totéž tlačítko, odhlášení se nekopíruje', () => {
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
    const page = read(ACCOUNT_FORMS);
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
