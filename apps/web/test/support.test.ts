import { describe, expect, it } from 'vitest';
import { invalidSupportEnv, supportAvailable, supportFromEnv } from '@/lib/support';

/**
 * Dobrovolný příspěvek: údaje jdou jen z prostředí a na veřejnou stránku se
 * nesmí dostat nic, co by nešlo zaplatit — překlep v čísle účtu by znamenal
 * peníze poslané jinam.
 *
 * IBAN v testech je veřejný vzorový z dokumentace ČNB, ne účet provozovatele.
 */
const SAMPLE_IBAN = 'CZ6508000000192000145399';

describe('dobrovolný příspěvek z prostředí', () => {
  it('bez proměnných se nenabízí nic', () => {
    const options = supportFromEnv({});
    expect(options).toEqual({ iban: null, accountNumber: null, paymentCode: null, url: null });
    expect(supportAvailable(options)).toBe(false);
    expect(invalidSupportEnv({})).toEqual([]);
  });

  it('z českého IBAN složí QR platbu i číslo účtu v českém tvaru', () => {
    const options = supportFromEnv({ DANERO_SUPPORT_IBAN: 'CZ65 0800 0000 1920 0014 5399' });
    expect(options.iban).toBe(SAMPLE_IBAN);
    expect(options.accountNumber).toBe('19-2000145399/0800');
    // bez částky (volí si ji přispěvatel) a bez diakritiky ve zprávě
    expect(options.paymentCode).toBe(`SPD*1.0*ACC:${SAMPLE_IBAN}*CC:CZK*MSG:DANERO PRISPEVEK`);
    expect(supportAvailable(options)).toBe(true);
  });

  it('nulové předčíslí se v čísle účtu nepíše', () => {
    // týž účet bez předčíslí má jiný kontrolní součet — spočítaný, ne opsaný
    const options = supportFromEnv({ DANERO_SUPPORT_IBAN: 'CZ5508000000001234567899' });
    expect(options.accountNumber).toBe('1234567899/0800');
  });

  it('IBAN s chybným kontrolním součtem se nenabídne a health ho pojmenuje', () => {
    const env = { DANERO_SUPPORT_IBAN: 'CZ6508000000192000145398' };
    expect(supportFromEnv(env).paymentCode).toBeNull();
    expect(invalidSupportEnv(env)).toEqual(['DANERO_SUPPORT_IBAN']);
  });

  it('o znak kratší český IBAN se nenabídne, i když mu vyjde kontrolní součet', () => {
    // 23 znaků místo 24, mod 97 = 1 — spočítané, ne opsané. Bez kontroly tvaru
    // z něj vznikla QR platba s prázdným číslem účtu a health hlásil „ok“.
    const env = { DANERO_SUPPORT_IBAN: 'CZ340800000019200014539' };
    const options = supportFromEnv(env);
    expect(options).toEqual({ iban: null, accountNumber: null, paymentCode: null, url: null });
    expect(supportAvailable(options)).toBe(false);
    expect(invalidSupportEnv(env)).toEqual(['DANERO_SUPPORT_IBAN']);
  });

  it('QR platba a číslo účtu vznikají vždy spolu', () => {
    for (const iban of [SAMPLE_IBAN, 'CZ5508000000001234567899', 'CZ340800000019200014539', 'x']) {
      const options = supportFromEnv({ DANERO_SUPPORT_IBAN: iban });
      expect(options.paymentCode === null).toBe(options.accountNumber === null);
    }
  });

  it('zahraniční IBAN se nenabídne — QR platba je český standard', () => {
    // platný německý vzorový IBAN
    const env = { DANERO_SUPPORT_IBAN: 'DE89370400440532013000' };
    expect(supportFromEnv(env).iban).toBeNull();
    expect(invalidSupportEnv(env)).toEqual(['DANERO_SUPPORT_IBAN']);
  });

  it('příspěvek nic neodemyká: modul čtou jen stránky, které ho zobrazují', async () => {
    // Jakmile by se podle příspěvku cokoli rozhodovalo (funkce, limit, pořadí
    // ve frontě), není to dar, ale cena — a přestává to splňovat podmínky
    // hostingu i podmínky užití. Proto smí `lib/support` importovat jen to,
    // co údaje vypisuje, a health, který hlídá překlep v nastavení.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, relative } = await import('node:path');
    const root = join(import.meta.dirname, '..');
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return files(full);
        return /\.(ts|tsx)$/.test(entry) ? [full] : [];
      });
    // Hledá se cesta k modulu v jakémkoli zápisu — statický import, dynamický
    // `await import(…)` (tak si moduly berou server actions), jiné uvozovky
    // i relativní cesta. První verze znala jen `from '@/lib/support'`.
    const mentionsSupport = /['"`](@\/lib\/support|(\.{1,2}\/)+(lib\/)?support)['"`]/;
    const importers = ['app', 'lib', 'components']
      .flatMap((dir) => files(join(root, dir)))
      .filter((file) => mentionsSupport.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .sort();
    expect(importers).toEqual([
      'app/api/health/route.ts',
      'app/cenik/page.tsx',
      'app/soukromi/page.tsx',
    ]);
  });

  it('odkaz musí být https, jinak se nevypíše', () => {
    expect(supportFromEnv({ DANERO_SUPPORT_URL: 'https://github.com/sponsors/nekdo' }).url).toBe(
      'https://github.com/sponsors/nekdo',
    );
    for (const url of ['http://example.com', 'javascript:alert(1)', 'neco']) {
      expect(supportFromEnv({ DANERO_SUPPORT_URL: url }).url).toBeNull();
      expect(invalidSupportEnv({ DANERO_SUPPORT_URL: url })).toEqual(['DANERO_SUPPORT_URL']);
    }
  });
});
