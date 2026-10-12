import { d } from '@danero/shared';
import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db';
import { notificationPrefs, taxpayerProfiles } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import {
  changedFields,
  pickChanged,
  submissionMark,
  type SubmissionMark,
} from '@/lib/form-baseline';
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
import {
  NOTIFICATION_FIELDS,
  OTHER_INCOME_FORMAT,
  OTHER_INCOME_MAX_DIGITS,
  PROFILE_FIELDS,
} from './form-state';
import { settingsErrorText, settingsOkText } from './settings-toast';

/**
 * Uložení obou formulářů nastavení — jedno místo pro všechny cesty, kterými
 * formulář na server přijde: první uložení profilu tlačítkem (server action
 * s přesměrováním), auto-save (server action s výsledkem) a uložení při
 * odchodu ze stránky (`/api/settings/*`, požadavek, který přežije zavření
 * panelu). Všechny tři musí zapsat totéž a stejně: jen pole, která člověk
 * v tom formuláři změnil (`lib/form-baseline.ts`).
 *
 * Stránky tu nikdo neznehodnocuje (`revalidatePath`): auto-save si stránku
 * po uložení dotáhne ze serveru sám, jednou po posledním odeslání v řadě.
 * Akce, která by to dělala za něj, by stránku vykreslila po každém odeslání
 * zvlášť — i uprostřed řady, se stavem, který další odeslání hned mění.
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
          params: { code: 'prijmy' },
        });
        return;
      }
      // Horní mez: nejvýš dvanáct číslic před desetinnou tečkou (pod bilion Kč)
      // — bez ní by nesmyslný vstup přetekl DB numeric(18,2). Počítají se
      // číslice, ne hodnota, aby tutéž mez poznal i `pattern` v prohlížeči.
      if (v.split('.')[0]!.length > OTHER_INCOME_MAX_DIGITS) {
        ctx.addIssue({
          code: 'custom',
          message: 'Částka je nereálně vysoká — zkontroluj ji.',
          params: { code: 'prijmy' },
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

/** Vynechá sloupce, jejichž odeslaná hodnota je už v databázi. */
function omitUnchanged<Values extends Record<string, unknown>>(
  values: Partial<Values>,
  stored: Record<string, unknown>,
): Partial<Values> {
  return Object.fromEntries(
    Object.entries(values).filter(([column, value]) =>
      // částka je v databázi `numeric` („5000.00“), z formuláře přijde „5000“
      column === 'otherIncomeCzk'
        ? !d(String(stored[column])).eq(String(value))
        : stored[column] !== value,
    ),
  ) as Partial<Values>;
}

/**
 * Podmínka zápisu: řádek naposledy nezapsalo NOVĚJŠÍ odeslání téhož formuláře.
 *
 * Auto-save posílá odeslání za sebou — až na odchod ze stránky: co čeká, jde
 * hned, souběžně s tím, co ještě běží, a jinou cestou (`/api/settings/*`
 * místo server action; na Vercelu jiná funkce). Na server tak můžou dorazit
 * obráceně. Revize R7 (M3): párování přepnuté tam a zpět a zavřený panel
 * skončily na starší volbě.
 *
 * Odeslání proto nese pořadí (`SUBMISSION_FIELD`) a řádek si pamatuje to
 * poslední. Podmínka je součást téhož příkazu jako zápis, takže ji dvě
 * souběžná odeslání nemůžou obejít mezi čtením a zápisem. Jiný formulář
 * (jiný panel, jiné zařízení, stránka načtená znovu) má jiné označení a mezi
 * nimi se pořadí neurčuje — platí, kdo přišel poslední, jako dřív. Stejné
 * číslo podruhé (opakované odeslání) projde.
 */
const notSuperseded = (
  row: { saveInstance: AnyColumn; saveSequence: AnyColumn },
  mark: SubmissionMark,
): SQL =>
  sql`(${row.saveInstance} IS DISTINCT FROM ${mark.instance} OR ${row.saveSequence} IS NULL OR ${row.saveSequence} <= ${mark.sequence})`;

