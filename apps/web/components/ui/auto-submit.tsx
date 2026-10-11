'use client';

import { startTransition, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { readEarlyInput } from '@/lib/early-input';
import {
  describeFocus,
  findFocusTarget,
  handoffApplies,
  isTextEntry,
  type FocusDescriptor,
  type FocusHandoff,
} from '@/lib/focus-handoff';
import { CHANGED_FIELD } from '@/lib/form-baseline';
import {
  differsFromServerHtml,
  reconcileWithServerHtml,
  restoreServerHtml,
  type FormControlState,
} from '@/lib/form-changes';
import { announce, refreshFromServer } from '@/lib/save-feedback';
import {
  createSaveQueue,
  saveBody,
  SignedOutError,
  type AutoSaveOutcome,
  type SaveJob,
  type SaveQueue,
  type SaveReportContext,
  type SaveResult,
} from '@/lib/save-queue';

const subscribeToNothing = (): (() => void) => () => {};

type AutoSaveAction = (data: FormData) => Promise<AutoSaveOutcome>;
type TextField = HTMLInputElement | HTMLTextAreaElement;

/** Když odpověď na uložení vůbec nepřišla. */
const SAVE_FAILED = 'Uložení se nepovedlo. Zkontroluj připojení a zkus to znovu.';
/** Když pole s neplatným textem nemá vlastní nápovědu (`title`). */
const DRAFT_INVALID = 'Rozepsaná hodnota není platná a neuloží se.';

/**
 * Kde byl fokus ve formuláři, který právě zanikl (`lib/focus-handoff.ts`).
 * Proměnná modulu, ne stav komponenty: uložení stránku vykreslí celou znovu
 * a stav komponenty s ní zanikne — modul zůstává.
 */
let focusHandoff: FocusHandoff | null = null;

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
 * - pole, která server odmítl a která jsme proto označili `aria-invalid`.
 */
const confirmedValues = new WeakMap<Element, string>();
const humanEdited = new WeakSet<Element>();
const markedInvalid = new WeakSet<Element>();

/** Fronty a akce podle adresy uložení: přežívají nové vykreslení i zánik formuláře. */
const queues = new Map<string, SaveQueue>();
const actions = new Map<string, AutoSaveAction>();
/** Formuláře, které jsou právě na stránce (nástupce zanikajícího se pozná tady). */
const liveForms = new Map<string, HTMLFormElement>();
/** Jak formuláři na stránce říct, že jeho odeslání nedopadlo. */
const unsavedHandlers = new Map<string, (result: SaveResult, context: SaveReportContext) => void>();

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
    if (!hasDraft(field) || !humanEdited.has(field) || field.name === except) continue;
    if (validOnly && !field.validity.valid) continue;
    confirm(field);
    names.push(field.name);
  }
  return names;
}

