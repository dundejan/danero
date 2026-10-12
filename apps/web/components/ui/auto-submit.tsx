'use client';

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { readEarlyInput } from '@/lib/early-input';
import {
  describeFocus,
  findFocusTarget,
  FOCUS_HANDOFF_TTL_MS,
  handoffApplies,
  isTextEntry,
  type FocusDescriptor,
  type FocusHandoff,
} from '@/lib/focus-handoff';
import { CHANGED_FIELD } from '@/lib/form-baseline';
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
 * Když odpověď na uložení vůbec nepřišla. Neříká „neuložilo se“: požadavek
 * mohl dorazit a ztratila se jen odpověď (revize R7, M2) — co platí, ukáže
 * až stránka dotažená ze serveru.
 */
const SAVE_UNKNOWN = 'Spojení vypadlo. Co je uložené, ukážeme hned, jak se obnoví.';
/** Uložilo se něco jiného, zatímco v jiném poli pořád leží odmítnutý text. */
const OTHERS_SAVED = 'Ostatní změny jsou uložené.';
/** Když pole s neplatným textem nemá vlastní nápovědu (`title`). */
const DRAFT_INVALID = 'Rozepsaná hodnota není platná a neuloží se.';
/** Adresa, na které se pozná, že je server zase dosažitelný. */
const REACHABILITY_URL = '/api/health';
/** Jak často zkoušet spojení, dokud je dole (ms). */
const RETRY_MS = 4000;

/**
 * Kde byl fokus ve formuláři, který právě zanikl (`lib/focus-handoff.ts`).
 * Proměnná modulu, ne stav komponenty: uložení stránku vykreslí celou znovu
 * a stav komponenty s ní zanikne — modul zůstává.
 */
let focusHandoff: (FocusHandoff & { heldSpace: boolean }) | null = null;

/**
 * Kde stránka stála, když formulář zanikl — nový ji tam vrátí. Platí stejně
 * krátce a jen pro tutéž stránku jako předávka fokusu, ale nezávisle na ní:
 * polohu drží i ten, kdo ve formuláři fokus neměl (přepnul prstem).
 */
let scrollHandoff: { pathname: string; x: number; y: number; at: number } | null = null;

/**
 * Formulář, který právě zaniká, a jméno pole, jehož rozepsaný text převzal
 * jeho nástupce. Co nikdo nepřevzal, se uloží — stránka se opouští.
 */
let departure: { endpoint: string; resumed: string | null } | null = null;

/**
 * Stav polí mimo komponentu (klíčem je prvek, takže zaniká s ním):
 * - hodnota, kterou textové pole už odeslalo k uložení — rozepsaný je jen
 *   text, který se od ní liší;
 * - pole, do kterých prokazatelně psal člověk (důvěryhodná událost `input`).
 *   Jen jejich rozepsaný text se ukládá bez `change` (při odchodu, při
 *   opuštění pole po předávce) — hodnota, kterou do pole dal skript nebo
 *   prohlížeč, se sama neuloží nikdy;
 * - text, který server odmítl: pole je označené `aria-invalid` a tentýž text
 *   se podruhé neposílá (člověk už ví, že neprošel).
 */
const confirmedValues = new WeakMap<Element, string>();
const humanEdited = new WeakSet<Element>();
const rejectedValues = new WeakMap<Element, string>();

/** Fronty a akce podle adresy uložení: přežívají nové vykreslení i zánik formuláře. */
const queues = new Map<string, SaveQueue>();
const actions = new Map<string, AutoSaveAction>();
/** Označení účtu, kterému formulář na stránce patří (`lib/owner-tag.ts`). */
const owners = new Map<string, string>();
/** Formuláře, které jsou právě na stránce (nástupce zanikajícího se pozná tady). */
const liveForms = new Map<string, HTMLFormElement>();
/** Jak formuláři na stránce říct, že jeho odeslání nedopadlo. */
const unsavedHandlers = new Map<string, (result: SaveResult, context: SaveReportContext) => void>();

/**
 * Text, který server odmítl, a věta, kterou to řekl — podle adresy uložení
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
  { except = null, validOnly = false }: { except?: string | null; validOnly?: boolean } = {},
): string[] {
  const names: string[] = [];
  for (const field of textFieldsOf(form)) {
    if (!hasOwnDraft(field) || field.name === except) continue;
    if (validOnly && !field.validity.valid) continue;
    confirm(field);
    names.push(field.name);
  }
  return names;
}

/** Políčko nebo přepínač — prvek, který mezerník přepne až puštěním klávesy. */
const isToggle = (target: unknown): target is HTMLInputElement =>
  target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio');

