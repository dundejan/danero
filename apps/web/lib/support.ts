import type { EnvSource } from '@/lib/contact';

/**
 * Dobrovolný příspěvek na provoz — jediné místo, kde Danero zmiňuje peníze.
 *
 * Danero je zdarma celé a příspěvek NIC neodemyká. To není jen slib, je to
 * i podmínka hostingu: hostovaná instance běží na Vercel Hobby, který dovoluje
 * žádat o dary, ale ne cokoli prodávat („Asking for Donations does not fall
 * under commercial usage“, Fair Use Guidelines). Jakmile by příspěvek něco
 * odemykal, je to prodej a tarif přestává stačit.
 *
 * Údaje jdou z prostředí, ne z repozitáře — stejné pravidlo jako u identifikace
 * provozovatele (`lib/contact.ts`): číslo účtu konkrétního člověka nepatří do
 * veřejného kódu, který si smí kdokoli rozjet sám. Bez proměnných se sekce
 * o podpoře prostě nevykreslí.
 *
 * - `DANERO_SUPPORT_IBAN` — český IBAN, na který jde příspěvek poslat
 *   (z něj se skládá QR platba i číslo účtu v českém tvaru),
 * - `DANERO_SUPPORT_URL` — odkaz na stránku, kde jde přispět kartou
 *   (např. GitHub Sponsors).
 */
export interface SupportOptions {
  /** IBAN bez mezer, nebo `null`, když není nastavený nebo je neplatný. */
  iban: string | null;
  /** Číslo účtu v českém tvaru `předčíslí-číslo/kód banky`. */
  accountNumber: string | null;
  /** Řetězec QR platby (formát SPAYD) — bez částky, tu si zvolí přispěvatel. */
  paymentCode: string | null;
  /** Odkaz na příspěvek kartou, nebo `null`. */
  url: string | null;
}

/** Zpráva pro příjemce v QR platbě — bez diakritiky, banky ji jinak komolí. */
const PAYMENT_MESSAGE = 'DANERO PRISPEVEK';

/** Kontrolní součet IBAN (ISO 13616): po přeskládání a převodu písmen mod 97 = 1. */
function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/**
 * Český IBAN má pevný tvar `CZkk BBBB PPPPPP CCCCCCCCCC` — přesně 24 znaků:
 * kód banky, předčíslí a číslo účtu.
 */
const CZECH_IBAN = /^CZ\d{22}$/;

/**
 * Číslo účtu v běžném zápisu: nuly zleva se nepíšou a nulové předčíslí se
 * vynechává celé. Volá se jen nad IBAN, který prošel `CZECH_IBAN`.
 */
function czechAccountNumber(iban: string): string {
  const bank = iban.slice(4, 8);
  const prefix = iban.slice(8, 14).replace(/^0+/, '');
  const number = iban.slice(14).replace(/^0+/, '');
  return `${prefix ? `${prefix}-` : ''}${number}/${bank}`;
}

/** Odkaz smí být jen https — hodnota končí v `href` na veřejné stránce. */
function safeUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function supportFromEnv(env: EnvSource = process.env): SupportOptions {
  const raw = env.DANERO_SUPPORT_IBAN?.replace(/\s/g, '').toUpperCase() ?? '';
  // Tvar I kontrolní součet. Samotný součet nestačí: o znak kratší „český"
  // IBAN může součtem projít taky — vznikla by QR platba na neexistující účet
  // s prázdným číslem účtu pod ní, a health by hlásil, že je všechno v pořádku.
  // Cizí IBAN se nenabízí vůbec: QR platba je český standard a číslo účtu
  // skládáme z českého tvaru.
  const iban = CZECH_IBAN.test(raw) && isValidIban(raw) ? raw : null;
  return {
    iban,
    accountNumber: iban ? czechAccountNumber(iban) : null,
    paymentCode: iban ? `SPD*1.0*ACC:${iban}*CC:CZK*MSG:${PAYMENT_MESSAGE}` : null,
    url: safeUrl(env.DANERO_SUPPORT_URL),
  };
}

/** Je vůbec co nabídnout? Bez toho se sekce o podpoře nevykresluje. */
export function supportAvailable(options: SupportOptions): boolean {
  return options.paymentCode !== null || options.url !== null;
}

/** Nastavená, ale nepoužitelná hodnota — pro `/api/health`, ať překlep nezapadne. */
export function invalidSupportEnv(env: EnvSource = process.env): string[] {
  const options = supportFromEnv(env);
  const invalid: string[] = [];
  if (env.DANERO_SUPPORT_IBAN?.trim() && !options.iban) invalid.push('DANERO_SUPPORT_IBAN');
  if (env.DANERO_SUPPORT_URL?.trim() && !options.url) invalid.push('DANERO_SUPPORT_URL');
  return invalid;
}
