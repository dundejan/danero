import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EnvSource } from '@/lib/contact';
import { emailEnvError, missingEmailEnv } from '@/lib/operator-env';

/**
 * K2-04: nástroj provozovatele poslal uživateli e-mail podepsaný „Danero —
 * nenastaveno, IČO nenastaveno" s odkazem na `http://localhost:3000`, protože
 * jeho vlastní návod jmenoval jen `DATABASE_URL`.
 *
 * Testy si prostředí obvykle nastaví samy, takže tuhle třídu chyb nikdy
 * nezachytí. Proto je kontrola vytažená do `lib/operator-env.ts` (unit testy
 * níž jí prostředí podstrčí explicitně) **a** proto se skript v druhé půlce
 * spouští doopravdy, jako podproces s prostředím složeným od nuly.
 */

const UPLNE: EnvSource = {
  DANERO_OPERATOR_NAME: 'Zkušební provozovatel',
  DANERO_OPERATOR_ICO: '12345678',
  DANERO_OPERATOR_ADDRESS: 'Zkušební 1, 100 00 Zkušebno',
  DANERO_CONTACT_EMAIL: 'kontakt@example.test',
  BETTER_AUTH_URL: 'https://priklad.test',
};

const bez = (...promenne: string[]): EnvSource => {
  const env = { ...UPLNE };
  for (const promenna of promenne) delete env[promenna];
  return env;
};

describe('předletová kontrola prostředí (K2-04)', () => {
  it('kompletní prostředí projde', () => {
    expect(missingEmailEnv(UPLNE)).toEqual([]);
  });

  it('chybějící údaj pojmenuje proměnnou, kterou má provozovatel doplnit', () => {
    expect(missingEmailEnv(bez('DANERO_OPERATOR_ICO'))).toEqual(['DANERO_OPERATOR_ICO']);
    expect(missingEmailEnv(bez('BETTER_AUTH_URL'))).toEqual(['BETTER_AUTH_URL']);
  });

  it('prázdná proměnná je totéž co nenastavená (jinak by prošla mezera)', () => {
    expect(missingEmailEnv({ ...UPLNE, DANERO_CONTACT_EMAIL: '   ' })).toEqual([
      'DANERO_CONTACT_EMAIL',
    ]);
  });

  it('holé prostředí vypíše všech pět proměnných', () => {
    expect(missingEmailEnv({})).toEqual([
      'DANERO_OPERATOR_NAME',
      'DANERO_OPERATOR_ICO',
      'DANERO_OPERATOR_ADDRESS',
      'DANERO_CONTACT_EMAIL',
      'BETTER_AUTH_URL',
    ]);
  });

  it('hláška řekne, co chybí i co by se bez toho stalo', () => {
    const hlaska = emailEnvError(missingEmailEnv(bez('DANERO_OPERATOR_NAME', 'BETTER_AUTH_URL')));
    expect(hlaska).toContain('DANERO_OPERATOR_NAME');
    expect(hlaska).toContain('BETTER_AUTH_URL');
    expect(hlaska).toContain('localhost');
  });
});

/**
 * Druhá půlka: že tu kontrolu skript opravdu volá, a to PŘED jakoukoli akcí.
 * Prostředí se skládá od nuly (`env -i` v podobě objektu), aby do podprocesu
 * nepropadly hodnoty, které si testům nastavuje `vitest.config.ts`.
 */
describe('skript failed-imports se bez prostředí nerozjede (K2-04)', () => {
  const korenWebu = join(import.meta.dirname, '..');
  const script = join(korenWebu, 'scripts', 'failed-imports.ts');
  const tsx = join(korenWebu, 'node_modules', '.bin', 'tsx');

  const spustit = (
    argumenty: string[],
    doplnky: EnvSource,
  ): { status: number; output: string } => {
    // prostředí se skládá od nuly, ne z `process.env` — jinak by do podprocesu
    // propadly hodnoty, které si testům nastavuje `vitest.config.ts`
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    };
    Object.assign(env, doplnky);
    try {
      const stdout = execFileSync(tsx, [script, ...argumenty], {
        cwd: korenWebu,
        env,
        encoding: 'utf8',
        // bez tohohle si podproces píše na stderr rodiče a výstup testů je pak
        // k nepřečtení (a hláška by se nedala kontrolovat)
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output: stdout };
    } catch (error) {
      const spadl = error as { status?: number; stdout?: string; stderr?: string };
      return { status: spadl.status ?? -1, output: `${spadl.stdout ?? ''}${spadl.stderr ?? ''}` };
    }
  };

  it.each(['retry', 'retry-all', 'reject'])(
    '„%s" bez identifikace provozovatele skončí dřív, než sáhne na data',
    (podprikaz) => {
      const { status, output } = spustit([podprikaz, 'nejaky-id', 'důvod'], {});
      expect(status).toBe(1);
      expect(output).toContain('DANERO_OPERATOR_NAME');
      expect(output).toContain('BETTER_AUTH_URL');
      // a hlavně: databázi ani neotevřel, takže žádný případ neuzavřel
      expect(output).not.toContain('neexistuje');
    },
    30_000,
  );

  it(
    '„delete" naopak jede i bez nich — žádost o výmaz nesmí blokovat chybějící IČO',
    () => {
      const { status, output } = spustit(['delete', 'nejaky-id'], {
        PGLITE_DATA_DIR: mkdtempSync(join(tmpdir(), 'danero-operator-env-')),
      });
      // došel až do databáze (případ s tím id v ní není), ne k hlášce o prostředí
      expect(output).toContain('neexistuje');
      expect(output).not.toContain('DANERO_OPERATOR_NAME');
      expect(status).toBe(1);
    },
    60_000,
  );
});
