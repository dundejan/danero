import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hostovaný Checkout je jediná obrazovka nákupu, kterou nekreslíme sami:
 * vzhled (ikona, logo, barvy) se bere ze značky nastavené ve Stripe, ale řeč
 * je pořád naše. Bez věty nad tlačítkem se z české objednávky stane anonymní
 * platební formulář — a člověk, který právě posílá 990 Kč, nemá kde vyčíst,
 * co se stane vzápětí.
 *
 * Test hlídá mechanismus i jazyk: obě placené cesty musí posílat `custom_text`
 * a věta musí být česky (diakritika), ne anglický zbytek po copy-paste.
 */
const ZDROJ = readFileSync(
  join(import.meta.dirname, '..', 'app', '(app)', 'predplatne', 'actions.ts'),
  'utf8',
);

describe('vzhled a řeč Checkoutu', () => {
  it('checkout posílá vlastní větu nad tlačítkem Zaplatit', () => {
    expect(ZDROJ).toMatch(/^\s*custom_text: \{ submit: \{ message: params\.submitMessage \} \},$/m);
  });

  it('obě placené cesty (hlídání i podklady) tu větu vyplňují česky', () => {
    const vety = [...ZDROJ.matchAll(/submitMessage:\s*(?:\n\s*)?[`'](.+?)[`'],?\n/gs)].map(
      (shoda) => shoda[1]!,
    );
    expect(vety).toHaveLength(2);
    for (const veta of vety) {
      expect(veta).toMatch(/[ěščřžýáíéůúň]/);
      expect(veta).toContain('e-mailem');
    }
  });

  it('měna zůstává česká — přepočet do měny návštěvníka by rozešel cenu s ceníkem', () => {
    expect(ZDROJ).toContain('adaptive_pricing: { enabled: false }');
    expect(ZDROJ).toContain("locale: 'cs'");
  });
});
