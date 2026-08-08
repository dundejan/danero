import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WaitlistForm } from '@/components/waitlist-form';
import { OPERATOR } from '@/lib/contact';

/**
 * Čekací listina sbírá e-mail na základě souhlasu (§ 7 odst. 2 zákona
 * 480/2004 Sb.), takže u formuláře musí být to, co čl. 13 GDPR žádá: kdo je
 * správce, kde jsou celé zásady a jak se souhlas odvolá (čl. 7 odst. 3).
 * Registrace to má od nálezu B-1, waitlist do 7. 8. 2026 neměl nic — nález E-35.
 *
 * Testuje se podstata tvrzení, ne jeho formulace: odkaz, identifikace správce
 * a kontakt na odvolání. Text kolem nich se smí přepsat kdykoli.
 */
describe('čekací listina — informační povinnost u souhlasu (E-35)', () => {
  const html = renderToStaticMarkup(createElement(WaitlistForm));

  it('vede na zásady ochrany soukromí', () => {
    expect(html).toContain('href="/soukromi"');
  });

  it('jmenuje správce údajů', () => {
    expect(html).toContain(OPERATOR.name);
    expect(html).toContain(OPERATOR.ico);
  });

  it('nabízí odvolání souhlasu a kontakt, kam ho poslat', () => {
    expect(html).toMatch(/odvolat/);
    expect(html).toContain(`mailto:${OPERATOR.email}`);
  });
});
