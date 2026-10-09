import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTotpCode, TOTP_CODE_PATTERN } from '@/lib/auth-errors';
import {
  backupCodesClipboardText,
  manualEntryKey,
  twoFactorView,
  type TwoFactorSetup,
  type TwoFactorView,
} from '@/lib/two-factor-view';
import { TwoFactorSection } from '@/components/two-factor-section';

/**
 * L6b-03: záložní kódy zmizely v okamžiku, kdy uživatel potvrdil první kód.
 *
 * Úvodní věta vedla pořadím „naskenuj → potvrď → ulož“ a kdo ji splnil doslova,
 * dostal po potvrzení otázku „Záložní kódy máš uložené?“ nad prázdnou kartou.
 * Kódy přitom jinde vidět nejsou: po odchodu ze stránky je už nezná ani klient
 * a server je znovu nevydá. Co se má v kterém stavu ukázat, proto rozhoduje
 * čistá funkce; celou cestu prohlížečem hlídá E2E (`e2e/dvoufaktor.spec.ts`).
 */

/**
 * Stav komponenty (rozdělané nastavení, „právě ověřeno“) vzniká až odpovědí
 * serveru a bez prohlížeče ho nejde navodit. Vykreslení se proto zkouší tak, že
 * se komponentě podstrčí hotové rozhodnutí; dokud žádné podstrčené není, běží
 * skutečná `twoFactorView` — tu testují první dva bloky.
 */
