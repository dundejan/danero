import { BASELINE_FIELD, CHANGED_FIELD, SUBMISSION_FIELD } from '@/lib/form-baseline';

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
  /** Čí formulář odeslání vytvořil (`lib/owner-tag.ts`) — hláška o výsledku se ukáže jen jemu. */
  owner?: string;
  /** Pořadí odeslání (`SUBMISSION_FIELD`); přiděluje ho fronta, když odeslání vzniká. */
  mark?: string;
}

/** Jak odeslání dopadlo z pohledu prohlížeče. */
export type SaveResult =
  | { kind: 'saved'; message: string }
  /** Server hodnotu odmítl (neplatná částka). */
  | { kind: 'rejected'; message: string; field?: string }
  /** Odpověď nepřišla — síť, pád serveru. */
  | { kind: 'failed' }
  /** Přihlášení mezitím skončilo; aplikace člověka pošle na přihlášení. */
  | { kind: 'signedOut' }
  /**
   * Odesláno cestou, která odpověď nevrací (`navigator.sendBeacon` při zániku
   * dokumentu) — jak dopadlo, se stránka nedozví, takže není co hlásit.
   */
  | { kind: 'sent' };

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
  /**
   * Odeslání, které přežije odchod ze stránky. `null` = odesláno, ale odpověď
   * nepřijde (viz `sent` v `SaveResult`).
   */
  sendLeaving(job: SaveJob, context: LeavingContext): Promise<AutoSaveOutcome | null>;
  report(result: SaveResult, context: SaveReportContext): void;
}

/** Za jakých okolností odeslání při odchodu odchází. */
export interface LeavingContext {
  /**
   * Zaniká celý dokument (`pagehide`: zavření panelu, F5, odchod na jinou
   * adresu) — na rozdíl od přechodu uvnitř aplikace nebo pouhého skrytí
   * panelu, kde stránka žije dál a odpověď si přečte.
   */
  unloading: boolean;
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
  /**
   * Odchod ze stránky: čekající odeslání (a případné `job` navíc) jde hned.
   * `unloading` říká, že zaniká celý dokument (viz `LeavingContext`).
   */
  flush(job?: SaveJob, context?: Partial<LeavingContext>): void;
  /**
   * Stav formuláře z posledního odeslání, dokud nějaké běží nebo čeká; jinak
   * `null`. Formulář vykreslený znovu uprostřed ukládání by jinak ukázal stav
   * serveru z doby před ním a změna by na chvíli skočila zpátky.
   */
  unsettled(): FormData | null;
}

/** Tělo požadavku: stav formuláře, jména změněných polí a pořadí odeslání. */
export function saveBody(job: SaveJob): FormData {
  const body = new FormData();
  for (const [name, value] of job.data) {
    if (name !== CHANGED_FIELD && name !== SUBMISSION_FIELD) body.append(name, value);
  }
  for (const name of job.triggers) body.append(CHANGED_FIELD, name);
  if (job.mark !== undefined) body.append(SUBMISSION_FIELD, job.mark);
  return body;
}

/**
 * Odeslání bez změny pole `field`: hodnota se vrátí na stav, se kterým byl
 * formulář vykreslen (takže ji server nezapíše), a pole zmizí ze jmen změněných.
 *
 * Server odmítá formulář celý. Odeslání, které vzniklo dřív, než odmítnutí
 * přišlo, nese tentýž neplatný text — a s ním by padly i změny, které za něj
 * nemůžou (revize R7, D1: neplatná částka a hned po ní změna párování; nabídka
 * ukazovala novou volbu, v databázi zůstala stará).
 */
export function withoutField(job: SaveJob, field: string): SaveJob {
  const baseline = job.data.get(BASELINE_FIELD);
  const served =
    typeof baseline === 'string' ? new URLSearchParams(baseline).getAll(field) : [];
  const data = new FormData();
  for (const [name, value] of job.data) if (name !== field) data.append(name, value);
  for (const value of served) data.append(field, value);
  return { ...job, data, triggers: job.triggers.filter((name) => name !== field) };
}

export function createSaveQueue(
  deps: SaveQueueDeps,
  /** Označení fronty v pořadí odeslání — jedno na formulář a načtení stránky. */
  instance: string = crypto.randomUUID(),
): SaveQueue {
  let waiting: SaveJob | null = null;
  let sequence = 0;
  let draining = false;
  let leavingInFlight = 0;
  let latest: FormData | null = null;
  const settled = (): void => {
    if (!draining && waiting === null && leavingInFlight === 0) latest = null;
  };

  const settle = async (
    sending: () => Promise<AutoSaveOutcome | null>,
  ): Promise<SaveResult> => {
    try {
      const outcome = await sending();
      if (outcome === null) return { kind: 'sent' };
      return outcome.ok
        ? { kind: 'saved', message: outcome.message }
        : { kind: 'rejected', message: outcome.message, field: outcome.field };
    } catch (error) {
      return error instanceof SignedOutError || isActionRedirect(error)
        ? { kind: 'signedOut' }
        : { kind: 'failed' };
    }
  };

  /**
   * Novější stav formuláře nahrazuje čekající, jména změněných polí se sčítají.
   * Odeslání dostává pořadové číslo ve chvíli, kdy vzniká — ne až když odchází.
   */
  const merge = (job: SaveJob): void => {
    latest = job.data;
    sequence += 1;
    waiting = {
      ...job,
      triggers: waiting ? [...new Set([...waiting.triggers, ...job.triggers])] : job.triggers,
      mark: `${instance}.${sequence}`,
    };
  };

  /**
   * Server právě odmítl text pole. Čekající odeslání, které ho nese taky
   * (vzniklo dřív, než odpověď přišla), ho odloží — viz `withoutField`.
   * Odeslání vzniklá později už nesou, co je v poli doopravdy.
   */
  const dropRefused = (job: SaveJob, result: SaveResult): void => {
    if (result.kind !== 'rejected' || result.field === undefined || waiting === null) return;
    const refused = job.data.get(result.field);
    if (refused === null || waiting.data.get(result.field) !== refused) return;
    const stale = waiting.data;
    waiting = withoutField(waiting, result.field);
    if (latest === stale) latest = waiting.data;
  };

  const drain = async (): Promise<void> => {
    try {
      while (waiting) {
        const job = waiting;
        waiting = null;
        const result = await settle(() => deps.send(job));
        dropRefused(job, result);
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
    flush(job, { unloading = false } = {}) {
      if (job) merge(job);
      if (!waiting) return;
      const sent = waiting;
      waiting = null;
      leavingInFlight += 1;
      void settle(() => deps.sendLeaving(sent, { unloading })).then((result) => {
        leavingInFlight -= 1;
        deps.report(result, { job: sent, leaving: true, last: waiting === null && !draining });
        settled();
      });
    },
    unsettled: () => latest,
  };
}
