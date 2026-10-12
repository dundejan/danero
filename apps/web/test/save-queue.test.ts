import { describe, expect, it } from 'vitest';
import { BASELINE_FIELD, CHANGED_FIELD, SUBMISSION_FIELD } from '@/lib/form-baseline';
import {
  createSaveQueue,
  saveBody,
  SignedOutError,
  type AutoSaveOutcome,
  type LeavingContext,
  type SaveJob,
  type SaveReportContext,
  type SaveResult,
  withoutField,
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
  const queue = createSaveQueue(
    {
      send: sending(false) as (job: SaveJob) => Promise<AutoSaveOutcome>,
      sendLeaving: sending(true),
      report: (result, context) => reports.push({ result, context }),
    },
    'fronta',
  );
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
    // odeslání, které nešlo frontou, pořadí nenese
    expect(body.has(SUBMISSION_FIELD)).toBe(false);
  });

  it('pořadí odeslání nese jednou, i kdyby ho stav formuláře už obsahoval', () => {
    const body = saveBody({ ...job({ a: '1', [SUBMISSION_FIELD]: 'cizi.9' }, 'a'), mark: 'fronta.3' });
    expect(body.getAll(SUBMISSION_FIELD)).toEqual(['fronta.3']);
  });
});

/**
 * Revize R7, M3: odchod ze stránky pošle čekající odeslání souběžně s tím,
 * které ještě běží, a na server můžou dorazit obráceně (přepnutí tam a zpět
 * a zavření panelu skončilo na starší volbě). Fronta proto odeslání čísluje
 * ve chvíli, kdy vznikají; server starší odeslání téhož formuláře nezapíše
 * (`test/settings-save-order.test.ts`).
 */
describe('pořadí odeslání', () => {
  const marks = (sent: Sent[]): Array<string | undefined> => sent.map((item) => item.job.mark);

  it('každé odeslání má vyšší číslo než předchozí a označení fronty', async () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    sent[0]!.finish(saved);
    await settle();
    queue.enqueue(job({ a: '2' }, 'a'));
    expect(marks(sent)).toEqual(['fronta.1', 'fronta.2']);
    expect(saveBody(sent[1]!.job).get(SUBMISSION_FIELD)).toBe('fronta.2');
  });

  it('číslo patří chvíli, kdy odeslání vzniklo — odchod během ukládání je novější', () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ parovani: 'LIFO' }, 'parovani')); // běží
    queue.enqueue(job({ parovani: 'FIFO' }, 'parovani')); // čeká
    queue.flush(); // odchází souběžně s prvním
    expect(sent.map((item) => [item.leaving, item.job.mark])).toEqual([
      [false, 'fronta.1'],
      [true, 'fronta.2'],
    ]);
  });

  it('slité odeslání nese číslo poslední změny', () => {
    const { queue, sent } = harness();
    queue.enqueue(job({ a: '1' }, 'a'));
    queue.enqueue(job({ a: '1', b: '2' }, 'b'));
    queue.enqueue(job({ a: '1', b: '3' }, 'b'));
    queue.flush();
    expect(marks(sent)).toEqual(['fronta.1', 'fronta.3']);
  });

  it('dvě fronty (dva formuláře nebo dvě načtení stránky) mají různá označení', () => {
    const first = createSaveQueue({ send: async () => saved, sendLeaving: async () => saved, report: () => {} });
    const sentMarks: string[] = [];
    const second = createSaveQueue({
      send: async (sentJob) => {
        sentMarks.push(sentJob.mark ?? '');
        return saved;
      },
      sendLeaving: async () => saved,
      report: () => {},
    });
    first.enqueue(job({ a: '1' }, 'a'));
    second.enqueue(job({ a: '1' }, 'a'));
    expect(sentMarks[0]).toMatch(/^[0-9a-f-]{36}\.1$/);
  });
});

/**
 * Revize R7, D1: server odmítá formulář celý. Odeslání, které vzniklo dřív,
 * než odmítnutí přišlo, nese tentýž neplatný text — a s ním padla i změna,
 * která za něj nemůže (částka `abc` a hned po ní párování: nabídka ukazovala
 * LIFO, v databázi zůstalo FIFO a neuložilo se to ani při odchodu).
 */
