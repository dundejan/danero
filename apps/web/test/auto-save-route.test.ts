import { describe, expect, it, vi } from 'vitest';

/**
 * Uložení při odchodu ze stránky (`/api/settings/*`): obyčejný požadavek,
 * který přežije zavření panelu. Server action má kontrolu původu vestavěnou,
 * tahle cesta si ji hlídá sama — formulář smí poslat jen naše stránka
 * a jen přihlášený uživatel (toho zjišťuje každá cesta z relace a předává).
 */
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
  const USER = 'u-odchod';

  it('cizí stránce neuloží nic', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const response = await autoSaveResponse(request({ 'sec-fetch-site': 'cross-site' }), USER, save);
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  it('nepřihlášenému neuloží nic a řekne to stavem 401', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const response = await autoSaveResponse(request(SAME_ORIGIN), null, save);
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
    const response = await autoSaveResponse(request(SAME_ORIGIN, body), USER, save);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, message: 'Uloženo.' });
    expect(save.mock.calls[0]![0]).toBe('u-odchod');
    expect(save.mock.calls[0]![1].get('pole')).toBe('hodnota');
  });

  it('odmítnutou hodnotu vrátí i s hláškou a polem', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const response = await autoSaveResponse(request(SAME_ORIGIN), USER, async () => ({
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
      USER,
      save,
    );
    expect(response.status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  /**
   * Revize R7 (M4): cesta neměla strop velikosti těla — 5 MB prošlo až
   * k validaci formuláře. Formulář nastavení má kolem 4 kB.
   */
  it('moc velké tělo odmítne stavem 413 a nic neuloží', async () => {
    const { autoSaveResponse, MAX_BODY_BYTES } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const oversized = new FormData();
    oversized.append('pole', 'x'.repeat(MAX_BODY_BYTES));
    const response = await autoSaveResponse(request(SAME_ORIGIN, oversized), USER, save);
    expect(response.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
  });

  it('strop platí i bez hlavičky Content-Length (tělo po kusech)', async () => {
    const { autoSaveResponse, MAX_BODY_BYTES } = await import('@/lib/auto-save-route');
    const save = vi.fn();
    const chunk = new TextEncoder().encode('x'.repeat(4096));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > 4 * MAX_BODY_BYTES) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = new Request('https://danero.test/api/settings/profile', {
      method: 'POST',
      headers: { ...SAME_ORIGIN, 'content-type': 'multipart/form-data; boundary=x' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(streamed.headers.get('content-length')).toBeNull();
    const response = await autoSaveResponse(streamed, USER, save);
    expect(response.status).toBe(413);
    expect(save).not.toHaveBeenCalled();
    // zbytek těla se nečte: čtení skončilo dlouho před koncem proudu
    expect(sent).toBeLessThan(4 * MAX_BODY_BYTES);
  });

  it('formulář běžné velikosti projde beze změny', async () => {
    const { autoSaveResponse } = await import('@/lib/auto-save-route');
    const body = new FormData();
    for (let index = 0; index < 30; index++) body.append(`pole-${index}`, 'hodnota '.repeat(8));
    body.append('ostatni-prijmy', '12 000,50');
    const save = vi.fn(async (_userId: string, formData: FormData) => ({
      ok: true,
      message: String(formData.get('ostatni-prijmy')),
    }));
    const response = await autoSaveResponse(request(SAME_ORIGIN, body), USER, save);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: '12 000,50' });
  });
});
