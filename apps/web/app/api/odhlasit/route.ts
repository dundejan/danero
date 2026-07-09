import { getDb } from '@/db';
import { notificationPrefs } from '@/db/schema';
import { verifyUnsubscribeToken } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * Odhlášení e-mailových upozornění z odkazu v e-mailu (G8d) — bez přihlášení,
 * token je HMAC podepsaný. GET jen zobrazí potvrzení (mail scannery a prefetch
 * odkazy navštěvují automaticky!), změnu provede až POST.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const userId = await verifyUnsubscribeToken(token);
  if (!userId) return new Response('Neplatný odkaz.', { status: 400 });

  const html = `<!doctype html><html lang="cs"><meta charset="utf-8">
<title>Odhlášení upozornění — Danero</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Odhlásit e-mailová upozornění?</h1>
<p>Upozornění v aplikaci ti zůstanou; e-maily jde kdykoli zapnout zpět v Nastavení → Notifikace.</p>
<form method="post">
  <button type="submit" style="padding:.5rem 1rem;cursor:pointer">Ano, vypnout e-maily</button>
</form>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const userId = await verifyUnsubscribeToken(token);
  if (!userId) return new Response('Neplatný odkaz.', { status: 400 });

  const db = await getDb();
  await db
    .insert(notificationPrefs)
    .values({ userId, emailEnabled: false })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: { emailEnabled: false, updatedAt: new Date() },
    });

  return new Response(
    'E-mailová upozornění jsou vypnutá. Znovu je zapneš v Nastavení → Notifikace. Upozornění v aplikaci ti zůstávají.',
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
