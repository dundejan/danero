import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Šifrování broker API klíčů na aplikační úrovni (docs/04): AES-256-GCM,
 * klíč mimo DB. Produkce vyžaduje DANERO_ENCRYPTION_KEY (32 B hex); dev si
 * jednorázově vygeneruje klíč do gitignorované .data/ — stejný vzor jako auth secret.
 *
 * D-05: šifrovaný text nese OTISK klíče, kterým vznikl. Bez něj byla výměna
 * DANERO_ENCRYPTION_KEY jednosměrná — všechna uložená tajemství se rázem
 * nedala přečíst (GCM je neověří) a syncy tiše padaly do „zadej klíč znovu".
 * S otiskem se starý klíč nechá v DANERO_ENCRYPTION_KEYS_OLD, čte se obojí
 * a data se překlopí postupně (reencryptSecret).
 */
const KEY_BYTES = 32;
const FORMAT = 'v2';

function parseKey(hex: string, source: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${source} musí být 32 bajtů hex (openssl rand -hex 32).`);
  }
  return key;
}

/** Klíč, kterým se šifruje. Ostatní se smí použít už jen ke čtení. */
function primaryKey(): Buffer {
  const fromEnv = process.env.DANERO_ENCRYPTION_KEY;
  if (fromEnv) return parseKey(fromEnv, 'DANERO_ENCRYPTION_KEY');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DANERO_ENCRYPTION_KEY musí být v produkci nastaven (openssl rand -hex 32).');
  }
  const file = join('.data', 'dev-encryption-key');
  if (existsSync(file)) return parseKey(readFileSync(file, 'utf8').trim(), file);
  mkdirSync('.data', { recursive: true });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  return key;
}

/**
 * Klíče, kterými se ještě smí ČÍST — aktuální plus vyřazené z rotace
 * (DANERO_ENCRYPTION_KEYS_OLD, hex oddělené čárkou). Pořadí rozhoduje
 * jen u starého formátu bez otisku, kde se klíč hledá zkusmo.
 */
function decryptionKeys(): Buffer[] {
  const retired = (process.env.DANERO_ENCRYPTION_KEYS_OLD ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((hex) => parseKey(hex, 'DANERO_ENCRYPTION_KEYS_OLD'));
  return [primaryKey(), ...retired];
}

/**
 * Otisk klíče: 8 hex znaků ze SHA-256. Klíč z něj zpětně nezískáš, jen podle
 * něj poznáš, kterým z nastavených klíčů tajemství vzniklo.
 */
function fingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * Otisk je nalepený na verzi formátu (`v2-3f7a1c9d`), ne jako samostatné pole:
 * kódování je oddělené tečkami a přidané pole by změnilo počet dílů každému,
 * kdo šifrovaný text rozebírá.
 */
function versionTag(key: Buffer): string {
  return `${FORMAT}-${fingerprint(key)}`;
}

export function encryptSecret(plaintext: string): string {
  const key = primaryKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    versionTag(key),
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Klíče, kterými má smysl zkoušet dešifrovat text s tímhle prefixem. */
function candidateKeys(version: string): Buffer[] {
  // v1 = formát před D-05, otisk nenese — projedou se všechny klíče a
  // ověřovací tag GCM sám pozná, který sedí
  if (version === 'v1') return decryptionKeys();
  if (version.startsWith(`${FORMAT}-`)) {
    const id = version.slice(FORMAT.length + 1);
    return decryptionKeys().filter((key) => fingerprint(key) === id);
  }
  throw new Error('Neplatný formát šifrovaného tajemství.');
}

export function decryptSecret(encoded: string): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split('.');
  if (!version || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Neplatný formát šifrovaného tajemství.');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  for (const key of candidateKeys(version)) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch {
      // jiný klíč z rotace to může přečíst; když dojdou, spadne to na hlášku níž
    }
  }
  throw new Error(
    'Šifrované tajemství nejde přečíst — buď je poškozené, nebo vzniklo jiným ' +
      'klíčem. Při výměně DANERO_ENCRYPTION_KEY nech ten původní v DANERO_ENCRYPTION_KEYS_OLD.',
  );
}

/**
 * Překlopení tajemství na aktuální klíč (rotace). Vrací nový šifrovaný text,
 * nebo null, když už pod aktuálním klíčem je — volající pak nemusí do DB psát.
 */
export function reencryptSecret(encoded: string): string | null {
  if (encoded.startsWith(`${versionTag(primaryKey())}.`)) return null;
  return encryptSecret(decryptSecret(encoded));
}
