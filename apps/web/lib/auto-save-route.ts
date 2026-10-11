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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, message: 'Formulář se nepodařilo přečíst.' }, 400);
  }
  const outcome = await save(userId, formData);
  return json(outcome, outcome.ok ? 200 : 422);
}
