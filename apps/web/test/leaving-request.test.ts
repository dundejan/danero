import { describe, expect, it, vi } from 'vitest';
import { CHANGED_FIELD } from '@/lib/form-baseline';
import { fetchLeaving, postLeaving, type LeavingTransport } from '@/lib/leaving-request';
import { SignedOutError, type SaveJob } from '@/lib/save-queue';

/**
 * Požadavek, kterým auto-save ukládá při odchodu ze stránky. `fetch`
 * s `keepalive` zavření panelu přežije jen tam, kde ho prohlížeč umí (Firefox
 * až od verze 133); jinde zanikající dokument posílá beacon. Beacon nevrací
 * odpověď, takže nesmí nahradit `fetch` tam, kde stránka žije dál.
 */
const ENDPOINT = '/api/settings/profile';

const job = (): SaveJob => {
  const data = new FormData();
  data.append('ostatni-prijmy', '12000');
  return { data, triggers: ['ostatni-prijmy'] };
};

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function transport(options: { keepalive: boolean; beacon?: boolean | null }): {
  transport: LeavingTransport;
  fetch: ReturnType<typeof vi.fn>;
  sendBeacon: ReturnType<typeof vi.fn>;
} {
  const fetch = vi.fn(async (_input: string, _init: RequestInit) =>
    response({ ok: true, message: 'Uloženo.' }),
  );
  const sendBeacon = vi.fn((_url: string, _data: FormData) => options.beacon ?? true);
  return {
    transport: {
      keepalive: options.keepalive,
      fetch,
      sendBeacon: options.beacon === null ? undefined : sendBeacon,
    },
    fetch,
    sendBeacon,
  };
}

describe('uložení při odchodu: fetch, nebo beacon', () => {
  it('kde prohlížeč keepalive umí, jde vždycky fetch a vrátí výsledek', async () => {
    for (const unloading of [false, true]) {
      const { transport: env, fetch, sendBeacon } = transport({ keepalive: true });
      expect(await postLeaving(ENDPOINT, job(), { unloading }, env)).toEqual({
        ok: true,
        message: 'Uloženo.',
        field: undefined,
      });
      expect(sendBeacon).not.toHaveBeenCalled();
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(ENDPOINT);
      expect(init).toMatchObject({ method: 'POST', keepalive: true });
    }
  });

  it('bez keepalive pošle zanikající dokument beacon se stejným tělem a odpověď nečeká', async () => {
    const { transport: env, fetch, sendBeacon } = transport({ keepalive: false });
    expect(await postLeaving(ENDPOINT, job(), { unloading: true }, env)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const [url, body] = sendBeacon.mock.calls[0]! as [string, FormData];
    expect(url).toBe(ENDPOINT);
    expect(body.get('ostatni-prijmy')).toBe('12000');
    expect(body.getAll(CHANGED_FIELD)).toEqual(['ostatni-prijmy']);
  });

  it('bez keepalive, ale na stránce, která žije dál, zůstává fetch — jinak by zmizela hláška', async () => {
    const { transport: env, fetch, sendBeacon } = transport({ keepalive: false });
    expect(await postLeaving(ENDPOINT, job(), { unloading: false }, env)).toMatchObject({ ok: true });
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('když prohlížeč beacon nepřijme nebo ho nemá, zkusí aspoň fetch', async () => {
    for (const beacon of [false, null]) {
      const { transport: env, fetch } = transport({ keepalive: false, beacon });
      expect(await postLeaving(ENDPOINT, job(), { unloading: true }, env)).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('vypršelé přihlášení a nesrozumitelnou odpověď hlásí výjimkou', async () => {
    const signedOut: LeavingTransport = {
      keepalive: true,
      fetch: async () => response({ ok: false, message: 'Přihlášení vypršelo.' }, 401),
    };
    await expect(fetchLeaving(ENDPOINT, job(), signedOut)).rejects.toBeInstanceOf(SignedOutError);
    const garbled: LeavingTransport = { keepalive: true, fetch: async () => response({ nic: 1 }) };
    await expect(fetchLeaving(ENDPOINT, job(), garbled)).rejects.toThrow('neznámá odpověď');
  });

  it('odmítnutou částku vrátí i se jménem pole', async () => {
    const rejected: LeavingTransport = {
      keepalive: true,
      fetch: async () =>
        response({ ok: false, message: 'Zadej částku.', field: 'ostatni-prijmy' }, 422),
    };
    expect(await fetchLeaving(ENDPOINT, job(), rejected)).toEqual({
      ok: false,
      message: 'Zadej částku.',
      field: 'ostatni-prijmy',
    });
  });
});
