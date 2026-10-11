import { describe, expect, it } from 'vitest';
import {
  encodeLeavingDraft,
  LEAVING_DRAFT_TTL_MS,
  leavingDraftFor,
} from '@/lib/leaving-draft';

/**
 * Poznámka o rozepsaném textu, se kterým stránka odcházela (F5). Nová stránka
 * si text převezme jen tehdy, když je to tentýž formulář ve stejném stavu
 * a odchod byl před chvílí — jinak platí, co poslal server.
 */
const AT = 1_000_000;
const left = encodeLeavingDraft({
  endpoint: '/api/settings/profile',
  pathname: '/nastaveni',
  baseline: 'ostatni-prijmy=0&parovani=FIFO',
  at: AT,
  fields: { 'ostatni-prijmy': '5000' },
});
const form = {
  endpoint: '/api/settings/profile',
  pathname: '/nastaveni',
  baseline: 'ostatni-prijmy=0&parovani=FIFO',
  now: AT + 800,
};

describe('rozepsaný text po F5', () => {
  it('tentýž formulář ve stejném stavu si text převezme', () => {
    expect(leavingDraftFor(left, form)).toEqual({ 'ostatni-prijmy': '5000' });
  });

  it('jakmile server poslal jiný stav, uložení už doběhlo a text se nevrací', () => {
    expect(
      leavingDraftFor(left, { ...form, baseline: 'ostatni-prijmy=5000&parovani=FIFO' }),
    ).toBeNull();
    // ani když se mezitím změnilo něco jiného (druhé zařízení)
    expect(leavingDraftFor(left, { ...form, baseline: 'ostatni-prijmy=0&parovani=LIFO' })).toBeNull();
  });

  it('jiný formulář ani jiná stránka text nedostane', () => {
    expect(leavingDraftFor(left, { ...form, endpoint: '/api/settings/notifications' })).toBeNull();
    expect(leavingDraftFor(left, { ...form, pathname: '/nastaveni/upozorneni' })).toBeNull();
  });

  it('stará poznámka neplatí — návrat po čase ukáže stav ze serveru', () => {
    expect(leavingDraftFor(left, { ...form, now: AT + LEAVING_DRAFT_TTL_MS })).not.toBeNull();
    expect(leavingDraftFor(left, { ...form, now: AT + LEAVING_DRAFT_TTL_MS + 1 })).toBeNull();
    // hodiny posunuté zpět
    expect(leavingDraftFor(left, { ...form, now: AT - 1 })).toBeNull();
  });

  it('chybějící nebo poškozená poznámka nic nevrací', () => {
    for (const raw of [
      null,
      '',
      'nesmysl',
      '{}',
      'null',
      JSON.stringify({ ...JSON.parse(left), fields: { 'ostatni-prijmy': 5000 } }),
      JSON.stringify({ ...JSON.parse(left), at: 'včera' }),
    ]) {
      expect(leavingDraftFor(raw, form), String(raw)).toBeNull();
    }
  });
});
