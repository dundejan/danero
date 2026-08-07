import { randomBytes, timingSafeEqual } from 'node:crypto';
import { argon2idAsync } from '@noble/hashes/argon2.js';

/**
 * Otisky hesel: Argon2id (E-8 z auditu). Better Auth má ve výchozím stavu
 * scrypt — legitimní KDF, ale Argon2id je dnešní doporučení OWASP a odolnější
 * proti GPU/ASIC útoku. Měnit ho jde jen dokud nejsou živé účty, proto teď.
 *
 * Parametry dle OWASP Password Storage Cheat Sheet (Argon2id): 19 MiB paměti,
 * 2 iterace, paralelismus 1.
 *
 * CENA (změřeno): otisk i ověření trvají ~450 ms, scrypt zvládne totéž za ~68 ms.
 * Přihlášení i registrace se tím prodlouží zhruba o půl vteřiny a na serverless
 * funkci je to blokující výpočet. Je to obvyklá cena za KDF odolný proti GPU
 * a brute force chrání i rate limit (5 pokusů/min), ale kdyby to vadilo, návrat
 * ke scryptu je odebrání bloku `password` v lib/auth.ts — staré otisky se pak
 * ověří dál, protože `verifyPassword` obě varianty rozpozná.
 *
 * Implementace je čistě v JS (`@noble/hashes`, který si Better Auth stejně
 * táhne) — žádná nativní závislost, takže to jede i v serverless funkci
 * beze změny buildu.
 *
 * Formát je standardní PHC řetězec, takže z otisku samotného je poznat, jak
 * vznikl: `$argon2id$v=19$m=19456,t=2,p=1$<sůl>$<otisk>`.
 */
const MEMORY_KIB = 19_456;
const ITERATIONS = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PREFIX = '$argon2id$';

const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2idAsync(password, salt, {
    m: MEMORY_KIB,
    t: ITERATIONS,
    p: PARALLELISM,
    dkLen: HASH_BYTES,
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const hash = await derive(password, salt);
  return `${PREFIX}v=19$m=${MEMORY_KIB},t=${ITERATIONS},p=${PARALLELISM}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Ověření otisku. Otisky, které nevznikly tady (scrypt z Better Authu), se
 * ověřují jeho původní funkcí — jinak by po přepnutí algoritmu nikdo se starým
 * účtem neprošel přihlášením. Produkce je sice prázdná, ale vlastní instance
 * pod AGPL prázdné nejsou.
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  // Poškozený otisk v databázi je selhání ověření, ne pád přihlašovacího
  // endpointu — jinak by jeden rozbitý řádek vracel 500 místo „špatné heslo".
  if (!hash.startsWith(PREFIX)) {
    try {
      const { verifyPassword: legacyVerify } = await import('better-auth/crypto');
      return await legacyVerify({ hash, password });
    } catch {
      return false;
    }
  }
  const parts = hash.split('$');
  // ['', 'argon2id', 'v=19', 'm=…,t=…,p=…', salt, hash]
  if (parts.length !== 6) return false;
  const params = Object.fromEntries(
    parts[3]!.split(',').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    }),
  );
  const salt = new Uint8Array(Buffer.from(parts[4]!, 'base64'));
  const expected = Buffer.from(parts[5]!, 'base64');
  const actual = Buffer.from(
    await argon2idAsync(password, salt, {
      m: params.m ?? MEMORY_KIB,
      t: params.t ?? ITERATIONS,
      p: params.p ?? PARALLELISM,
      dkLen: expected.length,
    }),
  );
  // konstantní čas: délku porovnat zvlášť, timingSafeEqual na různých délkách vyhodí
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
