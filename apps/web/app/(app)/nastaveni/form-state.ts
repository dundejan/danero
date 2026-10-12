import { d } from '@danero/shared';
import type { getNotificationPrefs } from '@/lib/notifications';
import {
  DEADLINE_LEAD_OPTIONS,
  LIMIT_THRESHOLD_OPTIONS,
  notificationRules,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';
import type { ProfileRow } from '@/lib/portfolio';

/**
 * Co formuláře nastavení ukazují — jediný zdroj pro výchozí hodnoty polí
 * i pro skrytý stav, se kterým se formulář odesílá (`lib/form-baseline.ts`).
 *
 * Obojí MUSÍ vycházet odtud: server zapisuje jen pole, která se od stavu při
 * vykreslení liší, takže pole s jinou výchozí hodnotou, než jakou nese skrytý
 * stav, by se tvářilo jako změněné a přepsalo by cizí změnu. Shodu hlídá
 * `test/settings-form-state.test.ts` nad vykresleným HTML.
 *
 * Dvojice jsou přesně to, co by neupravený formulář odeslal: nezaškrtnuté
 * políčko chybí, skupina políček má jednu dvojici za každé zaškrtnuté.
 */
type FormEntries = Array<[name: string, value: string]>;

const checked = (name: string, on: boolean): FormEntries => (on ? [[name, 'on']] : []);

/** Sloupec profilu → `name` pole, kterým se ve formuláři nastavuje. */
export const PROFILE_FIELDS = {
  regime: 'rezim',
  hasBusinessAssets: 'obchodni-majetek',
  otherIncomeCzk: 'ostatni-prijmy',
  matchingMethod: 'parovani',
  fxMethod: 'kurzy',
  limit100kStrict: 'limit-100k',
  timeTestBasis: 'zaklad-casoveho-testu',
  derivativesExpensesPerType: 'derivaty-vydaje',
  emtTimeTestExempt: 'emt-casovy-test',
  returnOfCapitalReducesBasis: 'vratka-kapitalu',
} as const;

/**
 * Kolik číslic smí mít částka před desetinnou čárkou: dvanáct, tedy pod bilion
 * korun. Mez je počet číslic, ne hodnota — jen tak ji stejně pozná server
 * (`save.ts`) i atribut `pattern` v prohlížeči. Dřív server odmítal částku nad
 * bilion, kterou vzor pustil: kdo s ní zavřel panel, nedozvěděl se, že se
 * neuložila.
 */
export const OTHER_INCOME_MAX_DIGITS = 12;

/**
 * Tvar částky v poli „Další zdanitelné příjmy“ pro atribut `pattern`: nejvýš
 * dvanáct číslic s mezerami kdekoli a nejvýš jedna desetinná čárka nebo tečka
 * se dvěma místy (prázdné pole je nula). Musí pustit přesně to, co pustí
 * server (`save.ts`): přísnější vzor by platnou částku při zavírání panelu
 * neuložil, volnější by nechal odejít s částkou, kterou server zahodí. Shodu
 * hlídá `test/profil-castka.test.ts`.
 */
export const OTHER_INCOME_PATTERN = String.raw`\s*(\d\s*){1,${OTHER_INCOME_MAX_DIGITS}}([.,]\s*(\d\s*){1,2})?|\s*`;

/** Věta k tomu tvaru — nápověda pole a hláška, když rozepsaná částka neprojde. */
export const OTHER_INCOME_FORMAT = 'Zadej částku v korunách, třeba 12000 nebo 12000,50.';

/**
 * Stav formuláře daňového profilu. Bez profilu jsou to bezpečné předvolby;
 * režim předvolbu nemá (L7i-01), takže v dvojicích chybí.
 */
export function profileFormEntries(profile: ProfileRow | null): FormEntries {
  return [
    ...(profile ? ([[PROFILE_FIELDS.regime, profile.regime]] satisfies FormEntries) : []),
    // DB numeric vrací „0.00“ — do pole patří lidské „0“
    [PROFILE_FIELDS.otherIncomeCzk, d(profile?.otherIncomeCzk ?? '0').toString()],
    ...checked(PROFILE_FIELDS.hasBusinessAssets, profile?.hasBusinessAssets ?? false),
    [PROFILE_FIELDS.matchingMethod, profile?.matchingMethod ?? 'FIFO'],
    [PROFILE_FIELDS.fxMethod, profile?.fxMethod ?? 'UNIFIED'],
    [PROFILE_FIELDS.timeTestBasis, profile?.timeTestBasis ?? 'settlement'],
    [PROFILE_FIELDS.limit100kStrict, (profile?.limit100kStrict ?? true) ? 'strict' : 'lenient'],
    [
      PROFILE_FIELDS.derivativesExpensesPerType,
      (profile?.derivativesExpensesPerType ?? false) ? 'perType' : 'restrictive',
    ],
    [PROFILE_FIELDS.emtTimeTestExempt, (profile?.emtTimeTestExempt ?? false) ? 'lenient' : 'safe'],
    [
      PROFILE_FIELDS.returnOfCapitalReducesBasis,
      (profile?.returnOfCapitalReducesBasis ?? false) ? 'lenient' : 'safe',
    ],
  ];
}

/** Sloupec nastavení upozornění → `name` pole, kterým se ve formuláři nastavuje. */
export const NOTIFICATION_FIELDS = {
  emailEnabled: 'emaily-zapnute',
  timeTestEvents: 'upozorneni-casove-testy',
  limitEvents: 'upozorneni-limity',
  calendarEmails: 'upozorneni-kalendar',
  emailFrequency: 'frekvence-emailu',
  timeTestLeadDays: 'lhuta-casoveho-testu',
  timeTestDone: 'osvobozeno-hotovo',
  limitThresholdsPct: 'hranice-limitu',
  deadlineLeadDays: 'lhuta-terminu',
  summaryFrequency: 'pravidelny-prehled',
  urgentImmediately: 'nalehave-hned',
} as const;

type NotificationPrefs = Awaited<ReturnType<typeof getNotificationPrefs>>;

/** Stav formuláře upozornění (chybějící řádek v databázi = výchozí pravidla). */
export function notificationFormEntries(prefs: NotificationPrefs): FormEntries {
  const rules = notificationRules(prefs);
  const options = (name: string, all: readonly number[], selected: number[]): FormEntries =>
    all.filter((value) => selected.includes(value)).map((value) => [name, String(value)]);
  return [
    ...checked(NOTIFICATION_FIELDS.emailEnabled, prefs.emailEnabled),
    [NOTIFICATION_FIELDS.emailFrequency, prefs.emailFrequency === 'WEEKLY' ? 'WEEKLY' : 'DAILY'],
    ...checked(NOTIFICATION_FIELDS.urgentImmediately, rules.urgentImmediately),
    [NOTIFICATION_FIELDS.summaryFrequency, rules.summaryFrequency],
    ...checked(NOTIFICATION_FIELDS.timeTestEvents, prefs.timeTestEvents),
    ...options(NOTIFICATION_FIELDS.timeTestLeadDays, TIME_TEST_LEAD_OPTIONS, rules.timeTestLeadDays),
    ...checked(NOTIFICATION_FIELDS.timeTestDone, rules.timeTestDone),
    ...checked(NOTIFICATION_FIELDS.limitEvents, prefs.limitEvents),
    ...options(
      NOTIFICATION_FIELDS.limitThresholdsPct,
      LIMIT_THRESHOLD_OPTIONS,
      rules.limitThresholdsPct,
    ),
    ...checked(NOTIFICATION_FIELDS.calendarEmails, prefs.calendarEmails),
    [
      NOTIFICATION_FIELDS.deadlineLeadDays,
      String(
        DEADLINE_LEAD_OPTIONS.find((days) => days === rules.deadlineLeadDays) ??
          DEADLINE_LEAD_OPTIONS[0],
      ),
    ],
  ];
}
