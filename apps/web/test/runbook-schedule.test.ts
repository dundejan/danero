import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážný test plánovaného běhu runbook pojistek
 * (`.github/workflows/runbook-check.yml`).
 *
 * Testy `runbook.test.ts` čtou skutečný dnešek a od 1. listopadu chtějí mít
 * nachystaný další rok (kurzy, registr období, kalendáře svátků). Dokud je
 * pouštělo jen CI při pushi a pull requestu, promluvily jen tehdy, když někdo
 * zrovna pushnul — a v tichém listopadu a prosinci by se chybějící rok ohlásil
 * až 1. ledna rozbitou aplikací (nález L11-02 páté revize). Plánovaný workflow
 * je pouští i bez commitu.
 *
 * Workflow se před sloučením nedá vyzkoušet naostro a po sloučení běží jednou
 * za měsíc, takže překlep v cestě k testu by se ukázal až za týdny. Proto tady
 * hlídáme to, co jde ověřit čtením souboru:
 *
 * - má plán (každý měsíc, hned po 1. dni) i ruční spuštění,
 * - pouští každý `runbook.test.ts`, který v repozitáři je, a žádný neexistující,
 * - nežádá tajemství ani proměnné repozitáře a token má jen ke čtení kódu.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKFLOW_NAME = 'runbook-check.yml';
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', WORKFLOW_NAME);

/** workspace balíčky podle složek — název balíčku je `@danero/<složka>` */
const WORKSPACE_GROUPS = ['apps', 'packages'];

function readWorkflow(): string {
  expect(
    existsSync(WORKFLOW_PATH),
    `Chybí .github/workflows/${WORKFLOW_NAME} — runbook pojistky pak běží jen při pushi a pull requestu.`,
  ).toBe(true);
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

/** `apps/web/test/runbook.test.ts` a spol. — všechny pojistky, které v repozitáři jsou */
function runbookTestsInRepo(): string[] {
  return WORKSPACE_GROUPS.flatMap((group) =>
    readdirSync(join(REPO_ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/test/runbook.test.ts`)
      .filter((path) => existsSync(join(REPO_ROOT, path))),
  ).sort();
}

/** cesty testů, které workflow pouští přes `pnpm --filter @danero/<balíček> exec vitest run …` */
function testsRunByWorkflow(workflow: string): string[] {
  const found: string[] = [];
  const command = /pnpm --filter @danero\/([\w-]+) exec vitest run((?: \S+)+)/g;
  for (const match of workflow.matchAll(command)) {
    const packageDir = WORKSPACE_GROUPS.map((group) => `${group}/${match[1]}`).find((dir) =>
      existsSync(join(REPO_ROOT, dir, 'package.json')),
    );
    expect(packageDir, `balíček @danero/${match[1]} ve workspace není`).toBeDefined();
    for (const argument of match[2]!.trim().split(' ')) {
      if (!argument.startsWith('--')) found.push(`${packageDir}/${argument}`);
    }
  }
  return found.sort();
}

describe('plánovaný běh runbook pojistek', () => {
  it('běží podle plánu každý měsíc hned po prvním dni a jde spustit i ručně', () => {
    const workflow = readWorkflow();
    const cron = /^\s+- cron: '(\d+) (\d+) (\d+) \* \*'\s*$/m.exec(workflow);
    expect(cron, 'plán má být jeden den v měsíci: „minuta hodina den * *“').not.toBeNull();
    // Pojistky posouvají požadovaný rok 1. listopadu (UTC) — běh v prvních
    // dnech měsíce nechá na doplnění skoro celé dva měsíce. Den 29–31 by navíc
    // v některých měsících neproběhl vůbec.
    expect(Number(cron![3])).toBeGreaterThanOrEqual(2);
    expect(Number(cron![3])).toBeLessThanOrEqual(7);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:\s*$/m);
    // push ani pull_request sem nepatří, to už dělá ci.yml
    expect(workflow).not.toMatch(/^ {2}(push|pull_request|pull_request_target):/m);
  });

  it('pouští každý runbook test v repozitáři a žádný, který neexistuje', () => {
    const inRepo = runbookTestsInRepo();
    // kdyby hledání přestalo sedět na rozložení repozitáře, test by hlídal prázdno
    expect(inRepo).toEqual(
      expect.arrayContaining([
        'apps/web/test/runbook.test.ts',
        'packages/engine/test/runbook.test.ts',
      ]),
    );
    expect(testsRunByWorkflow(readWorkflow())).toEqual(inRepo);
  });

  it('webovou pojistku pouští po souborech za sebou', () => {
    // webové testy sdílejí zámek PGlite; `runbook.test.ts` databázi nepotřebuje,
    // ale příkaz má být stejný, jakým se pojistka pouští lokálně
    expect(readWorkflow()).toMatch(
      /pnpm --filter @danero\/web exec vitest run --no-file-parallelism test\/runbook\.test\.ts/,
    );
  });

  it('nežádá tajemství ani proměnné repozitáře a token má jen ke čtení kódu', () => {
    const workflow = readWorkflow();
    expect(workflow).not.toMatch(/\$\{\{\s*(secrets|vars)\./);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n(?! )/m);
    // práva se nesmí rozšířit ani na úrovni jobu
    expect(workflow.match(/^\s*permissions:/gm)).toHaveLength(1);
  });
});
