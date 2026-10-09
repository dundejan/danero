/**
 * Nejběžnější hesla se nepřijímají (L8a-04, rozhodnutí R21).
 *
 * Jediné pravidlo bývala délka aspoň 10 znaků, takže prošlo `1234567890`
 * i `password12` — a účet přitom drží daňová data a klíče brokera. Tohle není
 * měřič síly hesla: odmítá jen to, co útočník zkusí jako první, a všechno
 * ostatní nechává být. Žádná cizí služba, žádný seznam uniklých hesel —
 * čistá funkce bez závislostí, ať jde zavolat ze serveru i z formuláře.
 *
 * Čtyři pravidla, všechna nad heslem převedeným na malá písmena:
 *  1. jeden znak dokola (`aaaaaaaaaa`) nebo krátký kus dokola (`abcabcabcabc`,
 *     `passwordpassword`),
 *  2. souvislá řada číslic nebo písmen abecedy, vzestupně i sestupně
 *     (`1234567890`, `9876543210`, `abcdefghij`),
 *  3. běžné slovo doplněné jen číslicemi a pár znaménky (`password12`,
 *     `heslo12345!`, `2024qwerty`),
 *  4. krátký seznam známých „klávesnicových“ hesel, která pravidla 1–3
 *     nechytí (`1q2w3e4r5t`, `qwertyuiop`).
 *
 * Seznamy jsou schválně krátké. Co do nich přidat: jen to, co má aspoň
 * 10 znaků (kratší heslo neprojde už délkou) a co je v žebříčcích nejčastějších
 * hesel, ne co „vypadá slabě“.
 */

/** Slova, která s číslicemi kolem sebe tvoří nejčastější hesla. */
const COMMON_WORDS = new Set([
  'password',
  'passwort',
  'passw0rd',
  'p@ssword',
  'p@ssw0rd',
  'heslo',
  'mojeheslo',
  'tajneheslo',
  'qwerty',
  'qwertz',
  'qwertyuiop',
  'qwertzuiop',
  'asdfghjkl',
  'zxcvbnm',
  'admin',
  'administrator',
  'welcome',
  'iloveyou',
  'miluju',
  'milujute',
  'letmein',
  'changeme',
  'monkey',
  'dragon',
  'football',
  'princess',
  'sunshine',
  'superman',
  'batman',
  'master',
  'login',
  'danero',
  'test',
  'tester',
  'user',
  'hello',
  'ahoj',
  'abc',
  'abcd',
  'abcde',
  'abcdef',
  'pass',
  'secret',
  'internet',
  'computer',
  'pocitac',
  'lokomotiva',
  'slunicko',
  'martin',
  'michael',
  'daniel',
  'jennifer',
]);

/** Hesla z žebříčků, která pravidla výš nechytí (klávesnicové vzory, zrcadla). */
const KNOWN_PASSWORDS = new Set([
  '1q2w3e4r5t',
  '1q2w3e4r5t6y',
  'q1w2e3r4t5',
  'q1w2e3r4t5y6',
  '1qaz2wsx3edc',
  '1qazxsw23edc',
  'zaq12wsxcde3',
  'qazwsxedcrfv',
  'qazwsxedc123',
  '123qweasdzxc',
  'qweasdzxc123',
  '1q2w3e4r5t6z',
  '12345qwert',
  'qwert12345',
  '12345qwertz',
  'qwertz12345',
  '1234554321',
  '1234512345',
  '1122334455',
  '1029384756',
  '1357924680',
  '2468013579',
  '0102030405',
  '1231231234',
  '147258369a',
  '1234567890a',
  'a1234567890',
  'a123456789',
  '123456789a',
  '123456789q',
  'q123456789',
  'asdfghjkl;',
  "asdfghjkl;'",
  'trustno1trustno1',
]);

const MIN_WORD_SEQUENCE = 5;

/** Nejkratší kus, jehož opakováním řetězec vznikl (aspoň dvakrát); jinak `null`. */
function repeatedBlock(text: string): string | null {
  for (let size = 1; size <= text.length / 2; size += 1) {
    if (text.length % size !== 0) continue;
    const block = text.slice(0, size);
    if (block.repeat(text.length / size) === text) return block;
  }
  return null;
}

/**
 * Jde každý znak o jedna za předchozím, nebo o jedna před ním? U číslic se
 * řada přetáčí přes nulu — `1234567890` je na klávesnici pořád jedna řada.
 * Písmena se nepřetáčejí.
 */
function isSequence(text: string): boolean {
  if (text.length < 2) return false;
  const digits = /^\d+$/.test(text);
  if (!digits && !/^[a-z]+$/.test(text)) return false;
  const step = (index: number): number => {
    const diff = text.charCodeAt(index) - text.charCodeAt(index - 1);
    return digits ? (diff + 10) % 10 : diff;
  };
  const first = step(1);
  const allowed = digits ? [1, 9] : [1, -1];
  if (!allowed.includes(first)) return false;
  for (let index = 2; index < text.length; index += 1) {
    if (step(index) !== first) return false;
  }
  return true;
}

/** Heslo bez číslic a znamének na začátku a na konci: `2024heslo123!` → `heslo`. */
const stripDecoration = (text: string): string =>
  text.replace(/^[\d\s!?.,_*#@$%&+=-]+/, '').replace(/[\d\s!?.,_*#@$%&+=-]+$/, '');

/** Je heslo z těch, která útočník zkusí jako první? */
export function isCommonPassword(password: string): boolean {
  const text = password.trim().toLowerCase();
  if (!text) return false;
  if (repeatedBlock(text) !== null) return true;
  if (isSequence(text)) return true;
  if (KNOWN_PASSWORDS.has(text)) return true;
  // samé číslice a znaménka: o těch rozhodla pravidla výš, dál jde o slovo
  const word = stripDecoration(text);
  if (!word) return false;
  if (COMMON_WORDS.has(word)) return true;
  // krátká řada (`de`, `ab`) je náhoda, ne heslo z žebříčku
  if (word.length >= MIN_WORD_SEQUENCE && isSequence(word)) return true;
  // totéž slovo víckrát za sebou s číslicemi kolem (`hesloheslo12`)
  const block = repeatedBlock(word);
  return block !== null && (block.length === 1 || COMMON_WORDS.has(block));
}

/** Věta pro formuláře, kde se heslo nastavuje (registrace, obnova, změna). */
export const COMMON_PASSWORD_MESSAGE =
  'Tohle heslo patří k těm, která se zkoušejí jako první. Zvol jiné — třeba pár slov za sebou, která ti dávají smysl jen spolu.';

/** Kód chyby, pod kterým to server vrací formulářům. */
export const COMMON_PASSWORD_CODE = 'PASSWORD_TOO_COMMON';
