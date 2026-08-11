import { getDb } from '@/db';
import { notificationPrefs } from '@/db/schema';
import { verifyUnsubscribeToken } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** Společný obal stránky odhlášení — text/plain by uživatele nechal na holé
    bílé stránce bez jediného odkazu zpátky (úspěšná větev navigaci má). */
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="cs"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Danero</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">${title}</h1>
${body}
</body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** Neplatný, vypršelý nebo podvržený token — vždy s cestou zpět. */
const invalidLink = (): Response =>
  page(
    'Odkaz na odhlášení neplatí',
    `<p>Odkaz je poškozený nebo už vypršel. Zkopíruj ho z e-mailu celý, nebo si e-maily vypni přímo v aplikaci.</p>
<p><a href="/nastaveni/upozorneni">Nastavení → Upozornění</a> · <a href="/">Úvodní stránka Danera</a></p>`,
    400,
  );

/**
 * Odhlášení e-mailových upozornění z odkazu v e-mailu (G8d) — bez přihlášení,
 * token je HMAC podepsaný. GET jen zobrazí potvrzení (mail scannery a prefetch
 * odkazy navštěvují automaticky!), změnu provede až POST.
 */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const userId = await verifyUnsubscribeToken(token);
  if (!userId) return invalidLink();

  return page(
    'Odhlásit e-mailová upozornění?',
    `<p>Upozornění v aplikaci ti zůstanou; e-maily jde kdykoli zapnout zpět.</p>
<p>Jemnější nastavení (typy a frekvence) najdeš po přihlášení v <a href="/nastaveni/upozorneni">Nastavení → Upozornění</a>.</p>
<form method="post">
  <button type="submit" style="padding:.5rem 1rem;cursor:pointer">Ano, vypnout e-maily</button>
</form>`,
  );
}

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const userId = await verifyUnsubscribeToken(token);
  if (!userId) return invalidLink();

  const db = await getDb();
  await db
    .insert(notificationPrefs)
    .values({ userId, emailEnabled: false })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: { emailEnabled: false, updatedAt: new Date() },
    });

  // potvrzení jako HTML — kvůli odkazu na jemnější nastavení
  return page(
    'E-mailová upozornění jsou vypnutá',
    `<p>Upozornění v aplikaci ti zůstávají.</p>
<p>Jemnější nastavení (typy a frekvence) najdeš po přihlášení v <a href="/nastaveni/upozorneni">Nastavení → Upozornění</a>.</p>`,
  );
}
