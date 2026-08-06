import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

/**
 * E-8: /soukromi tvrdilo Argon2, Better Auth přitom jel na výchozím scryptu.
 * Přepnutí je zadarmo, dokud nejsou živé účty — ale otisky vzniklé dřív se
 * musí dál ověřit, jinak by se vlastní instance pod AGPL zamkly.
 */
describe('otisky hesel', () => {
  it('vyrobí Argon2id otisk v PHC formátu a ověří ho', async () => {
    const hash = await hashPassword('Tajne-Heslo-2026');

    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hash).not.toContain('Tajne-Heslo-2026');
    expect(await verifyPassword({ hash, password: 'Tajne-Heslo-2026' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'Tajne-Heslo-2027' })).toBe(false);
  });

  it('stejné heslo dvakrát dá jiný otisk (náhodná sůl)', async () => {
    const [a, b] = await Promise.all([hashPassword('stejne'), hashPassword('stejne')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword({ hash: a, password: 'stejne' })).toBe(true);
    expect(await verifyPassword({ hash: b, password: 'stejne' })).toBe(true);
  });

  it('ověří i starý scrypt otisk z Better Authu', async () => {
    const { hashPassword: legacyHash } = await import('better-auth/crypto');
    const legacy = await legacyHash('Stare-Heslo-2025');

    expect(legacy.startsWith('$argon2id$')).toBe(false);
    expect(await verifyPassword({ hash: legacy, password: 'Stare-Heslo-2025' })).toBe(true);
    expect(await verifyPassword({ hash: legacy, password: 'spatne' })).toBe(false);
  });

  it('poškozený otisk neprojde a neshodí přihlášení', async () => {
    for (const hash of ['$argon2id$rozbite', '$argon2id$v=19$m=1$sul', '']) {
      expect(await verifyPassword({ hash, password: 'cokoliv' })).toBe(false);
    }
  });
});
