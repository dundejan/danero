import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Uložení při odchodu ze stránky (`/api/settings/*`): obyčejný požadavek,
 * který přežije zavření panelu. Server action má kontrolu původu vestavěnou,
 * tahle cesta si ji hlídá sama — formulář smí poslat jen naše stránka
 * a jen přihlášený uživatel.
 */
const state = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));

vi.mock('@/lib/auth', () => ({
  getAuth: async () => ({ api: { getSession: async () => state.session } }),
}));

const request = (headers: Record<string, string>, body: BodyInit = new FormData()): Request =>
  new Request('https://danero.test/api/settings/profile', { method: 'POST', headers, body });

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };

describe('původ požadavku', () => {
  it('pozná požadavek z téže adresy podle Sec-Fetch-Site', async () => {
    const { isSameOriginRequest } = await import('@/lib/auto-save-route');
    expect(isSameOriginRequest(new Headers({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(isSameOriginRequest(new Headers({ 'sec-fetch-site': site })), site).toBe(false);
    }
  });

  it('bez Sec-Fetch-Site porovná Origin s adresou serveru', async () => {
    const { isSameOriginRequest } = await import('@/lib/auto-save-route');
    const headers = (values: Record<string, string>) => new Headers(values);
    expect(isSameOriginRequest(headers({ origin: 'https://danero.test', host: 'danero.test' }))).toBe(
      true,
    );
    // za proxy platí adresa, na kterou přišel prohlížeč
    expect(
      isSameOriginRequest(
        headers({ origin: 'https://danero.test', host: 'interni:3000', 'x-forwarded-host': 'danero.test' }),
      ),
    ).toBe(true);
    expect(isSameOriginRequest(headers({ origin: 'https://jinde.test', host: 'danero.test' }))).toBe(
      false,
    );
    // podvržený Sec-Fetch-Site má přednost před shodným Origin
    expect(
      isSameOriginRequest(
        headers({ 'sec-fetch-site': 'cross-site', origin: 'https://danero.test', host: 'danero.test' }),
      ),
    ).toBe(false);
    expect(isSameOriginRequest(headers({ host: 'danero.test' }))).toBe(false);
    expect(isSameOriginRequest(headers({ origin: 'nesmysl', host: 'danero.test' }))).toBe(false);
  });
});

describe('odpověď na uložení při odchodu', () => {
  beforeEach(() => {
    state.session = { user: { id: 'u-odchod' } };
  });

  it('cizí stránce neuloží nic', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const response = await autoSaveResponse(request({ 'sec-fetch-site': 'cross-site' }), save);
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('nepřihlášenému neuloží nic a řekne to stavem 401', async () => {
    state.session = null;
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const response = await autoSaveResponse(request(SAME_ORIGIN), save);
    expect(response.status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  it('uloží za přihlášeného uživatele a vrátí výsledek', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const body = new FormData();
    body.append('pole', 'hodnota');
    const save = vi.fn(async (_userId: string, _formData: FormData) => ({
      ok: true,
      message: 'Uloženo.',
    }));
    const response = await autoSaveResponse(request(SAME_ORIGIN, body), save);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, message: 'Uloženo.' });
    expect(save.mock.calls[0]![0]).toBe('u-odchod');
    expect(save.mock.calls[0]![1].get('pole')).toBe('hodnota');
  });

  it('odmítnutou hodnotu vrátí i s hláškou a polem', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const response = await autoSaveResponse(request(SAME_ORIGIN), async () => ({
      ok: false,
      message: 'Zadej částku.',
      field: 'ostatni-prijmy',
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      message: 'Zadej částku.',
      field: 'ostatni-prijmy',
    });
  });

  it('tělo, které není formulář, skončí chybou požadavku, ne výjimkou', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const response = await autoSaveResponse(
      request({ ...SAME_ORIGIN, 'content-type': 'application/json' }, '{"a":1}'),
      save,
    );
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
});
