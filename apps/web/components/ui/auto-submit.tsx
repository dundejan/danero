'use client';

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { onAutoSaveSessionEnd } from '@/lib/auto-save-session';
import { readEarlyInput } from '@/lib/early-input';
import {
  describeFocus,
  findFocusTarget,
  handoffApplies,
  isTextEntry,
  type FocusDescriptor,
  type FocusHandoff,
} from '@/lib/focus-handoff';
import { CHANGED_FIELD, changedFields } from '@/lib/form-baseline';
import {
  applyFormValues,
  differsFromServerHtml,
  reconcileWithServerHtml,
  restoreServerHtml,
  type FormControlState,
} from '@/lib/form-changes';
import {
  forgetLeavingDraft,
  rememberLeavingDraft,
  takeLeavingDraft,
  type LeavingDraft,
} from '@/lib/leaving-draft';
import { fetchLeaving, postLeaving } from '@/lib/leaving-request';
import { announce, refreshFromServer } from '@/lib/save-feedback';
import {
  createSaveQueue,
  saveBody,
  type AutoSaveOutcome,
  type SaveJob,
  type SaveQueue,
  type SaveReportContext,
  type SaveResult,
} from '@/lib/save-queue';

const subscribeToNothing = (): (() => void) => () => {};

type AutoSaveAction = (data: FormData) => Promise<AutoSaveOutcome>;
type TextField = HTMLInputElement | HTMLTextAreaElement;

/**
 * Když odpověď na uložení nepřišla a server není dosažitelný. Neříká
 * „neuložilo se“: požadavek mohl dorazit a ztratila se jen odpověď (revize R7,
 * M2) — co platí, ukáže až stránka dotažená ze serveru.
 */
const SAVE_UNKNOWN = 'Spojení vypadlo. Co je uložené, ukážeme hned, jak se obnoví.';
/**
 * Odpověď nepřišla (nebo přišla chyba serveru), ale server odpovídá a formulář
 * už ukazuje stav od něj.
 */
const SAVE_UNCONFIRMED = 'Uložení se nepotvrdilo. Formulář ukazuje, co je uložené.';
/**
 * Totéž, když v poli zůstal text, který se uložit nepodařilo. Stránka ho sama
 * znovu neposílá (revize R8, D2: server odpovídal chybou a formulář ji zkoušel
 * devětkrát za vteřinu) — odejde s další změnou, s opuštěním pole nebo stránky.
 */
const DRAFT_UNSAVED = 'Uložení se nepovedlo. Zkusíme to znovu s tvojí další změnou.';
/**
 * Formulář je zamčený déle, než aby to šlo přejít mlčky, a ještě není jasné,
 * jak to dopadne. O spojení neříká nic — server možná odpovídá, jen pomalu.
 */
const SAVE_CHECKING = 'Uložení se nepotvrdilo. Ověřujeme, co je uložené.';
/** Za jak dlouho zamčený formulář řekne proč, i když ještě neví, jak to dopadne (ms). */
const LOCK_NOTICE_MS = 1000;
/** Uložilo se něco jiného, zatímco v jiném poli pořád leží odmítnutý text. */
const OTHERS_SAVED = 'Ostatní změny jsou uložené.';
/** Když pole s neplatným textem nemá vlastní nápovědu (`title`). */
const DRAFT_INVALID = 'Rozepsaná hodnota není platná a neuloží se.';
/** Adresa, na které se pozná, že je server zase dosažitelný. */
const REACHABILITY_URL = '/api/health';
/**
 * Jak dlouho na tu odpověď čekat (ms). Spojení, které jen visí, by jinak
 * drželo formulář zamčený až do limitu prohlížeče.
 */
const REACHABILITY_TIMEOUT_MS = 8000;
/** Jak často zkoušet spojení, dokud je dole (ms). */
const RETRY_MS = 4000;

/**
 * Kde byl fokus ve formuláři, který právě zanikl (`lib/focus-handoff.ts`).
 * Proměnná modulu, ne stav komponenty: uložení stránku vykreslí celou znovu
 * a stav komponenty s ní zanikne — modul zůstává.
 */
let focusHandoff: (FocusHandoff & { key: string }) | null = null;

/**
 * Formulář jednoho účtu. Všechno, co si auto-save pamatuje mimo komponentu, je
 * vedené pod `key` — tedy zvlášť pro každý účet, který se v tomhle dokumentu
 * vystřídá (`lib/auto-save-session.ts`).
 */
interface Scope {
  key: string;
  /** Adresa uložení formuláře. */
  endpoint: string;
  /** Označení účtu (`lib/owner-tag.ts`). */
  owner: string;
}

const scopeOf = (endpoint: string, owner: string): Scope => ({
  key: `${owner} ${endpoint}`,
  endpoint,
  owner,
});

/**
 * Formulář, který právě zaniká, a jméno pole, jehož rozepsaný text převzal
 * jeho nástupce. Co nikdo nepřevzal, se uloží — stránka se opouští.
 */
let departure: { key: string; resumed: string | null } | null = null;

/**
 * Stav polí mimo komponentu (klíčem je prvek, takže zaniká s ním):
 * - hodnota, kterou textové pole už odeslalo k uložení — rozepsaný je jen
 *   text, který se od ní liší;
 * - pole, do kterých prokazatelně psal člověk (důvěryhodná událost `input`).
 *   Jen jejich rozepsaný text se ukládá bez `change` (při odchodu, při
 *   opuštění pole po předávce) — hodnota, kterou do pole dal skript nebo
 *   prohlížeč, se sama neuloží nikdy;
 * - text, který server odmítl: pole je označené `aria-invalid` a tentýž text
 *   se podruhé neposílá (člověk už ví, že neprošel);
 * - text, který už jednou odešel a odpověď na něj nepřišla (`stalled`). Sám se
 *   znovu neposílá — jen po obnoveném spojení, a to jednou; jinak odejde
 *   s další změnou ve formuláři, s opuštěním pole nebo stránky.
 */
