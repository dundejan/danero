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
      // Primitivum `Table` (components/ui/table.tsx) je jen obal nad `<table>`:
      // název mu dodává volající a `scope="col"` nese jeho `Th`. Počítají se
      // proto obě podoby značky a samotné primitivum se přeskakuje.
      if (path.endsWith(join('ui', 'table.tsx'))) continue;
      const tabulek = (source.match(/<(?:table|Table)[\s>]/g) ?? []).length;
      if (tabulek === 0) continue;
      // název tabulky: `<caption>` nebo `aria-label` — obojí čtečka ohlásí.
      // `sr-only` caption uvnitř posuvné oblasti reportu přetékal na mobilu
      // o 45 px (odchytilo E2E `pristupnost.spec.ts`), proto se tam název nese
      // atributem.
      const pojmenovanych =
        (source.match(/<caption[\s>]/g) ?? []).length +
        (source.match(/<(?:table|Table) aria-label=/g) ?? []).length;
      expect(pojmenovanych, `${path}: ${tabulek} tabulek, ${pojmenovanych} s názvem`).toBe(tabulek);

      // atributy bývají na dalších řádcích, takže se kouká na celou značku
      const hlavicky = source.match(/<th\b[^>]*>/g) ?? [];
      const bezScope = hlavicky.filter((tag) => !tag.includes('scope='));
      expect(bezScope, `${path}: hlavičky bez scope`).toEqual([]);
    }
  });

  it('hlavička primitiva Table nese scope="col" sama', () => {
    // na tom stojí výjimka výš: kdo píše `<Th>`, scope neuvádí
    const primitive = readFileSync(join(COMPONENTS, 'ui', 'table.tsx'), 'utf8');
    const hlavicky = primitive.match(/<th\b[^>]*>/g) ?? [];
    expect(hlavicky).toHaveLength(1);
    expect(hlavicky[0]).toContain('scope="col"');
  });

  /**
   * Hlavičky bez obsahu: samouzavírací značka i prázdná dvojice, nativní `<th>`
   * i primitivum `<Th>`. Po redesignu jsou všechny hlavičky `<Th>` a původní
   * výraz hledal jen malé `<th` — test tak prošel, i kdyby byla prázdná každá
   * (nález R4-05).
   */
  const prazdneHlavicky = (source: string): string[] => [
    ...(source.match(/<(?:th|Th)\b[^>]*\/>/g) ?? []),
    ...(source.match(/<(?:th|Th)\b[^>]*>\s*<\/(?:th|Th)>/g) ?? []),
  ];

  it('prázdnou hlavičku pozná v obou podobách značky', () => {
    expect(prazdneHlavicky('<Th />')).toHaveLength(1);
    expect(prazdneHlavicky('<th scope="col" />')).toHaveLength(1);
    expect(prazdneHlavicky('<Th align="right"></Th>')).toHaveLength(1);
    expect(prazdneHlavicky('<Th align="right">\n  </Th>')).toHaveLength(1);
    expect(prazdneHlavicky('<Th>Metoda</Th><Th align="right">Daň</Th>')).toHaveLength(0);
    // jiná komponenta se stejným začátkem jména hlavička není
    expect(prazdneHlavicky('<Thumb />')).toHaveLength(0);
  });

  it('žádná hlavičková buňka nezůstane prázdná', () => {
    // hlavičky jsou i ve stránkách (`app`), nejen v komponentách
    const zdroje = [
      ...soubory,
      ...tsxFiles(join(import.meta.dirname, '..', 'app')).map((path) => ({
        path,
        source: readFileSync(path, 'utf8'),
      })),
    ];
    let hlavicek = 0;
    for (const { path, source } of zdroje) {
      // primitivum obsah buňky nezná — dostává ho od volajícího přes `props`
      if (path.endsWith(join('ui', 'table.tsx'))) continue;
      hlavicek += (source.match(/<(?:th|Th)\b/g) ?? []).length;
      // prázdná hlavička smí zůstat jen s vlastním názvem pro čtečku
      for (const tag of prazdneHlavicky(source)) {
        expect(tag, `${path}: prázdná hlavička bez názvu`).toMatch(/aria-label=/);
      }
    }
    // pojistka proti testu, který nehlídá nic: hlavičky se musí vůbec najít
    expect(hlavicek).toBeGreaterThan(20);
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

/**
 * H-3-03: interní ID pravidel („R-05c") se ukazovala uživateli na deseti
 * místech, ale `/jak-pocitame` žádné R-xx neobsahuje a z přihlášené části na
 * něj nevedl jediný odkaz — tedy žargon bez vysvětlení (pravidlo 3 CLAUDE.md).
 * V UI proto zůstává česká věta a odkaz na metodiku; kódy patří do tištěného
 * podkladu, kde slouží průkaznosti výpočtu.
 */
describe('interní kódy pravidel nejsou v UI bez vysvětlení (H-3-03)', () => {
  it('žádný viditelný text v komponentách neuvádí R-xx', () => {
    for (const path of tsxFiles(COMPONENTS)) {
      const source = readFileSync(path, 'utf8');
      // komentáře (řádkové i blokové) jsou v pořádku — čte je jen vývojář
      const bezKomentaru = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const kody = bezKomentaru.match(/\bR-\d{2}[a-z]?\b/g) ?? [];
      expect(kody, `${path}: kódy pravidel ve viditelném textu`).toEqual([]);
    }
  });

  it('seznam varování odkazuje na metodiku', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'components', 'warnings-list.tsx'),
      'utf8',
    );
    expect(source).toContain('/jak-pocitame');
  });
});
