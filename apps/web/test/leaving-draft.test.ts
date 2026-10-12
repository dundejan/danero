import { describe, expect, it } from 'vitest';
import {
  encodeLeavingDraft,
  LEAVING_DRAFT_TTL_MS,
  leavingDraftFor,
} from '@/lib/leaving-draft';

/**
 * Poznámka o rozepsaném textu, se kterým stránka odcházela (F5). Nová stránka
 * si text převezme jen tehdy, když je to tentýž formulář, odchod byl před
 * chvílí a pole od serveru dostalo pořád tu hodnotu, se kterou stará stránka
 * odcházela — jinak platí, co poslal server.
 */
const AT = 1_000_000;
const left = encodeLeavingDraft({
  endpoint: '/api/settings/profile',
  owner: 'ucet-a',
  pathname: '/nastaveni',
  at: AT,
  fields: { 'ostatni-prijmy': { from: '0', text: '5000' } },
});
const form = {
  endpoint: '/api/settings/profile',
  owner: 'ucet-a',
  pathname: '/nastaveni',
  now: AT + 800,
  served: { 'ostatni-prijmy': '0' },
};

describe('rozepsaný text po F5', () => {
  it('pole, které od serveru dostalo starou hodnotu, si text převezme', () => {
    expect(leavingDraftFor(left, form)).toEqual({ 'ostatni-prijmy': '5000' });
  });

  it('jakmile server poslal jinou hodnotu, text se nevrací', () => {
    // uložení už doběhlo
    expect(leavingDraftFor(left, { ...form, served: { 'ostatni-prijmy': '5000' } })).toEqual({});
    // nebo pole mezitím změnil někdo jinde — jeho hodnotu nepřepisujeme
    expect(leavingDraftFor(left, { ...form, served: { 'ostatni-prijmy': '120' } })).toEqual({});
    // pole, které formulář nemá
    expect(leavingDraftFor(left, { ...form, served: {} })).toEqual({});
  });

  it('změna jiného pole jinde převzetí nebrání', () => {
    // dřív se srovnával stav celého formuláře a částka po F5 zmizela z obrazovky,
    // přestože byla uložená (změřeno: párování změněné na druhém zařízení)
    expect(
      leavingDraftFor(left, { ...form, served: { 'ostatni-prijmy': '0', poznamka: 'jiná' } }),
    ).toEqual({ 'ostatni-prijmy': '5000' });
  });

  it('jiný formulář ani jiná stránka text nedostane', () => {
    expect(leavingDraftFor(left, { ...form, endpoint: '/api/settings/notifications' })).toEqual({});
    expect(leavingDraftFor(left, { ...form, pathname: '/nastaveni/upozorneni' })).toEqual({});
  });

  it('jinému účtu se text nenabídne (R7, D3)', () => {
    // odhlášení v jiném panelu poznámku nesmaže — úložiště je pro každý panel zvlášť
    expect(leavingDraftFor(left, { ...form, owner: 'ucet-b' })).toEqual({});
    expect(leavingDraftFor(left, { ...form, owner: '' })).toEqual({});
    // poznámka ze starší verze aplikace označení nenese
    const withoutOwner = JSON.parse(left) as Record<string, unknown>;
    delete withoutOwner.owner;
    expect(leavingDraftFor(JSON.stringify(withoutOwner), form)).toEqual({});
  });

  it('stará poznámka neplatí — návrat po čase ukáže stav ze serveru', () => {
    expect(leavingDraftFor(left, { ...form, now: AT + LEAVING_DRAFT_TTL_MS })).not.toEqual({});
    expect(leavingDraftFor(left, { ...form, now: AT + LEAVING_DRAFT_TTL_MS + 1 })).toEqual({});
    // hodiny posunuté zpět
    expect(leavingDraftFor(left, { ...form, now: AT - 1 })).toEqual({});
  });

  it('chybějící nebo poškozená poznámka nic nevrací', () => {
    for (const raw of [
      null,
      '',
      'nesmysl',
      '{}',
      'null',
      JSON.stringify({ ...JSON.parse(left), fields: { 'ostatni-prijmy': '5000' } }),
      JSON.stringify({ ...JSON.parse(left), fields: { 'ostatni-prijmy': { from: 0, text: '5' } } }),
      JSON.stringify({ ...JSON.parse(left), at: 'včera' }),
    ]) {
      expect(leavingDraftFor(raw, form), String(raw)).toEqual({});
    }
  });
});
