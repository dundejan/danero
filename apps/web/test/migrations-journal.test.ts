import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * M-3: drizzle porovnává jen timestamp nejnovější migrace, nikdy hash — migrace
 * se starším `when` se tiše přeskočí navždy (a `drizzle-kit check` řekne
 * „Everything's fine“). Hlídá to `db/check-journal.mjs` v CI.
 */
const SCRIPT = join(process.cwd(), 'db/check-journal.mjs');
const JOURNAL = join(process.cwd(), 'db/migrations/meta/_journal.json');

function run(journalPath: string): { code: number; output: string } {
  try {
    return { code: 0, output: execFileSync('node', [SCRIPT, journalPath]).toString() };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return { code: err.status, output: `${err.stdout}${err.stderr}` };
  }
}

/** Kopie migrací v temp adresáři, ať se dá žurnál rozbít bez dopadu na repo. */
function tempMigrations(uprav: (journal: { entries: Array<Record<string, unknown>> }) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'danero-journal-'));
  cpSync(join(process.cwd(), 'db/migrations'), join(dir, 'migrations'), { recursive: true });
  const path = join(dir, 'migrations/meta/_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8'));
  uprav(journal);
  writeFileSync(path, JSON.stringify(journal, null, 2));
  return path;
}

describe('kontrola žurnálu migrací (M-3)', () => {
  it('žurnál v repozitáři projde', () => {
    const { code, output } = run(JOURNAL);
    expect(output).toContain('v pořádku');
    expect(code).toBe(0);
  });

  it('migrace se starším when než předchozí neprojde', () => {
    const path = tempMigrations((journal) => {
      const last = journal.entries.at(-1)!;
      const previous = journal.entries.at(-2)!;
      last.when = (previous.when as number) - 1;
    });
    const { code, output } = run(path);
    expect(code).toBe(1);
    expect(output).toContain('tiše přeskočil');
  });

  it('migrace bez záznamu v žurnálu neprojde', () => {
    const path = tempMigrations((journal) => {
      journal.entries.pop();
    });
    const { code, output } = run(path);
    expect(code).toBe(1);
    expect(output).toContain('není v žurnálu');
  });
});
