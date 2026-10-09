import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOrCreateDevSecret } from '@/lib/dev-secret';

/**
 * Vývojové tajemství (`.data/dev-auth-secret`, `.data/dev-encryption-key`) se
 * smí vygenerovat jen jednou: kdo ho přepíše, zneplatní relace a zašifrované
 * klíče brokerů procesu, který si ho přečetl dřív.
 */
const dirs: string[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'danero-dev-secret-'));
  dirs.push(dir);
  return join(dir, 'vnoreny', 'tajemstvi');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readOrCreateDevSecret', () => {
  it('chybějící soubor založí i s adresářem a jen pro vlastníka', () => {
    const file = tempFile();
    expect(readOrCreateDevSecret(file, () => 'prvni')).toBe('prvni');
    expect(readFileSync(file, 'utf8')).toBe('prvni');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('existující tajemství vrátí a nové negeneruje', () => {
    const file = tempFile();
    readOrCreateDevSecret(file, () => 'prvni');
    let generated = 0;
    const second = readOrCreateDevSecret(file, () => {
      generated += 1;
      return 'druhy';
    });
    expect(second).toBe('prvni');
    expect(generated).toBe(0);
  });

  it('ořízne konec řádku z ručně založeného souboru', () => {
    const file = tempFile();
    readOrCreateDevSecret(file, () => 'x');
    writeFileSync(file, 'rucne\n');
    expect(readOrCreateDevSecret(file, () => 'jiny')).toBe('rucne');
  });

  it('souběh: kdo přijde druhý, nepřepíše a vrátí tajemství prvního', () => {
    const file = tempFile();
    readOrCreateDevSecret(file, () => 'zaklad');
    rmSync(file);
    // druhý proces soubor založí mezi naším čtením a zápisem
    const ours = readOrCreateDevSecret(file, () => {
      writeFileSync(file, 'cizi');
      return 'nase';
    });
    expect(ours).toBe('cizi');
    expect(readFileSync(file, 'utf8')).toBe('cizi');
  });
});
