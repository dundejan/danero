import { analyzeTaxYear } from '@danero/engine';
import { getDb } from '@/db';
import { getAuth } from '@/lib/auth';
import { currentTaxYear } from '@/lib/clock';
import { OPERATOR } from '@/lib/contact';
import { canGenerateReport } from '@/lib/entitlements';
import {
  EpoInputError,
  generateDpfdp7,
  type EpoDapTyp,
  type EpoPersonalData,
} from '@/lib/epo';
import { errorText, logEvent } from '@/lib/log';
import {
  engineInputForUser,
  getProfile,
  loadDailyRates,
  loadTransactions,
  pinTaxYear,
} from '@/lib/portfolio';

const field = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** Číselník typů přiznání — jediný seznam pro validaci vstupu. */
const DAP_TYPY: readonly EpoDapTyp[] = ['B', 'O', 'D', 'E'];

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
  const currentYear = currentTaxYear();
  const dailyRates = await loadDailyRates(db, txs, currentYear);
  // R-05c: XML je podklad pro podání → konfigurace se pro ten rok zafixuje
  const pinnedProfile = await pinTaxYear(db, profile, year, currentYear);
  const result = analyzeTaxYear(engineInputForUser(txs, pinnedProfile, year, dailyRates));

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

  // K3-07: typ přiznání (řádné / opravné / dodatečné) — neznámou hodnotu
  // nedosazujeme tiše na „řádné", to je právě ta záměna, kterou nález popisuje.
  const typRaw = field(form, 'typ-priznani');
  if (typRaw !== undefined && !DAP_TYPY.includes(typRaw as EpoDapTyp)) {
    return chyba('Neznámý typ přiznání.');
  }
  const dapTyp = (typRaw as EpoDapTyp | undefined) ?? 'B';
  const zjistenoDne = field(form, 'datum-zjisteni');
  const dodatecne = zjistenoDne
    ? {
        zjistenoDne,
        posledniZnamaDanCzk: field(form, 'posledni-dan'),
        posledniZnamaZtrataCzk: field(form, 'posledni-ztrata'),
      }
    : undefined;

  try {
    const { xml } = generateDpfdp7({ year, result, personal, varianta, dapTyp, dodatecne });
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="danero-dpfdp7-${year}.xml"`,
      },
    });
  } catch (error) {
    // K3-06: vadu VSTUPU generátor popisuje větou psanou pro uživatele („Doplň
    // u těchhle dividend zemi zdroje v importu") — a ta se sem musí dostat celá.
    // Do 23. 8. 2026 ji přebilo obecné „Export se nepodařil. Zkus to prosím
    // znovu", což je u deterministické vady rada, po které uživatel klikne
    // podesáté a dostane totéž.
    if (error instanceof EpoInputError) {
      logEvent('info', 'epo.export_rejected', { userId: session.user.id, year, error: error.message });
      return chyba(error.message, 400);
    }
    // Interní hláška uživateli nepomůže a může nést obsah dotazu i s parametry
    // (Drizzle je dává do message) — do odpovědi jde jen česká věta, detail do logu.
    logEvent('error', 'epo.export_failed', { userId: session.user.id, year, error: errorText(error) });
    // Adresa se bere z lib/contact.ts, ať se neslibuje schránka, která
    // neexistuje: `podpora@danero.cz` tu stálo natvrdo, ale kořenová doména
    // nemá MX záznam, takže by taková zpráva nikam nedošla.
    return chyba(
      `Export se nepodařil. Zkus to prosím znovu, případně napiš na ${OPERATOR.email}.`,
      500,
    );
  }
}
