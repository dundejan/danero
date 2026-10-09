import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * Pravidlo 1 z CLAUDE.md: identifikátory anglicky bez výjimky, česky jen to,
 * co čte člověk. Do `scripts/stripe-webhook.mjs` se přesto dostaly `KLIC`,
 * `rezim`, `cesta`, `telo`, `endpointy`, `ocekavane`, `vseSedi`, `chybi`
 * a `navic`; `validate-epo.mjs` mělo `prazdny`, `tuzemsky`, `ztrata`,
 * `smisene` nebo `drobnaDan`. Skripty jsou mimo `pnpm lint` typových pravidel,
 * takže je nechytilo nic — proto tenhle strážce.
 *
 * Do revize 5 četl jen kořenový `scripts/*.mjs`, tedy jediný soubor. Nález
 * L12-09 pak našel desítky českých deklarací v `apps/web/lib`, komponentách
 * i importerech (`velikost`, `BARVY`, `castka`, `chybi`…) — strážce je nemohl
 * vidět, protože ty soubory vůbec neotevřel. Proto dnes prochází celý
 * produkční kód: `lib`, `components`, `app` a `scripts` webu, `src` každého
 * balíčku a kořenové `scripts/`.
 *
 * Hlídají se DEKLARACE, ne výskyty: české texty ve výpisech pro člověka
 * (`console.log`), hodnoty `name` atributů i klíče objektových literálů tam
 * patřit mají a zůstávají. Deklarace se čtou z AST TypeScriptu (proměnné,
 * funkce, parametry, typy, vlastnosti typů a tříd), ne regulárním výrazem —
 * ten by si české slovo v řetězci spletl s názvem.
 *
 * Název se rozloží na slova (`poslednZtrata` → `posledn`, `ztrata`;
 * `HRANICE_38B` → `hranice`, `b`) a každé slovo se porovná se dvěma seznamy.
 */

/** Kmeny: slovo jimi ZAČÍNÁ (`castk` chytí `castka`, `castky` i `castkou`). */
const CZECH_STEMS = [
  // původní seznam ze skriptů
  'rezim',
  'endpointy',
  'ocekavan',
  'chyb',
  'navic',
  'prazdn',
  'tuzemsk',
  'ztrat',
  'smisen',
  'drobn',
  'srazk',
  'pocet',
  'nalez',
  'soubor',
  'zprav',
  'vysled',
  'udaj',
  'castk',
  'hodnot',
  'radek',
  'radk',
  'sloup',
  'prepinac',
  'skript',
  'seznam',
  'nazev',
  'nazv',
  'jmen',
  'hesl',
  // L12-09: názvy, které našel sken hledače a AST ověřovatele
  'hranic',
  'prijm',
  'prijem',
  'vydaj',
  'vydej',
  'posledn',
  'neznam',
  'zapocet',
  'celkem',
  'popis',
  'dodatecn',
  'zahranicn',
  'zdroj',
  'rozdil',
  'barv',
  'pismo',
  'sirk',
  'unikatn',
  'odhlas',
  'prihlas',
  'odkaz',
  'dostupn',
  'mesic',
  'krypto',
  'drzen',
  'osvobozen',
  'duvod',
  'korporatn',
  'velikost',
  'strop',
  // další české deklarace, které rozšířený sken našel v témže rozsahu
  'zasad',
  'pravidl',
  'clanek',
  'clank',
  'stitek',
  'stitk',
  'useknut',
  'zdaniteln',
  'cteni',
  'zapis',
  'varianta',
  'varianty',
  'zjist',
  'patick',
  'zalom',
  'znack',
  'situac',
  'volba',
  'volby',
  'davka',
  'davky',
  'brezen',
  'leden',
  'unor',
  'oznamen',
  'zbytek',
  'zaokrouhl',
  'ridic',
  'poplatn',
  'sleva',
  'slevy',
  'ulice',
  'obec',
  // obecná česká slova, která se do kódu vkrádají nejčastěji
  'uzivatel',
  'polozk',
  'zaklad',
  'soucet',
  'priznan',
  'podklad',
  'vypis',
  'zaloh',
  'platb',
  'obdobi',
  'strank',
  'tlacitk',
  'formular',
  'overen',
  'nastaven',
  'upozornen',
  'vzhled',
  'nadpis',
  'obsah',
  'otazk',
  'odpoved',
  'pruvodc',
  'cenik',
  'podmink',
  'soukrom',
  'provozovatel',
  'predchoz',
  'poplat',
  'smlouv',
  'nakup',
  'prodej',
  'prehled',
  'kalkulack',
  'bezpecnost',
  'investic',
  'smazan',
  'ulozen',
  'udrzb',
];