const confirmedValues = new WeakMap<Element, string>();
const humanEdited = new WeakSet<Element>();
const rejectedValues = new WeakMap<Element, string>();
const stalled = new WeakSet<Element>();

/*
 * Všechny mapy níž mají klíč `Scope.key` — formulář (adresa uložení) a účet.
 */

/** Fronty a akce: přežívají nové vykreslení i zánik formuláře. */
const queues = new Map<string, SaveQueue>();
const actions = new Map<string, AutoSaveAction>();
/** Formuláře, které jsou právě na stránce (nástupce zanikajícího se pozná tady). */
const liveForms = new Map<string, HTMLFormElement>();
/** Jak formuláři na stránce říct, že jeho odeslání nedopadlo. */
const unsavedHandlers = new Map<string, (result: SaveResult, context: SaveReportContext) => void>();
/**
 * Formuláře, jejichž rozepsaný text už po obnoveném spojení jednou odešel sám
 * a nedopadl. Další pokus patří uživateli; uvolní ho uložení, které dopadne,
 * nebo jeho další změna.
 */
const autoResent = new Set<string>();

/**
 * Text, který server odmítl, a věta, kterou to řekl — podle formuláře
 * a jména pole. Mimo prvky, protože odmítnutý text musí přežít nové vykreslení
 * formuláře stejně jako rozepsaný text s fokusem: jiná změna stránku dotáhne
 * ze serveru, pole vznikne znovu s uloženou hodnotou a `aria-invalid` zmizí.
 * Do revize R7 tak neplatná částka zadaná hned po jiné změně skončila hláškou
 * „Uloženo“ a nulou v poli (D2).
 *
 * Dokud tu nějaký text je, potvrzení jiné změny odmítnutí nepřebije — poslední
 * viditelná zpráva zůstává ta o chybě. Záznam mizí, když člověk do pole sáhne,
 * nebo když formulář ze stránky odejde.
 */
const rejections = new Map<string, Map<string, { text: string; message: string }>>();

/**
 * Text, se kterým se panel právě skryl. Poznámka pro F5 se píše až při
 * skutečném zániku dokumentu (`pagehide`); některé prohlížeče ale při něm
 * ohlásí skrytí dřív, a to už rozepsaný text odeslalo. Tady počká, jestli
 * zánik opravdu přijde — návrat panelu ji zahodí.
 */
const hiddenDrafts = new Map<string, LeavingDraft>();

/** Formuláře, u kterých se po ztracené odpovědi čeká na stav ze serveru. */
const resyncing = new Set<string>();

// Odhlášení: nic z toho, co tu po účtu zbylo, se nesmí dostat k dalšímu.
// Odeslání, která jsou na cestě, doběhnou pod přihlášením, se kterým odešla —
// jejich výsledek už ale nikdo nedostane.
onAutoSaveSessionEnd({
  flush: async () => {
    await Promise.all(
      Array.from(queues.values(), (queue) => {
        queue.flush();
        return queue.whenIdle();
      }),
    );
  },
  reset: () => {
    for (const queue of queues.values()) queue.discard();
    queues.clear();
    actions.clear();
    autoResent.clear();
    rejections.clear();
    hiddenDrafts.clear();
    focusHandoff = null;
  },
});

/** Prvky formuláře, které přijmou fokus — pole i tlačítka vysvětlivek mezi nimi. */
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

const focusablesOf = (form: HTMLFormElement): HTMLElement[] =>
  Array.from(form.querySelectorAll<HTMLElement>(FOCUSABLE));

