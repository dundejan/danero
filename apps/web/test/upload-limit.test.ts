import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F-3-3: strop velikosti nahraného souboru musí zůstat POD limitem Vercelu.
 *
 * Vercel utne tělo požadavku na 4,5 MB dřív, než se dostane k aplikaci —
 * změřeno naostro proti produkci: 4 300 kB projde, 4 400 kB vrátí
 * `413 FUNCTION_PAYLOAD_TOO_LARGE`, tedy syrovou anglickou stránku místo
 * české hlášky. Do 9. 8. 2026 aplikace slibovala 20 MB, takže uživatel
 * s velkým exportem nedostal radu, co dělat, ale nesrozumitelnou chybu.
 *
 * Test hlídá mechanismus (obě konstanty pod limitem platformy a v souladu),
 * ne konkrétní znění hlášky.
 */
const VERCEL_LIMIT_BYTES = 4.5 * 1024 * 1024;

describe('strop nahrávaného souboru (F-3-3)', () => {
  const cti = (cesta: string): string => readFileSync(join(import.meta.dirname, '..', cesta), 'utf8');

  it('MAX_FILE_BYTES je pod limitem Vercelu', () => {
    const zdroj = cti('app/(app)/import/actions.ts');
    const shoda = /const MAX_FILE_BYTES = (\d+) \* 1024 \* 1024;/.exec(zdroj);
    expect(shoda).not.toBeNull();
    const bajty = Number(shoda![1]) * 1024 * 1024;
    expect(bajty).toBeLessThan(VERCEL_LIMIT_BYTES);
  });

  it('bodySizeLimit Nextu je taky pod limitem Vercelu a nad stropem souboru', () => {
    const zdroj = cti('next.config.ts');
    const shoda = /bodySizeLimit: '([\d.]+)mb'/.exec(zdroj);
    expect(shoda).not.toBeNull();
    const bajty = Number(shoda![1]) * 1024 * 1024;
    expect(bajty).toBeLessThanOrEqual(VERCEL_LIMIT_BYTES);
    expect(bajty).toBeGreaterThan(4 * 1024 * 1024);
  });
});
