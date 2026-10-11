import { CHANGED_FIELD } from '@/lib/form-baseline';

/**
 * Fronta automatického ukládání jednoho formuláře.
 *
 * Auto-save odesílá každou změnu zvlášť a server zapisuje jen pole, která se
 * liší od stavu při vykreslení (`lib/form-baseline.ts`). Fronta k tomu drží
 * tři věci:
 *
 * - **Pořadí.** Odeslání jdou za sebou, další až po odpovědi na předchozí —
 *   přepínač zapnutý a hned vypnutý se na serveru nesmí potkat obráceně.
 * - **Jedno čekající odeslání.** Změny, které přijdou během ukládání, se
 *   slijí: platí nejnovější stav formuláře a jména všech polí, která se mezitím
 *   změnila (i těch, která se vrátila na původní hodnotu).
 * - **Odchod ze stránky.** Co ještě čeká, se při odchodu odešle hned
 *   a požadavkem, který přežije zavření panelu (`sendLeaving`). Bez toho se
 *   rozepsaná částka ztratila pokaždé, když člověk odešel, aniž pole opustil
 *   (změřeno 11. 10. 2026: Zpět, zavření panelu, F5 i odchod jinam).
 *
 * Fronta žije mimo komponentu formuláře: uložení formulář vykreslí znovu
 * a odchod ho odmontuje, rozdělaná práce musí doběhnout tak jako tak.
 *
 * Čistá logika bez Reactu a bez DOM — jde otestovat v Node.
 */

/** Výsledek automatického uložení, jak ho server vrací prohlížeči. */
export interface AutoSaveOutcome {
  ok: boolean;
  /** Věta pro uživatele. */
  message: string;
  /** `name` pole, kvůli kterému server formulář odmítl. */
  field?: string;
}

/** Jedno odeslání: stav formuláře a jména polí, jejichž změna ho vyvolala. */
export interface SaveJob {
  data: FormData;
  triggers: string[];
}

/** Jak odeslání dopadlo z pohledu prohlížeče. */
export type SaveResult =
  | { kind: 'saved'; message: string }
  /** Server hodnotu odmítl (neplatná částka). */
  | { kind: 'rejected'; message: string; field?: string }
  /** Odpověď nepřišla — síť, pád serveru. */
  | { kind: 'failed' }
  /** Přihlášení mezitím skončilo; aplikace člověka pošle na přihlášení. */
  | { kind: 'signedOut' };

/** Uložení, které skončilo tím, že uživatel už není přihlášený. */
export class SignedOutError extends Error {}

/** Výjimka, kterou server action hlásí přesměrování (u auto-save jen na přihlášení). */
const isActionRedirect = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'digest' in error &&
  typeof error.digest === 'string' &&
  error.digest.startsWith('NEXT_REDIRECT');

interface SaveQueueDeps {
  /** Běžné odeslání, dokud stránka žije. */
  send(job: SaveJob): Promise<AutoSaveOutcome>;
  /** Odeslání, které přežije odchod ze stránky. */
  sendLeaving(job: SaveJob): Promise<AutoSaveOutcome>;
  report(result: SaveResult, context: SaveReportContext): void;
}

export interface SaveReportContext {
  job: SaveJob;
  /** Odesláno při odchodu ze stránky. */
  leaving: boolean;
  /** Žádné další odeslání téhož formuláře neběží ani nečeká. */
  last: boolean;
}

export interface SaveQueue {
  /** Zařadí odeslání; běží-li jiné, počká na něj (a slije se s dalším čekajícím). */
  enqueue(job: SaveJob): void;
  /** Odchod ze stránky: čekající odeslání (a případné `job` navíc) jde hned. */
  flush(job?: SaveJob): void;
  /**
   * Stav formuláře z posledního odeslání, dokud nějaké běží nebo čeká; jinak
   * `null`. Formulář vykreslený znovu uprostřed ukládání by jinak ukázal stav
   * serveru z doby před ním a změna by na chvíli skočila zpátky.
   */
  unsettled(): FormData | null;
}

/** Tělo požadavku: stav formuláře a jména změněných polí. */
export function saveBody(job: SaveJob): FormData {
  const body = new FormData();
  for (const [name, value] of job.data) {
    if (name !== CHANGED_FIELD) body.append(name, value);
  }
  for (const name of job.triggers) body.append(CHANGED_FIELD, name);
  return body;
}

export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  let waiting: SaveJob | null = null;
  let draining = false;
  let leavingInFlight = 0;
  let latest: FormData | null = null;
  const settled = (): void => {
    if (!draining && waiting === null && leavingInFlight === 0) latest = null;
  };

  const settle = async (sending: () => Promise<AutoSaveOutcome>): Promise<SaveResult> => {
    try {
      const outcome = await sending();
      return outcome.ok
        ? { kind: 'saved', message: outcome.message }
        : { kind: 'rejected', message: outcome.message, field: outcome.field };
    } catch (error) {
      return error instanceof SignedOutError || isActionRedirect(error)
        ? { kind: 'signedOut' }
        : { kind: 'failed' };
    }
  };

  /** Novější stav formuláře nahrazuje čekající, jména změněných polí se sčítají. */
  const merge = (job: SaveJob): void => {
    latest = job.data;
    waiting = waiting
      ? { data: job.data, triggers: [...new Set([...waiting.triggers, ...job.triggers])] }
      : job;
  };

  const drain = async (): Promise<void> => {
    try {
      while (waiting) {
        const job = waiting;
        waiting = null;
        const result = await settle(() => deps.send(job));
        deps.report(result, {
          job,
          leaving: false,
          last: waiting === null && leavingInFlight === 0,
        });
      }
    } finally {
      draining = false;
      settled();
    }
  };

  return {
    enqueue(job) {
      merge(job);
      if (draining) return;
      draining = true;
      void drain();
    },
    flush(job) {
      if (job) merge(job);
      if (!waiting) return;
      const sent = waiting;
      waiting = null;
      leavingInFlight += 1;
      void settle(() => deps.sendLeaving(sent)).then((result) => {
        leavingInFlight -= 1;
        deps.report(result, { job: sent, leaving: true, last: waiting === null && !draining });
        settled();
      });
    },
    unsettled: () => latest,
  };
}