/** Textové pole s jménem — jediný druh pole, který může být „rozepsaný“. */
const textFieldOf = (target: unknown): TextField | null =>
  (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
  isTextEntry(target) &&
  target.name !== '' &&
  !target.disabled
    ? target
    : null;

const textFieldsOf = (form: HTMLFormElement): TextField[] =>
  Array.from(form.elements)
    .map(textFieldOf)
    .filter((field): field is TextField => field !== null);

const confirmedValue = (field: TextField): string =>
  confirmedValues.get(field) ?? field.defaultValue;

/** Text, který uživatel napsal a pole ho ještě neodeslalo. */
const hasDraft = (field: TextField): boolean => field.value !== confirmedValue(field);

/**
 * Rozepsaný text, který se smí uložit bez `change`: psal ho člověk a server
 * ho ještě neodmítl.
 */
const hasOwnDraft = (field: TextField): boolean =>
  hasDraft(field) && humanEdited.has(field) && rejectedValues.get(field) !== field.value;

const confirm = (field: TextField): void => {
  confirmedValues.set(field, field.value);
};

/**
 * Stav formuláře k odeslání. Textová pole jdou hodnotou, kterou už potvrdila —
 * změna nabídky tak s sebou nevezme půlku částky, kterou člověk zrovna píše
 * vedle (server by ji uložil, nebo kvůli ní odmítl celý formulář).
 */
function snapshot(form: HTMLFormElement): FormData {
  const data = new FormData(form);
  data.delete(CHANGED_FIELD);
  for (const field of textFieldsOf(form)) data.set(field.name, confirmedValue(field));
  return data;
}

/**
 * Potvrdí rozepsaný text, který psal člověk, a vrátí jména těch polí.
 * `validOnly`: text, o kterém prohlížeč ví, že neprojde (`pattern`), se
 * neposílá — při zavírání panelu už není komu říct, že ho server odmítl.
 */
function confirmDrafts(
  form: HTMLFormElement,
  {
    except = null,
    validOnly = false,
    only = () => true,
  }: {
    except?: string | null;
    validOnly?: boolean;
    /** Zúží výběr na pole, která vyhoví. */
    only?: (field: TextField) => boolean;
  } = {},
): string[] {
  const names: string[] = [];
  for (const field of textFieldsOf(form)) {
    if (!hasOwnDraft(field) || field.name === except || !only(field)) continue;
    if (validOnly && !field.validity.valid) continue;
    confirm(field);
    stalled.delete(field);
    names.push(field.name);
  }
  return names;
}

/**
 * Rozepsaný text, který nečeká na to, až člověk pole opustí: pole už opustil
 * (fokus mu vzal zámek formuláře), nebo text jednou odešel a odpověď nepřišla.
 * Odejde s nejbližší další změnou. Text v poli, kde člověk právě píše, sem
 * nepatří — ten se s cizí změnou neposílá nikdy (viz `snapshot`).
 */
const isOverdue = (field: TextField): boolean =>
  stalled.has(field) || document.activeElement !== field;

/** Označí pole textem, který server odmítl, a zapamatuje si ho pro další vykreslení. */
function markRejected(key: string, field: TextField, message: string): void {
  rejectedValues.set(field, field.value);
  field.setAttribute('aria-invalid', 'true');
  const refused = rejections.get(key) ?? new Map<string, { text: string; message: string }>();
  refused.set(field.name, { text: field.value, message });
  rejections.set(key, refused);
}

/** Člověk do pole sáhl: odmítnutý text už neplatí, pole se posoudí znovu. */
function clearRejected(key: string, field: TextField): void {
  rejectedValues.delete(field);
  field.removeAttribute('aria-invalid');
  rejections.get(key)?.delete(field.name);
}

/**
 * Formulář, u kterého nevíme, co je uložené: nejde ovládat a říká to
 * (`inert`, `aria-busy`), dokud stav nepotvrdí server. `ready` zase pustí
 * i E2E, které na atribut čeká (`autoSaveForm`).
 */
function markSynced(form: HTMLFormElement | undefined, synced: boolean): void {
  if (!form) return;
  form.inert = !synced;
  form.setAttribute(READY_ATTRIBUTE, synced ? 'ready' : 'unsynced');
  if (synced) form.removeAttribute('aria-busy');
  else form.setAttribute('aria-busy', 'true');
}

/**
 * Odpovídá server? Chyba 5xx se počítá jako „ne“: `/api/health` jí říká, že
 * nedosáhne na databázi, a dotažená stránka by skončila chybou místo stavu.
 */
const serverReachable = (): Promise<boolean> =>
  fetch(REACHABILITY_URL, {
    cache: 'no-store',
    signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
  }).then(
    (response) => response.status < 500,
    () => false,
  );

/** Počká, až prohlížeč ohlásí připojení — nejdéle `RETRY_MS`. */
const untilRetry = (): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      resolve();
    };
    const timer = setTimeout(done, RETRY_MS);
    window.addEventListener('online', done);
  });

/**
 * Kde ve formuláři je fokus. Zámek (`inert`) ho shodí na stránku a kdo ovládá
 * klávesnicí, hledal by po odemčení místo znovu od začátku (revize R8, M3).
 */
function focusWithin(form: HTMLFormElement | undefined): FocusDescriptor | null {
  const active = document.activeElement;
  return form && active instanceof HTMLElement && form.contains(active)
    ? describeFocus(active, focusablesOf(form))
    : null;
}

/** Vrátí fokus, kde byl před zámkem — jen když ho mezitím nikdo nepřevzal. */
function restoreFocus(form: HTMLFormElement, descriptor: FocusDescriptor | null): void {
  const active = document.activeElement;
  if (!descriptor || (active !== null && active !== document.body)) return;
  findFocusTarget(descriptor, focusablesOf(form))?.focus({ preventScroll: true });
}

/**
 * Odpověď na uložení nepřišla, takže stránka neví, co server zapsal (revize
 * R7, M2: obrazovka se vracela na starou volbu, přestože server uložil novou).
 * Formulář se proto zamkne a stav si vyžádá ze serveru; do té doby netvrdí
 * nic. Dotažení stránky se pouští až po ověření, že server odpovídá — bez
 * spojení by ho směrovač nahradil načtením celého dokumentu a místo aplikace
 * by zbyla chybová stránka prohlížeče.
 *
 * HLÁŠKA. Když server odpovídá, zazní jediná — s výsledkem, ve chvíli, kdy
 * formulář už ukazuje jeho stav. Když ne, řekne zámek hned, že spojení
 * vypadlo, a po jeho obnovení, jak to dopadlo (první hláška do té doby dávno
 * zmizela a nabídka by se jinak vrátila beze slova). A trvá-li to déle než
 * `LOCK_NOTICE_MS`, ohlásí se zámek aspoň obecně — beze slova je pro čtečku
 * jen pole, které přestalo existovat.
 *
 * ROZEPSANÝ TEXT se po odemčení pošle znovu jen tehdy, když opravdu chybělo
 * spojení, a jen jednou. Když server celou dobu odpovídal, vinou spojení to
 * nebylo a další pokus by dopadl stejně: do revize R8 (D2) se tu uložení
 * částky, na které server odpovídal chybou 500, opakovalo bez prodlevy, dokud
 * byla stránka otevřená (36 pokusů a 36 hlášek za 12 s). Text proto zůstává
 * v poli a odejde s další změnou, kterou člověk udělá.
 */
