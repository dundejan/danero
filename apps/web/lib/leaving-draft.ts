/**
 * Rozepsaný text, který se ukládal ve chvíli, kdy stránka zanikala.
 *
 * Při F5 odejde uložení rozepsané částky těsně před dotazem na novou stránku
 * a server je vyřizuje souběžně: nová stránka se většinou vykreslí dřív, než
 * se uložení zapíše, a ukáže starou hodnotu, přestože nová je uložená (změřeno
 * 11. 10. 2026 v Chromiu i Firefoxu). Člověk by ji psal znovu.
 *
 * Zanikající stránka si proto text poznamená do úložiště panelu a nová si ho
 * převezme: pokud ještě vidí stav, se kterým stará stránka odcházela, vrátí
 * text do pole a uloží ho obvyklou cestou (server, který ho mezitím zapsal,
 * podruhé nic nezapíše). Jakmile je stav jiný, uložení už doběhlo a platí, co
 * poslal server.
 *
 * Poznámka platí krátce a jen pro tentýž formulář na téže adrese se stejným
 * stavem — nesmí se z ní stát cesta, kterou se do nastavení vrátí stará hodnota.
 *
 * Čisté funkce bez DOM — úložiště si volající čte a zapisuje sám.
 */

/** Klíč v `sessionStorage`. */
export const LEAVING_DRAFT_KEY = 'danero:leaving-draft';

/** Jak dlouho po odchodu poznámka platí (ms). */
export const LEAVING_DRAFT_TTL_MS = 10_000;

interface LeavingDraft {
  /** Adresa uložení formuláře. */
  endpoint: string;
  /** Cesta stránky, ze které se odcházelo. */
  pathname: string;
  /** Stav formuláře při vykreslení (skryté pole `puvodni-stav`). */
  baseline: string;
  at: number;
  /** Rozepsaný text podle `name` pole. */
  fields: Record<string, string>;
}

export function encodeLeavingDraft(draft: LeavingDraft): string {
  return JSON.stringify(draft);
}

const isLeavingDraft = (value: unknown): value is LeavingDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.endpoint === 'string' &&
    typeof draft.pathname === 'string' &&
    typeof draft.baseline === 'string' &&
    typeof draft.at === 'number' &&
    typeof draft.fields === 'object' &&
    draft.fields !== null &&
    Object.values(draft.fields).every((text) => typeof text === 'string')
  );
};

/**
 * Text, který má formulář po načtení převzít; `null`, když poznámka chybí,
 * je poškozená, stará, patří jinému formuláři nebo se stav mezitím změnil.
 */
export function leavingDraftFor(
  raw: string | null,
  form: { endpoint: string; pathname: string; baseline: string; now: number },
): Record<string, string> | null {
  if (!raw) return null;
  let draft: unknown;
  try {
    draft = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isLeavingDraft(draft)) return null;
  const age = form.now - draft.at;
  return draft.endpoint === form.endpoint &&
    draft.pathname === form.pathname &&
    draft.baseline === form.baseline &&
    age >= 0 &&
    age <= LEAVING_DRAFT_TTL_MS
    ? draft.fields
    : null;
}
