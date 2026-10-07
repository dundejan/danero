import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fronta jobů delší než jeden běh funkce se dojíždí řetězem invokací
 * `/api/cron/jobs`. Řetěz nesmí vzniknout bez tajemství (skončil by na 401)
 * a nesmí být nekonečný.
 */
const stav = vi.hoisted(() => ({ cekajici: [] as Promise<unknown>[] }));

vi.mock('next/server', () => ({
  after: (fn: () => Promise<unknown>) => {
    stav.cekajici.push(fn());
  },
}));

describe('předání fronty jobů další invokaci', () => {
  let volani: Array<{ url: string; authorization: string | null }>;

  beforeEach(() => {
    stav.cekajici = [];
    volani = [];
    vi.stubGlobal('fetch', async (input: URL | string, init?: RequestInit) => {
      volani.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return new Response('ok');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it('zavolá záchranný cron s tajemstvím a o jedna vyšším pořadím', async () => {
    process.env.CRON_SECRET = 'tajne';
    const { continueJobsElsewhere } = await import('@/lib/cron-handoff');
    continueJobsElsewhere('https://danero.cz', 3);
    await Promise.all(stav.cekajici);

    expect(volani).toEqual([
      { url: 'https://danero.cz/api/cron/jobs?hop=4', authorization: 'Bearer tajne' },
    ]);
  });

  it('bez CRON_SECRET se nepředává nic — zbytek dojede s plánovaným cronem', async () => {
    const { continueJobsElsewhere } = await import('@/lib/cron-handoff');
    continueJobsElsewhere('http://localhost:3000', 0);
    await Promise.all(stav.cekajici);
    expect(volani).toEqual([]);
  });

  it('řetěz má strop a jeho dosažení jde do logu jako chyba', async () => {
    process.env.CRON_SECRET = 'tajne';
    const chybove: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      chybove.push(String(line));
    });
    const { continueJobsElsewhere } = await import('@/lib/cron-handoff');
    continueJobsElsewhere('https://danero.cz', 40);
    await Promise.all(stav.cekajici);

    expect(volani).toEqual([]);
    const udalost = JSON.parse(chybove[0]!) as Record<string, unknown>;
    expect(udalost).toMatchObject({ level: 'error', event: 'cron.jobs.handoff_failed', hop: 40 });
  });

  it('pořadí v řetězu se čte z ?hop= a nesmysl znamená začátek', async () => {
    const { hopFrom } = await import('@/lib/cron-handoff');
    expect(hopFrom(new Request('https://danero.cz/api/cron/jobs'))).toBe(0);
    expect(hopFrom(new Request('https://danero.cz/api/cron/jobs?hop=7'))).toBe(7);
    expect(hopFrom(new Request('https://danero.cz/api/cron/jobs?hop=-2'))).toBe(0);
    expect(hopFrom(new Request('https://danero.cz/api/cron/jobs?hop=abc'))).toBe(0);
  });
});
