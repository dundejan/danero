import { describe, expect, it } from 'vitest';
import { CHANGED_FIELD } from '@/lib/form-baseline';
import {
  createSaveQueue,
  saveBody,
  SignedOutError,
  type AutoSaveOutcome,
  type LeavingContext,
  type SaveJob,
  type SaveReportContext,
  type SaveResult,
} from '@/lib/save-queue';

/**
 * Fronta automatického ukládání: pořadí, slévání změn a odchod ze stránky.
 * Odesílání je napodobené — každé čeká, až ho test dokončí.
 */
interface Sent {
  job: SaveJob;
  leaving: boolean;
  /** Jen u odeslání při odchodu: zaniká celý dokument? */
  unloading?: boolean;
  finish(outcome: AutoSaveOutcome | null): void;
  fail(error: unknown): void;
}

function harness() {
  const sent: Sent[] = [];
  const reports: Array<{ result: SaveResult; context: SaveReportContext }> = [];
  const sending =
    (leaving: boolean) =>
    (job: SaveJob, context?: LeavingContext): Promise<AutoSaveOutcome | null> =>
      new Promise((finish, fail) =>
        sent.push({ job, leaving, unloading: context?.unloading, finish, fail }),
      );
  const queue = createSaveQueue({
    send: sending(false) as (job: SaveJob) => Promise<AutoSaveOutcome>,
    sendLeaving: sending(true),
    report: (result, context) => reports.push({ result, context }),
  });
  return { queue, sent, reports };
}

const job = (fields: Record<string, string>, ...triggers: string[]): SaveJob => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return { data, triggers };
};

