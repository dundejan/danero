import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Vývojové tajemství v gitignorované `.data/`: přečte ho, a když soubor ještě
 * není, vygeneruje ho a zapíše. Produkce se sem nedostane — volající bez
 * proměnné prostředí spadnou dřív (`resolveSecret`, `primaryKey`).
 *
 * Schválně bez `existsSync`: mezi dotazem „existuje?“ a zápisem si soubor může
 * založit druhý proces (E2E pouští dev server a pomocné skripty naráz) a ten
 * pomalejší by tajemství přepsal — první by pak šifroval klíčem, který už na
 * disku není. Zápis s příznakem `wx` projde jen tomu, kdo byl první; druhý si
 * přečte, co první uložil.
 */
export function readOrCreateDevSecret(file: string, generate: () => string): string {
  const stored = readIfPresent(file);
  if (stored !== null) return stored;
  mkdirSync(dirname(file), { recursive: true });
  const secret = generate();
  try {
    writeFileSync(file, secret, { mode: 0o600, flag: 'wx' });
    return secret;
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
    const winner = readIfPresent(file);
    if (winner === null) throw error;
    return winner;
  }
}

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
