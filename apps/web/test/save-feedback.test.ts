import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announce,
  currentFeedback,
  dismissFeedback,
  FEEDBACK_MAX_AGE_MS,
  feedbackIsFor,
  refreshFromServer,
  refreshSettled,
  setRefresher,
  subscribeToFeedback,
} from '@/lib/save-feedback';

/**
 * Úložiště hlášek auto-save žije déle než rozložení aplikace. Do revize R7
 * (M1) se hláška nikdy nemazala: po návratu z veřejné stránky se „Uloženo…“
 * ukázalo znovu a po odhlášení ho viděl i další účet přihlášený v témže panelu.
 */
const NOW = 1_000_000;

beforeEach(() => {
  dismissFeedback();
  setRefresher(null);
});

describe('hláška auto-save', () => {
  it('nová hláška nahradí předchozí a má vlastní číslo', () => {
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    const first = currentFeedback();
    announce('ok', 'Uloženo.', 'ucet-a', NOW + 1);
    const second = currentFeedback();
    expect(first).toMatchObject({ kind: 'ok', text: 'Uloženo.', owner: 'ucet-a', at: NOW });
    // totéž znění podruhé se musí ukázat znovu
    expect(second!.id).not.toBe(first!.id);
  });

  it('hláška, která zmizela z obrazovky, se maže a znovu se neukáže', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeToFeedback(seen);
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    const { id } = currentFeedback()!;
    dismissFeedback(id);
    expect(currentFeedback()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('zavření staré hlášky nesmaže tu, která ji mezitím nahradila', () => {
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    const { id } = currentFeedback()!;
    announce('chyba', 'Zadej částku.', 'ucet-a', NOW + 1);
    dismissFeedback(id);
    expect(currentFeedback()).toMatchObject({ kind: 'chyba' });
  });

  it('odhlášení úložiště vyprázdní', () => {
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    dismissFeedback();
    expect(currentFeedback()).toBeNull();
  });

  it('cizímu účtu se hláška neukáže', () => {
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    const feedback = currentFeedback()!;
    expect(feedbackIsFor(feedback, 'ucet-a', NOW)).toBe(true);
    expect(feedbackIsFor(feedback, 'ucet-b', NOW)).toBe(false);
  });

  it('rozložení, které vzniklo dlouho po hlášce, ji neukáže; uložení při odchodu ano', () => {
    announce('ok', 'Uloženo.', 'ucet-a', NOW);
    const feedback = currentFeedback()!;
    // odchod z Nastavení: odpověď přišla těsně před tím, než vzniklo nové rozložení
    expect(feedbackIsFor(feedback, 'ucet-a', NOW + FEEDBACK_MAX_AGE_MS)).toBe(true);
    // návrat do aplikace po čase
    expect(feedbackIsFor(feedback, 'ucet-a', NOW + FEEDBACK_MAX_AGE_MS + 1)).toBe(false);
    // hláška, která vznikla až po rozložení, se ukáže vždy
    expect(feedbackIsFor(feedback, 'ucet-a', NOW - 60_000)).toBe(true);
  });
});

/**
 * Dotažení stránky ze serveru: po ztracené odpovědi (R7, M2) se formulář
 * odemkne, až když je nový stav opravdu na obrazovce — proto slib.
 */
describe('dotažení stránky ze serveru', () => {
  it('bez rozložení aplikace není co dotahovat — slib se splní hned', async () => {
    await expect(refreshFromServer()).resolves.toBeUndefined();
  });

  it('slib se splní, až rozložení ohlásí, že dotažení doběhlo', async () => {
    const refresh = vi.fn();
    setRefresher(refresh);
    let done = false;
    const pending = refreshFromServer().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    refreshSettled();
    await pending;
    expect(done).toBe(true);
  });

  it('rozložení, které zaniklo uprostřed dotažení, čekající nenechá viset', async () => {
    setRefresher(() => {});
    const pending = refreshFromServer();
    setRefresher(null);
    await expect(pending).resolves.toBeUndefined();
  });
});