/**
 * Celá slova: krátká nebo taková, jimiž začíná i anglické slovo (`dan` ×
 * `danger`, `stat` × `status`, `typ` × `type`), takže jako kmen by střílela
 * vedle.
 */
const CZECH_WORDS = [
  'klic',
  'klice',
  'cesta',
  'cesty',
  'telo',
  'vse',
  'akce',
  'cena',
  'ceny',
  'cil',
  'cile',
  'dan',
  'dane',
  'den',
  'dne',
  'dny',
  'druh',
  'druhy',
  'kod',
  'kody',
  'kus',
  'kusy',
  'mena',
  'meny',
  'rok',
  'roky',
  'smer',
  'tvar',
  'typ',
  'typy',
  'veta',
  'vety',
  'styl',
  'znak',
  'znaku',
  'znaky',
  'slib',
  'slovo',
  'slova',
  'casti',
  'cislo',
  'cisla',
  'staty',
  'statu',
  'zeme',
  'zemi',
  'stav',
  'ucet',
  'ucty',
  'zisk',
  'kurz',
  'kurzy',
  'urok',
  'uroku',
  'uroky',
  'novy',
  'nove',
  'stary',
  'stare',
  'prvni',
  'dalsi',
  'konec',
  'hotovo',
  'strana',
  'znama',
  'zname',
  'pocitame',
  'caste',
  'projektu',
  'platformy',
];

/**
 * Záměrně se NEHLÍDAJÍ vlastní jména a pojmy bez anglického protějšku, které
 * kód používá jako termín: `epo`, `dap`, `podatelna` (Elektronická podatelna
 * finanční správy), `priloha2`/`priloha3` (pojmenované přílohy formuláře)
 * a `pausal` (paušální režim, takhle ho jmenuje i engine a sdílený model).
 */

const URL_PARAM = 'parametr URL — adresy stránek jsou česky a proměnná nese jeho jméno';
const FORM_FIELD = 'jméno pole formuláře (`name` atribut) — to uživatel vidí, proto česky';

/**
 * Oprávněné české názvy. Výjimka je vždy na konkrétní soubor a název a má
 * důvod — kmen se kvůli ní ze seznamu nevyřazuje, jinak by strážce přestal
 * tentýž název hlídat všude jinde.
 */
