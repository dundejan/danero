import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cameFromHistoryCache } from '@/lib/restored-page';

/**
 * Zpět/Vpřed umí ukázat stránku z paměti prohlížeče — starý stav aplikace.
 * Obnovit ze serveru se má jen tehdy; čerstvé načtení druhý dotaz nepotřebuje.
 */
describe('stránka vrácená z paměti prohlížeče', () => {
  it('návrat v historii s dokumentem z mezipaměti se pozná', () => {
    expect(cameFromHistoryCache({ type: 'back_forward', transferSize: 0 })).toBe(true);
  });

  it('návrat, při kterém server odpověděl, se neobnovuje podruhé', () => {
    expect(cameFromHistoryCache({ type: 'back_forward', transferSize: 18_342 })).toBe(false);
  });

  it('odkaz, F5 ani prohlížeč, který údaj nemá, obnovení nespustí', () => {
    expect(cameFromHistoryCache({ type: 'navigate', transferSize: 0 })).toBe(false);
    expect(cameFromHistoryCache({ type: 'reload', transferSize: 0 })).toBe(false);
    expect(cameFromHistoryCache({ type: 'back_forward' })).toBe(false);
    expect(cameFromHistoryCache(undefined)).toBe(false);
  });

  it('obnovení nese rozložení aplikace, ne jednotlivá stránka', () => {
    const layout = readFileSync(
      join(import.meta.dirname, '..', 'app', '(app)', 'layout.tsx'),
      'utf8',
    );
    expect(layout).toContain('<RefreshOnRestore />');
  });
});