describe('odmítnutý text uprostřed řady', () => {
  const baseline = 'ostatni-prijmy=0&parovani=FIFO';
  const withBaseline = (fields: Record<string, string>, ...triggers: string[]): SaveJob =>
    job({ [BASELINE_FIELD]: baseline, ...fields }, ...triggers);
  const refusal: AutoSaveOutcome = { ok: false, message: 'Zadej částku.', field: 'ostatni-prijmy' };

  it('čekající odeslání odmítnutý text odloží a zbytek uloží', async () => {
    const { queue, sent, reports } = harness();
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc', parovani: 'FIFO' }, 'ostatni-prijmy'));
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc', parovani: 'LIFO' }, 'parovani'));
    sent[0]!.finish(refusal);
    await settle();

    expect(sent).toHaveLength(2);
    const second = sent[1]!.job;
    // částka se vrací na stav, se kterým byl formulář vykreslen — server ji nezapíše
    expect(second.data.getAll('ostatni-prijmy')).toEqual(['0']);
    expect(second.data.get('parovani')).toBe('LIFO');
    expect(second.triggers).toEqual(['parovani']);
    // formulář vykreslený znovu nesmí dostat odmítnutý text jako „odeslaný“
    expect(queue.unsettled()?.get('ostatni-prijmy')).toBe('0');
    expect(reports[0]!.context.last).toBe(false);
    sent[1]!.finish(saved);
    await settle();
    expect(reports.map((report) => report.result.kind)).toEqual(['rejected', 'saved']);
  });

  it('text, který člověk mezitím opravil, zůstává', async () => {
    const { queue, sent } = harness();
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc' }, 'ostatni-prijmy'));
    queue.enqueue(withBaseline({ 'ostatni-prijmy': '5000' }, 'ostatni-prijmy'));
    sent[0]!.finish(refusal);
    await settle();
    expect(sent[1]!.job.data.get('ostatni-prijmy')).toBe('5000');
    expect(sent[1]!.job.triggers).toEqual(['ostatni-prijmy']);
  });

  it('odeslání vzniklé až po odmítnutí se nepřepisuje — tentýž text posoudí server znovu', async () => {
    const { queue, sent } = harness();
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc' }, 'ostatni-prijmy'));
    sent[0]!.finish(refusal);
    await settle();
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc' }, 'ostatni-prijmy'));
    expect(sent[1]!.job.data.get('ostatni-prijmy')).toBe('abc');
  });

  it('odmítnutí bez jména pole čekající odeslání nemění', async () => {
    const { queue, sent } = harness();
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc' }, 'ostatni-prijmy'));
    queue.enqueue(withBaseline({ 'ostatni-prijmy': 'abc', parovani: 'LIFO' }, 'parovani'));
    sent[0]!.finish({ ok: false, message: 'Formulář se nepodařilo uložit.' });
    await settle();
    expect(sent[1]!.job.data.get('ostatni-prijmy')).toBe('abc');
  });

  it('withoutField vrátí pole na stav při vykreslení — i skupinu políček a pole, které ve stavu není', () => {
    const data = new FormData();
    data.append(BASELINE_FIELD, 'hranice=60&hranice=85&castka=0');
    for (const value of ['60', '100']) data.append('hranice', value);
    data.append('castka', 'abc');
    data.append('prepinac', 'on');
    const base: SaveJob = { data, triggers: ['hranice', 'castka', 'prepinac'], owner: 'ucet', mark: 'fronta.4' };

    const group = withoutField(base, 'hranice');
    expect(group.data.getAll('hranice')).toEqual(['60', '85']);
    expect(group.triggers).toEqual(['castka', 'prepinac']);
    expect(group).toMatchObject({ owner: 'ucet', mark: 'fronta.4' });
    // přepínač ve stavu při vykreslení nebyl (nezaškrtnutý) → z odeslání zmizí
    expect(withoutField(base, 'prepinac').data.has('prepinac')).toBe(false);
    // původní odeslání se nemění
    expect(base.data.get('castka')).toBe('abc');
  });
});
