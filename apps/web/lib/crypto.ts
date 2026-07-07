import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Šifrování broker API klíčů na aplikační úrovni (docs/04): AES-256-GCM,
 * klíč mimo DB. Produkce vyžaduje DANERO_ENCRYPTION_KEY (32 B hex); dev si
 * jednorázově vygeneruje klíč do gitignorované .data/ — stejný vzor jako auth secret.
 */
function resolveKey(): Buffer {
  const fromEnv = process.env.DANERO_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, 'hex');
    if (key.length !== 32) {
      throw new Error('DANERO_ENCRYPTION_KEY musí být 32 bajtů hex (openssl rand -hex 32).');
    }
    return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DANERO_ENCRYPTION_KEY musí být v produkci nastaven (openssl rand -hex 32).');
  }
  const file = join('.data', 'dev-encryption-key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
  mkdirSync('.data', { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  );
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split('.');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Neplatný formát šifrovaného tajemství.');
  }
  const decipher = createDecipheriv('aes-256-gcm', resolveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