const ALLOWED: { file: string; names: string[]; reason: string }[] = [
  { file: 'apps/web/app/(app)/import/page.tsx', names: ['chyba', 'ulozeno'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/nastaveni/page.tsx', names: ['chyba'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/nastaveni/ucet/page.tsx', names: ['chyba'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/nastaveni/upozorneni/page.tsx', names: ['chyba'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/nastaveni/settings-toast.tsx', names: ['chyba'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/portfolio/page.tsx', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/prehled/page.tsx', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/app/(app)/report/page.tsx', names: ['rok', 'strana'], reason: URL_PARAM },
  { file: 'apps/web/app/demo/portfolio/page.tsx', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/app/demo/prehled/page.tsx', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/app/demo/report/page.tsx', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/app/page.tsx', names: ['smazano'], reason: URL_PARAM },
  { file: 'apps/web/lib/utils.ts', names: ['rok'], reason: URL_PARAM },
  { file: 'apps/web/components/views/report-view.tsx', names: ['strana'], reason: URL_PARAM },
  {
    file: 'apps/web/components/views/simulator-view.tsx',
    names: ['kusy', 'cena'],
    reason: `${FORM_FIELD}; formulář se odesílá metodou GET, takže jsou to zároveň parametry URL`,
  },
  { file: 'apps/web/components/new-password-form.tsx', names: ['heslo'], reason: FORM_FIELD },
  { file: 'apps/web/app/api/epo/route.ts', names: ['varianta', 'variantaRaw'], reason: FORM_FIELD },
  {
    file: 'apps/web/lib/epo-submission.ts',
    names: ['Polozka', 'Typ', 'Zkr'],
    reason: 'atributy XML odpovědi podatelny finanční správy — názvy určuje cizí schéma',
  },
];

/**
 * DOČASNÉ: dávky revize 5, které tyhle soubory teprve přejmenovávají
 * (L12-09). Až dávka do větve dojde, její řádek smaž — strážce pak vypíše,
 * co v souborech zbylo, a to buď přejmenuj, nebo zapiš s důvodem výš.
 */
const PENDING_BATCHES: Record<string, string[]> = {
  B19: ['packages/importers/src/etoro/xlsx.ts'],
  B22: [
    'apps/web/lib/epo.ts',
    'apps/web/lib/priloha2.ts',
    'apps/web/components/views/report-view.tsx',
  ],
  B25: ['packages/importers/src/fio/csv.ts'],
  B27: [
    'apps/web/lib/email-layout.ts',
    'apps/web/lib/email.ts',
    'apps/web/lib/prices.ts',
    'apps/web/lib/notifications.ts',
    'apps/web/lib/demo-data.ts',
    'apps/web/components/filing-calculator.tsx',
    'apps/web/components/guide-article.tsx',
    'apps/web/components/views/position-view.tsx',
    'apps/web/app/(app)/nastaveni/settings-toast.tsx',
    'apps/web/scripts/failed-imports.ts',
  ],
};

/**
 * DLUH: české deklarace, které rozšířený strážce našel navíc a žádná dávka
 * revize 5 je nepřejmenovává. Nejsou oprávněné — seznam jen drží stav, aby
 * nepřibývaly další. Po přejmenování řádek smaž; nové sem nepřidávej.
 */
const KNOWN_DEBT: Record<string, string[]> = {
  'apps/web/app/(app)/nastaveni/actions.ts': ['kod'],
  'apps/web/app/api/epo/route.ts': [
    'DAP_TYPY',
    'chyba',
    'dapTyp',
    'dodatecne',
    'typRaw',
    'zjistenoDne',
  ],
  'apps/web/app/bezpecnost/page.tsx': ['ZASADY', 'zasada'],
  'apps/web/app/jak-pocitame/page.tsx': ['PRAVIDLA', 'pravidlo', 'zdroj'],
  'apps/web/app/kalkulacka/page.tsx': ['PRAVIDLA', 'pravidlo'],
  'apps/web/app/pruvodce/page.tsx': ['CLANKY', 'clanek', 'popis', 'stitek'],
  'apps/web/components/views/overview-view.tsx': ['PrehledNotification'],
  'apps/web/lib/import-service.ts': ['useknuty'],
  'packages/engine/src/engine.ts': ['podStropem'],
  'packages/engine/src/ledger/ledger.ts': ['cteni', 'nazev', 'zapis', 'zdanitelne'],
  'packages/importers/src/portu/csv.ts': ['typ', 'typRaw'],
  'scripts/validate-epo.mjs': ['varianta'],
};

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const SCAN_ROOTS = [
  'apps/web/lib',
  'apps/web/components',
  'apps/web/app',
  'apps/web/scripts',
  'scripts',
  ...readdirSync(join(REPO_ROOT, 'packages')).map((name) => `packages/${name}/src`),
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(relative(REPO_ROOT, full).split(sep).join('/'));
    }
  }
  return out;
}

interface Declaration {
  name: string;
  line: number;
}

function declarations(file: string): Declaration[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(REPO_ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Declaration[] = [];
  const add = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      found.push({
        name: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    } else if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
      for (const element of node.elements) if (ts.isBindingElement(element)) add(element.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isEnumMember(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node)
    ) {
      add(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** `poslednZtrata` → `posledn`, `ztrata`; `HRANICE_38B` → `hranice`, `b`. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_$0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isCzechWord(word: string): boolean {
  return CZECH_WORDS.includes(word) || CZECH_STEMS.some((stem) => word.startsWith(stem));
}

/**
 * Stránka se jmenuje podle své adresy a adresy jsou česky (pravidlo 1):
 * `app/cenik/page.tsx` proto smí mít `CenikPage` i `CENIK_FAQ`. Povolená jsou
 * jen slova z cesty toho souboru, ne čeština obecně.
 */
function routeWords(file: string): Set<string> {
  if (!file.startsWith('apps/web/app/')) return new Set();
  const segments = file.slice('apps/web/app/'.length).split('/').slice(0, -1);
  return new Set(
    segments.flatMap((segment) => segment.toLowerCase().split(/[^a-z]+/)).filter(Boolean),
  );
}

function czechDeclarations(file: string): string[] {
  const fromRoute = routeWords(file);
  const allowed = new Set([
    ...ALLOWED.filter((entry) => entry.file === file).flatMap((entry) => entry.names),
    ...(KNOWN_DEBT[file] ?? []),
  ]);
  const hits = new Set<string>();
  for (const { name, line } of declarations(file)) {
    // Diakritika v identifikátoru je vždycky chyba — JS ji technicky povolí.
    if (/[^\x20-\x7E]/.test(name)) hits.add(`${name} (řádek ${line})`);
    if (allowed.has(name)) continue;
    if (wordsOf(name).some((word) => !fromRoute.has(word) && isCzechWord(word))) {
      hits.add(`${name} (řádek ${line})`);
    }
  }
  return [...hits];
}

describe('identifikátory anglicky (pravidlo 1)', () => {
  const files = SCAN_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)));
  const pending = new Map(
    Object.entries(PENDING_BATCHES).flatMap(([batch, batchFiles]) =>
      batchFiles.map((file) => [file, batch] as const),
    ),
  );

  it('strážce vidí web, balíčky i skripty (jinak nic nehlídá)', () => {
    for (const root of SCAN_ROOTS) {
      expect(
        files.filter((file) => file.startsWith(`${root}/`)).length,
        `žádný zdrojový soubor v ${root}`,
      ).toBeGreaterThan(0);
    }
    expect(files).toContain('scripts/validate-epo.mjs');
    expect(files).toContain('apps/web/scripts/failed-imports.ts');
  });

  it('pozná názvy, které už jednou prošly, a anglická slova nechá být', () => {
    const czech = (name: string): boolean => wordsOf(name).some(isCzechWord);
    // L12-09 a dřívější úklid skriptů — každý z nich se do kódu skutečně dostal
    for (const name of [
      'velikost',
      'BARVY',
      'HRANICE_38B',
      'poslednZtrata',
      'prijmyZeStatuProZapocet',
      'kryptoNad100k',
      'KORPORATNI_AKCE',
      'CHYBA_LABELS',
      'xmlOdkaz',
      'chybi',
      'mena',
      'KLIC',
      'vseSedi',
      'drobnaDan',
    ]) {
      expect(czech(name), name).toBe(true);
    }
    // anglická slova, která českým kmenem jen začínají nebo se mu podobají
    for (const name of [
      'status',
      'statement',
      'danger',
      'dense',
      'type',
      'typedRows',
      'platform',
      'derivativeIsin',
      'description',
      'limit100kUsedCzk',
      'kindLabel',
      'styleOf',
      'checkCode',
      'pausalRegime',
    ]) {
      expect(czech(name), name).toBe(false);
    }
  });

  it(
    'produkční kód nedeklaruje česky pojmenované proměnné, funkce ani typy',
    { timeout: 30_000 },
    () => {
      const offenders: string[] = [];
      for (const file of files) {
        if (pending.has(file)) continue;
        for (const hit of czechDeclarations(file)) offenders.push(`${file}: ${hit}`);
      }
      expect(
        offenders,
        'české identifikátory — přejmenuj je, nebo doplň výjimku s důvodem',
      ).toEqual([]);
    },
  );
});
