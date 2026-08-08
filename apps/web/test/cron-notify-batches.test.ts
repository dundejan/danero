import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-11: notifikační cron je O(uživatelů) a na každého pouští celý engine.
 * Bez dávkování by timeout u 50. uživatele znamenal, že zbytek ten den
 * nedostane nic — dávky si proto předávají štafetu přes `?offset=`.
 */
const stav = vi.hoisted(() => ({
  zpracovani: [] as string[],
  cekajici: [] as Promise<unknown>[],
  ucty: [] as Array<{ id: string; email: string }>,
  /** Komu má odeslání spadnout (simulace výpadku Resendu). */
  selhavajici: new Set<string>(),
}));

vi.mock('next/server', () => ({
  after: (fn: () => Promise<unknown>) => {
    stav.cekajici.push(fn());
  },
}));
vi.mock('@/db', () => ({ getDb: async () => ({}) }));
vi.mock('@/lib/entitlements', () => ({
  billingEnabled: () => false,
  usersWithActiveSubscription: async () => new Set<string>(),
}));
vi.mock('@/lib/notifications', () => ({
  // schválně v opačném pořadí, než v jakém se má zpracovávat — route si musí
  // frontu seřadit sám, jinak by na sebe dávky nenavázaly
  listNotificationTargets: async () => [...stav.ucty].reverse(),
  processUserNotifications: async (_db: unknown, target: { id: string }) => {
    stav.zpracovani.push(target.id);
    if (stav.selhavajici.has(target.id)) {
      throw new Error('Resend: Internal server error (500)');
    }
    return { created: 1, emailed: 1 };
  },
  resolveEmailSender: () => async () => {},
}));

/**
 * Dobere celý řetěz štafet. `Promise.all(stav.cekajici)` nestačí: pole si
 * udělá snímek, ale navazující dávka do něj přidá další promise teprve během
 * čekání — a assertace pak běží nad rozpracovaným řetězem (v CI to spolehlivě
 * ukázalo 59 z 60 uživatelů).
 */
async function dobehniStafetu(): Promise<void> {
  while (stav.cekajici.length > 0) await Promise.all(stav.cekajici.splice(0));
}

const URL_CRON = 'https://danero.cz/api/cron/notify';
const request = (url = URL_CRON) =>
  new Request(url, { headers: { authorization: 'Bearer tajne' } });

describe('dávkování notifikačního cronu (G-11)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'tajne';
    stav.zpracovani = [];
    stav.cekajici = [];
    stav.selhavajici = new Set();
    stav.ucty = Array.from({ length: 60 }, (_, i) => ({
      id: `u-${String(i).padStart(3, '0')}`,
      email: `u${i}@danero.cz`,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it('jedna dávka zpracuje jen svůj díl a zbytek předá dál', async () => {
    const predane: string[] = [];
    vi.stubGlobal('fetch', async (input: URL | string) => {
      predane.push(String(input));
      return new Response('ok');
    });

    const { GET } = await import('@/app/api/cron/notify/route');
    const body = await (await GET(request())).json();

    expect(body.processed).toBe(25);
    expect(body.remaining).toBe(35);
    expect(stav.zpracovani).toHaveLength(25);
    expect(stav.zpracovani[0]).toBe('u-000'); // stabilní pořadí navzdory DB

    await dobehniStafetu();
    expect(predane).toEqual([`${URL_CRON}?offset=25`]);
  });

  it('řetěz dávek obslouží všechny uživatele, každého právě jednou', async () => {
    const { GET } = await import('@/app/api/cron/notify/route');
    let invokaci = 0;
    vi.stubGlobal('fetch', async (input: URL | string) => {
      invokaci += 1;
      return GET(request(String(input)));
    });

    await GET(request());
    await dobehniStafetu();

    expect(invokaci).toBe(2); // 60 uživatelů = 25 + 25 + 10
    expect(stav.zpracovani).toHaveLength(60);
    expect(new Set(stav.zpracovani).size).toBe(60);
    expect(stav.zpracovani.at(-1)).toBe('u-059');
  });

  it('výpadek odesílatele skončí v logu jako error, ne jen v těle odpovědi (G-O1)', async () => {
    // Celodenní výpadek Resendu: chyby jednotlivých uživatelů se dřív spolkly
    // do těla odpovědi, cron vrátil 200 a v logu zůstaly dvě info hlášky.
    // Tělo odpovědi Vercel Cron neuchovává — z monitoringu tedy nešlo poznat,
    // že ten den nikomu nic nepřišlo.
    stav.ucty = Array.from({ length: 3 }, (_, i) => ({ id: `u-${i}`, email: `u${i}@danero.cz` }));
    stav.selhavajici = new Set(stav.ucty.map((u) => u.id));

    const chybove: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      chybove.push(String(line));
    });

    const { GET } = await import('@/app/api/cron/notify/route');
    const odpoved = await GET(request());
    const telo = await odpoved.json();

    expect(odpoved.status).toBe(200); // zbytek fronty se zpracovat má
    expect(telo.processed).toBe(3);
    expect(telo.failed).toBe(3);

    const udalosti = chybove.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(udalosti.map((u) => u.event)).toEqual([
      'cron.notify.failures',
      'cron.notify.finished',
    ]);
    // text chyby musí být vidět — jinak nejde odlišit výpadek odesílatele
    // od chyby v datech jednoho účtu
    expect(udalosti[0]).toMatchObject({ level: 'error', failed: 3 });
    expect(String(udalosti[0]!.error)).toContain('Resend');
    // i souhrnný log běhu je error, ne info
    expect(udalosti[1]).toMatchObject({ level: 'error', status: 200, failed: 3 });
  });

  it('poslední dávka už štafetu nepředává', async () => {
    const predane: string[] = [];
    vi.stubGlobal('fetch', async (input: URL | string) => {
      predane.push(String(input));
      return new Response('ok');
    });

    const { GET } = await import('@/app/api/cron/notify/route');
    const body = await (await GET(request(`${URL_CRON}?offset=50`))).json();

    expect(body.processed).toBe(10);
    expect(body.remaining).toBe(0);
    await dobehniStafetu();
    expect(predane).toEqual([]);
  });
});