async function resync(scope: Scope): Promise<void> {
  const { key, owner } = scope;
  if (resyncing.has(key)) return;
  resyncing.add(key);
  const locked = liveForms.get(key);
  const focus = focusWithin(locked);
  markSynced(locked, false);
  const tell = (text: string): void => announce('chyba', text, owner);
  const notice = setTimeout(() => tell(SAVE_CHECKING), LOCK_NOTICE_MS);
  let offline = false;
  try {
    while (!(await serverReachable())) {
      if (!offline) {
        offline = true;
        clearTimeout(notice);
        tell(SAVE_UNKNOWN);
      }
      await untilRetry();
    }
    await refreshFromServer();
  } finally {
    clearTimeout(notice);
    resyncing.delete(key);
    const form = liveForms.get(key);
    if (!form) {
      // člověk mezitím odešel jinam; co je uložené, uvidí, až se k formuláři vrátí
      tell(SAVE_UNCONFIRMED);
    } else {
      // Týž formulář jako před dotažením = server poslal stav, se kterým byl
      // vykreslen: nabídky a přepínače, které se neuložily, se na něj vrátí.
      // Nový formulář už uložený stav ukazuje a není co vracet.
      for (const control of Array.from(form.elements)) {
        if (textFieldOf(control) === null) restoreServerHtml(control as unknown as FormControlState);
      }
      markSynced(form, true);
      // obrazovka ukazuje stav serveru — co nedopadlo, na ní není a dál se nenese
      const queue = queueFor(scope);
      queue.rebase();
      restoreFocus(form, focus);
      // Text, který čekal na spojení, se teď uloží sám — jednou. Jinak zůstává
      // v poli a hláška říká, kdy odejde. Text v poli, kam se právě vrátil fokus
      // a který ještě nikdy neodešel, je rozepsaný jako každý jiný: uloží se,
      // až ho člověk opustí.
      const names =
        offline && !autoResent.has(key) ? confirmDrafts(form, { only: isOverdue }) : [];
      if (names.length > 0) {
        autoResent.add(key);
        queue.enqueue({ data: snapshot(form), triggers: names, owner });
      } else if (textFieldsOf(form).some((field) => hasOwnDraft(field) && isOverdue(field))) {
        tell(DRAFT_UNSAVED);
      } else {
        tell(SAVE_UNCONFIRMED);
      }
    }
  }
}

function queueFor(scope: Scope): SaveQueue {
  const { key, endpoint, owner } = scope;
  const existing = queues.get(key);
  if (existing && !existing.isDiscarded()) return existing;
  // něco se uložilo a stránka to ještě neukazuje
  let unrefreshed = false;
  // Nejvyšší číslo odeslání, na které odpověď nepřišla, a nejvyšší uložené.
  // Ztracenou odpověď napraví jen uložené POZDĚJŠÍ odeslání (nese všechno, co
  // server do té doby nepotvrdil); dřívější o ní neříká nic.
  let unknownUpTo = 0;
  let savedUpTo = 0;
  const queue = createSaveQueue({
    send: (job) => {
      const action = actions.get(key);
      // bez akce (formulář mezitím zanikl) jde i běžné odeslání obyčejným požadavkem
      return action ? action(saveBody(job)) : fetchLeaving(endpoint, job);
    },
    sendLeaving: (job, context) => postLeaving(endpoint, job, context),
    report: (result, context) => {
      const sequence = context.job.sequence ?? 0;
      if (result.kind === 'saved') savedUpTo = Math.max(savedUpTo, sequence);
      if (result.kind === 'failed') unknownUpTo = Math.max(unknownUpTo, sequence);
      const unknown = unknownUpTo > savedUpTo;
      if (result.kind === 'saved') {
        autoResent.delete(key);
        // Potvrzení jiné změny nesmí přebít odmítnutí, které pořád platí:
        // člověk by odešel s tím, že je uloženo všechno (R7, D2). Hláška proto
        // říká obojí — co se uložilo a co pořád ne.
        const [refused] = rejections.get(key)?.values() ?? [];
        // A dokud není jasné, jak dopadlo pozdější odeslání, nepotvrzuje se nic:
        // „Uloženo“ by platilo jen pro část toho, co formulář ukazuje.
        if (!unknown) {
          if (refused) announce('chyba', `${OTHERS_SAVED} ${refused.message}`, owner);
          else announce('ok', result.message, owner);
        }
      }
      if (result.kind === 'rejected') {
        announce('chyba', result.message, owner);
        unsavedHandlers.get(key)?.(result, context);
      }
      // Stránku po uložení dotáhne ze serveru až poslední odeslání v řadě,
      // jedním dotazem (akce sama stránku nepřekresluje — vykreslila by ji po
      // každém odeslání zvlášť). Po vypršelém přihlášení tím odeslání při
      // odchodu skončí na přihlášení; akci tam přesměruje server sám.
      unrefreshed ||= result.kind === 'saved' || (result.kind === 'signedOut' && !result.redirected);
      // Zpracování odmítnutí výš mohlo zařadit další odeslání (zbytek změn bez
      // odmítnutého pole) — pak tohle poslední není a rozhodne se až po něm.
      if (!context.last || queue.hasWaiting()) return;
      if (unknown) {
        // Řada doběhla a o některém odeslání nevíme, jak dopadlo — ať bylo
        // poslední, nebo ne (odchod ze stránky, který se nevrátil, zatímco starší
        // akce doběhla v pořádku). Stav dotahuje `resync`, až když server
        // odpovídá; bez formuláře na stránce zbývá jen to říct.
        unknownUpTo = 0;
        unsavedHandlers.get(key)?.({ kind: 'failed' }, context);
        if (liveForms.has(key)) {
          unrefreshed = false;
          void resync(scope);
        } else {
          announce('chyba', SAVE_UNKNOWN, owner);
        }
        return;
      }
      if (unrefreshed) {
        unrefreshed = false;
        void refreshFromServer();
      }
    },
  });
  queues.set(key, queue);
  return queue;
}