/** Odeslání při odchodu: obyčejný požadavek, který přežije zavření panelu. */
async function postLeaving(endpoint: string, job: SaveJob): Promise<AutoSaveOutcome> {
  const response = await fetch(endpoint, {
    method: 'POST',
    body: saveBody(job),
    keepalive: true,
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401) throw new SignedOutError();
  const outcome = (await response.json()) as Partial<AutoSaveOutcome>;
  if (typeof outcome.ok !== 'boolean' || typeof outcome.message !== 'string') {
    throw new Error('neznámá odpověď na uložení');
  }
  return { ok: outcome.ok, message: outcome.message, field: outcome.field };
}

function queueFor(endpoint: string): SaveQueue {
  const existing = queues.get(endpoint);
  if (existing) return existing;
  const queue = createSaveQueue({
    send: (job) => {
      const action = actions.get(endpoint);
      return action ? action(saveBody(job)) : postLeaving(endpoint, job);
    },
    sendLeaving: (job) => postLeaving(endpoint, job),
    // Jeden běh fronty = jeden přechod Reactu. Server action po uložení
    // vykreslí stránku znovu; dokud přechod běží, React to vykreslení drží,
    // takže formulář neskočí na stav po prvním uložení, zatímco druhé běží.
    scope: (run) => startTransition(run),
    report: (result, context) => {
      if (result.kind === 'saved') announce('ok', result.message);
      if (result.kind === 'rejected') announce('chyba', result.message);
      if (result.kind === 'failed') announce('chyba', SAVE_FAILED);
      // Odeslání při odchodu šlo mimo směrovač: co je na obrazovce, se musí
      // dotáhnout ze serveru (po vypršelém přihlášení tím skončí na přihlášení).
      if (context.leaving && result.kind !== 'failed') refreshFromServer();
      if (result.kind !== 'saved') unsavedHandlers.get(endpoint)?.(result, context);
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
 * `action`, která po uložení vykreslí stránku znovu, a výsledek ukáže hláška
 * v rozložení aplikace (`lib/save-feedback.ts`). Adresa stránky se nemění:
 * dřív uložení končilo přesměrováním s `?ok=` a každá změna přidala krok do
 * historie prohlížeče (změřeno 11. 10. 2026: po třech změnách čtyři stisky
 * Zpět). Formulář se prohlížečem neodesílá nikdy — ani Enterem v textovém
 * poli, který dřív poslal totéž podruhé.
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
}: {
  /** Server action, která formulář uloží a vrátí výsledek. */
  action: AutoSaveAction;
  /** Adresa, která uloží totéž obyčejným požadavkem — pro odchod ze stránky. */
  endpoint: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /**
   * Formulář právě zaniká. Chromium při zániku pole s rozepsaným textem
   * ohlásí `change` ještě během vykreslování; text v tu chvíli už patří
   * předávce nebo uložení při odchodu a tahle událost se nepočítá.
   */
  const detached = useRef(false);

  // Layout efekt: úklid běží, dokud zanikající pole ještě stojí v dokumentu
  // (běžný efekt by už viděl fokus na <body>), a nový formulář fokus vrátí
  // dřív, než prohlížeč cokoli vykreslí.
  useLayoutEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    detached.current = false;
    actions.set(endpoint, action);
    liveForms.set(endpoint, form);
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
    }
    return () => {
      detached.current = true;
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
        focusHandoff = { pathname, descriptor, at: performance.now() };
      }
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
        const job = names.length > 0 ? { data: snapshot(form), triggers: names } : undefined;
        const queue = queueFor(endpoint);
        // s nástupcem fronta pokračuje sama; bez něj se stránka opouští
        if (liveForms.has(endpoint)) {
          if (job) queue.enqueue(job);
        } else {
          queue.flush(job);
        }
      });
    };
  }, [action, endpoint]);

  // serverový snímek platí jen pro první vykreslení při hydrataci
  const hydratedFromServer = useRef(
    useSyncExternalStore(
      subscribeToNothing,
      () => false,
      () => true,
    ),
  );

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const queue = queueFor(endpoint);
    const save = (triggers: string[]): void =>
      queue.enqueue({ data: snapshot(form), triggers });

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
      announce('chyba', field.title || DRAFT_INVALID);
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
      if (markedInvalid.has(field)) {
        markedInvalid.delete(field);
        field.removeAttribute('aria-invalid');
      }
      syncUnloadGuard();
    };
    const onChange = (event: Event): void => {
      if (detached.current) return;
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
      if (detached.current) return;
      const field = textFieldOf(event.target);
      if (!field || !hasDraft(field) || !humanEdited.has(field)) return;
      confirm(field);
      syncUnloadGuard();
      save([field.name]);
    };
    // formulář ukládá skript; prohlížeč ho neodesílá (Enter v textovém poli)
    const onSubmit = (event: Event): void => event.preventDefault();
    // Skrytí i zavření panelu: co čeká, jde hned a požadavkem, který odchod
    // přežije. Na telefonu je skrytí panelu často poslední, co stránka zažije.
    const leave = (): void => {
      if (detached.current) return;
      const names = confirmDrafts(form, { validOnly: true });
      queue.flush(names.length > 0 ? { data: snapshot(form), triggers: names } : undefined);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') leave();
    };

    // Odeslání nedopadlo: obrazovka nesmí tvrdit, že je uloženo.
    const onUnsaved = (result: SaveResult, { job, last }: SaveReportContext): void => {
      if (result.kind === 'rejected') {
        // odmítnutý text zůstává v poli k opravě, ale už není „odeslaný“
        const rejected = textFieldsOf(form).filter(
          (field) => field.name === result.field && confirmedValues.has(field),
        );
        for (const field of rejected) {
          confirmedValues.delete(field);
          markedInvalid.add(field);
          field.setAttribute('aria-invalid', 'true');
        }
        syncUnloadGuard();
        // Server odmítl formulář celý. Ostatní změny, které šly s neplatným
        // textem, za něj nemůžou — odešlou se znovu bez něj.
        const rest = job.triggers.filter((name) => name !== result.field);
        const othersChanged = Array.from(form.elements).some(
          (control) =>
            textFieldOf(control) === null &&
            differsFromServerHtml(control as unknown as FormControlState),
        );
        if (rejected.length > 0 && last && (rest.length > 0 || othersChanged)) save(rest);
      }
      if (result.kind === 'failed' && last) {
        // odpověď nepřišla: nabídky a přepínače zpátky na uložený stav, text
        // zůstává rozepsaný (uloží se s dalším opuštěním pole nebo odchodem)
        for (const control of Array.from(form.elements)) {
          const field = textFieldOf(control);
          if (field) confirmedValues.delete(field);
          else restoreServerHtml(control as unknown as FormControlState);
        }
        syncUnloadGuard();
      }
    };

    form.addEventListener('input', onInput);
    form.addEventListener('change', onChange);
    form.addEventListener('focusout', onFocusOut);
    form.addEventListener('submit', onSubmit);
    window.addEventListener('pagehide', leave);
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
      for (const field of textFieldsOf(form)) {
        if (early.edited.has(field)) humanEdited.add(field);
        // text potvrzený před hydratací se odešle; rozepsaný zůstává rozepsaný
        if (early.committed.has(field) && hasDraft(field)) confirm(field);
      }
      if (submit) save([]);
    }
    syncUnloadGuard();
    form.setAttribute(READY_ATTRIBUTE, 'ready');
    return () => {
      form.removeEventListener('input', onInput);
      form.removeEventListener('change', onChange);
      form.removeEventListener('focusout', onFocusOut);
      form.removeEventListener('submit', onSubmit);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (unsavedHandlers.get(endpoint) === onUnsaved) unsavedHandlers.delete(endpoint);
      form.removeAttribute(READY_ATTRIBUTE);
    };
  }, [endpoint]);

  return <input ref={ref} type="hidden" name={CHANGED_FIELD} />;
}