/**
 * Dokončí stisk mezerníku, který začal na zaniklém prvku.
 *
 * Mezerník přepíná políčko až puštěním — a jen na prvku, na kterém byl
 * stisknut. Když formulář mezi stiskem a puštěním vznikl znovu (doběhlo
 * předchozí uložení), puštění dopadne na nový prvek, který stisk neviděl,
 * a prohlížeč ho zahodí: klávesa šla do prázdna, přepínač zůstal, jak byl
 * (změřeno 12. 10. 2026 shodně v Chromiu, Firefoxu i WebKitu). Nový prvek
 * proto puštění dokončí sám. Jiná klávesa nebo ztráta fokusu čekání ruší —
 * pak už nejde o tentýž stisk.
 */
function finishHeldSpace(target: HTMLInputElement): void {
  const stop = (): void => {
    target.removeEventListener('keyup', finish);
    target.removeEventListener('keydown', stop);
    target.removeEventListener('blur', stop);
  };
  const finish = (event: KeyboardEvent): void => {
    stop();
    if (event.key === ' ' && event.isTrusted && !target.disabled) target.click();
  };
  target.addEventListener('keyup', finish);
  target.addEventListener('keydown', stop);
  target.addEventListener('blur', stop);
}

/** Označí pole textem, který server odmítl, a zapamatuje si ho pro další vykreslení. */
function markRejected(endpoint: string, field: TextField, message: string): void {
  rejectedValues.set(field, field.value);
  field.setAttribute('aria-invalid', 'true');
  const refused = rejections.get(endpoint) ?? new Map<string, { text: string; message: string }>();
  refused.set(field.name, { text: field.value, message });
  rejections.set(endpoint, refused);
}

