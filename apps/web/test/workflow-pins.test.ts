import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážný test workflow v `.github/workflows/`.
 *
 * Značka `@v4` u cizí akce není verze, ale ukazatel, který majitel jejího
 * repozitáře smí kdykoli přesunout jinam — a `migrate.yml` pouští stažený kód
 * ve stejném jobu, kde o pár kroků dál dostane připojení k produkční databázi.
 * Neměnné je jen plné SHA commitu. Proto:
 *
 * - každé `uses:` míří na 40 hex znaků a nese komentář s verzí (bez něj se
 *   z SHA nepozná, co se vlastně pouští, a nejde ho rozumně povýšit),
 * - každý checkout má `persist-credentials: false`, takže token nezůstane
 *   ležet v `.git/config` pro další kroky jobu,
 * - každý workflow si práva tokenu říká sám a `ci.yml` jen o čtení kódu —
 *   výchozí nastavení repozitáře se dá změnit a fork ho mít nemusí,
 * - `migrate.yml` smí použít jen akce, které má ve stejném znění i `ci.yml`.
 *   Migrace se před sloučením nikde nespustí: překlep v SHA by ji shodil už
 *   při přípravě jobu a kód by se nasadil nad starým schématem. CI nad pull
 *   requestem tatáž SHA stáhne dřív a překlep ukáže.
 *
 * Test čte VŠECHNY soubory ve složce, ne vyjmenované tři — nový workflow tím
 * pádem musí splnit totéž.
 */
const WORKFLOWS_DIR = join(import.meta.dirname, '..', '..', '..', '.github', 'workflows');

type ActionUse = {
  file: string;
  line: number;
  /** celé `owner/repo@ref`, jak stojí za `uses:` */
  target: string;
  ref: string;
  comment: string;
  /** řádky téhož kroku pod `uses:` (blok `with:` a spol.) */
  stepBody: string;
};

const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();

function readWorkflow(name: string): string {
  return readFileSync(join(WORKFLOWS_DIR, name), 'utf8');
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function actionUses(file: string): ActionUse[] {
  const lines = readWorkflow(file).split('\n');
  const found: ActionUse[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(-\s+)?uses:\s*(\S+)\s*(?:#\s*(.*?))?\s*$/.exec(line);
    if (!match) return;
    const target = match[3]!.replace(/^['"]|['"]$/g, '');
    // akce z vlastního repozitáře se bere z téhož commitu jako workflow
    if (target.startsWith('./')) return;
    // krok končí na dalším řádku, který není odsazený hlouběji než jeho pomlčka
    const stepIndent = match[2] ? match[1]!.length : match[1]!.length - 2;
    const body: string[] = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && indentOf(next) <= stepIndent) break;
      body.push(next);
    }
    found.push({
      file,
      line: index + 1,
      target,
      ref: target.slice(target.lastIndexOf('@') + 1),
      comment: match[4] ?? '',
      stepBody: body.join('\n'),
    });
  });
  return found;
}

const allUses = workflowFiles.flatMap(actionUses);
const describeUse = (use: ActionUse) => `${use.file}:${use.line} ${use.target}`;

describe('workflow v .github/workflows', () => {
  it('test vidí všechny soubory a v nich použité akce', () => {
    // kdyby regulár přestal sedět na zápis ve workflow, test by hlídal prázdno
    expect(workflowFiles).toEqual(expect.arrayContaining(['ci.yml', 'migrate.yml']));
    for (const file of ['ci.yml', 'migrate.yml']) {
      expect(actionUses(file).length, `${file}: počet uses`).toBeGreaterThanOrEqual(3);
    }
    for (const file of workflowFiles) {
      const written = readWorkflow(file)
        .split('\n')
        .filter((line) => /^\s*(-\s+)?uses:/.test(line)).length;
      const local = readWorkflow(file)
        .split('\n')
        .filter((line) => /^\s*(-\s+)?uses:\s*['"]?\.\//.test(line)).length;
      expect(actionUses(file).length, `${file}: rozpoznaná uses`).toBe(written - local);
    }
  });

  it('každá akce je připnutá na plné SHA commitu, ne na pohyblivou značku', () => {
    const unpinned = allUses.filter((use) => !/^[0-9a-f]{40}$/.test(use.ref));
    expect(unpinned.map(describeUse)).toEqual([]);
  });

  it('u každého SHA stojí komentář s verzí vydání', () => {
    const uncommented = allUses.filter((use) => !/^v\d+\.\d+\.\d+$/.test(use.comment));
    expect(uncommented.map(describeUse)).toEqual([]);
  });

  it('tatáž akce je ve všech workflow připnutá na stejné SHA', () => {
    const refsByAction = new Map<string, Set<string>>();
    for (const use of allUses) {
      const action = use.target.slice(0, use.target.lastIndexOf('@'));
      refsByAction.set(action, (refsByAction.get(action) ?? new Set()).add(use.ref));
    }
    const split = [...refsByAction].filter(([, refs]) => refs.size > 1);
    expect(split.map(([action, refs]) => `${action}: ${[...refs].join(', ')}`)).toEqual([]);
  });

  it('checkout nenechává token v .git/config', () => {
    const checkouts = allUses.filter((use) => use.target.startsWith('actions/checkout@'));
    expect(checkouts.length).toBeGreaterThanOrEqual(4);
    const persisting = checkouts.filter(
      (use) => !/^\s*persist-credentials:\s*false\s*$/m.test(use.stepBody),
    );
    expect(persisting.map(describeUse)).toEqual([]);
  });

  it('každý workflow si práva tokenu říká sám a ci.yml žádá jen čtení kódu', () => {
    const silent = workflowFiles.filter((file) => !/^permissions:/m.test(readWorkflow(file)));
    expect(silent).toEqual([]);
    expect(readWorkflow('ci.yml')).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
  });

  it('migrate.yml používá jen akce, které ve stejném znění ověří ci.yml nad pull requestem', () => {
    const verifiedByCi = new Set(actionUses('ci.yml').map((use) => use.target));
    const unverified = actionUses('migrate.yml').filter((use) => !verifiedByCi.has(use.target));
    expect(unverified.map(describeUse)).toEqual([]);
  });
});
