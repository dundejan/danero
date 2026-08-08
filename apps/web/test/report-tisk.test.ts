import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { printedRangeNote, disposalPage } from '@/components/views/report-view';

/**
 * H-3-01: vytištěný podklad k přiznání musí říct, kolik prodejů obsahuje.
 *
 * Stránkovací lišta reportu je `print:hidden`, takže výtisk u velkého portfolia
 * vypadal kompletně, přestože nesl jen 200 řádků z 25 000 — a aplikace nad ním
 * tvrdila, že „tisk i XML obsahují všechny prodeje“. Neúplný podklad odnesený
 * na finanční úřad v domnění, že je úplný, je tichá ztráta dat na tom nejhorším
 * možném místě.
 */
describe('rozsah vytištěného podkladu (H-3-01)', () => {
  it('věta na papíře nese skutečný rozsah strany i celek', () => {
    const { totalPages, currentPage, fromRow } = disposalPage(25_000, 1);
    const veta = printedRangeNote({
      fromRow,
      onPage: 200,
      total: 25_000,
      page: currentPage,
      totalPages,
    });

    // podstata, ne formulace: musí být vidět rozsah řádků i počet stran
    expect(veta).toContain('1–200');
    expect(veta).toContain('25000');
    expect(veta).toContain('125');
  });

  it('na poslední straně sedí rozsah na zbytek řádků', () => {
    const { totalPages, currentPage, fromRow } = disposalPage(25_050, 126);
    expect(currentPage).toBe(126);
    const veta = printedRangeNote({
      fromRow,
      onPage: 50,
      total: 25_050,
      page: currentPage,
      totalPages,
    });
    expect(veta).toContain('25001–25050');
  });

  it('report tu větu vykresluje jen pro tisk a stránkovací lištu naopak skrývá', () => {
    const zdroj = readFileSync(
      join(import.meta.dirname, '..', 'components', 'views', 'report-view.tsx'),
      'utf8',
    );
    // odstavec s rozsahem musí být v tiskové větvi (`print:block`)
    const tiskovyOdstavec = zdroj
      .split('\n')
      .findIndex((radek) => radek.includes('print:block') && radek.includes('text-inkoust-tlumeny'));
    expect(tiskovyOdstavec).toBeGreaterThan(-1);
    expect(zdroj).toContain('printedRangeNote({');
    // a nesmí se vrátit tvrzení, že tisk obsahuje všechny prodeje
    expect(zdroj).not.toContain('Tisk\n                i XML pro podatelnu obsahují všechny prodeje');
  });
});
