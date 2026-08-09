import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * H-3-07: sedm tabulek v aplikaci nemělo `<caption>` ani `scope="col"` —
 * report-view pět tabulek / 0 caption / 31 `<th>` / 0 scope, position-view
 * a portfolio-view po jedné. Čtečka pak u každé buňky neví, do jakého sloupce
 * patří ani co je to za tabulku; nejhorší byla tabulka variant párování, kde
 * poslední `<th>` byl úplně prázdný.
 *
 * Test hlídá mechanismus, ne konkrétní znění: každá `<table>` v komponentách
 * musí mít popis a každá hlavičková buňka vazbu na sloupec.
 */
const COMPONENTS = join(import.meta.dirname, '..', 'components');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

describe('tabulky jsou čitelné čtečkou (H-3-07)', () => {
  const soubory = tsxFiles(COMPONENTS).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

  it('každá tabulka má caption a každá hlavička scope="col"', () => {
    for (const { path, source } of soubory) {
      const tabulek = (source.match(/<table[\s>]/g) ?? []).length;
      if (tabulek === 0) continue;
      // název tabulky: `<caption>` nebo `aria-label` — obojí čtečka ohlásí.
      // `sr-only` caption uvnitř posuvné oblasti reportu přetékal na mobilu
      // o 45 px (odchytilo E2E `pristupnost.spec.ts`), proto se tam název nese
      // atributem.
      const pojmenovanych =
        (source.match(/<caption[\s>]/g) ?? []).length +
        (source.match(/<table aria-label=/g) ?? []).length;
      expect(pojmenovanych, `${path}: ${tabulek} tabulek, ${pojmenovanych} s názvem`).toBe(tabulek);

      // atributy bývají na dalších řádcích, takže se kouká na celou značku
      const hlavicky = source.match(/<th\b[^>]*>/g) ?? [];
      const bezScope = hlavicky.filter((tag) => !tag.includes('scope='));
      expect(bezScope, `${path}: hlavičky bez scope`).toEqual([]);
    }
  });

  it('žádná hlavičková buňka nezůstane prázdná', () => {
    for (const { path, source } of soubory) {
      // prázdná hlavička smí zůstat jen s vlastním názvem pro čtečku
      for (const tag of source.match(/<th\b[^>]*\/>/g) ?? []) {
        expect(tag, `${path}: prázdný <th> bez názvu`).toMatch(/aria-label=/);
      }
    }
  });
});

/**
 * H-3-06 / H-3-18 / H-3-22: plovoucí toast (`bottom-4 z-50`) překrýval mobilní
 * tab bar — 24 ze 40 px včetně popisků navigace — a chybový toast se sám nikdy
 * neschoval, takže jediná cesta ven byl křížek o velikosti 8 × 20 px (SC 2.5.8
 * chce 24 × 24). Tab bar zároveň nerezervoval `env(safe-area-inset-bottom)`,
 * takže popisky ležely uvnitř gesta home indicatoru.
 */
describe('mobilní spodní pruh a toast si nelezou do zelí (H-3-06, H-3-18)', () => {
  const read = (relativni: string): string =>
    readFileSync(join(import.meta.dirname, '..', relativni), 'utf8');

  it('toast sedí nad tab barem a schová se sám i při chybě', () => {
    const toast = read('components/toast.tsx');
    expect(toast).toContain('safe-area-inset-bottom');
    expect(toast).not.toMatch(/fixed bottom-4 right-4 z-50/);
    // časovač neplatí jen pro 'ok' — chybový toast musí taky zmizet
    expect(toast).not.toMatch(/if \(kind !== 'ok'\) return;/);
    // zavírací tlačítko má cíl aspoň 24 × 24 px (h-6 w-6)
    expect(toast).toMatch(/h-6 w-6/);
  });

  it('tab bar rezervuje bezpečnou zónu gesta', () => {
    expect(read('components/nav-rail.tsx')).toContain('safe-area-inset-bottom');
  });
});