export async function saveProfile(
  userId: string,
  formData: FormData,
  /** Jen pro testy proti konkrétní databázi (`test/postgres-compat.test.ts`). */
  database?: Db,
): Promise<ProfileSaveResult> {
  const parsed = ProfileFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    // u částky umíme poradit konkrétně; zbytek formuláře jsou jen nabídky,
    // do kterých se z UI nedá napsat nic vlastního
    const error = parsed.error.issues.some(
      (issue) => (issue as { params?: { code?: string } }).params?.code === 'prijmy',
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

  const db = database ?? (await getDb());
  const [previous] = await db
    .select()
    .from(taxpayerProfiles)
    .where(eq(taxpayerProfiles.userId, userId));
  // Existující profil se nepřepisuje celý: zapíšou se jen pole, která člověk
  // v tomhle formuláři změnil. Panel, který zůstal otevřený se starým stavem,
  // jinak změnou jednoho pole vrátil všechna ostatní (`lib/form-baseline.ts`).
  // UPDATE nese jen ta pole, takže se dvě souběžná uložení nepřepíšou ani
  // mezi čtením a zápisem.
  const changed = previous
    ? pickChanged(submitted, PROFILE_FIELDS, changedFields(formData, Object.values(PROFILE_FIELDS)))
    : submitted;
  // A z nich mění stav v databázi jen některá: totéž odeslání může přijít
  // dvakrát (rozepsaná částka uložená při F5 a znovu po načtení stránky,
  // `lib/leaving-draft.ts`) a podruhé nemá co zapsat do historie účtu, ani
  // kvůli němu mazat upozornění.
  const applied = previous ? omitUnchanged(changed, previous) : submitted;
  const mark = submissionMark(formData);
  let written = false;
  if (mark) {
    // Odeslání s pořadím zapisuje všechno, co člověk ve formuláři změnil, ne
    // jen to, čím se liší od právě přečteného řádku: mezi čtením a zápisem mohlo
    // dorazit starší odeslání a pole změnit. Pořadí se zapíše i tehdy, když se
    // nemění nic — jen tak ho starší odeslání, které teprve dorazí, najde.
    // `updatedAt` se posouvá s každým takovým zápisem polí (je to klíč mezipaměti
    // výpočtů); historie účtu a mazání upozornění se dál řídí tím, co se opravdu
    // změnilo.
    const stamp = Object.keys(changed).length > 0 ? { updatedAt: new Date() } : {};
    const order = { saveInstance: mark.instance, saveSequence: mark.sequence };
    const rows = await db
      .insert(taxpayerProfiles)
      .values({ userId, ...submitted, ...order })
      .onConflictDoUpdate({
        target: taxpayerProfiles.userId,
        set: { ...changed, ...stamp, ...order },
        setWhere: notSuperseded(taxpayerProfiles, mark),
      })
      .returning({ userId: taxpayerProfiles.userId });
    written = rows.length > 0 && Object.keys(applied).length > 0;
  } else if (Object.keys(applied).length > 0) {
    // uložení, které nic nemění, nic nezapisuje
    const updatedAt = new Date();
    await db
      .insert(taxpayerProfiles)
      .values({ userId, ...submitted, updatedAt })
      .onConflictDoUpdate({ target: taxpayerProfiles.userId, set: { ...applied, updatedAt } });
    written = true;
  }
  if (written) await logAudit(db, userId, 'PROFILE_CHANGE');

  // K2-02: změna profilu přepočítá všechny nezafixované roky, takže uložená
  // upozornění hlídače za ně přestala platit — a jejich dedupe klíč by hlídač
  // na ten rok umlčel natrvalo (detail a testy v lib/profile-changes.ts).
  if (written && profileAffectsCalculations(previous, applied)) {
    await dropStaleLimitNotifications(db, userId);
  }

  return { ok: true, firstSave: previous === undefined };
}

export async function saveNotificationPrefs(
  userId: string,
  formData: FormData,
  /** Jen pro testy proti konkrétní databázi (`test/postgres-compat.test.ts`). */
  database?: Db,
): Promise<void> {
  const db = database ?? (await getDb());
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
  // starší odeslání téhož formuláře, které dorazilo až po novějším, nezapíše nic
  const mark = submissionMark(formData);
  const order = mark ? { saveInstance: mark.instance, saveSequence: mark.sequence } : {};
  await db
    .insert(notificationPrefs)
    .values({ userId, ...submitted, updatedAt, ...order })
    .onConflictDoUpdate({
      target: notificationPrefs.userId,
      set: { ...applied, updatedAt, ...order },
      setWhere: mark ? notSuperseded(notificationPrefs, mark) : undefined,
    });
}