/** Vrátí do pole text, který uživatel psal, když formulář zanikl. */
function resumeDraft(field: TextField, draft: NonNullable<FocusDescriptor['draft']>): void {
  field.value = draft.value;
  try {
    field.setSelectionRange(draft.selectionStart, draft.selectionEnd);
  } catch {
    // typ pole výběr textu neumí (číslo, e-mail) — kurzor zůstane na konci
  }
  // text psal člověk (jinak by se nepředával) — uloží se s opuštěním pole
  humanEdited.add(field);
}

/**
 * Atribut, který formulář dostane ve chvíli, kdy auto-save začne poslouchat.
 * Do té doby změna pole nic neodešle (a změnu vyslanou skriptem nikdo
 * nedožene) — čeká na něj E2E (`autoSaveForm` v `e2e/helpers.ts`).
 */
const READY_ATTRIBUTE = 'data-auto-submit';

/**
 * Auto-save formuláře: vloží se DOVNITŘ <form> a každou změnu pole uloží.
 * U textových polí prohlížeč spouští `change` až při blur — přesně to chceme,
 * žádný debounce není potřeba.
 *
 * JAK SE UKLÁDÁ. Změna jde serveru jako stav celého formuláře a jméno pole,
 * které se změnilo (`CHANGED_FIELD`); server zapíše jen pole, která se liší
 * od stavu při vykreslení, a to jmenované vždy (`lib/form-baseline.ts`).
 * Odeslání řadí fronta (`lib/save-queue.ts`): jdou za sebou a změny, které
 * přijdou během ukládání, se slijí do jednoho dalšího. Jméno změněného pole
 * nese každé další odeslání, dokud server tu změnu nepotvrdí — jen tak smí
 * starší odeslání, které dorazí pozdě, zahodit. Ukládá server action
 * `action`; výsledek ukáže hláška v rozložení aplikace
 * (`lib/save-feedback.ts`) a po posledním odeslání v řadě se stránka dotáhne
 * ze serveru. Adresa stránky se nemění a stránka neroluje: dřív uložení
 * končilo přesměrováním s `?ok=` a každá změna přidala krok do historie
 * prohlížeče (změřeno 11. 10. 2026: po třech změnách čtyři stisky Zpět).
 * Formulář se prohlížečem neodesílá nikdy — ani Enterem v textovém poli,
 * který dřív poslal totéž podruhé.
 *
 * ROZEPSANÝ TEXT. Text, který člověk napsal a pole ještě neopustil,
 * prohlížeč neohlásil (`change`). Neztratí se:
 * - s jinou změnou se neodesílá (viz `snapshot`), ale nové vykreslení
 *   formuláře ho převezme i s fokusem (`lib/focus-handoff.ts`);
 * - uloží se, když pole ztratí fokus, i kdyby prohlížeč `change` nevyslal
 *   (text vrácený po předávce jako změnu neohlásí);
 * - uloží se při odchodu ze stránky — přechod odkazem nebo Zpět uvnitř
 *   aplikace (formulář zaniká), skrytí a zavření panelu, F5, odchod jinam
 *   (`pagehide`, `visibilitychange`). Odchod jde požadavkem, který zavření
 *   panelu přežije (`endpoint`), ne akcí.
 * Ukládá se jen text, který prokazatelně psal člověk. Neplatný text server
 * odmítne a hláška to řekne i na stránce, kam člověk mezitím odešel; pole
 * zůstane označené a text v něm, aby šel opravit. Jen při zavírání panelu už
 * není kde to říct — tam se prohlížeč zeptá, jestli opravdu odejít.
 *
 * PŘED HYDRATACÍ. Změna provedená dřív, než se stránka hydratovala, událost
 * `change` vyslala do prázdna. Po hydrataci se proto formulář srovná s HTML
 * ze serveru — a rozhoduje, KDO rozdíl způsobil (`lib/form-changes.ts`):
 * - pole, které prokazatelně změnil člověk (`lib/early-input.ts`), se odešle;
 * - každý jiný rozdíl se vrátí na hodnotu ze serveru a NEODEŠLE se. Tak
 *   vypadá hodnota, kterou do pole vrátil prohlížeč (F5 ve Firefoxu, návrat
 *   v historii, obnovený panel) nebo vyplnilo rozšíření: odeslat ji by
 *   potichu přepsalo nastavení změněné mezitím jinde.
 * Jen po hydrataci — po vykreslení v prohlížeči (přechod odkazem) pole
 * teprve vznikla a není co srovnávat.
 *
 * Formulář s auto-save má mít `autoComplete="off"`: prohlížeč pak staré
 * hodnoty do polí nevrací vůbec. Srovnání výše je pojistka pro případy, kdy
 * to nestačí.
 *
 * FOKUS. Uložení stránku vykreslí znovu a formulář s novým stavem vznikne
 * celý nový (`key` na formuláři), takže pole s fokusem zanikne. Zanikající
 * formulář si proto zapamatuje, kde fokus byl, a nový ho tam vrátí — ve
 * stejném vykreslení, takže klávesa zmáčknutá těsně po uložení nejde do
 * prázdna. Hodnoty polí se nepředávají, ty jsou vždy ze serveru; výjimka je
 * rozepsaný text.
 *
 * KDYŽ ODPOVĚĎ NEPŘIJDE, formulář se zamkne, řekne proč a stav si vyžádá ze
 * serveru; po odemčení vrátí fokus, kde byl. Podrobnosti u `resync`.
 *
 * ÚČET. Všechno, co si auto-save pamatuje, je vedené zvlášť pro každý účet
 * (`owner`) a odhlášení to zahodí (`lib/auto-save-session.ts`); odeslání nese
 * označení účtu a server ho pod jiným přihlášením nezapíše (`lib/owner-tag.ts`).
 *
 * Bez JavaScriptu auto-save není — a není ani aplikace: stránka bez něj
 * ukáže jen sdělení, že ho potřebuje (`components/no-script-notice.tsx`).
 */