/** Člověk do pole sáhl: odmítnutý text už neplatí, pole se posoudí znovu. */
function clearRejected(endpoint: string, field: TextField): void {
  rejectedValues.delete(field);
  field.removeAttribute('aria-invalid');
  rejections.get(endpoint)?.delete(field.name);
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

const serverReachable = (): Promise<boolean> =>
  fetch(REACHABILITY_URL, { cache: 'no-store' }).then(
    () => true,
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
 * Odpověď na uložení nepřišla, takže stránka neví, co server zapsal (revize
 * R7, M2: obrazovka se vracela na starou volbu, přestože server uložil novou).
 * Formulář se proto zamkne a stav si vyžádá ze serveru; do té doby netvrdí
 * nic. Dotažení stránky se pouští až po ověření, že server odpovídá — bez
 * spojení by ho směrovač nahradil načtením celého dokumentu a místo aplikace
 * by zbyla chybová stránka prohlížeče.
 */
async function resync(endpoint: string): Promise<void> {
  if (resyncing.has(endpoint)) return;
  resyncing.add(endpoint);
  markSynced(liveForms.get(endpoint), false);
  try {
    while (!(await serverReachable())) await untilRetry();
    await refreshFromServer();
  } finally {
    resyncing.delete(endpoint);
    const form = liveForms.get(endpoint);
    if (form) {
      // Týž formulář jako před dotažením = server poslal stav, se kterým byl
      // vykreslen: nabídky a přepínače, které se neuložily, se na něj vrátí.
      // Nový formulář už uložený stav ukazuje a není co vracet.
      for (const control of Array.from(form.elements)) {
        if (textFieldOf(control) === null) restoreServerHtml(control as unknown as FormControlState);
      }
      markSynced(form, true);
      // rozepsaný text čekal na spojení — teď se uloží
      const names = confirmDrafts(form);
      if (names.length > 0) {
        queueFor(endpoint).enqueue({
          data: snapshot(form),
          triggers: names,
          owner: owners.get(endpoint),
        });
      }
    }
  }
}

function queueFor(endpoint: string): SaveQueue {
  const existing = queues.get(endpoint);
  if (existing) return existing;
  // něco se uložilo a stránka to ještě neukazuje
  let unrefreshed = false;
  const queue = createSaveQueue({
    send: (job) => {
      const action = actions.get(endpoint);
      // bez akce (formulář mezitím zanikl) jde i běžné odeslání obyčejným požadavkem
      return action ? action(saveBody(job)) : fetchLeaving(endpoint, job);
    },
    sendLeaving: (job, context) => postLeaving(endpoint, job, context),
    report: (result, context) => {
      // hláška patří účtu, jehož formulář odeslání vytvořil
      const owner = context.job.owner ?? '';
      if (result.kind === 'saved') {
        // Potvrzení jiné změny nesmí přebít odmítnutí, které pořád platí:
        // člověk by odešel s tím, že je uloženo všechno (R7, D2). Hláška proto
        // říká obojí — co se uložilo a co pořád ne.
        const [refused] = rejections.get(endpoint)?.values() ?? [];
        if (refused) announce('chyba', `${OTHERS_SAVED} ${refused.message}`, owner);
        else announce('ok', result.message, owner);
      }
      if (result.kind === 'rejected') announce('chyba', result.message, owner);
      if (result.kind === 'failed') announce('chyba', SAVE_UNKNOWN, owner);
      // Stránku po uložení dotáhne ze serveru až poslední odeslání v řadě,
      // jedním dotazem (akce sama stránku nepřekresluje — vykreslila by ji po
      // každém odeslání zvlášť). Po vypršelém přihlášení tím odeslání při
      // odchodu skončí na přihlášení; akci tam přesměruje server sám.
      unrefreshed ||= result.kind === 'saved' || (context.leaving && result.kind === 'signedOut');
      const failedLast = result.kind === 'failed' && context.last;
      if (context.last && unrefreshed && !failedLast) {
        unrefreshed = false;
        void refreshFromServer();
      }
      if (result.kind !== 'saved') unsavedHandlers.get(endpoint)?.(result, context);
      // po ztracené odpovědi dotahuje `resync` — až když server odpovídá
      if (failedLast && liveForms.has(endpoint)) {
        unrefreshed = false;
        void resync(endpoint);
      }
    },
  });
  queues.set(endpoint, queue);
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
 * přijdou během ukládání, se slijí do jednoho dalšího. Ukládá server action
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
    actions.set(endpoint, action);
    owners.set(endpoint, owner);
    liveForms.set(endpoint, form);
    // Formulář vznikl znovu uprostřed ukládání: server ho vykreslil se stavem
    // z doby před ním. Pole proto dostanou, co právě odchází — jinak by změna
    // na chvíli skočila zpátky. Odeslaný text je odeslaný, ne rozepsaný.
    const unsettled = queueFor(endpoint).unsettled();
    if (unsettled) {
      const controls = Array.from(form.elements) as unknown as FormControlState[];
      for (const control of applyFormValues(controls, unsettled)) {
        const field = textFieldOf(control);
        if (field) confirm(field);
      }
    }
    // cesta z doby vzniku: při odchodu jinam už adresa může patřit nové stránce
    const { pathname } = window.location;
    const handoff = focusHandoff;
    focusHandoff = null;
    if (handoffApplies(handoff, pathname, performance.now())) {
      const target = findFocusTarget(handoff.descriptor, focusablesOf(form));
      const active = document.activeElement;
      // fokus nikomu nebereme: vrací se jen tehdy, když zánikem pole spadl na stránku
      if (target && (active === null || active === document.body)) {
        target.focus({ preventScroll: true });
      }
      const field = target && document.activeElement === target ? textFieldOf(target) : null;
      if (field && handoff.descriptor.draft) {
        resumeDraft(field, handoff.descriptor.draft);
        if (departure?.endpoint === endpoint) departure.resumed = field.name;
      }
      if (handoff.heldSpace && target && document.activeElement === target && isToggle(target)) {
        finishHeldSpace(target);
      }
    }
    // Stránka po novém vykreslení stojí tam, kde stála: starý formulář zanikl
    // a nový je na jeho místě, jenže WebKit mezi tím stránku zkrátí a polohu
    // rolování zahodí (kotvení rolování neumí) — uložení dole v Nastavení
    // vracelo Safari na začátek stránky (změřeno 12. 10. 2026: 516 → 0 px).
    const scroll = scrollHandoff;
    scrollHandoff = null;
    if (
      scroll !== null &&
      scroll.pathname === pathname &&
      performance.now() - scroll.at <= FOCUS_HANDOFF_TTL_MS &&
      (window.scrollX !== scroll.x || window.scrollY !== scroll.y)
    ) {
      window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' });
    }

    // Text, který server odmítl ještě předchozímu vykreslení formuláře, se vrací
    // do pole i s označením — jen tam, kde pole od serveru nikdo nepřevzal
    // (předávka fokusu, odeslání v běhu).
    const refused = rejections.get(endpoint);
    for (const field of refused ? textFieldsOf(form) : []) {
      const entry = refused?.get(field.name);
      if (!entry || field.value !== field.defaultValue) continue;
      field.value = entry.text;
      humanEdited.add(field);
      markRejected(endpoint, field, entry.message);
    }

    const queue = queueFor(endpoint);
    const jobFor = (triggers: string[]): SaveJob => ({ data: snapshot(form), triggers, owner });
    const save = (triggers: string[]): void => queue.enqueue(jobFor(triggers));

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
      if (rejectedValues.has(field)) clearRejected(endpoint, field);
      syncUnloadGuard();
    };
    const onChange = (event: Event): void => {
      const field = textFieldOf(event.target);
      if (field) {
        // Enter v poli, jehož text už odešel, nic nového neříká
        if (!hasDraft(field)) return;
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
      if (!field || !hasOwnDraft(field) || resyncing.has(endpoint)) return;
      confirm(field);
      syncUnloadGuard();
      save([field.name]);
    };
    // Mezerník stisknutý na políčku a ještě nepuštěný: zanikne-li formulář
    // v té chvíli, nástupce stisk dokončí (`finishHeldSpace`).
    let spaceDownOn: EventTarget | null = null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === ' ' && isToggle(event.target)) spaceDownOn = event.target;
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ') spaceDownOn = null;
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
          : hiddenDrafts.get(endpoint);
      if (!note) return;
      if (unloading) {
        hiddenDrafts.delete(endpoint);
        rememberLeavingDraft({ ...note, at: Date.now() });
      } else {
        hiddenDrafts.set(endpoint, note);
      }
    };
    // Stránka žije dál (panel je zase vidět, návrat z mezipaměti prohlížeče):
    // poznámka pro F5 patřila odchodu, který nenastal.
    const alive = (): void => {
      hiddenDrafts.delete(endpoint);
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
          if (field.value === sent) markRejected(endpoint, field, result.message);
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
        // Odpověď nepřišla. Text zůstává rozepsaný (uloží se, až bude spojení);
        // nabídky a přepínače nechává být — co z nich platí, řekne až server
        // (`resync`), do té doby je formulář zamčený.
        for (const field of textFieldsOf(form)) confirmedValues.delete(field);
        syncUnloadGuard();
      }
    };

    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange);
    form.addEventListener('focusout', onFocusOut);
    form.addEventListener('keydown', onKeyDown);
    form.addEventListener('keyup', onKeyUp);
    form.addEventListener('submit', onSubmit);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    unsavedHandlers.set(endpoint, onUnsaved);
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
    markSynced(form, !resyncing.has(endpoint));
    return () => {
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onFocusOut);
      form.removeEventListener('keydown', onKeyDown);
      form.removeEventListener('keyup', onKeyUp);
      form.removeEventListener('submit', onSubmit);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (unsavedHandlers.get(endpoint) === onUnsaved) unsavedHandlers.delete(endpoint);
      form.removeAttribute(READY_ATTRIBUTE);
      if (liveForms.get(endpoint) === form) liveForms.delete(endpoint);
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
        focusHandoff = {
          pathname,
          descriptor,
          at: performance.now(),
          heldSpace: spaceDownOn === active,
        };
      }
      scrollHandoff = { pathname, x: window.scrollX, y: window.scrollY, at: performance.now() };
      // Buď formulář vznikne znovu na téže stránce (uložení ji vykreslilo
      // znovu) a rozepsaný text převezme, nebo se stránka opouští a text je
      // potřeba uložit. Nástupce vzniká v témže vykreslení — po něm je jasno.
      const leaving = { endpoint, resumed: null as string | null };
      departure = leaving;
      queueMicrotask(() => {
        if (departure === leaving) departure = null;
        // vývojový režim Reactu efekt zkusmo uklidí a pustí znovu — formulář stojí dál
        if (form.isConnected) return;
        const names = confirmDrafts(form, { except: leaving.resumed });
        const job = names.length > 0 ? jobFor(names) : undefined;
        const queue = queueFor(endpoint);
        // s nástupcem fronta pokračuje sama; bez něj se stránka opouští
        if (liveForms.has(endpoint)) {
          if (job) queue.enqueue(job);
        } else {
          queue.flush(job);
          // odmítnutý text ani text ze skrytého panelu se na jinou stránku nenese
          rejections.delete(endpoint);
          hiddenDrafts.delete(endpoint);
        }
      });
    };
  }, [action, endpoint, owner]);

  return <input ref={ref} type="hidden" name={CHANGED_FIELD} />;
}
