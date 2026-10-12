/**
 * Rozepsaný text, který se ukládal ve chvíli, kdy stránka zanikala.
 *
 * Při F5 odejde uložení rozepsané částky těsně před dotazem na novou stránku
 * a server je vyřizuje souběžně: nová stránka se většinou vykreslí dřív, než
 * se uložení zapíše, a ukáže starou hodnotu, přestože nová je uložená (změřeno
 * 11. 10. 2026 v Chromiu i Firefoxu). Člověk by ji psal znovu.
 *
 * Zanikající stránka si proto text poznamená do úložiště panelu a nová si ho
 * převezme: pokud pole od serveru dostalo pořád tu hodnotu, se kterou stará
 * stránka odcházela, vrátí do něj text a uloží ho obvyklou cestou (server,
 * který ho mezitím zapsal, podruhé nic nezapíše). Jakmile server poslal jinou
 * hodnotu, uložení už doběhlo — nebo pole mezitím změnil někdo jinde —
 * a platí, co poslal server.
 *
 * Poznámka platí krátce a jen pro tentýž formulář téhož účtu na téže adrese;
 * odhlášení ji maže. Nesmí se z ní stát cesta, kterou se do nastavení vrátí
 * stará hodnota nebo text jiného účtu:
 * - píše se jen ve chvíli, kdy dokument opravdu zaniká (`pagehide`). Do revize
 *   R7 ji psalo i pouhé skrytí panelu a nikdo ji nemazal: kdo částku napsal,
 *   přepnul panel, vrátil se, přepsal ji zpátky a dal F5, dostal do pole
 *   i do databáze hodnotu, kterou právě zrušil;
 * - stránka, která žije dál (návrat z mezipaměti prohlížeče, panel zase
 *   vidět), ji zahodí;
 * - nese označení účtu a jinému účtu se nepoužije — odhlášení v JINÉM panelu
 *   ji smazat neumí, úložiště je pro každý panel zvlášť.
 */

/** Klíč v `sessionStorage`. */
const LEAVING_DRAFT_KEY = 'danero:leaving-draft';

/** Jak dlouho po odchodu poznámka platí (ms). */
export const LEAVING_DRAFT_TTL_MS = 10_000;

export interface LeavingDraft {
  /** Adresa uložení formuláře. */
  endpoint: string;
  /** Označení účtu, který text psal (`lib/owner-tag.ts`). */
  owner: string;
  /** Cesta stránky, ze které se odcházelo. */
  pathname: string;
  at: number;
  /** Podle `name` pole: hodnota, kterou pole dostalo od serveru, a rozepsaný text. */
  fields: Record<string, { from: string; text: string }>;
}

export function encodeLeavingDraft(draft: LeavingDraft): string {
  return JSON.stringify(draft);
}

const isLeavingDraft = (value: unknown): value is LeavingDraft => {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.endpoint === 'string' &&
    typeof draft.owner === 'string' &&
    typeof draft.pathname === 'string' &&
    typeof draft.at === 'number' &&
    typeof draft.fields === 'object' &&
    draft.fields !== null &&
    Object.values(draft.fields).every(
      (field: unknown) =>
        typeof field === 'object' &&
        field !== null &&
        typeof (field as { from?: unknown }).from === 'string' &&
        typeof (field as { text?: unknown }).text === 'string',
    )
  );
};

/** Formulář, který se po načtení ptá, jestli má co převzít. */
interface LoadedForm {
  endpoint: string;
  /** Označení přihlášeného účtu. */
  owner: string;
  pathname: string;
  now: number;
  /** Hodnoty textových polí, jak je poslal server (podle `name`). */
  served: Record<string, string>;
}

/**
 * Text, který má formulář po načtení převzít (podle `name` pole); prázdné,
 * když poznámka chybí, je poškozená, stará nebo patří jinému formuláři. Pole,
 * kterému server mezitím poslal jinou hodnotu, text nedostane.
 */
export function leavingDraftFor(raw: string | null, form: LoadedForm): Record<string, string> {
  if (!raw) return {};
  let draft: unknown;
  try {
    draft = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isLeavingDraft(draft)) return {};
  const age = form.now - draft.at;
  if (
    draft.endpoint !== form.endpoint ||
    draft.owner !== form.owner ||
    draft.pathname !== form.pathname ||
    age < 0 ||
    age > LEAVING_DRAFT_TTL_MS
  ) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(draft.fields)
      .filter(([name, field]) => form.served[name] === field.from)
      .map(([name, field]) => [name, field.text]),
  );
}

/*
 * Úložiště panelu umí být vypnuté nebo plné — poznámka je jen pomůcka, bez ní
 * nová stránka ukáže, co poslal server.
 */

export function rememberLeavingDraft(draft: LeavingDraft): void {
  try {
    window.sessionStorage.setItem(LEAVING_DRAFT_KEY, encodeLeavingDraft(draft));
  } catch {
    // bez poznámky
  }
}

/** Přečte poznámku a smaže ji — platí pro jedno načtení stránky. */
export function takeLeavingDraft(form: LoadedForm): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(LEAVING_DRAFT_KEY);
    window.sessionStorage.removeItem(LEAVING_DRAFT_KEY);
    return leavingDraftFor(raw, form);
  } catch {
    return {};
  }
}

/**
 * Zahodí poznámku: při odhlášení (text rozepsaný v jednom účtu se nesmí
 * nabídnout dalšímu) a pokaždé, když stránka, která ji napsala, žije dál.
 */
export function forgetLeavingDraft(): void {
  try {
    window.sessionStorage.removeItem(LEAVING_DRAFT_KEY);
  } catch {
    // není co mazat
  }
}
