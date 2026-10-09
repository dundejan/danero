/** Tvar ISIN: dvě písmena země, devět znaků národního kódu, kontrolní číslice. */
const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * Platný ISIN podle ISO 6166: správný tvar A sedící kontrolní číslice.
 *
 * Číslice je tam právě proto, aby se překlep poznal při zadání: písmena se
 * převedou na čísla (A = 10 … Z = 35), vzniklá řada číslic se projde zprava
 * Luhnovým algoritmem a součet musí být dělitelný deseti. Chytí každou jednu
 * špatně opsanou číslici a skoro každé přehození dvou sousedních (jen 0 ↔ 9
 * ne) — platný ISIN jiného titulu ale samozřejmě nepozná.
 *
 * Čeká už srovnaný vstup (velká písmena, bez mezer); náhradní identifikátory
 * univerzální šablony (`CFD:…`, krypto) ISIN nejsou a neprojdou.
 */
export function isValidIsin(isin: string): boolean {
  if (!ISIN_SHAPE.test(isin)) return false;
  const digits = [...isin]
    .map((char) => (char >= 'A' ? String(char.charCodeAt(0) - 55) : char))
    .join('');
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[digits.length - 1 - index]);
    // každá druhá číslice zprava (kontrolní je první) se zdvojuje
    const value = index % 2 === 1 ? digit * 2 : digit;
    sum += value > 9 ? value - 9 : value;
  }
  return sum % 10 === 0;
}
