import { analyzeTaxYear } from '@danero/engine';
import { getDb } from '@/db';
import { getAuth } from '@/lib/auth';
import { canGenerateReport } from '@/lib/entitlements';
import { generateDpfdp7, type EpoPersonalData } from '@/lib/epo';
import { errorText, logEvent } from '@/lib/log';
import { engineInputForUser, getProfile, loadDailyRates, loadTransactions } from '@/lib/portfolio';

const field = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const chyba = (message: string, status = 400): Response =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * Export přiznání do XML pro EPO/mojedane.cz (písemnost DPFDP7).
 * Osobní údaje z formuláře se NIKAM neukládají — jen protečou do XML.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response('Nepřihlášen', { status: 401 });

  const form = await request.formData();
  const year = Number(field(form, 'rok'));
  if (!Number.isInteger(year)) return chyba('Chybí platný rok exportu.');

  const variantaRaw = field(form, 'varianta');
  const varianta =
    variantaRaw === 'GENERAL' || variantaRaw === 'SEPARATE_16A' ? variantaRaw : undefined;

  const db = await getDb();
  const { checkRateLimit } = await import('@/lib/rate-limit');
  if (!(await checkRateLimit(db, `epo:${session.user.id}`, { max: 10, windowMs: 60_000 }))) {
    return chyba('Příliš mnoho exportů za sebou — počkej minutu.', 429);
  }
  // XML je součást podkladů — bez zaplaceného roku (nebo předplatného) ne;
  // stránka /report už paywall ukazuje, tohle hlídá i přímé volání endpointu
  if (!(await canGenerateReport(db, session.user.id, year))) {
    return chyba(`Podklady za rok ${year} nemáš odemčené — najdeš je v ceníku.`, 402);
  }
  const profile = await getProfile(db, session.user.id);
  if (!profile) return chyba('Nejdřív vyplň daňový profil v Nastavení.');
  const txs = await loadTransactions(db, session.user.id);
  if (txs.length === 0) return chyba('Zatím nemáš žádné transakce — nejdřív importuj data.');

  // stejný výpočet jako /report: denní kurzy ČNB, když jsou k dispozici (R-06b)
  const dailyRates = await loadDailyRates(db, txs, Number(new Date().toISOString().slice(0, 4)));
  const result = analyzeTaxYear(engineInputForUser(txs, profile, year, dailyRates));

  const personal: EpoPersonalData = {
    dic: field(form, 'dic'),
    rodneCislo: field(form, 'rodneCislo'),
    prijmeni: field(form, 'prijmeni'),
    jmeno: field(form, 'jmeno'),
    ulice: field(form, 'ulice'),
    cisloPopisne: field(form, 'cisloPopisne'),
    obec: field(form, 'obec'),
    psc: field(form, 'psc'),
    ufoCil: field(form, 'ufoCil'),
    pracUfo: field(form, 'pracUfo'),
    email: field(form, 'email'),
  };

  try {
    const { xml } = generateDpfdp7({ year, result, personal, varianta });
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="danero-dpfdp7-${year}.xml"`,
      },
    });
  } catch (error) {
    // Interní hláška uživateli nepomůže a může nést obsah dotazu i s parametry
    // (Drizzle je dává do message) — do odpovědi jde jen česká věta, detail do logu.
    logEvent('error', 'epo.export_failed', { userId: session.user.id, year, error: errorText(error) });
    return chyba('Export se nepodařil. Zkus to prosím znovu, případně napiš na podpora@danero.cz.', 500);
  }
}
