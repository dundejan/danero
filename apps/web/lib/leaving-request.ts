import {
  saveBody,
  SignedOutError,
  type AutoSaveOutcome,
  type LeavingContext,
  type SaveJob,
} from '@/lib/save-queue';

/**
 * Požadavek, kterým auto-save ukládá při odchodu ze stránky (`/api/settings/*`).
 *
 * Běžně je to `fetch` s `keepalive`: prohlížeč ho dokončí i po zavření panelu
 * a stránka, která žije dál (přechod uvnitř aplikace, skrytý panel), si přečte
 * odpověď. Firefox ale `keepalive` umí až od verze 133 — ve starším volbu
 * potichu ignoruje a požadavek se zánikem dokumentu zahodí, takže rozepsaná
 * částka se při zavření panelu neuložila.
 *
 * Tam, kde `keepalive` není, proto zanikající dokument pošle totéž přes
 * `navigator.sendBeacon`. Ten odpověď nevrací, takže se používá JEN při zániku
 * dokumentu (není komu ji ukázat) a jen tam, kde `fetch` odchod nepřežije;
 * všude jinde zůstává `fetch` i s hláškou o výsledku.
 *
 * Kontrola původu na serveru (`lib/auto-save-route.ts`) se tím nemění ani
 * neoslabuje: beacon je požadavek z téže adresy se stejnými hlavičkami
 * `Sec-Fetch-Site` a `Origin` jako `fetch` a nese přihlašovací cookie.
 */

/** Co modul potřebuje od prohlížeče — v testu se dosadí napodobenina. */
export interface LeavingTransport {
  /** Umí `fetch` volbu `keepalive`? */
  keepalive: boolean;
  fetch(input: string, init: RequestInit): Promise<Response>;
  /** Vrací `false`, když prohlížeč požadavek nepřijal do fronty. */
  sendBeacon?(url: string, data: FormData): boolean;
}

/** `Request.prototype.keepalive` existuje právě tam, kde volbu `fetch` ctí. */
const browserTransport = (): LeavingTransport => ({
  keepalive: typeof Request !== 'undefined' && 'keepalive' in Request.prototype,
  fetch: (input, init) => fetch(input, init),
  sendBeacon:
    typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
      ? (url, data) => navigator.sendBeacon(url, data)
      : undefined,
});

/** Uložení požadavkem, na který přijde odpověď — stránka žije dál. */
export async function fetchLeaving(
  endpoint: string,
  job: SaveJob,
  transport: LeavingTransport = browserTransport(),
): Promise<AutoSaveOutcome> {
  const response = await transport.fetch(endpoint, {
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

/**
 * Odešle uložení při odchodu. Vrací výsledek ze serveru, nebo `null`, když
 * šlo přes beacon a odpověď nepřijde.
 */
export async function postLeaving(
  endpoint: string,
  job: SaveJob,
  { unloading }: LeavingContext,
  transport: LeavingTransport = browserTransport(),
): Promise<AutoSaveOutcome | null> {
  // když prohlížeč beacon nepřijme (plná fronta), zbývá aspoň pokus přes fetch
  if (unloading && !transport.keepalive && transport.sendBeacon?.(endpoint, saveBody(job))) {
    return null;
  }
  return fetchLeaving(endpoint, job, transport);
}
