import type { AutoSaveOutcome } from '@/lib/save-queue';

/**
 * Uložení formuláře při odchodu ze stránky (`/api/settings/*`).
 *
 * Auto-save běžně ukládá server action. Ta ale odchod ze stránky nepřežije:
 * požadavek spuštěný při zavírání panelu prohlížeč zahodí, pokud není označený
 * `keepalive`, a server action tak označit nejde. Rozepsaná částka, kterou
 * člověk nepotvrdil opuštěním pole, proto při odchodu jde sem — obyčejným
 * požadavkem, který zavření panelu přežije. Ukládá totéž a stejně jako akce
 * (`app/(app)/nastaveni/save.ts`).
 *
 * Kdo volá, zjišťuje každá cesta sama a předává sem (`userId`) — strážce
 * tenancy to chce vidět přímo v ní. Server action má navíc vestavěnou
 * kontrolu původu požadavku; tady ji děláme sami: formulář smí poslat jen
 * naše stránka.
 */

/**
 * Přišel požadavek z téže adresy, na které aplikace běží? Prohlížeč to říká
 * hlavičkou `Sec-Fetch-Site`; kde chybí, porovná se `Origin` s adresou serveru
 * (stejně to dělá Next u server actions). Požadavek bez obojího se odmítá.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin';
  const origin = headers.get('origin');
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Strop velikosti těla. Formulář nastavení má s oddělovači kolem 4 kB;
 * šestnáct je s rezervou a pořád řádově míň než 5 MB, které dřív prošly až
 * k validaci (přihlášenému ze stejného původu, ale zbytečně).
 */
export const MAX_BODY_BYTES = 16 * 1024;

/**
 * Tělo požadavku, nebo `null`, když je větší než strop. Hlavičce
 * `Content-Length` se věří jen k rychlému odmítnutí — tělo se čte po kusech
 * a počítá, takže strop platí i bez ní (nebo s nepravdivou).
 */
async function readLimitedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    // dál se nečte; zbytek těla zahodí server s odpovědí
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

const json = (outcome: AutoSaveOutcome, status: number): Response =>
  Response.json(outcome, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Odpověď na uložení při odchodu. `userId` je přihlášený uživatel, jak ho
 * cesta zjistila z relace (`null` = nikdo).
 */
export async function autoSaveResponse(
  request: Request,
  userId: string | null,
  save: (userId: string, formData: FormData) => Promise<AutoSaveOutcome>,
): Promise<Response> {
  if (!isSameOriginRequest(request.headers)) {
    return json({ ok: false, message: 'Požadavek nepřišel z aplikace.' }, 403);
  }
  if (userId === null) return json({ ok: false, message: 'Přihlášení vypršelo.' }, 401);
  const body = await readLimitedBody(request);
  if (body === null) return json({ ok: false, message: 'Formulář je moc velký.' }, 413);
  let formData: FormData;
  try {
    // tělo je už přečtené (a změřené) — formulář se z něj skládá znovu
    formData = await new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
      body,
    }).formData();
  } catch {
    return json({ ok: false, message: 'Formulář se nepodařilo přečíst.' }, 400);
  }
  const outcome = await save(userId, formData);
  return json(outcome, outcome.ok ? 200 : 422);
}
