import { revalidatePath } from 'next/cache';
import { d } from '@danero/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { notificationPrefs, taxpayerProfiles } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { changedFields, pickChanged } from '@/lib/form-baseline';
import {
  DEADLINE_LEAD_OPTIONS,
  DEFAULT_NOTIFICATION_RULES,
  formatNumberList,
  LIMIT_THRESHOLD_OPTIONS,
  parseNumberList,
  pickOption,
  SUMMARY_FREQUENCIES,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';
import { dropStaleLimitNotifications, profileAffectsCalculations } from '@/lib/profile-changes';
import type { AutoSaveOutcome } from '@/lib/save-queue';
import { NOTIFICATION_FIELDS, OTHER_INCOME_FORMAT, PROFILE_FIELDS } from './form-state';
import { settingsErrorText, settingsOkText } from './settings-toast';

/**
 * Uložení obou formulářů nastavení — jedno místo pro všechny cesty, kterými
 * formulář na server přijde: první uložení profilu tlačítkem (server action
 * s přesměrováním), auto-save (server action s výsledkem) a uložení při
 * odchodu ze stránky (`/api/settings/*`, požadavek, který přežije zavření
 * panelu). Všechny tři musí zapsat totéž a stejně: jen pole, která člověk
 * v tom formuláři změnil (`lib/form-baseline.ts`).
 */

/**
 * Klíče schématu = `name` atributy formuláře, které jsou podle pravidla 1
 * z CLAUDE.md česky (uživatel je vidí v DOM). Na anglické identifikátory se
 * překlápějí hned níž, takže dál v kódu ani v databázi čeština není.
 */
const ProfileFormSchema = z.object({
  rezim: z.enum(['PAUSAL', 'ZAMESTNANEC', 'OSVC', 'JINE']),
  'obchodni-majetek': z.literal('on').optional(),
  /**
   * Částku píše člověk, ne stroj: „10 000“, „1 234,50“, klidně s nedělitelnou
   * mezerou zkopírovanou z Danera (aplikace sama odděluje tisíce NBSP, takže
   * kopie vlastního čísla zpátky do formuláře je běžný pohyb). Mezery se proto
   * odstraní a desetinná čárka převede na tečku.
   *
   * ⚠️ Kontrola nesmí být rozdělená do dvou `.refine()`: Zod pustí i to druhé,
   * i když první selhalo, a `d('10 000')` vyhodí `DecimalError`. Ten už není
   * chybou validace, ale výjimkou uvnitř `safeParse` — a uživatel místo hlášky
   * dostal chybovou stránku. Rozhoduje se proto v jednom `superRefine`, který
   * `d()` zavolá až na tvaru, o kterém ví, že je číslo.
   */
  'ostatni-prijmy': z
    .string()
    .transform((v) => v.replace(/\s/g, '').replace(',', '.') || '0')
    .superRefine((v, ctx) => {
      if (!/^\d+(\.\d{1,2})?$/.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message: OTHER_INCOME_FORMAT,
          params: { kod: 'prijmy' },
        });
        return;
      }
      // horní mez: bilion Kč — bez ní by nesmyslný vstup přetekl DB numeric(18,2)
      if (d(v).gt('1000000000000')) {
        ctx.addIssue({
          code: 'custom',
          message: 'Částka je nereálně vysoká — zkontroluj ji.',
          params: { kod: 'prijmy' },
        });
      }
    }),
  parovani: z.enum(['FIFO', 'LIFO', 'MAX_PROFIT', 'MAX_LOSS']),
  kurzy: z.enum(['UNIFIED', 'CNB_DAILY']),
  'limit-100k': z.enum(['strict', 'lenient']),
  'zaklad-casoveho-testu': z.enum(['settlement', 'trade']),
  'derivaty-vydaje': z.enum(['restrictive', 'perType']),
  'emt-casovy-test': z.enum(['safe', 'lenient']),
  'vratka-kapitalu': z.enum(['safe', 'lenient']),
});

/** Kód hlášky (`settings-toast.tsx`), když formulář profilu neprošel kontrolou. */
type ProfileFormError = 'prijmy' | 'rezim' | 'formular';

type ProfileSaveResult = { ok: true; firstSave: boolean } | { ok: false; error: ProfileFormError };

/** Pole formuláře, kterého se chyba týká — auto-save ho označí (`aria-invalid`). */
const ERROR_FIELD: Partial<Record<ProfileFormError, string>> = {
  prijmy: PROFILE_FIELDS.otherIncomeCzk,
  rezim: PROFILE_FIELDS.regime,
};

/** Výsledek uložení profilu tak, jak ho auto-save ukáže uživateli. */
export function profileOutcome(result: ProfileSaveResult): AutoSaveOutcome {
  return result.ok
    ? { ok: true, message: settingsOkText('profil') }
    : { ok: false, message: settingsErrorText(result.error), field: ERROR_FIELD[result.error] };
}

/** Potvrzení uloženého nastavení upozornění (formulář nemá co odmítnout). */
export function notificationPrefsOutcome(): AutoSaveOutcome {
  return { ok: true, message: settingsOkText('notifikace') };
}

