import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEmailSender } from '@/lib/email';

/**
 * K5-11: odesílání e-mailu bylo jediné volání cizí služby bez časového stropu.
 * Resend 4.8 volá holý `fetch` bez `signal` (a vlastní `AbortSignal` neumí
 * přijmout), takže se čekalo, dokud se neozve undici se svým `headersTimeout`
 * — 300 s. Jeden zaseknutý e-mail sežral 300 z 800 s `maxDuration`
 * notifikačního cronu a dva ho zabily; na témž volání přitom visí i obnova
 * hesla a ověřovací e-mail, kde na odpověď čeká živý člověk.
 *
 * Ostatní volání strop mají (ČNB 60 s, T212 30/60 s, IBKR 60 s, štafeta 10 s).
 *
 * Zasekává se `fetch`, takže se podstrkuje `fetch`, ne balíček `resend`:
 * ten je pro vitest externí modul, jeho mock by tiše vypadl a test by šel
 * po síti do Resendu (ověřeno — vrátil „API key is invalid").
 */
const zprava = { to: 'jan@danero.cz', subject: 'Obnova hesla do Danera', text: 'odkaz' };

/** Jeden průchod smyčkou událostí — pod falešnými časovači jediný způsob, jak pustit ke slovu skutečné I/O. */
const tik = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe('odesílání e-mailu má časový strop (K5-11)', () => {
  it('mlčící Resend skončí chybou, ne čekáním do konce invokace', async () => {
    process.env.RESEND_API_KEY = 're_test';

    // Nejdřív jedno normální odeslání: `lib/email.ts` si `resend` natahuje
    // dynamickým importem a ten pod falešnými časovači nedoběhne. Zahřátý
    // modul pak druhé volání dosáhne až na `fetch` bez čekání na I/O.
    vi.stubGlobal('fetch', async () => Response.json({ id: 'msg_1' }));
    await resolveEmailSender()(zprava);

    let dotazu = 0;
    vi.stubGlobal('fetch', () => {
      dotazu += 1;
      // spojení, které se otevře a už nikdy neodpoví
      return new Promise(() => {});
    });
    // `setImmediate` musí zůstat skutečný, jinak se test nemá čím posunout
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    let vysledek: string | null = null;
    void resolveEmailSender()(zprava).then(
      () => {
        vysledek = 'odesláno';
      },
      (error: unknown) => {
        vysledek = `chyba: ${(error as Error).message}`;
      },
    );

    // Strop je 15 s. Posouváme po sekundách a mezi posuny pouštíme ke slovu
    // smyčku událostí — cesta k `fetch` vede přes dynamický import i přes
    // vnitřní čekání knihovny, a čekat jen na průchody smyčkou (nebo naopak
    // skočit rovnou o 20 s) je závod, který na vytíženém stroji prohrává.
    for (let i = 0; i < 40 && vysledek === null; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      await tik();
    }
    expect(dotazu).toBe(1);

    // vypršení se musí chovat jako SELHÁNÍ odeslání — na tom stojí vrácení
    // claimu u digestu i u potvrzení objednávky a hláška uživateli u obnovy hesla
    expect(vysledek ?? 'odeslání pořád visí').toMatch(/^chyba: Resend neodpověděl do 15 s/);
  });

  it('e-mail, který se odeslat stihne, strop nezdrží', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.stubGlobal('fetch', async () => Response.json({ id: 'msg_1' }));

    await expect(resolveEmailSender()(zprava)).resolves.toBeUndefined();
  });
});
