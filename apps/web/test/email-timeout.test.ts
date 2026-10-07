import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveEmailSender } from '@/lib/email';

/**
 * K5-11: odesílání e-mailu bylo jediné volání cizí služby bez časového stropu.
 * Resend 4.8 volá holý `fetch` bez `signal` (a vlastní `AbortSignal` neumí
 * přijmout), takže se čekalo, dokud se neozve undici se svým `headersTimeout`
 * — 300 s, tedy celý `maxDuration` notifikačního cronu na jediný zaseknutý
 * e-mail; na témž volání přitom visí i obnova hesla a ověřovací e-mail, kde
 * na odpověď čeká živý člověk.
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

    // Nejdřív nechat odeslání dojít až k `fetch` — BEZ posunu hodin. Cesta
    // k němu vede přes dynamický import a vnitřní čekání knihovny, tedy přes
    // skutečné I/O, a to pod zátěží trvá. Dokud se hodiny posouvaly souběžně,
    // šlo o závod: na vytíženém stroji (naposledy v CI 8. 10. 2026) uběhlo
    // falešných 15 s dřív, než se `fetch` vůbec zavolal, strop zafungoval nad
    // ničím a test hlásil nula dotazů. `advanceTimersByTimeAsync(0)` pustí jen
    // časovače splatné hned (kdyby je knihovna po cestě potřebovala).
    for (let i = 0; i < 20_000 && dotazu === 0 && vysledek === null; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await tik();
    }
    expect(dotazu).toBe(1);
    // spojení visí a hodiny stojí → odeslání ještě nesmí být rozhodnuté
    expect(vysledek).toBeNull();

    // Teprve teď běží čas. Strop je 15 s; po sekundách, ať mezi posuny dostane
    // slovo i smyčka událostí.
    for (let i = 0; i < 40 && vysledek === null; i += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      await tik();
    }

    // vypršení se musí chovat jako SELHÁNÍ odeslání — na tom stojí vrácení
    // claimu u digestu a hláška uživateli u obnovy hesla
    expect(vysledek ?? 'odeslání pořád visí').toMatch(/^chyba: Resend neodpověděl do 15 s/);
  });

  it('e-mail, který se odeslat stihne, strop nezdrží', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.stubGlobal('fetch', async () => Response.json({ id: 'msg_1' }));

    await expect(resolveEmailSender()(zprava)).resolves.toBeUndefined();
  });
});
