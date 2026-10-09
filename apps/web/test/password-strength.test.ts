import { describe, expect, it } from 'vitest';
import { isCommonPassword } from '@/lib/password-strength';

/**
 * L8a-04 (rozhodnutí R21): nejběžnější hesla se nepřijímají. Všechna hesla
 * tady mají aspoň 10 znaků — kratší odmítne už pravidlo o délce.
 */
describe('nejběžnější hesla (L8a-04, R21)', () => {
  it.each([
    // z nálezu
    '1234567890',
    'password12',
    // jeden znak nebo krátký kus dokola
    'aaaaaaaaaa',
    '1111111111',
    'abcabcabcabc',
    '1212121212',
    'passwordpassword',
    // řady, vzestupně i sestupně, i přes nulu
    '0123456789',
    '9876543210',
    '0987654321',
    '12345678901234',
    'abcdefghij',
    'zyxwvutsrq',
    // běžné slovo s číslicemi a znaménky kolem, bez ohledu na velikost písmen
    'Password123',
    'PASSWORD2024!',
    'heslo12345',
    'Heslo123456!',
    '2024qwerty!',
    'qwertyuiop',
    'qwertz123456',
    'admin12345',
    'iloveyou123',
    'danero2026',
    'hesloheslo12',
    'abcdefghijk123',
    // klávesnicové vzory z žebříčků
    '1q2w3e4r5t',
    '1qaz2wsx3edc',
    '1234554321',
  ])('odmítne „%s“', (password) => {
    expect(isCommonPassword(password)).toBe(true);
  });

  it.each([
    // věta nebo pár slov — přesně to, co formulář radí
    'kun-baterie-sponka',
    'Moje kočka má 4 tlapky',
    'spravny kun baterie',
    // náhodné řetězce
    'x7#Lq92mVb',
    'T9fk2LpQ8zXw',
    // číslice, které nejsou řada ani opakování
    '8305914726',
    '2718281828459',
    // běžné slovo uvnitř delšího hesla nevadí
    'heslo-k-danim-2026-zima',
    'mujpasswordjedlouhy',
    'adminovakocka77',
    // písmena se přes konec abecedy nepřetáčejí
    'wxyzabcdef',
  ])('přijme „%s“', (password) => {
    expect(isCommonPassword(password)).toBe(false);
  });

  it('mezery na krajích ani velikost písmen pravidlo neobejdou', () => {
    expect(isCommonPassword('  QWERTYUIOP  ')).toBe(true);
  });

  it('prázdný vstup není „běžné heslo“ — o něm rozhoduje pravidlo o délce', () => {
    expect(isCommonPassword('')).toBe(false);
  });
});
