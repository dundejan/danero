import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Otisky hesel: scrypt z `node:crypto` s tvrdšími parametry, než má Better Auth
 * ve výchozím stavu (E-8 z auditu).
 *
 * Nejdřív jsem sem dal Argon2id, protože ho doporučuje OWASP — a bylo to horší
 * rozhodnutí. Změřeno:
 *
 * | varianta                         | paměť   | čas    | blokuje event loop |
 * |----------------------------------|---------|--------|--------------------|
 * | Argon2id 19 MiB (čistě v JS)     |  19 MiB | 450 ms | ANO                |
 * | scrypt Better Auth (N=2^14,r=16) |  32 MiB |  72 ms | ne                 |
 * | scrypt tady (N=2^16, r=8)        |  64 MiB | 146 ms | ne                 |
 * | scrypt OWASP (N=2^17, r=8)       | 128 MiB | 294 ms | ne                 |
 *
 * Argon2id byl tedy paměťově SLABŠÍ než scrypt, který nahrazoval (19 vs 32 MiB),
 * a přitom 6× pomalejší — jediná dostupná implementace je čistě v JS a blokuje
 * event loop. Nativní scrypt jede na libuv threadpoolu: čtyři souběžná
 * přihlášení odbaví za 173 ms, kdežto blokující Argon2id by je seřadil za sebe.
 * Algoritmus je jen tak dobrý, jak dobře ho umí spustit runtime.
 *
 * Parametry `N=65536, r=8, p=1` = 64 MiB, tedy dvojnásobek toho, co dává Better
 * Auth, a spodní patro doporučení OWASP pro scrypt. Zvednout na 128 MiB
 * (`N=131072`) je změna jednoho čísla — cena je ~300 ms na přihlášení.
 *
 * Formát je PHC řetězec, takže z otisku je poznat, čím vznikl:
 * `$scrypt$N=65536,r=8,p=1$<sůl>$<otisk>`.
 */
const COST = 65_536; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const SALT_BYTES = 16;
const HASH_BYTES = 64;
const PREFIX = '$scrypt$';
/** scrypt si hlídá strop paměti sám — bez zvednutí by 64 MiB odmítl. */
const MAX_MEM = 256 * 1024 * 1024;

const b64 = (data: Uint8Array): string => Buffer.from(data).toString('base64');

function derive(
  password: string,
  salt: Uint8Array,
  params: { N: number; r: number; p: number; dkLen: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC jako Better Auth — jinak by se týž znak zadaný jinou klávesnicí
    // otiskl jinak a uživatel by se nepřihlásil
    scrypt(
      password.normalize('NFKC'),
      salt,
      params.dkLen,
      { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const hash = await derive(password, salt, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    dkLen: HASH_BYTES,
  });
  return `${PREFIX}N=${COST},r=${BLOCK_SIZE},p=${PARALLELISM}$${b64(salt)}$${b64(hash)}`;
}

/**
 * Ověření otisku. Otisky, které nevznikly tady (výchozí formát Better Authu),
 * se ověřují jeho původní funkcí — jinak by se po změně parametrů nikdo se
 * starým účtem nepřihlásil. Poškozený otisk je selhání ověření, ne pád
 * endpointu: jinak by jeden rozbitý řádek vracel 500 místo „špatné heslo".
 */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  if (!hash.startsWith(PREFIX)) {
    try {
      const { verifyPassword: legacyVerify } = await import('better-auth/crypto');
      return await legacyVerify({ hash, password });
    } catch {
      return false;
    }
  }
  const parts = hash.split('$');
  // ['', 'scrypt', 'N=…,r=…,p=…', salt, hash]
  if (parts.length !== 5) return false;
  const params = Object.fromEntries(
    parts[2]!.split(',').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, Number(value)];
    }),
  );
  const salt = new Uint8Array(Buffer.from(parts[3]!, 'base64'));
  const expected = Buffer.from(parts[4]!, 'base64');
  try {
    const actual = await derive(password, salt, {
      N: params.N ?? COST,
      r: params.r ?? BLOCK_SIZE,
      p: params.p ?? PARALLELISM,
      dkLen: expected.length,
    });
    // konstantní čas: délku porovnat zvlášť, timingSafeEqual na různých délkách vyhodí
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