const saved: AutoSaveOutcome = { ok: true, message: 'Uloženo.' };
/** Nechá doběhnout sliby, které se právě vyřešily. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('fronta ukládání', () => {
  it('první změnu odešle hned, další až po odpovědi na předchozí', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(job({ prepinac: 'on' }, 'prepinac'));
    queue.enqueue(job({}, 'prepinac'));
    expect(sent).toHaveLength(1);

    sent[0]!.finish(saved);
    await settle();
    expect(sent).toHaveLength(2);
    // první odpověď: další odeslání ještě čekalo
    expect(reports[0]!.context.last).toBe(false);

    sent[1]!.finish(saved);
    await settle();
    expect(reports.map((report) => report.result.kind)).toEqual(['saved', 'saved']);
    expect(reports[1]!.context.last).toBe(true);
  });

  it('změny během ukládání slije: nejnovější stav a jména všech změněných polí', async () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '1', b: '2' }, 'b'));
    // třetí změna vrací pole `b` na původní hodnotu — jméno musí zůstat
    queue.enqueue(job({ a: '1', c: '3' }, 'c'));

    sent[0]!.finish(saved);
    await settle();
    expect(sent).toHaveLength(2);
    expect([...sent[1]!.job.data.entries()]).toEqual([
      ['a', '1'],
      ['c', '3'],
    ]);
    expect(sent[1]!.job.triggers).toEqual(['b', 'c']);
  });

  it('po doběhu přijme další změnu znovu hned', async () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    sent[0]!.finish(saved);
    await settle();
    queue.enqueue(job({ a: '2' }, 'a'));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.leaving).toBe(false);
  });

  it('při odchodu odešle čekající změnu hned a cestou, která odchod přežije', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '1', b: '2' }, 'b'));
    queue.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.leaving).toBe(true);
    expect(sent[1]!.job.triggers).toEqual(['b']);

    // nic se neposílá dvakrát: po odpovědi na první už fronta nemá co odeslat
    sent[0]!.finish(saved);
    sent[1]!.finish(saved);
    await settle();
    expect(sent).toHaveLength(2);
    expect(reports.map((report) => report.context.leaving).sort()).toEqual([false, true]);
  });

  it('rozepsaný text při odchodu jde jedním odesláním i s tím, co čekalo', () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '1', b: '2' }, 'b'));
    queue.flush(job({ a: '1', b: '2', castka: '500' }, 'castka'));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.job.triggers).toEqual(['b', 'castka']);
    expect(sent[1]!.job.data.get('castka')).toBe('500');
  });

  it('odchod bez čekající změny nic neposílá', () => {
    const { queue, sent } = harness();
    queue.flush();
    expect(sent).toHaveLength(0);
    // rozepsaný text jde i tehdy, když se zrovna nic neukládá
    queue.flush(job({ castka: '500' }, 'castka'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.leaving).toBe(true);
  });

  it('odeslání při odchodu ví, jestli zaniká celý dokument', () => {
    const { queue, sent } = harness();
    queue.flush(job({ castka: '500' }, 'castka'));
    queue.flush(job({ castka: '600' }, 'castka'), { unloading: true });
    expect(sent.map((item) => item.unloading)).toEqual([false, true]);
  });

  it('odeslání bez odpovědi (beacon) nehlásí úspěch ani chybu a frontu uvolní', async () => {
    const { queue, sent, reports } = harness();
    queue.flush(job({ castka: '500' }, 'castka'), { unloading: true });
    expect(queue.unsettled()?.get('castka')).toBe('500');
    sent[0]!.finish(null);
    await settle();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.result).toEqual({ kind: 'sent' });
    expect(reports[0]!.context).toMatchObject({ leaving: true, last: true });
    expect(queue.unsettled()).toBeNull();
  });

  it('rozliší odmítnutí, výpadek a vypršelé přihlášení', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(job({ castka: 'abc' }, 'castka'));
    sent[0]!.finish({ ok: false, message: 'Zadej částku.', field: 'castka' });
    await settle();
    queue.enqueue(job({ a: '1' }, 'a'));
    sent[1]!.fail(new TypeError('Failed to fetch'));
    await settle();
    queue.enqueue(job({ a: '1' }, 'a'));
    sent[2]!.fail(new SignedOutError());
    await settle();
    // server action hlásí přesměrování na přihlášení výjimkou s otiskem
    queue.enqueue(job({ a: '1' }, 'a'));
    sent[3]!.fail(Object.assign(new Error('redirect'), { digest: 'NEXT_REDIRECT;replace;/prihlaseni;307;' }));
    await settle();

    expect(reports.map((report) => report.result)).toEqual([
      { kind: 'rejected', message: 'Zadej částku.', field: 'castka' },
      { kind: 'failed' },
      { kind: 'signedOut' },
      { kind: 'signedOut' },
    ]);
  });

  it('výpadek jednoho odeslání frontu nezastaví', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '1', b: '2' }, 'b'));
    sent[0]!.fail(new Error('síť'));
    await settle();
    expect(sent).toHaveLength(2);
    sent[1]!.finish(saved);
    await settle();
    expect(reports.map((report) => report.result.kind)).toEqual(['failed', 'saved']);
  });
});

describe('stav, který právě odchází', () => {
  it('je k dispozici, dokud něco běží nebo čeká, a pak zmizí', async () => {
    const { queue, sent } = harness();
    expect(queue.unsettled()).toBeNull();
    queue.enqueue(job({ a: '1' }, 'a'));
    expect(queue.unsettled()?.get('a')).toBe('1');
    // formulář vykreslený znovu uprostřed ukládání má ukázat nejnovější stav
    queue.enqueue(job({ a: '2' }, 'a'));
    expect(queue.unsettled()?.get('a')).toBe('2');
    sent[0]!.finish(saved);
    await settle();
    expect(queue.unsettled()?.get('a')).toBe('2');
    sent[1]!.finish(saved);
    await settle();
    expect(queue.unsettled()).toBeNull();
  });

  it('platí i pro odeslání při odchodu', async () => {
    const { queue, sent } = harness();
    queue.flush(job({ castka: '500' }, 'castka'));
    expect(queue.unsettled()?.get('castka')).toBe('500');
    sent[0]!.finish(saved);
    await settle();
    expect(queue.unsettled()).toBeNull();
  });

  it('poslední je až odeslání, po kterém nic neběží ani nečeká', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '2' }, 'a'));
    queue.flush();
    // odchod doběhne dřív než první běžné odeslání
    sent[1]!.finish(saved);
    await settle();
    expect(reports[0]!.context).toMatchObject({ leaving: true, last: false });
    sent[0]!.finish(saved);
    await settle();
    expect(reports[1]!.context).toMatchObject({ leaving: false, last: true });
  });
});

describe('tělo požadavku', () => {
  it('nese stav formuláře a každé změněné pole zvlášť', () => {
    const body = saveBody(job({ a: '1', [CHANGED_FIELD]: '' }, 'a', 'b'));
    expect(body.get('a')).toBe('1');
    // prázdné skryté pole z formuláře se nahradí jmény změněných polí
    expect(body.getAll(CHANGED_FIELD)).toEqual(['a', 'b']);
  });
});