const forced = vi.hoisted(() => ({ view: null as unknown }));
vi.mock('@/lib/two-factor-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/two-factor-view')>();
  return {
    ...actual,
    twoFactorView: (state: Parameters<typeof actual.twoFactorView>[0]) =>
      (forced.view as TwoFactorView | null) ?? actual.twoFactorView(state),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/lib/auth-client', () => ({ authClient: { twoFactor: {} } }));

afterEach(() => {
  forced.view = null;
});

// smyšlené hodnoty ve tvaru, v jakém je vydává plugin (kód 5 + 5 znaků, klíč base32)
const SETUP: TwoFactorSetup = {
  totpURI:
    'otpauth://totp/Danero:priklad%40priklad.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Danero&digits=6&period=30',
  backupCodes: ['aB3dE-fG7hJ', 'kL9mN-pQ2rS', 'tU4vW-xY6zA'],
};
const MANUAL_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('twoFactorView — co karta 2FA ukazuje (L6b-03)', () => {
  it('právě ověřeno: záložní kódy zůstávají vidět', () => {
    const view = twoFactorView({ enabled: false, setup: SETUP, verified: true });
    expect(view).toEqual({ kind: 'confirmed', backupCodes: SETUP.backupCodes });
  });

  it('kódy drží i po obnovení dat ze serveru, kdy už účet hlásí zapnuté 2FA', () => {
    // `router.refresh()` po potvrzení překlopí `enabled`, stav stránky ale zůstává
    const view = twoFactorView({ enabled: true, setup: SETUP, verified: true });
    expect(view).toEqual({ kind: 'confirmed', backupCodes: SETUP.backupCodes });
  });

  it('rozdělané nastavení ukazuje kódy i klíč pro ruční zadání zvlášť', () => {
    const view = twoFactorView({ enabled: false, setup: SETUP, verified: false });
    expect(view).toEqual({
      kind: 'setup',
      totpURI: SETUP.totpURI,
      manualKey: MANUAL_KEY,
      backupCodes: SETUP.backupCodes,
    });
  });

  it('zapnuté z dřívějška (po odchodu ze stránky) už kódy nemá odkud vzít', () => {
    expect(twoFactorView({ enabled: true, setup: null, verified: false })).toEqual({
      kind: 'enabled',
    });
  });

  it('vypnuté nabízí zapnutí', () => {
    expect(twoFactorView({ enabled: false, setup: null, verified: false })).toEqual({
      kind: 'offer',
    });
  });
});

describe('manualEntryKey — klíč pro ruční zadání do autentikátoru (L6b-03)', () => {
  it('vytáhne tajný klíč z adresy otpauth://', () => {
    expect(manualEntryKey(SETUP.totpURI)).toBe(MANUAL_KEY);
  });

  it('nezáleží na pořadí parametrů', () => {
    expect(
      manualEntryKey('otpauth://totp/Danero:a%40priklad.test?issuer=Danero&secret=MFRGGZDF'),
    ).toBe('MFRGGZDF');
  });

  it('bez klíče nebo nad nesmyslem vrátí null — karta pak ukáže jen celou adresu', () => {
    expect(manualEntryKey('otpauth://totp/Danero:a%40priklad.test?issuer=Danero')).toBeNull();
    expect(manualEntryKey('otpauth://totp/Danero?secret=')).toBeNull();
    expect(manualEntryKey('tohle není adresa')).toBeNull();
  });
});

describe('backupCodesClipboardText — obsah schránky po „Zkopírovat“ (L6b-03)', () => {
  it('každý kód na vlastním řádku, beze změny znaků', () => {
    expect(backupCodesClipboardText(SETUP.backupCodes)).toBe(
      'aB3dE-fG7hJ\nkL9mN-pQ2rS\ntU4vW-xY6zA',
    );
  });
});

describe('TwoFactorSection — vykreslení jednotlivých stavů', () => {
  const render = (view: TwoFactorView): string => {
    forced.view = view;
    return renderToStaticMarkup(createElement(TwoFactorSection, { enabled: false }));
  };
  // E2E sbírá kódy přes `locator('span')` — jiný prvek by spec rozbil
  const codeSpans = (html: string): string[] =>
    [...html.matchAll(/<span>([A-Za-z0-9]{5}-[A-Za-z0-9]{5})<\/span>/g)].map((match) => match[1]!);

  it('právě ověřeno: kódy jsou na stránce, jdou zkopírovat a otázka bez kódů je pryč (L6b-03)', () => {
    const html = render({ kind: 'confirmed', backupCodes: SETUP.backupCodes });
    expect(codeSpans(html)).toEqual(SETUP.backupCodes);
    expect(html).toContain('>Zkopírovat</button>');
    // text, podle kterého E2E pozná dokončené zapnutí
    expect(html).toContain('Dvoufaktorové ověření je aktivní');
    expect(html).toContain('dokud z téhle stránky neodejdeš');
    expect(html).not.toContain('Záložní kódy máš uložené?');
  });

  it('rozdělané nastavení: nejdřív uložit kódy, pak potvrdit; klíč je vidět samostatně (L6b-03)', () => {
    const html = render({
      kind: 'setup',
      totpURI: SETUP.totpURI,
      manualKey: MANUAL_KEY,
      backupCodes: SETUP.backupCodes,
    });
    expect(codeSpans(html)).toEqual(SETUP.backupCodes);
    expect(html).toContain('>Zkopírovat</button>');
    const save = html.indexOf('ulož si záložní kódy');
    const confirm = html.indexOf('Teprve pak zapnutí potvrď');
    expect(save).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(save);
    expect(html).toMatch(new RegExp(`<code[^>]*>${MANUAL_KEY}</code>`, 'v'));
    // celá adresa zůstává samostatným prvkem — E2E z ní čte tajemství
    expect(html).toMatch(/<p[^>]*>otpauth:\/\/totp\/[^<]+<\/p>/);
  });

  it('adresa bez klíče: karta ukáže jen ji, prázdný blok s klíčem nevznikne (L6b-03)', () => {
    const html = render({
      kind: 'setup',
      totpURI: 'otpauth://totp/Danero',
      manualKey: null,
      backupCodes: SETUP.backupCodes,
    });
    expect(html).not.toContain('<code');
    expect(html).toContain('otpauth://totp/Danero');
  });

  it('pole na první kód snese mezery a hlásí se jako jednorázový kód (L6b-06, L7-06)', () => {
    const html = render({
      kind: 'setup',
      totpURI: SETUP.totpURI,
      manualKey: MANUAL_KEY,
      backupCodes: SETUP.backupCodes,
    });
    const field = /<input[^>]*id="kod-2fa"[^>]*>/.exec(html)?.[0] ?? '';
    expect(field).toContain('autoComplete="one-time-code"');
    expect(field).toContain('title="Šest číslic z aplikace autentikátoru"');
    const pattern = /pattern="([^"]+)"/.exec(field)?.[1];
    expect(pattern).toBe(TOTP_CODE_PATTERN);
    expect(new RegExp(`^(?:${pattern})$`, 'v').test('123 456')).toBe(true);
  });

  it('zapnuté z dřívějška: kódy nejsou, karta řekne, že je neukáže a jak vzniknou nové (L6b-03)', () => {
    const html = render({ kind: 'enabled' });
    expect(codeSpans(html)).toEqual([]);
    expect(html).toContain('Záložní kódy už znovu neukážeme');
    expect(html).toContain('vypni a zapni znovu');
    expect(html).toContain('>Vypnout 2FA</button>');
  });
});

/**
 * Strážce nad zdrojákem: to, co vykreslení neukáže — že komponenta rozhodnutí
 * opravdu bere z `twoFactorView` nad vlastním stavem a že kód před odesláním čistí.
 */
describe('two-factor-section.tsx — napojení na twoFactorView a čištění kódu', () => {
  const source = readFileSync(
    join(import.meta.dirname, '..', 'components', 'two-factor-section.tsx'),
    'utf8',
  );

  it('zobrazení určuje twoFactorView, ne vlastní podmínky nad stavem (L6b-03)', () => {
    expect(source).toContain('twoFactorView({ enabled, setup, verified })');
    // tři dřívější větve — s nimi kódy po potvrzení neměl kdo vykreslit
    expect(source).not.toMatch(/if \((?:enabled && !setup|setup && !verified|verified)\)/);
  });

  it('do schránky jdou kódy přes backupCodesClipboardText (L6b-03)', () => {
    expect(source).toContain('clipboard.writeText(backupCodesClipboardText(codes))');
  });

  it('„123 456“ odejde na server jako „123456“ (L6b-06)', () => {
    expect(source).toMatch(/verifyTotp\(\{\s*code: normalizeTotpCode\(/);
    expect(normalizeTotpCode('123 456')).toBe('123456');
  });
});