export async function saveProfile(userId: string, formData: FormData): Promise<ProfileSaveResult> {
  const parsed = ProfileFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    // u částky umíme poradit konkrétně; zbytek formuláře jsou jen nabídky,
    // do kterých se z UI nedá napsat nic vlastního
    const error = parsed.error.issues.some(
      (issue) => (issue as { params?: { kod?: string } }).params?.kod === 'prijmy',
    )
      ? 'prijmy'
      : // L7i-01 (R8): režim nemá předvolbu, takže první uložení bez výběru je
        // běžný pohyb, ne podvržený formulář — chce vlastní větu
        parsed.error.issues.some((issue) => issue.path[0] === 'rezim')
        ? 'rezim'
        : 'formular';
    return { ok: false, error };
  }

  const submitted = {
    regime: parsed.data.rezim,
    hasBusinessAssets: parsed.data['obchodni-majetek'] === 'on',
    otherIncomeCzk: parsed.data['ostatni-prijmy'],
    matchingMethod: parsed.data.parovani,
    fxMethod: parsed.data.kurzy,
    limit100kStrict: parsed.data['limit-100k'] === 'strict',
    timeTestBasis: parsed.data['zaklad-casoveho-testu'],
    derivativesExpensesPerType: parsed.data['derivaty-vydaje'] === 'perType',
    emtTimeTestExempt: parsed.data['emt-casovy-test'] === 'lenient',
    returnOfCapitalReducesBasis: parsed.data['vratka-kapitalu'] === 'lenient',
  };

  const db = await getDb();
  const [previous] = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  // Existující profil se nepřepisuje celý: zapíšou se jen pole, která člověk
  // v tomhle formuláři změnil. Panel, který zůstal otevřený se starým stavem,
  // jinak změnou jednoho pole vrátil všechna ostatní (`lib/form-baseline.ts`).
  // UPDATE nese jen ta pole, takže se dvě souběžná uložení nepřepíšou ani
  // mezi čtením a zápisem.
  const applied = previous
    ? pickChanged(submitted, PROFILE_FIELDS, changedFields(formData, Object.values(PROFILE_FIELDS)))
    : submitted;
  // uložení, které nic nemění, nic nezapisuje
  if (Object.keys(applied).length > 0) {
    const updatedAt = new Date();
    await db
      .insert(taxpayerProfiles)
      .values({ userId, ...submitted, updatedAt })
      .onConflictDoUpdate({ target: taxpayerProfiles.userId, set: { ...applied, updatedAt } });
    await logAudit(db, userId, 'PROFILE_CHANGE');
  }

  // K2-02: změna profilu přepočítá všechny nezafixované roky, takže uložená
  // upozornění hlídače za ně přestala platit — a jejich dedupe klíč by hlídač
  // na ten rok umlčel natrvalo (detail a testy v lib/profile-changes.ts).
  if (profileAffectsCalculations(previous, applied)) {
    await dropStaleLimitNotifications(db, userId);
  }

  revalidatePath('/prehled');
  revalidatePath('/nastaveni');
  // první uložení = cesta nového uživatele pokračuje krokem 2 (přidat data)
  revalidatePath('/import');
  return { ok: true, firstSave: previous === undefined };
}

export async function saveNotificationPrefs(userId: string, formData: FormData): Promise<void> {
  const db = await getDb();
  /** Zaškrtnuté volby → text pro DB; mimo nabídku se cokoli zahodí. */
  const checked = (name: string, allowed: readonly number[]): string =>
    formatNumberList(parseNumberList(formData.getAll(name).map(String).join(','), allowed, []));
  const submitted = {
    emailEnabled: formData.get('emaily-zapnute') === 'on',
    timeTestEvents: formData.get('upozorneni-casove-testy') === 'on',
    limitEvents: formData.get('upozorneni-limity') === 'on',
    calendarEmails: formData.get('upozorneni-kalendar') === 'on',
    // hodnoty ze selectů a zaškrtávátek validujeme na whitelist — cokoli jiného
    // spadne na bezpečný default (formulář jde odeslat i mimo naše UI)
    emailFrequency: formData.get('frekvence-emailu') === 'WEEKLY' ? 'WEEKLY' : 'DAILY',
    timeTestLeadDays: checked('lhuta-casoveho-testu', TIME_TEST_LEAD_OPTIONS),
    timeTestDone: formData.get('osvobozeno-hotovo') === 'on',
    limitThresholdsPct: checked('hranice-limitu', LIMIT_THRESHOLD_OPTIONS),
    deadlineLeadDays: pickOption(
      Number(formData.get('lhuta-terminu')),
      DEADLINE_LEAD_OPTIONS,
      DEFAULT_NOTIFICATION_RULES.deadlineLeadDays,
    ),
    summaryFrequency: pickOption(
      formData.get('pravidelny-prehled'),
      SUMMARY_FREQUENCIES,
      DEFAULT_NOTIFICATION_RULES.summaryFrequency,
    ),
    urgentImmediately: formData.get('nalehave-hned') === 'on',
  };
  // Jen pole, která člověk v tomhle formuláři změnil — zastaralý panel jinak
  // jedním přepnutím vrátil všechno ostatní (`lib/form-baseline.ts`). Řádek,
  // který ještě neexistuje, vznikne celý z odeslaného formuláře.
  const applied = pickChanged(
    submitted,
    NOTIFICATION_FIELDS,
    changedFields(formData, Object.values(NOTIFICATION_FIELDS)),
  );
  const updatedAt = new Date();
  await db
    .insert(notificationPrefs)
    .values({ userId, ...submitted, updatedAt })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: { ...applied, updatedAt } });
  revalidatePath('/nastaveni/upozorneni');
}
