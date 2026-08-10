import { test } from '@playwright/test';
import { auditPage } from '../e2e/a11y';
import { registerWithProfile } from '../e2e/helpers';

/**
 * Přístupnost objednávkových stránek — stejný audit jako hlavní sada
 * (`e2e/pristupnost.spec.ts`), jen tady, protože `/predplatne/hlidani`
 * a `/predplatne/podklady` existují jedině se zapnutými platbami. Jinde by se
 * jen přesměrovaly na přehled tarifů a audit by tiše měřil jinou stránku.
 *
 * Formulář, kde se platí, si to zaslouží nejvíc: kontrast ceny, popisek výběru
 * roku i souhlasu a struktura landmarků (přes `<aside>` kolem shrnutí už
 * jednou vznikl duplicitní `complementary`).
 */
test('přístupnost: objednávky hlídání i podkladů (light i dark)', async ({ page }) => {
  test.setTimeout(300_000);
  await registerWithProfile(page, { name: 'E2E A11y Platby', email: 'a11y-platby@danero.cz' });

  for (const path of ['/predplatne', '/predplatne/hlidani', '/predplatne/podklady']) {
    await auditPage(page, path);
  }
});