export function AutoSubmit({
  action,
  endpoint,
  owner,
}: {
  /** Server action, která formulář uloží a vrátí výsledek. */
  action: AutoSaveAction;
  /** Adresa, která uloží totéž obyčejným požadavkem — pro odchod ze stránky. */
  endpoint: string;
  /** Označení přihlášeného účtu (`lib/owner-tag.ts`): co si stránka odloží, patří jen jemu. */
  owner: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // serverový snímek platí jen pro první vykreslení při hydrataci
  const hydratedFromServer = useRef(
    useSyncExternalStore(
      subscribeToNothing,
      () => false,
      () => true,
    ),
  );

  // Všechno v layout efektu, nic v běžném:
  // - úklid běží, dokud zanikající pole ještě stojí v dokumentu (běžný efekt
  //   by už viděl fokus na <body>), a nový formulář fokus vrátí dřív, než
  //   prohlížeč cokoli vykreslí;
  // - posluchači vznikají ve stejném kroku jako formulář. Běžný efekt běží až
  //   po vykreslení: pole s vráceným fokusem by chvíli nikdo neposlouchal
  //   a klávesa zmáčknutá v té mezeře by změnila hodnotu, která se neuloží;
  // - posluchači mizí dřív než pole. Chromium při zániku pole s rozepsaným
  //   textem ohlásí `change` ještě během vykreslování — text v tu chvíli už
  //   patří předávce nebo uložení při odchodu.
  useLayoutEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const scope = scopeOf(endpoint, owner);
    const { key } = scope;
    const queue = queueFor(scope);
    actions.set(key, action);
    liveForms.set(key, form);
    // Formulář vznikl znovu uprostřed ukládání: server ho vykreslil se stavem
    // z doby před ním. Pole proto dostanou, co právě odchází — jinak by změna
    // na chvíli skočila zpátky. Odeslaný text je odeslaný, ne rozepsaný.
    const unsettled = queue.unsettled();
    if (unsettled) {
      const controls = Array.from(form.elements) as unknown as FormControlState[];
      // Jen pole, která uživatel opravdu změnil (liší se od stavu, se kterým
      // odeslání vzniklo, nebo jejich změnu server ještě nepotvrdil). Odeslání
      // nese celý formulář: v panelu se starým stavem by pole, na které nikdo
      // nesáhl, přepsalo hodnotu právě došlou ze serveru starou — a ta by se
      // s další změnou zapsala přes změnu udělanou jinde.
      const names = controls.flatMap((control) => (control.name ? [control.name] : []));
      const own = changedFields(unsettled, names);
      for (const name of queue.unconfirmed()) own.add(name);
      for (const control of applyFormValues(controls, unsettled, (name) => own.has(name))) {
        const field = textFieldOf(control);
        if (field) confirm(field);
      }
    } else {
      // Nic neběží a formulář je čerstvě ze serveru: změny, které server dřív
      // nepotvrdil (ztracená odpověď, přihlášení mezitím vypršelo), na
      // obrazovce nejsou a další odeslání je pod svým jménem nést nesmí.
      queue.rebase();
    }
    // cesta z doby vzniku: při odchodu jinam už adresa může patřit nové stránce
    const { pathname } = window.location;
    const handoff = focusHandoff;
    focusHandoff = null;
    if (handoff?.key === key && handoffApplies(handoff, pathname, performance.now())) {
      const target = findFocusTarget(handoff.descriptor, focusablesOf(form));
      const active = document.activeElement;
      // fokus nikomu nebereme: vrací se jen tehdy, když zánikem pole spadl na stránku
      if (target && (active === null || active === document.body)) {
        target.focus({ preventScroll: true });
      }
      const field = target && document.activeElement === target ? textFieldOf(target) : null;
      if (field && handoff.descriptor.draft) {
        resumeDraft(field, handoff.descriptor.draft);
        if (departure?.key === key) departure.resumed = field.name;
      }
    }

    // Text, který server odmítl ještě předchozímu vykreslení formuláře, se vrací
    // do pole i s označením — jen tam, kde pole od serveru nikdo nepřevzal
    // (předávka fokusu, odeslání v běhu).
    const refused = rejections.get(key);
    for (const field of refused ? textFieldsOf(form) : []) {
      const entry = refused?.get(field.name);
      if (!entry || field.value !== field.defaultValue) continue;
      field.value = entry.text;
      humanEdited.add(field);
      markRejected(key, field, entry.message);
    }

    const jobFor = (triggers: string[]): SaveJob => ({ data: snapshot(form), triggers, owner });
    // Změna, kterou udělal člověk. Vezme s sebou i text, který na uložení čeká
    // (`isOverdue`) — po chybě serveru je to ten „další pokus“, který hláška slíbila.
    const save = (triggers: string[]): void => {
      autoResent.delete(key);
      const overdue = confirmDrafts(form, { only: isOverdue });
      queue.enqueue(jobFor([...new Set([...overdue, ...triggers])]));
    };

    // Neplatný rozepsaný text při zavírání panelu: uložit nejde a po odchodu
    // už není kde to říct — prohlížeč se zeptá, jestli opravdu odejít.
    // Posluchač existuje jen po dobu, kdy takový text ve formuláři je
    // (stránka s posluchačem `beforeunload` hůř přežívá v paměti prohlížeče).
    const invalidDraft = (): TextField | undefined =>
      textFieldsOf(form).find((field) => hasDraft(field) && !field.validity.valid);
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const field = invalidDraft();
      if (!field) return;
      event.preventDefault();
      // kdo zůstane, uvidí proč
      announce('chyba', field.title || DRAFT_INVALID, owner);
    };
    let guarded = false;
    const syncUnloadGuard = (): void => {
      const needed = invalidDraft() !== undefined;
      if (needed === guarded) return;
      guarded = needed;
      if (needed) window.addEventListener('beforeunload', onBeforeUnload);
      else window.removeEventListener('beforeunload', onBeforeUnload);
    };

    const onInput = (event: Event): void => {
      const field = textFieldOf(event.target);
      if (!field) return;
      if (event.isTrusted) humanEdited.add(field);
      // kdo text přepisuje, píše nový — ten odejde až s opuštěním pole
      stalled.delete(field);
      if (rejectedValues.has(field)) clearRejected(key, field);
      syncUnloadGuard();
    };
    const onChange = (event: Event): void => {
      const field = textFieldOf(event.target);
      if (field) {
        // Enter v poli, jehož text už odešel, nic nového neříká
        if (!hasDraft(field)) return;
        // Zámek pole o fokus připravil sám; dokud se čeká na stav ze serveru,
        // nic se neposílá (stejně jako ve `focusout` níž) — text zůstává rozepsaný.
        if (resyncing.has(key)) return;
        confirm(field);
        syncUnloadGuard();
      }
      const name = (event.target as { name?: unknown } | null)?.name;
      save(typeof name === 'string' && name !== '' ? [name] : []);
    };
    // Opuštění pole s rozepsaným textem bez `change`: text vrácený skriptem
    // (předávka po novém vykreslení) prohlížeč jako změnu neohlásí.
    // `change` přichází před `focusout`, takže běžné psaní sem nedojde.
    const onFocusOut = (event: FocusEvent): void => {
      const field = textFieldOf(event.target);
      // dokud se čeká na stav ze serveru, nic se neposílá (text se uloží po něm)
      if (!field || !hasOwnDraft(field) || resyncing.has(key)) return;
      confirm(field);
      syncUnloadGuard();
      save([field.name]);
    };
    // formulář ukládá skript; prohlížeč ho neodesílá (Enter v textovém poli)
    const onSubmit = (event: Event): void => event.preventDefault();
    // Skrytí i zavření panelu: co čeká, jde hned a požadavkem, který odchod
    // přežije. Na telefonu je skrytí panelu často poslední, co stránka zažije.
    // `unloading`: zaniká celý dokument — kde prohlížeč neumí `keepalive`,
    // jde uložení přes beacon (`lib/leaving-request.ts`).
    const leave = (unloading: boolean): void => {
      const names = confirmDrafts(form, { validOnly: true });
      queue.flush(names.length > 0 ? jobFor(names) : undefined, { unloading });
      // F5: nová stránka se vykreslí dřív, než se tohle uložení zapíše — text si
      // převezme z poznámky (`lib/leaving-draft.ts`). Píše se až při zániku
      // dokumentu; skrytí panelu si text jen podrží pro případ, že zánik přijde
      // hned po něm.
      const note: LeavingDraft | undefined =
        names.length > 0
          ? {
              endpoint,
              owner,
              pathname: window.location.pathname,
              at: Date.now(),
              fields: Object.fromEntries(
                textFieldsOf(form)
                  .filter((field) => names.includes(field.name))
                  .map((field) => [field.name, { from: field.defaultValue, text: field.value }]),
              ),
            }
          : hiddenDrafts.get(key);
      if (!note) return;
      if (unloading) {
        hiddenDrafts.delete(key);
        rememberLeavingDraft({ ...note, at: Date.now() });
      } else {
        hiddenDrafts.set(key, note);
      }
    };
    // Stránka žije dál (panel je zase vidět, návrat z mezipaměti prohlížeče):
    // poznámka pro F5 patřila odchodu, který nenastal.
    const alive = (): void => {
      hiddenDrafts.delete(key);
      forgetLeavingDraft();
    };
    const onPageHide = (): void => leave(true);
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) alive();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') leave(false);
      else alive();
    };

    // Odeslání nedopadlo: obrazovka nesmí tvrdit, že je uloženo.
    const onUnsaved = (result: SaveResult, { job, last }: SaveReportContext): void => {
      if (result.kind === 'rejected') {
        const sent = result.field === undefined ? null : job.data.get(result.field);
        // Odmítnutý text už není „odeslaný“. V poli zůstává k opravě a označí se —
        // pokud v něm pořád je; kdo mezitím píše něco jiného, toho se odmítnutí
        // starého textu netýká.
        for (const field of textFieldsOf(form)) {
          if (field.name !== result.field || confirmedValues.get(field) !== sent) continue;
          confirmedValues.delete(field);
          if (field.value === sent) markRejected(key, field, result.message);
        }
        syncUnloadGuard();
        // Server odmítl formulář celý. Ostatní změny, které šly s neplatným textem,
        // za něj nemůžou — odešlou se znovu bez něj. Pozná se to podle odeslání, ne
        // podle pole: odeslání, které vzniklo před odmítnutím a odešlo souběžně
        // (odchod ze stránky), nese neplatný text taky, i když pole už označené je.
        const rest = job.triggers.filter((name) => name !== result.field);
        const othersChanged = Array.from(form.elements).some(
          (control) =>
            textFieldOf(control) === null &&
            differsFromServerHtml(control as unknown as FormControlState),
        );
        const stale = result.field !== undefined && sent !== snapshot(form).get(result.field);
        if (stale && last && (rest.length > 0 || othersChanged)) save(rest);
      }
      if (result.kind === 'failed' && last) {
        // Odpověď nepřišla. Text, který s odesláním odešel, je zase rozepsaný
        // a pamatuje si, že už jednou neuspěl (`stalled`); nabídky a přepínače
        // nechává být — co z nich platí, řekne až server (`resync`), do té
        // doby je formulář zamčený.
        for (const field of textFieldsOf(form)) {
          if (!confirmedValues.has(field)) continue;
          confirmedValues.delete(field);
          if (hasDraft(field)) stalled.add(field);
        }
        syncUnloadGuard();
      }
    };

    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange);
    form.addEventListener('focusout', onFocusOut);
    form.addEventListener('submit', onSubmit);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    unsavedHandlers.set(key, onUnsaved);
    // jednou: vývojový režim Reactu pouští efekt dvakrát a druhé odeslání by
    // se s prvním pralo
    if (hydratedFromServer.current) {
      hydratedFromServer.current = false;
      const early = readEarlyInput(window);
      const controls = Array.from(form.elements) as unknown as FormControlState[];
      const { revert, submit } = reconcileWithServerHtml(controls, early);
      // nejdřív vrátit, co není od člověka — server by rozdíl proti stavu při
      // vykreslení vzal jako změnu
      revert.forEach(restoreServerHtml);
      // text, se kterým předchozí stránka odcházela (F5) a který tahle ještě
      // neukazuje: vrátí se do pole a uloží znovu — server, který ho mezitím
      // zapsal, podruhé nic nezapíše
      const left = takeLeavingDraft({
        endpoint,
        owner,
        pathname: window.location.pathname,
        now: Date.now(),
        served: Object.fromEntries(
          textFieldsOf(form).map((field) => [field.name, field.defaultValue]),
        ),
      });
      const resumed: string[] = [];
      for (const field of textFieldsOf(form)) {
        if (early.edited.has(field)) humanEdited.add(field);
        // text potvrzený před hydratací se odešle; rozepsaný zůstává rozepsaný
        if (early.committed.has(field) && hasDraft(field)) confirm(field);
        const text = left[field.name];
        // kdo do pole mezitím psal, má přednost
        if (text === undefined || text === field.value || early.edited.has(field)) continue;
        field.value = text;
        humanEdited.add(field);
        confirm(field);
        resumed.push(field.name);
      }
      if (submit || resumed.length > 0) save(resumed);
    }
    syncUnloadGuard();
    // formulář vzniklý uprostřed čekání na stav ze serveru zůstává zamčený
    markSynced(form, !resyncing.has(key));
    return () => {
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onFocusOut);
      form.removeEventListener('submit', onSubmit);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (unsavedHandlers.get(key) === onUnsaved) unsavedHandlers.delete(key);
      form.removeAttribute(READY_ATTRIBUTE);
      if (liveForms.get(key) === form) liveForms.delete(key);
      const active = document.activeElement;
      if (active instanceof HTMLElement && form.contains(active)) {
        const field = textFieldOf(active);
        const descriptor = describeFocus(
          active,
          focusablesOf(form),
          field ? confirmedValue(field) : undefined,
        );
        // rozepsaný text se předává jen tehdy, když ho psal člověk
        if (field && !humanEdited.has(field)) descriptor.draft = null;
        focusHandoff = { key, pathname, descriptor, at: performance.now() };
      }
      // Buď formulář vznikne znovu na téže stránce (uložení ji vykreslilo
      // znovu) a rozepsaný text převezme, nebo se stránka opouští a text je
      // potřeba uložit. Nástupce vzniká v témže vykreslení — po něm je jasno.
      const leaving = { key, resumed: null as string | null };
      departure = leaving;
      queueMicrotask(() => {
        if (departure === leaving) departure = null;
        // vývojový režim Reactu efekt zkusmo uklidí a pustí znovu — formulář stojí dál
        if (form.isConnected) return;
        const successor = liveForms.get(key);
        // Text, jehož uložení nedopadlo, se s novým vykreslením formuláře sám
        // neposílá (viz `resync`): nástupce ho převezme jako rozepsaný — pokud
        // mu server mezitím neposlal totéž (pak uložený je) a pokud do pole
        // nikdo nesáhl.
        const heirs = successor ? textFieldsOf(successor) : [];
        for (const field of successor ? textFieldsOf(form) : []) {
          if (!stalled.has(field) || !hasOwnDraft(field) || field.name === leaving.resumed) continue;
          const heir = heirs.find((candidate) => candidate.name === field.name);
          if (!heir || heir.value !== heir.defaultValue || heir.value === field.value) continue;
          heir.value = field.value;
          humanEdited.add(heir);
          stalled.add(heir);
        }
        const names = confirmDrafts(form, {
          except: leaving.resumed,
          only: (field) => !successor || !stalled.has(field),
        });
        const job = names.length > 0 ? jobFor(names) : undefined;
        // fronta podle toho, co platí teď — odhlášení tu původní mezitím zahodilo
        const current = queueFor(scope);
        // s nástupcem fronta pokračuje sama; bez něj se stránka opouští
        if (successor) {
          if (job) current.enqueue(job);
        } else {
          current.flush(job);
          // odmítnutý text ani text ze skrytého panelu se na jinou stránku nenese
          rejections.delete(key);
          hiddenDrafts.delete(key);
        }
      });
    };
  }, [action, endpoint, owner]);

  return <input ref={ref} type="hidden" name={CHANGED_FIELD} />;
}
