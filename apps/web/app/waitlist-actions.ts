'use server';

import { headers } from 'next/headers';
import { getDb } from '@/db';
import { waitlist } from '@/db/schema';
import { checkRateLimit } from '@/lib/rate-limit';

export interface WaitlistState {
  ok?: string;
  chyba?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Zápis do waitlistu (docs/12, P0). Anonymní akce → rate limit per IP;
 * opakované přihlášení stejného e-mailu je no-op (PK), uživateli se ale
 * vždy potvrdí úspěch — nezveřejňujeme, kdo na seznamu je.
 */
export async function joinWaitlistAction(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { chyba: 'Zadej platný e-mail.' };
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const db = await getDb();
  if (!(await checkRateLimit(db, `waitlist:${ip}`, { max: 5, windowMs: 60 * 60 * 1000 }))) {
    return { chyba: 'Příliš mnoho pokusů — zkus to prosím za hodinu.' };
  }

  await db.insert(waitlist).values({ email }).onConflictDoNothing();
  return { ok: 'Díky! Ozveme se ti jedním e-mailem, až Danero otevřeme.' };
}
