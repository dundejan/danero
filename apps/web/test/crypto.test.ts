import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, reencryptSecret } from '@/lib/crypto';

/**
 * D-05: šifrovaný text musí nést otisk klíče, kterým vznikl. Bez něj byla
 * výměna DANERO_ENCRYPTION_KEY jednosměrná — uložené broker klíče se rázem
 * nedaly přečíst a syncy tiše padaly do „zadej klíč znovu“.
 */
const KLIC_A = randomBytes(32).toString('hex');
const KLIC_B = randomBytes(32).toString('hex');

const puvodni = {
  key: process.env.DANERO_ENCRYPTION_KEY,
  old: process.env.DANERO_ENCRYPTION_KEYS_OLD,
};

/** Nastaví aktuální klíč a (volitelně) ty vyřazené z rotace. */
function pouzijKlice(key: string, old?: string): void {
  process.env.DANERO_ENCRYPTION_KEY = key;
  if (old === undefined) delete process.env.DANERO_ENCRYPTION_KEYS_OLD;
  else process.env.DANERO_ENCRYPTION_KEYS_OLD = old;
}

afterEach(() => {
  if (puvodni.key === undefined) delete process.env.DANERO_ENCRYPTION_KEY;
  else process.env.DANERO_ENCRYPTION_KEY = puvodni.key;
  if (puvodni.old === undefined) delete process.env.DANERO_ENCRYPTION_KEYS_OLD;
  else process.env.DANERO_ENCRYPTION_KEYS_OLD = puvodni.old;
});

describe('šifrování tajemství (AES-256-GCM)', () => {
  it('round-trip a integrita — pozměněný ciphertext ani authTag neprojde', () => {
    pouzijKlice(KLIC_A);
    const zasifrovano = encryptSecret('tajny-api-klic-123');
    expect(zasifrovano).not.toContain('tajny');
    expect(decryptSecret(zasifrovano)).toBe('tajny-api-klic-123');

    const [verze, iv, tag, data] = zasifrovano.split('.');
    expect(() => decryptSecret([verze, iv, tag, `${data!.slice(0, -4)}AAAA`].join('.'))).toThrow();
    expect(() => decryptSecret([verze, iv, `${tag!.slice(0, -4)}AAAA`, data].join('.'))).toThrow();
    expect(() => decryptSecret('nesmysl')).toThrow('Neplatný formát');
  });

  it('otisk klíče je v šifrovaném textu a liší se klíč od klíče', () => {
    pouzijKlice(KLIC_A);
    const otiskA = encryptSecret('x').split('.')[0]!;
    pouzijKlice(KLIC_B);
    const otiskB = encryptSecret('x').split('.')[0]!;

    expect(otiskA).toMatch(/^v2-[0-9a-f]{8}$/);
    expect(otiskA).not.toBe(otiskB);
    // z otisku nesmí jít vyčíst klíč
    expect(KLIC_A).not.toContain(otiskA.slice(3));
  });

  it('po rotaci klíče se stará data čtou vyřazeným klíčem, nová šifrují novým', () => {
    pouzijKlice(KLIC_A);
    const stare = encryptSecret('klic-brokera-z-loni');

    // rotace: nový klíč se stane aktuálním, ten starý zůstane jen ke čtení
    pouzijKlice(KLIC_B, KLIC_A);
    expect(decryptSecret(stare)).toBe('klic-brokera-z-loni');
    const nove = encryptSecret('klic-brokera-dnes');
    expect(nove.split('.')[0]).not.toBe(stare.split('.')[0]);
    expect(decryptSecret(nove)).toBe('klic-brokera-dnes');
  });

  it('bez vyřazeného klíče v rotaci to spadne s návodem, ne s hláškou z knihovny', () => {
    pouzijKlice(KLIC_A);
    const stare = encryptSecret('klic-brokera-z-loni');
    pouzijKlice(KLIC_B);
    expect(() => decryptSecret(stare)).toThrow('DANERO_ENCRYPTION_KEYS_OLD');
  });

  it('reencryptSecret překlopí na aktuální klíč, u aktuálního vrátí null', () => {
    pouzijKlice(KLIC_A);
    const stare = encryptSecret('klic-brokera');

    pouzijKlice(KLIC_B, KLIC_A);
    const prekloplene = reencryptSecret(stare);
    expect(prekloplene).not.toBe(null);
    expect(decryptSecret(prekloplene!)).toBe('klic-brokera');
    expect(prekloplene!.split('.')[0]).toBe(encryptSecret('cokoliv').split('.')[0]);
    // už je na aktuálním klíči — volající nemusí sahat do databáze
    expect(reencryptSecret(prekloplene!)).toBe(null);
  });

  it('formát bez otisku klíče (v1) se dál dešifruje — i po rotaci', () => {
    // doslovný tvar, který v databázi leží od doby před D-05
    const v1 = (key: string, plaintext: string): string => {
      process.env.DANERO_ENCRYPTION_KEY = key;
      const [, iv, tag, data] = encryptSecret(plaintext).split('.');
      return ['v1', iv, tag, data].join('.');
    };

    pouzijKlice(KLIC_A);
    const stare = v1(KLIC_A, 'klic-ulozeny-pred-rotaci');
    expect(decryptSecret(stare)).toBe('klic-ulozeny-pred-rotaci');

    // po rotaci ho přečte vyřazený klíč — otisk chybí, tak se klíče zkusí popořadě
    pouzijKlice(KLIC_B, KLIC_A);
    expect(decryptSecret(stare)).toBe('klic-ulozeny-pred-rotaci');
    expect(reencryptSecret(stare)!.startsWith('v2-')).toBe(true);
  });

  it('klíč jiné délky než 32 bajtů odmítne rovnou, ne až u prvního dešifrování', () => {
    pouzijKlice(randomBytes(16).toString('hex'));
    expect(() => encryptSecret('x')).toThrow('32 bajtů');
    pouzijKlice(KLIC_A, randomBytes(31).toString('hex'));
    expect(() => decryptSecret(encryptSecret('x'))).toThrow('DANERO_ENCRYPTION_KEYS_OLD');
  });
});
