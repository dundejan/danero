import { redirect } from 'next/navigation';
import { describe, expect, it } from 'vitest';
import { inPlaceDestination, redirectDestination, runInPlace } from '@/lib/redirect-in-place';

/**
 * R4-10: uložení na stránce upozornění obaluje akci, aby stránka po uložení
 * neodrolovala nahoru. Obal ale spolkl JAKÉKOLI přesměrování vnitřní akce
 * a vždy poslal „Uloženo“ — chybová větev, limit nebo vypršelé přihlášení
 * uvnitř akce by tak skončily zeleným potvrzením. Kotvu smí dostat jen
 * úspěšný návrat na tutéž stránku.
 */

/** Výjimka, kterou vyhodí skutečné `redirect()` z Nextu (bez obcházení). */
function redirectError(url: string): unknown {
  try {
    redirect(url);
  } catch (error) {
    return error;
  }
  throw new Error('redirect() nic nevyhodil');
}

const PAGE = '/nastaveni/upozorneni';

describe('cíl přesměrování z výjimky Nextu', () => {
  it('přečte adresu ze skutečné výjimky redirect()', () => {
    expect(redirectDestination(redirectError('/nastaveni/upozorneni?ok=notifikace'))).toBe(
      '/nastaveni/upozorneni?ok=notifikace',
    );
    // adresa smí nést středník i kotvu
    expect(redirectDestination(redirectError('/import?a=1;b=2#historie'))).toBe(
      '/import?a=1;b=2#historie',
    );
  });

  it('obyčejná výjimka přesměrování není', () => {
    expect(redirectDestination(new Error('spadla databáze'))).toBeNull();
    expect(
      redirectDestination(Object.assign(new Error('x'), { digest: 'NEXT_NOT_FOUND' })),
    ).toBeNull();
    expect(redirectDestination(null)).toBeNull();
    expect(redirectDestination('NEXT_REDIRECT;replace;/x;307;')).toBeNull();
  });
});

describe('kotva jen pro úspěšný návrat na tutéž stránku', () => {
  it('úspěch na téže stránce dostane kotvu', () => {
    expect(inPlaceDestination(redirectError(`${PAGE}?ok=notifikace`), PAGE, 'ulozeno')).toBe(
      `${PAGE}?ok=notifikace#ulozeno`,
    );
  });

  it('chybu vnitřní akce nepřepíše na „Uloženo“', () => {
    expect(inPlaceDestination(redirectError(`${PAGE}?chyba=limit`), PAGE, 'ulozeno')).toBeNull();
    // ani kdyby adresa nesla obojí
    expect(
      inPlaceDestination(redirectError(`${PAGE}?ok=notifikace&chyba=limit`), PAGE, 'ulozeno'),
    ).toBeNull();
    // návrat bez potvrzení není úspěch, o kterém by obal věděl
    expect(inPlaceDestination(redirectError(PAGE), PAGE, 'ulozeno')).toBeNull();
  });

  it('přesměrování jinam propustí beze změny', () => {
    for (const url of [
      '/prihlaseni',
      '/nastaveni?ok=profil',
      '/nastaveni/upozorneni/jinde?ok=notifikace',
      'https://jinde.example/nastaveni/upozorneni?ok=notifikace',
      '//jinde.example/nastaveni/upozorneni?ok=notifikace',
    ]) {
      expect(inPlaceDestination(redirectError(url), PAGE, 'ulozeno'), url).toBeNull();
    }
  });

  it('opravdová výjimka zůstává výjimkou', () => {
    expect(inPlaceDestination(new Error('spadla databáze'), PAGE, 'ulozeno')).toBeNull();
  });
});

describe('obal akce', () => {
  it('úspěšné akci doplní kotvu', async () => {
    await expect(
      runInPlace(async () => redirect(`${PAGE}?ok=notifikace`), PAGE, 'ulozeno'),
    ).resolves.toBe(`${PAGE}?ok=notifikace#ulozeno`);
  });

  it('chybové přesměrování akce propustí — nesmí z něj být „Uloženo“', async () => {
    const run = runInPlace(async () => redirect(`${PAGE}?chyba=limit`), PAGE, 'ulozeno');
    await expect(run).rejects.toSatisfy(
      (error) => redirectDestination(error) === `${PAGE}?chyba=limit`,
    );
  });

  it('přesměrování na přihlášení propustí', async () => {
    const run = runInPlace(async () => redirect('/prihlaseni'), PAGE, 'ulozeno');
    await expect(run).rejects.toSatisfy((error) => redirectDestination(error) === '/prihlaseni');
  });

  it('výjimku akce nepolkne', async () => {
    await expect(
      runInPlace(
        async () => {
          throw new Error('spadla databáze');
        },
        PAGE,
        'ulozeno',
      ),
    ).rejects.toThrow('spadla databáze');
  });

  it('akce bez přesměrování nechá potvrzení na obalu', async () => {
    await expect(runInPlace(async () => undefined, PAGE, 'ulozeno')).resolves.toBeNull();
  });
});
