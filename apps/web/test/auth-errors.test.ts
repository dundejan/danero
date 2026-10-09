import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  backupCodeErrorMessage,
  credentialsErrorMessage,
  normalizeBackupCode,
  normalizeTotpCode,
  TOTP_CODE_PATTERN,
  TOTP_CODE_TITLE,
} from '@/lib/auth-errors';

/**
 * Hlášky přihlašovacího formuláře (revize 5, dávka C03). Formulář do té doby
 * sváděl každou chybu serveru na e-mail a heslo: uživatel se správným heslem
 * četl po šestém pokusu „zkontroluj e-mail a heslo“ a šel si heslo obnovovat.
 */

const SITE = { siteUrl: 'https://dane.priklad.test' };

/** Hlášky, které posílají uživatele opravovat údaje — u chyby serveru lžou. */
const BLAMES_CREDENTIALS = /zkontroluj e-mail/i;

describe('credentialsErrorMessage — přihlášení a registrace', () => {
  it('špatné heslo (401) má u přihlášení dál tutéž větu, kterou hledají E2E testy', () => {
    const message = credentialsErrorMessage(
      'prihlaseni',
      { status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' },
      SITE,
    );
    expect(message).toEqual({ text: 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.' });
  });

  it('odmítnutá registrace (400) dál radí s e-mailem a délkou hesla', () => {
    const message = credentialsErrorMessage(
      'registrace',
      { status: 400, code: 'PASSWORD_TOO_SHORT' },
      SITE,
    );
    expect(message).toEqual({
      text: 'Registrace se nepodařila. Zkontroluj e-mail a zvol heslo o délce aspoň 10 znaků.',
    });
  });

  it.each(['prihlaseni', 'registrace'] as const)(
    'L15-01: stav 429 u „%s“ řekne, že pokusů bylo moc, a neposílá opravovat heslo',
    (mode) => {
      const message = credentialsErrorMessage(mode, { status: 429 }, SITE);
      expect(message.text).toContain('příliš často');
      expect(message.text).toContain('za minutu');
      expect(message.text).not.toMatch(BLAMES_CREDENTIALS);
      expect(message.link).toBeUndefined();
    },
  );

  it.each([
    ['prihlaseni', 500],
    ['registrace', 500],
    ['prihlaseni', 503],
  ] as const)(
    'L15-01: chyba serveru u „%s“ (%i) přizná, že vada je na naší straně',
    (mode, status) => {
      const message = credentialsErrorMessage(mode, { status }, SITE);
      expect(message.text).toContain('na naší straně');
      expect(message.text).not.toMatch(BLAMES_CREDENTIALS);
    },
  );

  it.each(['prihlaseni', 'registrace'] as const)(
    'L15-02: INVALID_ORIGIN u „%s“ pošle na nastavenou adresu aplikace, ne opravovat heslo',
    (mode) => {
      const message = credentialsErrorMessage(
        mode,
        { status: 403, code: 'INVALID_ORIGIN' },
        { ...SITE, currentOrigin: 'https://alias.priklad.test' },
      );
      expect(message.text).not.toMatch(BLAMES_CREDENTIALS);
      expect(message.text).toContain('z téhle adresy');
      expect(message.link).toEqual({
        href: 'https://dane.priklad.test',
        label: 'dane.priklad.test',
      });
    },
  );

  it('L15-02: adresa v odkazu jde z nastavení instance, žádná není natvrdo', () => {
    const message = credentialsErrorMessage(
      'prihlaseni',
      { status: 403, code: 'INVALID_ORIGIN' },
      { siteUrl: 'http://localhost:3000' },
    );
    expect(message.link).toEqual({ href: 'http://localhost:3000', label: 'localhost:3000' });
    expect(JSON.stringify(message)).not.toContain('danero.cz');
  });

  it('L15-02: když už uživatel na nastavené adrese je, neposíláme ho na ni znovu', () => {
    const message = credentialsErrorMessage(
      'prihlaseni',
      { status: 403, code: 'INVALID_ORIGIN' },
      { ...SITE, currentOrigin: 'https://dane.priklad.test' },
    );
    expect(message.link).toBeUndefined();
    expect(message.text).toContain('nastavení aplikace');
    expect(message.text).not.toMatch(BLAMES_CREDENTIALS);
  });

  it('jiné 403 než INVALID_ORIGIN se pod hlášku o adrese neschová', () => {
    const message = credentialsErrorMessage('prihlaseni', { status: 403, code: 'JINY_KOD' }, SITE);
    expect(message).toEqual({ text: 'Přihlášení se nepodařilo. Zkontroluj e-mail a heslo.' });
  });
});

describe('normalizeTotpCode — kód z autentikátoru (L6b-06)', () => {
  it.each([
    ['123 456', '123456'],
    [' 123456 ', '123456'],
    ['123\u00a0456\n', '123456'],
    ['1 2 3 4 5 6', '123456'],
    ['123456', '123456'],
  ])('z %j zbude %j', (raw, expected) => {
    expect(normalizeTotpCode(raw)).toBe(expected);
  });

  it('nic jiného než bílé znaky neodstraňuje — o platnosti rozhoduje server', () => {
    expect(normalizeTotpCode('12a 456')).toBe('12a456');
  });

  it('pattern pole pustí kód s mezerami, pět číslic ani písmeno ne', () => {
    // Prohlížeč atribut `pattern` překládá s příznakem `v` a ukotvuje ho na celou hodnotu.
    const pattern = new RegExp(`^(?:${TOTP_CODE_PATTERN})$`, 'v');
    for (const accepted of ['123456', '123 456', ' 123456 ', '1 2 3 4 5 6']) {
      expect(pattern.test(accepted), accepted).toBe(true);
    }
    for (const rejected of ['12345', '1234567', '12a456', '', '   ']) {
      expect(pattern.test(rejected), rejected).toBe(false);
    }
  });

  it('co pattern pustí, to po očištění dá přesně šest číslic', () => {
    const pattern = new RegExp(`^(?:${TOTP_CODE_PATTERN})$`, 'v');
    for (const raw of ['123 456', ' 1 2 3 4 5 6 ', '123456\t']) {
      expect(pattern.test(raw)).toBe(true);
      expect(normalizeTotpCode(raw)).toMatch(/^\d{6}$/);
    }
  });

  it('nápověda k poli česky říká, jaký tvar se čeká', () => {
    expect(TOTP_CODE_TITLE.toLowerCase()).toContain('šest číslic');
  });
});

describe('normalizeBackupCode — záložní kód (L6b-10)', () => {
  // Tvar kódů pluginu: deset znaků a–z, A–Z, 0–9 s pomlčkou po pátém
  // (better-auth/dist/plugins/two-factor/backup-codes, generateBackupCodesFn).
  it.each([
    ['přesný opis', 'aB3dE-fG7hJ', 'aB3dE-fG7hJ'],
    ['mezery okolo', '  aB3dE-fG7hJ \n', 'aB3dE-fG7hJ'],
    ['bez pomlčky', 'aB3dEfG7hJ', 'aB3dE-fG7hJ'],
    ['mezera místo pomlčky', 'aB3dE fG7hJ', 'aB3dE-fG7hJ'],
    ['mezery kolem pomlčky', 'aB3dE - fG7hJ', 'aB3dE-fG7hJ'],
    ['dlouhá pomlčka z automatických oprav', 'aB3dE–fG7hJ', 'aB3dE-fG7hJ'],
    ['mezera jinde než uprostřed', 'aB3 dEfG7hJ', 'aB3dE-fG7hJ'],
  ])('%s: %j → %j', (_label, raw, expected) => {
    expect(normalizeBackupCode(raw)).toBe(expected);
  });

  it('velikost písmen nechává být — kódy ji rozlišují a porovnává je knihovna', () => {
    expect(normalizeBackupCode('ab3deFG7HJ')).toBe('ab3de-FG7HJ');
    expect(normalizeBackupCode('AB3DE FG7HJ')).toBe('AB3DE-FG7HJ');
  });

  it('co nemá deset znaků kódu, jen ořízne a nic si nedomýšlí', () => {
    expect(normalizeBackupCode(' aB3dE-fG7h ')).toBe('aB3dE-fG7h');
    expect(normalizeBackupCode('aB3dEfG7hJk')).toBe('aB3dEfG7hJk');
    expect(normalizeBackupCode('aB3dE_fG7hJ')).toBe('aB3dE_fG7hJ');
    expect(normalizeBackupCode('')).toBe('');
  });
});

describe('backupCodeErrorMessage — záložní kód (L6b-10)', () => {
  it('špatný kód: hláška zmíní pomlčku i velká a malá písmena', () => {
    const message = backupCodeErrorMessage({ status: 401, code: 'INVALID_BACKUP_CODE' });
    // začátek hledá e2e/dvoufaktor.spec.ts doslova
    expect(message).toContain('Záložní kód nesedí');
    expect(message).toContain('pomlčky');
    expect(message).toContain('velká a malá písmena');
  });

  it('vyčerpaná výzva netvrdí, že kód nesedí — odmítla by i správný', () => {
    const message = backupCodeErrorMessage({
      status: 400,
      code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
    });
    expect(message).not.toContain('nesedí');
    expect(message).toMatch(/přihlas se znovu heslem/i);
    expect(message).toContain('zkus to ještě jednou');
  });
});

describe('auth-form.tsx hlášky a úpravu kódů bere z lib/auth-errors', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'components', 'auth-form.tsx'),
    'utf8',
  );

  it('chybu přihlášení i registrace překládá credentialsErrorMessage s adresou z SITE_URL', () => {
    expect(source).toContain('credentialsErrorMessage(mode, result.error');
    expect(source).toContain('siteUrl: SITE_URL');
    // větve nesmí zůstat ve formuláři podruhé
    expect(source).not.toContain('Zkontroluj e-mail a heslo');
  });

  it('nepotvrzený účet se dál pozná podle kódu, ne podle stavu', () => {
    expect(source).toContain("result.error.code === 'EMAIL_NOT_VERIFIED'");
  });

  it('záložní kód i kód z autentikátoru se před odesláním upraví', () => {
    expect(source).toMatch(/verifyBackupCode\(\{\s*code: normalizeBackupCode\(/);
    expect(source).toMatch(/verifyTotp\(\{\s*code: normalizeTotpCode\(/);
    expect(source).toContain('backupCodeErrorMessage(result.error)');
  });

  it('pole na kód z autentikátoru má tolerantní pattern a český title', () => {
    expect(source).toContain('pattern={TOTP_CODE_PATTERN}');
    expect(source).toContain('title={TOTP_CODE_TITLE}');
    expect(source).not.toContain('pattern="\\d{6}"');
  });
});
