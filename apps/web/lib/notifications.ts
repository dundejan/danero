import { and, asc, eq, gt, gte, inArray, isNull, max, min } from 'drizzle-orm';
import { filingDeadlines, type LimitStatus, type Position, type TaxYearResult } from '@danero/engine';
import { addDays, diffDays } from '@danero/shared';
import type { Db } from '@/db';
import { brokerAccounts, jobs, notifications, user } from '@/db/schema';
import { notificationPrefData, taxpayerProfileData } from '@/db/settings-data';
import { today as todayInPrague } from '@/lib/clock';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { operatorSignature } from '@/lib/contact';
import { composeMessage, type EmailMessage, type EmailSender } from '@/lib/email';
import type { EmailBlock, EmailItem } from '@/lib/email-layout';
import {
  DEFAULT_NOTIFICATION_RULES,
  formatNumberList,
  notificationRules,
  summaryPeriod,
  type NotificationRules,
} from '@/lib/notification-rules';
import { czDate, czk, pct, plural, qty } from '@/lib/format';
import { LIMIT_NAME, type LimitKind } from '@/lib/limit-names';
import {
  currentNotificationText,
  limitEventTitle,
  type LimitEventKey,
} from '@/lib/notification-display';
import { recommendedTaxCzk, unpaidUnderLimitCzk } from '@/lib/payable-tax';
import { parseSyncFailure } from '@/lib/sync-failure';
import {
  analyzeForUser,
  dailyRatesForProfile,
  getProfile,
  loadTransactions,
} from '@/lib/portfolio';

export interface NotificationCandidate {
  dedupeKey: string;
  type: string;
  title: string;
  body: string;
  /** Nesnese odklad do týdenního souhrnu — viz sloupec `urgent` ve schématu. */
  urgent?: boolean;
}

/**
 * Pásmo v dedupe klíči limitu. Tři výchozí hranice si nesou názvy, které
 * hlídač používal, dokud byly natvrdo — jinak by lidem, kteří upozornění na
 * 85 % už dostali, přišlo po nasazení znovu.
 */
const thresholdKey = (pct: number): string =>
  pct === 60 ? 'WARNING' : pct === 85 ? 'CRITICAL' : pct === 100 ? 'EXCEEDED' : `P${pct}`;

/**
 * Události hlídače (docs/05 F4): blížící se osvobození pozic, čerstvě
 * osvobozené pozice a čerpání limitů přes nastavené hranice. Dedupe klíč
 * zajistí, že každá událost vznikne jen jednou (per pozice+datum, per
 * limit+hranice+rok).
 *
 * `rules` jsou uživatelova pravidla (lhůty, hranice); bez nich platí výchozí,
 * takže demo i landing počítají to co dřív.
 */
export function computeNotificationCandidates(args: {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  today: string;
  rules?: NotificationRules;
}): NotificationCandidate[] {
  const { result, positions, labels, today, rules = DEFAULT_NOTIFICATION_RULES } = args;
  const out = new Map<string, NotificationCandidate>();
  const add = (candidate: NotificationCandidate) => {
    if (!out.has(candidate.dedupeKey)) out.set(candidate.dedupeKey, candidate);
  };

  for (const position of positions) {
    const label = labels.get(position.isin) ?? position.isin;
    for (const lot of position.lots) {
      // A2-3-04: pozice bez nároku na osvobození (obchodní majetek, stablecoiny,
      // období bez krypto osvobození, deriváty) nesmí dostat ani odpočet, ani
      // „osvobozeno 🎉" — je zdanitelná vždycky
      if (!lot.exemptionPossible) continue;
      const amount = `${qty(lot.remaining)} ks ${label}`;
      // nejbližší nastavená lhůta, do které se zbývající dny vejdou: se
      // stahující se lhůtou (30 → 7) vznikne pokaždé vlastní událost, ale
      // v jednom běhu jen jedna. U výchozích 30 a 7 to dá tytéž klíče,
      // jaké hlídač vydával, dokud byly lhůty natvrdo.
      const lead = lot.isExempt
        ? undefined
        : [...rules.timeTestLeadDays].sort((a, b) => a - b).find((days) => lot.daysToExempt <= days);
      if (lead !== undefined) {
        // naléhavost i formulace se řídí SKUTEČNÝM počtem dní, ne lhůtou, do
        // které pozice spadla: s jedinou nastavenou lhůtou „30 dní“ by jinak
        // i pozice den před osvobozením čekala na týdenní souhrn
        const soon = lot.daysToExempt <= 7;
        const dayWord = plural(lot.daysToExempt, 'den', 'dny', 'dní');
        add({
          dedupeKey: `tt${lead}|${position.isin}|${lot.exemptFrom}`,
          type: `TIME_TEST_${lead}`,
          urgent: soon,
          title: soon
            ? `${label}: osvobození už za ${lot.daysToExempt} ${dayWord}`
            : `${label}: osvobození za ${lot.daysToExempt} ${dayWord}`,
          // fakt + termín, žádný imperativ („počkej“) — individualizovaný pokyn
          // by se blížil radě dle § 1 zákona 523/1992 Sb. (nález V-4 právního auditu)
          body: soon
            ? `${amount} splní časový test ${czDate(lot.exemptFrom)}. Prodej po tomto datu bude od daně osvobozený — před ním se zisk daní celý.`
            : `${amount} splní tříletý časový test ${czDate(lot.exemptFrom)} — od té doby je prodej bez daně.`,
        });
      }
      if (rules.timeTestDone && lot.isExempt && diffDays(lot.exemptFrom, today) <= 3) {
        add({
          dedupeKey: `ttdone|${position.isin}|${lot.exemptFrom}`,
          type: 'TIME_TEST_DONE',
          title: `${label}: osvobozeno 🎉`,
          // POZOR: při bezpečném výkladu (R-02c striktně, default) se i časově
          // osvobozená tržba počítá do úhrnu 100k — netvrdit opak (nález 3 auditu)
          body: `${amount} od ${czDate(lot.exemptFrom)} splňuje časový test — prodej je osvobozený od daně. Při bezpečném výkladu se ale tržba pořád počítá do ročního úhrnu 100 000 Kč — dopad prodeje si ověř v simulátoru.`,
        });
      }
    }
  }

  const year = result.year;
  // Limity se jmenují stejně jako v aplikaci (`lib/limit-names.ts`) — titulek
  // upozornění stojí na přehledu hned vedle seznamu limitů a je to i předmět
  // e-mailu. Částka se bere ze stavu limitu: u limitů § 38g se rok od roku
  // liší (R-09a, R-09b), takže titulek a věta o čerpání nejmenují dvě různé.
  const limitEvents: Array<{
    key: LimitEventKey;
    kind: LimitKind;
    applicable: boolean;
    status: LimitStatus;
    consequence: string;
  }> = [
    {
      key: '50k',
      kind: 'FLAT_TAX',
      applicable: result.limits.flatTax50k.applicable,
      status: result.limits.flatTax50k.status,
      consequence: 'Při překročení za rok podáváš přiznání a přehledy (v paušálním režimu zůstáváš).',
    },
    {
      key: '20k',
      kind: 'EMPLOYEE_SIDE_INCOME',
      applicable: result.limits.employee20k.applicable,
      status: result.limits.employee20k.status,
      consequence: 'Při překročení za rok podáváš daňové přiznání.',
    },
    {
      // L12-02: obecný limit podle R-09a (§ 38g odst. 1) pro režim „Jiné“.
      // Nastavení ho slibuje hlídat a přehled ho vede jako měřák, hlídač o něm
      // ale mlčel — student nebo důchodce s dividendami přes limit nedostal
      // nic. Klíč nese jen druh limitu, částku ne: ta se od ZO 2027 mění
      // (100 000 Kč) a bere se ze stavu limitu stejně jako u zaměstnance.
      key: 'filing50k',
      kind: 'GENERAL_FILING',
      applicable: result.limits.generalFiling50k.applicable,
      status: result.limits.generalFiling50k.status,
      consequence: 'Při překročení za rok podáváš daňové přiznání.',
    },
    {
      key: '100k',
      kind: 'SECURITIES',
      // K6b-02: `true` natvrdo posílalo měřák „X ze 100 000" i poplatníkovi
      // s obchodním majetkem, který na osvobození podle § 4/1 t) nárok nemá
      // (R-02f) — v přehledu se přitom správně nezobrazoval.
      applicable: result.limits.limit100k.applicable,
      status: result.limits.limit100k,
      // fakt bez imperativu: individualizovaný pokyn („zvaž, počkej“) je za
      // hranicí § 1 zákona 523/1992 Sb. (nález V-4 auditu) — rada patří leda
      // obecně do marketingu, ne do e-mailu s čísly konkrétního člověka
      consequence: 'Nad limit se daní prodeje bez splněného časového testu.',
    },
    {
      key: 'krypto100k',
      kind: 'CRYPTO',
      // totéž pro krypto: v roce bez osvobození (ZO ≤ 2024, R-10b) měřák lže
      applicable: result.limits.cryptoLimit100k.applicable,
      status: result.limits.cryptoLimit100k,
      consequence:
        'Nad limit se daní prodeje a směny kryptoaktiv bez splněného časového testu.',
    },
  ];

  for (const event of limitEvents) {
    if (!event.applicable) continue;
    const usage = `Čerpání je ${czk(event.status.usedCzk)} z ${czk(event.status.limitCzk)} (${year})`;
    // jen NEJVYŠŠÍ dosažená hranice: kdo přijde rovnou na 90 %, nemá dostat
    // zvlášť i „přes 60 %“ — nižší hranice se ozvaly dřív, každá vlastním
    // klíčem (web slibuje e-mail při 60, 85 a 100 %, proto ty výchozí)
    const reached = rules.limitThresholdsPct.filter((pct) =>
      // 100 % = „prolomeno“ podle enginu (§ 4 odst. 1 písm. t mluví o příjmech
      // limit NEPŘESAHUJÍCÍCH, takže přesně 100 000 Kč je pořád pod limitem);
      // nižší hranice jsou náš vlastní předstih, tam stačí poměr
      pct >= 100 ? event.status.exceeded : event.status.ratio * 100 >= pct,
    );
    const top = reached.length > 0 ? Math.max(...reached) : null;
    if (top === null) continue;
    // O tom, jestli je limit prolomený, rozhoduje engine — ne to, kterou
    // hranici má uživatel zaškrtnutou. Bez toho by ten, kdo si odškrtl 100 %,
    // dostal při 150 % limitu titulek „Blížíš se“.
    const breached = event.status.exceeded;
    const level = breached ? 'exceeded' : top >= 85 ? 'critical' : 'warning';
    add({
      dedupeKey: `limit|${event.key}|${thresholdKey(top)}|${year}`,
      type: breached ? 'LIMIT_EXCEEDED' : top >= 85 ? 'LIMIT_CRITICAL' : 'LIMIT_WARNING',
      urgent: breached,
      title: limitEventTitle(event.kind, level, event.status.limitCzk),
      body: breached ? `${usage}. ${event.consequence}` : `${usage} — přes ${top} %. ${event.consequence}`,
    });
  }

  return [...out.values()];
}

/** Uloží jen nové události (PK userId+dedupeKey); vrátí, kolik přibylo. */
export async function syncNotifications(
  db: Db,
  userId: string,
  candidates: NotificationCandidate[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const existing = await db
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(
          notifications.dedupeKey,
          candidates.map((c) => c.dedupeKey),
        ),
      ),
    );
  const existingKeys = new Set(existing.map((row) => row.key));
  const fresh = candidates.filter((c) => !existingKeys.has(c.dedupeKey));
  if (fresh.length > 0) {
    // onConflictDoNothing: souběžné běhy (cron + ruční re-trigger) nesmí
    // spadnout na PK violation — druhý zápis téže události se tiše přeskočí
    await db
      .insert(notifications)
      .values(fresh.map((c) => ({ userId, ...c })))
      .onConflictDoNothing();
  }
  return fresh.length;
}

/**
 * Kalendářní události (G9c): lednové roční shrnutí a připomínky termínů
 * přiznání. Termíny se **počítají** dle R-09e (§ 136 + § 33/4 daňového řádu) —
 * natvrdo zapsané „2. 5." platilo za ZO 2024, za ZO 2025 vychází až 4. 5. 2026
 * a upomínka končila dva dny PŘED skutečným termínem.
 *
 * Texty jsou fakt a termín, žádný pokyn — individualizovaná rada je za hranicí
 * § 1 zákona č. 523/1992 Sb. (docs/13 V-4, nálezy E-23 a E-26).
 */
export function calendarCandidates(args: {
  today: string;
  /** Měl předchozí rok nějaké transakce? (jinak shrnutí nedává smysl) */
  hadActivityLastYear: boolean;
  /** Kolik dní před termínem připomenout (uživatelovo nastavení). */
  deadlineLeadDays?: number;
  /**
   * OSVČ (paušál i mimo něj) má od 1. 1. 2023 datovou schránku zřízenou ze
   * zákona, takže § 72 odst. 6 daňového řádu jí ukládá podat přiznání **jen
   * elektronicky**; písemné podání je vada podání (§ 74 DŘ) s pokutou dle
   * § 247a odst. 2 DŘ. Upomínka na tříměsíční písemný termín by ji tedy poslala
   * do pokuty a zbytečně jí zkrátila lhůtu o měsíc (E-23). Přehledy ČSSZ a
   * zdravotní pojišťovně se také týkají jen jí.
   */
  selfEmployed?: boolean;
}): NotificationCandidate[] {
  const {
    today,
    hadActivityLastYear,
    selfEmployed = false,
    deadlineLeadDays = DEFAULT_NOTIFICATION_RULES.deadlineLeadDays,
  } = args;
  const year = Number(today.slice(0, 4));
  const taxYear = year - 1;
  const { paper, electronic, advisor } = filingDeadlines(taxYear);
  // K1-02: XML se smí slibovat jen za roky, pro které oficiální struktura DPFDP7
  // existuje. Ceník, /podminky i report si to odvozují z EPO_SUPPORTED_YEARS —
  // e-maily byly jediné místo, kde to stálo natvrdo, takže lednové shrnutí za
  // rok 2026 slibovalo XML, které `/api/epo` odmítne vygenerovat.
  const xmlAvailable = EPO_SUPPORTED_YEARS.includes(taxYear);
  const xmlPromise = xmlAvailable ? ' i XML pro mojedane.cz' : '';
  const xmlPointer = xmlAvailable ? ' — XML export najdeš v reportu' : '';
  const xmlSentence = xmlAvailable ? ' XML pro mojedane.cz vygeneruješ v reportu.' : '';
  const out: NotificationCandidate[] = [];
  if (hadActivityLastYear && today >= `${year}-01-01` && today <= `${year}-01-31`) {
    const deadlineNote = selfEmployed
      ? `Jako OSVČ máš datovou schránku zřízenou ze zákona, takže se přiznání podává jen elektronicky (§ 72 odst. 6 daňového řádu) — do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`
      : `Písemné přiznání se podává do ${czDate(paper)}, elektronické do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`;
    out.push({
      dedupeKey: `rocni|${taxYear}`,
      type: 'YEAR_SUMMARY',
      title: `Podklady za rok ${taxYear} jsou připravené`,
      // stránka se jmenuje „Report“ (dřív „Daňový report“)
      body: `Report za rok ${taxYear} máš hotový v aplikaci — čísla do přiznání, srovnání variant výpočtu${xmlPromise}. ${deadlineNote}`,
    });
  }
  // okna upomínek končí PŘESNĚ dnem termínu, ne pevným datem — jinak poslední
  // dny před termínem nepřijde nic zrovna tomu, kdo ještě nepodal
  if (
    !selfEmployed &&
    hadActivityLastYear &&
    today >= addDays(paper, -deadlineLeadDays) &&
    today <= paper
  ) {
    out.push({
      dedupeKey: `termin|papir|${year}`,
      type: 'DEADLINE',
      urgent: deadlineLeadDays <= 14,
      title: `Blíží se termín přiznání: ${czDate(paper)}`,
      body: `Písemné přiznání za rok ${taxYear} se podává do ${czDate(paper)}. Elektronické podání (mojedane.cz) má lhůtu do ${czDate(electronic)}${xmlPointer}.`,
    });
  }
  if (
    hadActivityLastYear &&
    today >= addDays(electronic, -deadlineLeadDays) &&
    today <= electronic
  ) {
    const extra = selfEmployed
      ? ' Jako OSVČ podáváš přiznání jen elektronicky (§ 72 odst. 6 daňového řádu). Vedle přiznání se za stejné období podávají přehledy ČSSZ a zdravotní pojišťovně; Danero je nesleduje.'
      : '';
    out.push({
      dedupeKey: `termin|elektronicky|${year}`,
      type: 'DEADLINE',
      urgent: deadlineLeadDays <= 14,
      title: `Blíží se termín elektronického přiznání: ${czDate(electronic)}`,
      body: `Elektronické přiznání za rok ${taxYear} se podává do ${czDate(electronic)}.${xmlSentence}${extra}`,
    });
  }
  return out;
}

/** Po kolika dnech selhávající synchronizace se hlídač ozve. */
export const SYNC_FAILING_AFTER_DAYS = 3;

/**
 * Účet u brokera, jehož synchronizace selhává (vypršelý nebo zrušený klíč,
 * výpadek brokera). Do 7. 11. 2026 to hlídač nevěděl: počítal potichu ze
 * starých dat a přehled ani e-mail neřekly, že nové obchody a dividendy
 * chybí.
 *
 * Začátek výpadku (`failingSince`) je první neúspěšný sync po posledním
 * úspěšném — z historie jobů, ne z `lastSyncedAt`: ten se nastavuje jen po
 * úspěchu a vrácení importu ze syncu ho nuluje, takže by z něj vycházelo
 * „z účtu se nikdy nic nestáhlo“ i u účtu s daty za léta. Ozve se jednou za
 * výpadek (klíč nese den začátku) a až po `SYNC_FAILING_AFTER_DAYS` dnech —
 * jednodenní výpadek brokera vyřeší další noční běh sám.
 */
export function syncFailureCandidates(args: {
  accounts: Array<{
    id: string;
    label: string;
    lastSyncStatus: string | null;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
    /** První neúspěšný sync po posledním úspěšném; `null` = neznámý. */
    failingSince: Date | null;
  }>;
  today: string;
}): NotificationCandidate[] {
  const out: NotificationCandidate[] = [];
  for (const account of args.accounts) {
    if (account.lastSyncStatus !== 'error' || account.failingSince === null) continue;
    // den v pražském čase — sync ve 00:30 je ještě „dnes“, ne včera v UTC
    const since = todayInPrague(account.failingSince);
    if (diffDays(since, args.today) < SYNC_FAILING_AFTER_DAYS) continue;
    // věta z `lastSyncError` je psaná pro uživatele a bez přístupových údajů
    // (`lib/sync-failure.ts`); technický detail do e-mailu nejde
    const reason = account.lastSyncError ? parseSyncFailure(account.lastSyncError).text.trim() : '';
    const reasonSentence = reason === '' ? '' : ` ${/[.!?…]$/.test(reason) ? reason : `${reason}.`}`;
    const lastSuccess = account.lastSyncedAt
      ? ` Naposledy se data podařilo stáhnout ${czDate(todayInPrague(account.lastSyncedAt))}.`
      : '';
    out.push({
      dedupeKey: `sync|${account.id}|${since}`,
      type: 'SYNC_FAILING',
      // nesnese čekání na týdenní souhrn: do té doby jsou všechna čísla stará
      urgent: true,
      title: `${account.label}: synchronizace nefunguje od ${czDate(since)}`,
      body: `Synchronizace účtu ${account.label} od ${czDate(since)} selhává, takže výpočty nevidí nové obchody ani dividendy.${lastSuccess}${reasonSentence} Stav účtu a obnovení klíče najdeš v Importu.`,
    });
  }
  return out;
}

/** Řádek měřáku limitu v pravidelném přehledu. */
export interface SummaryMeter {
  label: string;
  usedCzk: string;
  limitCzk: string;
  percent: string;
  ratio: number;
  /** `danger` = prolomeno podle enginu, `caution` = od 85 % (naléhavé pásmo hlídače). */
  tone: 'normal' | 'caution' | 'danger';
}

/** Obsah pravidelného přehledu po částech — z nich se skládá text i e-mail. */
export interface SummaryContent {
  title: string;
  /** Daňový rok, za který limity platí (v lednu je to už nový rok). */
  year: number;
  /** „Stav k 1. 7. 2026 za rok 2026.“ */
  intro: string;
  meters: SummaryMeter[];
  /** Nejbližší osvobození, nebo věta, že žádné nečeká. */
  next: string;
  /** Orientační daň (s výhradou, když pod limitem režimu nevzniká povinnost). */
  tax: string;
}

/**
 * Pravidelný přehled (měsíční/čtvrtletní): jediná událost, která vzniká i ve
 * chvíli, kdy se NIC nestalo — od toho je. Shrne, kde je uživatel s limity,
 * co ho nejdřív čeká a na kolik zatím vychází daň, aby nemusel nic otvírat.
 *
 * V titulku období NENÍ: přehled odchází první den období a nese stav k tomu
 * dni, takže „Přehled za srpen“ odeslaný 1. srpna by popisoval červenec. Je to
 * snímek k datu, ne uzávěrka.
 */
export function summaryContent(args: {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  today: string;
}): SummaryContent {
  const { result, positions, labels, today } = args;

  // Řádky se jmenují stejně jako seznam limitů na přehledu (`LIMIT_NAME`);
  // částku limitu nese hned věta za jménem („… z 50 000 Kč“), a to ze stavu
  // limitu — u limitů § 38g se rok od roku liší (R-09a, R-09b).
  const limits: Array<{ label: string; status: LimitStatus }> = [
    ...(result.limits.flatTax50k.applicable
      ? [{ label: LIMIT_NAME.FLAT_TAX, status: result.limits.flatTax50k.status }]
      : []),
    ...(result.limits.employee20k.applicable
      ? [{ label: LIMIT_NAME.EMPLOYEE_SIDE_INCOME, status: result.limits.employee20k.status }]
      : []),
    // L12-02: bez tohoto řádku přehled v režimu „Jiné“ ukázal jen nečerpanou
    // stovku a působil klidně i při prolomeném limitu pro přiznání (R-09a)
    ...(result.limits.generalFiling50k.applicable
      ? [{ label: LIMIT_NAME.GENERAL_FILING, status: result.limits.generalFiling50k.status }]
      : []),
    // K6b-02b: měřák limitu, na který poplatník nárok NEMÁ, v přehledu být
    // nesmí — s cennými papíry v obchodním majetku osvobození podle § 4/1 t)
    // neexistuje (R-02f) a řádek „0 ze 100 000" tvrdí klid tam, kde se daní
    // každá koruna. V aplikaci se správně nezobrazuje už dřív.
    ...(result.limits.limit100k.applicable
      ? [{ label: LIMIT_NAME.SECURITIES, status: result.limits.limit100k }]
      : []),
    ...(result.limits.cryptoLimit100k.applicable && result.limits.cryptoLimit100k.usedCzk.gt(0)
      ? [{ label: LIMIT_NAME.CRYPTO, status: result.limits.cryptoLimit100k }]
      : []),
  ];
  const meters = limits.map(
    ({ label, status }): SummaryMeter => ({
      label,
      usedCzk: czk(status.usedCzk),
      limitCzk: czk(status.limitCzk),
      percent: pct(status.ratio * 100),
      ratio: status.ratio,
      // o prolomení rozhoduje engine (přesně 100 000 Kč je ještě pod limitem)
      tone: status.exceeded ? 'danger' : status.ratio >= 0.85 ? 'caution' : 'normal',
    }),
  );

  // nejbližší pozice, které doběhne časový test — jediné číslo, kvůli kterému
  // má smysl přehled číst i v měsíci, kdy se nic nestalo
  const next = positions
    .flatMap((position) =>
      position.lots
        .filter((lot) => lot.exemptionPossible && !lot.isExempt)
        .map((lot) => ({ isin: position.isin, exemptFrom: lot.exemptFrom, remaining: lot.remaining })),
    )
    .sort((a, b) => a.exemptFrom.localeCompare(b.exemptFrom))[0];
  const nextLine = next
    ? `Nejbližší osvobození: ${qty(next.remaining)} ks ${labels.get(next.isin) ?? next.isin} ${czDate(next.exemptFrom)}.`
    : 'Žádná pozice zatím na tříletý časový test nečeká.';

  const taxCzk = recommendedTaxCzk(result);
  // R-09f: pod limitem režimu se orientační daň neplatí — částka bez výhrady
  // by v e-mailu vypadala jako dluh
  const underLimit =
    unpaidUnderLimitCzk(result) && taxCzk.gt(0)
      ? ' — platí se jen při podání přiznání, a ta povinnost ti zatím nevzniká'
      : '';

  return {
    title: `Přehled k ${czDate(today)}`,
    year: result.year,
    intro: `Stav k ${czDate(today)} za rok ${result.year}.`,
    meters,
    next: nextLine,
    // fakt a čísla, žádný pokyn (V-4) — stejná pravidla jako u ostatních e-mailů
    tax: `Orientační daň z investic zatím ${czk(taxCzk)}${underLimit}.`,
  };
}

/** Text přehledu tak, jak se ukládá a ukazuje v aplikaci. */
export function summaryBody(content: SummaryContent): string {
  const limitLines = content.meters.map(
    (meter) => `${meter.label}: ${meter.usedCzk} z ${meter.limitCzk} (${meter.percent})`,
  );
  return `${content.intro} ${limitLines.join('. ')}. ${content.next} ${content.tax}`;
}

/**
 * Událost pravidelného přehledu. Období je součástí dedupe klíče, takže za
 * měsíc (čtvrtletí) odejde nejvýš jeden — i když cron poběží každý den.
 */
export function summaryCandidate(args: {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  today: string;
  period: string;
}): NotificationCandidate {
  const content = summaryContent(args);
  return {
    dedupeKey: `souhrn|${args.period}`,
    type: 'SUMMARY',
    title: content.title,
    body: summaryBody(content),
  };
}

/** Událost, jak vstupuje do souhrnného e-mailu. */
export interface DigestEntry {
  type: string;
  title: string;
  body: string;
  urgent?: boolean | null;
  /** Klíč události — u časového testu nese titul a datum (`tt30|<isin>|<datum>`). */
  dedupeKey?: string;
}

/**
 * Klíč události časového testu: `tt<lhůta>|<isin>|<datum osvobození>` nebo
 * `ttdone|<isin>|<datum>` (`computeNotificationCandidates`). Titul a datum se
 * berou z klíče, ne z textu — ten je pro lidi a mění se.
 */
const TIME_TEST_KEY = /^tt(\d+|done)\|(.+)\|(\d{4}-\d{2}-\d{2})$/;

export function parseTimeTestKey(
  dedupeKey: string | undefined,
): { done: boolean; isin: string; exemptFrom: string } | null {
  const match = dedupeKey === undefined ? null : TIME_TEST_KEY.exec(dedupeKey);
  return match ? { done: match[1] === 'done', isin: match[2]!, exemptFrom: match[3]! } : null;
}

/**
 * Události časového testu téhož titulu se v e-mailu slijí do jedné položky.
 *
 * Hlídač zakládá událost pro každý nákup zvlášť (každý má vlastní lhůtu), a kdo
 * nakupuje pravidelně, dostal by seznam „VWRL: osvobození za 7 dní“ pod sebou
 * pro každý den v týdnu. Tady z nich vznikne „VWRL: blíží se osvobození
 * 5 nákupů“ s rozpětím dat. V aplikaci zůstávají jednotlivě.
 */
function mergeTimeTests(entries: DigestEntry[]): DigestEntry[] {
  const groups = new Map<string, Array<{ entry: DigestEntry; exemptFrom: string }>>();
  const out: Array<DigestEntry | string> = [];
  for (const entry of entries) {
    const key = parseTimeTestKey(entry.dedupeKey);
    // titul tak, jak ho uživatel zná — vše před „: osvobození…“ v titulku
    const cut = entry.title.lastIndexOf(': osvoboz');
    if (!key || cut <= 0) {
      out.push(entry);
      continue;
    }
    const groupKey = `${key.done ? 'done' : 'lead'}|${key.isin}`;
    const group = groups.get(groupKey);
    // dvě lhůty TÉHOŽ nákupu (7 a 1 den) jsou jeden nákup, ne dva — zůstane
    // ta pozdější, bližší událost
    const same = group?.findIndex((g) => g.exemptFrom === key.exemptFrom) ?? -1;
    if (group && same >= 0) {
      const urgent = group[same]!.entry.urgent === true || entry.urgent === true;
      group[same] = { entry: { ...entry, urgent }, exemptFrom: key.exemptFrom };
    } else if (group) group.push({ entry, exemptFrom: key.exemptFrom });
    else {
      groups.set(groupKey, [{ entry, exemptFrom: key.exemptFrom }]);
      out.push(groupKey);
    }
  }
  return out.map((item) => {
    if (typeof item !== 'string') return item;
    const group = groups.get(item)!;
    const first = group[0]!.entry;
    if (group.length === 1) return first;
    const n = group.length;
    const label = first.title.slice(0, first.title.lastIndexOf(': osvoboz'));
    const dates = group.map((g) => g.exemptFrom).sort();
    const [from, to] = [dates[0]!, dates[dates.length - 1]!];
    const purchases = `${n} ${plural(n, 'nákup', 'nákupy', 'nákupů')} ${label}`;
    if (item.startsWith('done|')) {
      const when = from === to ? czDate(from) : `${czDate(from)} až ${czDate(to)}`;
      return {
        type: first.type,
        title: `${label}: osvobozeno (${n} ${plural(n, 'nákup', 'nákupy', 'nákupů')}) 🎉`,
        // POZOR: i časově osvobozená tržba se při bezpečném výkladu počítá do
        // úhrnu 100 000 Kč — stejná výhrada jako u jednotlivé události
        body: `${purchases} ${plural(n, 'splnil', 'splnily', 'splnilo')} časový test (${when}) — prodej je osvobozený od daně. Při bezpečném výkladu se ale tržba pořád počítá do ročního úhrnu 100 000 Kč — dopad prodeje si ověř v simulátoru.`,
        urgent: group.some((g) => g.entry.urgent === true),
      };
    }
    return {
      type: first.type,
      title: `${label}: blíží se osvobození ${n} nákupů`,
      // fakt a termín, žádný pokyn (V-4)
      body:
        from === to
          ? `${purchases} splní časový test ${czDate(from)}. Prodej po tomto datu bude od daně osvobozený — před ním se zisk daní celý.`
          : `${purchases} splní časový test postupně mezi ${czDate(from)} a ${czDate(to)}. Prodej každého z nich je od jeho data bez daně — dřív se zisk daní celý.`,
      urgent: group.some((g) => g.entry.urgent === true),
    };
  });
}

/** Kolik událostí jedné skupiny se vypíše v e-mailu (zbytek je v aplikaci). */
const MAX_DIGEST_ITEMS_PER_GROUP = 15;

/** Skupiny souhrnného e-mailu v pořadí, ve kterém se ukazují. */
const DIGEST_GROUPS: Array<{ title: string; matches: (type: string) => boolean }> = [
  // nejdřív: bez fungující synchronizace jsou ostatní čísla stará
  { title: 'Synchronizace brokera', matches: (type) => type === 'SYNC_FAILING' },
  { title: 'Limity', matches: (type) => type.startsWith('LIMIT_') },
  { title: 'Časový test', matches: (type) => type.startsWith('TIME_TEST') },
  { title: 'Termíny přiznání', matches: (type) => type === 'DEADLINE' || type === 'YEAR_SUMMARY' },
];

/**
 * Souhrnný e-mail hlídače. Do 7. 11. 2026 odcházel jako holý text s odrážkami
 * — jediný e-mail z Danera bez HTML podoby. Události se dělí do skupin
 * (limity, časový test, termíny), naléhavé jdou ve skupině první a pravidelný
 * přehled má měřáky čerpání. Text i HTML vznikají z týchž bloků.
 *
 * `summary` je obsah přehledu spočítaný v tomhle běhu; bez něj se přehled
 * vypíše jako ostatní události, z uloženého textu.
 */
export function digestEmail(args: {
  entries: DigestEntry[];
  weekly: boolean;
  summary?: SummaryContent;
  baseUrl: string;
  unsubscribeUrl: string;
}): Omit<EmailMessage, 'to'> {
  const { summary, baseUrl, unsubscribeUrl } = args;
  // co e-mail opravdu ukazuje: časové testy jednoho titulu jako jedna položka
  const entries = mergeTimeTests(args.entries);
  const subject =
    entries.length === 1
      ? `Danero: ${entries[0]!.title}`
      : args.weekly
        ? 'Danero: souhrn upozornění za týden'
        : `Danero: ${entries.length} ${plural(entries.length, 'nové upozornění', 'nová upozornění', 'nových upozornění')}`;

  const toItem = (entry: DigestEntry): EmailItem => ({
    title: entry.title,
    text: entry.body,
    urgent: entry.urgent === true,
  });
  // Měřáky se kreslí jen pro přehled vzniklý v tomhle běhu (titulek nese
  // dnešní datum) — ten má spočítaný obsah. Přehled, který čekal na týdenní
  // okno, odejde tak, jak vznikl, ze svého uloženého textu: v databázi tak
  // zůstává přesně to, co odešlo, a rok se mu pod rukama nezmění.
  const summaryEntries = entries.filter((entry) => entry.type === 'SUMMARY');
  const freshSummary = summary && summaryEntries.some((entry) => entry.title === summary.title) ? summary : undefined;
  const storedSummaries = summaryEntries.filter((entry) => entry.title !== freshSummary?.title);
  const grouped = DIGEST_GROUPS.map((group) => ({
    title: group.title,
    // naléhavé ve skupině první, jinak v pořadí, v jakém vznikly
    items: entries
      .filter((entry) => group.matches(entry.type))
      .sort((a, b) => Number(b.urgent === true) - Number(a.urgent === true))
      .map(toItem),
  }));
  const known = new Set(
    entries.filter((entry) => entry.type === 'SUMMARY' || DIGEST_GROUPS.some((g) => g.matches(entry.type))),
  );
  const other = entries.filter((entry) => !known.has(entry)).map(toItem);
  const sections = [
    ...grouped,
    ...(other.length > 0 ? [{ title: 'Další upozornění', items: other }] : []),
  ].filter((section) => section.items.length > 0);
  // nadpisy skupin jen tam, kde je co od sebe oddělit
  const withHeadings = sections.length + (summaryEntries.length > 0 ? 1 : 0) > 1;

  const blocks: EmailBlock[] = [];
  for (const section of sections) {
    if (withHeadings) blocks.push({ kind: 'h', text: section.title });
    // Strop na skupinu: Gmail zprávu nad ~102 kB zkrátí i s patičkou, a s ní
    // zmizí odhlašovací odkaz a identifikace provozovatele. Celý seznam je
    // v aplikaci.
    const shown = section.items.slice(0, MAX_DIGEST_ITEMS_PER_GROUP);
    blocks.push({ kind: 'items', items: shown });
    const hidden = section.items.length - shown.length;
    if (hidden > 0) {
      blocks.push({
        kind: 'note',
        text: `A ${plural(hidden, 'další', 'další', 'dalších')} ${hidden} ${plural(hidden, 'upozornění', 'upozornění', 'upozornění')} — všechna najdeš v přehledu v aplikaci.`,
      });
    }
  }
  if (freshSummary) {
    blocks.push(
      { kind: 'h', text: freshSummary.title },
      // rok musí zaznít: v lednu měřáky začínají od nuly za nový rok
      { kind: 'note', text: `Čerpání ročních limitů za rok ${freshSummary.year}.` },
    );
    if (freshSummary.meters.length > 0) {
      blocks.push({
        kind: 'meters',
        rows: freshSummary.meters.map((meter) => ({
          label: meter.label,
          value: `${meter.usedCzk} z ${meter.limitCzk}`,
          percent: meter.percent,
          ratio: meter.ratio,
          tone: meter.tone,
        })),
      });
    }
    blocks.push({ kind: 'p', text: freshSummary.next }, { kind: 'p', text: freshSummary.tax });
  }
  if (storedSummaries.length > 0) {
    if (withHeadings && !freshSummary) blocks.push({ kind: 'h', text: 'Pravidelný přehled' });
    blocks.push({ kind: 'items', items: storedSummaries.map(toItem) });
  }
  blocks.push(
    { kind: 'cta', label: 'Otevřít přehled', url: `${baseUrl}/prehled` },
    { kind: 'note', text: 'Danero je výpočetní nástroj, nikoli daňové poradenství.' },
    {
      kind: 'links',
      links: [
        { label: 'Nastavit, co a jak často chodí', url: `${baseUrl}/nastaveni/upozorneni` },
        { label: 'Odhlásit e-mailová upozornění', url: unsubscribeUrl },
      ],
    },
  );

  // náhled v seznamu zpráv: titulky v pořadí, v jakém je e-mail ukazuje;
  // čekající přehledy jsou v e-mailu jeden, tak i tady
  const shownTitles = [
    ...sections.flatMap((section) => section.items.map((item) => item.title)),
    ...summaryEntries.map((entry) => entry.title),
  ];
  const preheader = entries.length === 1 ? entries[0]!.body : [...new Set(shownTitles)].join(' · ');

  return composeMessage({
    subject,
    // po znacích, ne po UTF-16 jednotkách: 🎉 v titulku by se jinak rozsekl na „�“
    preheader:
      Array.from(preheader).length > 150
        ? `${Array.from(preheader).slice(0, 147).join('').trimEnd()}…`
        : preheader,
    blocks,
    footer: operatorSignature(),
  });
}

/** Preference uživatele; chybějící řádek = vše zapnuté, denní souhrn (G8d, H3). */
export async function getNotificationPrefs(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(notificationPrefData)
    .where(eq(notificationPrefData.userId, userId));
  return (
    row ?? {
      userId,
      emailEnabled: true,
      timeTestEvents: true,
      limitEvents: true,
      calendarEmails: true,
      emailFrequency: 'DAILY',
      lastDigestAt: null,
      // vlastní pravidla hlídače: výchozí = to, co dělal, dokud se nedala měnit
      timeTestLeadDays: formatNumberList(DEFAULT_NOTIFICATION_RULES.timeTestLeadDays),
      timeTestDone: DEFAULT_NOTIFICATION_RULES.timeTestDone,
      limitThresholdsPct: formatNumberList(DEFAULT_NOTIFICATION_RULES.limitThresholdsPct),
      deadlineLeadDays: DEFAULT_NOTIFICATION_RULES.deadlineLeadDays,
      summaryFrequency: DEFAULT_NOTIFICATION_RULES.summaryFrequency,
      urgentImmediately: DEFAULT_NOTIFICATION_RULES.urgentImmediately,
    }
  );
}

/**
 * Podepsaný odhlašovací token (HMAC přes BETTER_AUTH_SECRET) — odkaz v e-mailu
 * funguje bez přihlášení, ale nejde zfalšovat pro cizí účet.
 *
 * D-3-06: token nese **datum vydání** a po `UNSUBSCRIBE_TOKEN_TTL_DAYS`
 * přestane platit. Bez toho platil věčně a zneplatnit ho šlo jedině výměnou
 * `BETTER_AUTH_SECRET`, tedy odhlášením všech uživatelů — a zároveň to byl
 * trvalý identifikátor člověka putující v URL napříč všemi e-maily (kdo se
 * dostane ke starému e-mailu, odhlásí oběť z upozornění i za rok).
 *
 * Rok je kompromis: odkaz musí fungovat i ve zprávě, kterou si člověk otevře
 * po měsících, ale nesmí být doživotní. Starší token vede na stránku, která
 * nabídne odhlášení po přihlášení.
 */
export const UNSUBSCRIBE_TOKEN_TTL_DAYS = 365;

const unsubscribeSignature = async (userId: string, issuedDay: string): Promise<string> => {
  const { createHmac } = await import('node:crypto');
  const { resolveSecret } = await import('@/lib/auth');
  return createHmac('sha256', resolveSecret()).update(`unsub|${userId}|${issuedDay}`).digest('hex');
};

/** Den vydání jako celé číslo dní od epochy — krátké a bez závislosti na locale. */
const dayNumber = (date: Date): number => Math.floor(date.getTime() / 86_400_000);

export async function unsubscribeToken(userId: string, now = new Date()): Promise<string> {
  const issuedDay = String(dayNumber(now));
  const sig = await unsubscribeSignature(userId, issuedDay);
  return `${Buffer.from(userId).toString('base64url')}.${issuedDay}.${sig}`;
}

export async function verifyUnsubscribeToken(
  token: string,
  now = new Date(),
): Promise<string | null> {
  const [encoded, issuedDay, sig] = token.split('.');
  if (!encoded || !issuedDay || !sig || !/^\d+$/.test(issuedDay)) return null;
  const userId = Buffer.from(encoded, 'base64url').toString('utf8');
  const { timingSafeEqual } = await import('node:crypto');
  const expected = await unsubscribeSignature(userId, issuedDay);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  // Podpis sedí — teprve teď má smysl ptát se na stáří (jinak by šlo z délky
  // odpovědi hádat, jestli token platí).
  const age = dayNumber(now) - Number(issuedDay);
  if (age < 0 || age > UNSUBSCRIBE_TOKEN_TTL_DAYS) return null;
  return userId;
}

// odesílání žije v lib/email.ts (sdílí ho auth vrstva, která nesmí tahat engine)
export { resolveEmailSender, type EmailMessage, type EmailSender } from '@/lib/email';

/**
 * Denní běh pro jednoho uživatele: přepočet → nové události (do DB VŽDY,
 * přehled v aplikaci je úplný) → jeden digest e-mail podle preferencí
 * (typy + frekvence DAILY/WEEKLY). Idempotentní (druhý běh v den nic neposílá).
 */
/** K5-14: jak dlouho se ještě smí zkoušet odeslat upozornění, které neprošlo. */
const EMAIL_RETRY_LIMIT_DAYS = 14;

export async function processUserNotifications(
  db: Db,
  target: { id: string; email: string },
  options: { send: EmailSender; today?: string },
): Promise<{ created: number; emailed: number }> {
  const today = options.today ?? todayInPrague();
  const year = Number(today.slice(0, 4));
  const prefs = await getNotificationPrefs(db, target.id);
  const rules = notificationRules(prefs);

  let created = 0;
  // obsah pravidelného přehledu k dnešku — e-mail z něj kreslí měřáky
  let summaryNow: SummaryContent | undefined;
  const profile = await getProfile(db, target.id);
  if (profile) {
    const txs = await loadTransactions(db, target.id);
    if (txs.length > 0) {
      // stejná kurzová metoda jako v aplikaci (denní ČNB podle profilu, fallback
      // mimo pokrytí jednotné tabulky) — e-mail nesmí počítat jiná čísla než /prehled
      const dailyRates = await dailyRatesForProfile(db, txs, profile, year);
      const analysis = analyzeForUser(txs, profile, year, today, dailyRates);
      const lastYearPrefix = `${year - 1}-`;
      // H3: do DB se zakládá VŠECHNO — přehled v aplikaci zůstává úplný,
      // preference filtrují až e-mailovou frontu níže
      const period = summaryPeriod(today, rules.summaryFrequency);
      summaryNow = summaryContent({
        result: analysis.result,
        positions: analysis.positions,
        labels: analysis.labels,
        today,
      });
      const candidates = [
        ...computeNotificationCandidates({
          result: analysis.result,
          positions: analysis.positions,
          labels: analysis.labels,
          today,
          rules,
        }),
        ...calendarCandidates({
          today,
          hadActivityLastYear: txs.some((tx) =>
            ('tradeDate' in tx ? tx.tradeDate : tx.date).startsWith(lastYearPrefix),
          ),
          // § 72 odst. 6 DŘ: OSVČ má datovou schránku ze zákona → jen elektronicky (E-23)
          selfEmployed: profile.regime === 'PAUSAL' || profile.regime === 'OSVC',
          deadlineLeadDays: rules.deadlineLeadDays,
        }),
        ...(period
          ? [
              summaryCandidate({
                result: analysis.result,
                positions: analysis.positions,
                labels: analysis.labels,
                today,
                period,
              }),
            ]
          : []),
      ];
      created = await syncNotifications(db, target.id, candidates);
    }
  }

  // Selhávající synchronizace brokera — nezávisle na profilu a transakcích:
  // účet, ze kterého se nepodařilo stáhnout nic, transakce nemá
  const accountRows = await db
    .select({
      id: brokerAccounts.id,
      label: brokerAccounts.label,
      lastSyncStatus: brokerAccounts.lastSyncStatus,
      lastSyncedAt: brokerAccounts.lastSyncedAt,
      lastSyncError: brokerAccounts.lastSyncError,
    })
    .from(brokerAccounts)
    .where(eq(brokerAccounts.userId, target.id));
  const failingSince = async (accountId: string): Promise<Date | null> => {
    // klíč jobu synchronizace je id účtu (`enqueueSync`)
    const [lastSuccess] = await db
      .select({ at: max(jobs.createdAt) })
      .from(jobs)
      .where(and(eq(jobs.userId, target.id), eq(jobs.dedupeKey, accountId), eq(jobs.status, 'success')));
    const [firstError] = await db
      .select({ at: min(jobs.createdAt) })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, target.id),
          eq(jobs.dedupeKey, accountId),
          eq(jobs.status, 'error'),
          ...(lastSuccess?.at ? [gt(jobs.createdAt, lastSuccess.at)] : []),
        ),
      );
    return firstError?.at ?? null;
  };
  const accounts = await Promise.all(
    accountRows.map(async (account) => ({
      ...account,
      failingSince: account.lastSyncStatus === 'error' ? await failingSince(account.id) : null,
    })),
  );
  created += await syncNotifications(db, target.id, syncFailureCandidates({ accounts, today }));
  const failingAccounts = new Set(
    accountRows.filter((account) => account.lastSyncStatus === 'error').map((account) => account.id),
  );

  // E-mailová fronta (H3) — čekající notifikace se dělí do tří tříd:
  // 1. odeslané v digestu → emailedAt (idempotence, druhý běh nic neposílá),
  // 2. potlačené preferencí (master vypnutý nebo vypnutý typ) → TAKY emailedAt
  //    (nesmí se hromadit — po zapnutí nesmí přijít měsíce staré události),
  // 3. čekající na týdenní okno (WEEKLY, digest byl nedávno) → NEoznačovat,
  //    pošlou se v příštím týdenním souhrnu.
  // K5-14: strop opakování. Když odeslání selže, claim se vrací (níž), takže
  // se týž digest zkouší každý běh cronu znovu — u trvale nedoručitelné adresy
  // donekonečna (změřeno: 4 pokusy za 4 dny a pořád ve frontě, plus chyba
  // v logu při každém běhu). Po dvou týdnech je upozornění stejně bezcenné:
  // v přehledu v aplikaci zůstává, e-mailem už nechodí. Dva týdny jsou
  // dvojnásobek nejdelšího LEGITIMNÍHO čekání (týdenní digest, okno 6,5 dne),
  // takže se nemůžou splést s řádkem, který jen čeká na souhrn.
  const emailRetryCutoff = new Date(
    new Date(`${today}T00:00:00Z`).getTime() - EMAIL_RETRY_LIMIT_DAYS * 24 * 60 * 60 * 1000,
  );
  const pending = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, target.id),
        isNull(notifications.emailedAt),
        gte(notifications.createdAt, emailRetryCutoff),
      ),
    )
    // pořadí vzniku, ne fyzické pořadí řádků (Postgres je po UPDATE přeskládá)
    .orderBy(asc(notifications.createdAt), asc(notifications.dedupeKey));
  // Upozornění, které ještě neodešlo, není záznam o odeslaném e-mailu — smí
  // (a má) odejít s dnešními názvy limitů, ne s těmi, se kterými vzniklo před
  // přejmenováním. Řádek se přepíše dřív, než se pošle, takže v databázi dál
  // stojí přesně to, co odešlo. Odeslaných řádků se to netýká: ty se převádějí
  // až při zobrazení (`lib/notification-display.ts`).
  for (const row of pending) {
    const current = currentNotificationText(row);
    if (current.title === row.title && current.body === row.body) continue;
    await db
      .update(notifications)
      .set(current)
      .where(
        and(
          eq(notifications.userId, target.id),
          eq(notifications.dedupeKey, row.dedupeKey),
          isNull(notifications.emailedAt),
        ),
      );
    row.title = current.title;
    row.body = current.body;
  }
  const emailAllowed = (type: string): boolean => {
    if (!prefs.emailEnabled) return false;
    // pravidelný přehled má vlastní vypínač (kadenci) — a musí platit i pro
    // řádek, který už vznikl: kdo si přehled vypne den po jeho založení,
    // nesmí ho v nejbližším souhrnu přesto dostat
    if (type === 'SUMMARY') return rules.summaryFrequency !== 'OFF';
    if (type === 'YEAR_SUMMARY' || type === 'DEADLINE') return prefs.calendarEmails;
    // provozní zpráva bez vlastního vypínače: s nefunkční synchronizací jsou
    // stará všechna ostatní čísla, takže ji dostane každý, kdo e-maily chce
    if (type === 'SYNC_FAILING') return true;
    return type.startsWith('TIME_TEST') ? prefs.timeTestEvents : prefs.limitEvents;
  };
  // Zpráva o nefunkční synchronizaci, která čekala na odeslání, se zahodí,
  // když mezitím synchronizace zase proběhla — jinak by přišla po opravě.
  const stillRelevant = (n: (typeof pending)[number]): boolean =>
    n.type !== 'SYNC_FAILING' || failingAccounts.has(n.dedupeKey.split('|')[1] ?? '');
  const suppressed = pending.filter((n) => !emailAllowed(n.type) || !stillRelevant(n));
  const queue = pending.filter((n) => emailAllowed(n.type) && stillRelevant(n));

  // Okno digestu: WEEKLY nejdřív po 6,5 dnech od minulého, DAILY nejdřív po
  // půl dni — druhý běh cronu týž den (ruční re-trigger) tak nepošle druhý
  // e-mail. Tolerance (0,5 dne) kryje posun času běhu — přesný násobek dne
  // by běh o pár minut dřív odsunul o celý den.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayDate = new Date(`${today}T00:00:00Z`);
  const sinceLastMs =
    prefs.lastDigestAt === null
      ? Number.POSITIVE_INFINITY
      : todayDate.getTime() - prefs.lastDigestAt.getTime();
  // Naléhavé události (prolomený limit, osvobození do týdne, blížící se termín)
  // by v týdenním režimu čekaly na souhrn i šest dní — a upozornění „osvobození
  // za 7 dní“ doručené po termínu je k ničemu. Kdo si to nechá zapnuté, dostane
  // je hned, pořád ale nejvýš jeden e-mail za půl dne.
  //
  // Časový test je naléhavý u každého nákupu zvlášť, takže by u pravidelného
  // investora prorážel týdenní okno každý den (revize 7. 11. 2026: denní nákup
  // dvou ETF = 28 e-mailů za 28 dní v režimu „jednou týdně“). Okno proto
  // prorazí nejvýš jednou za týden pro týž titul; další nákupy téhož titulu
  // počkají na souhrn, kde se slijí do jedné položky.
  const weekAgo = new Date(todayDate.getTime() - 6.5 * DAY_MS);
  const alertedRecently = new Set(
    (
      await db
        .select({ dedupeKey: notifications.dedupeKey })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, target.id),
            eq(notifications.urgent, true),
            gte(notifications.emailedAt, weekAgo),
          ),
        )
    )
      .map((row) => parseTimeTestKey(row.dedupeKey)?.isin)
      .filter((isin): isin is string => isin !== undefined),
  );
  // Pojistka ale nesmí zdržet připomínku za termín: když nákup doběhne dřív,
  // než otevře příští týdenní souhrn (jiná lhůta téhož nákupu, pozdě
  // naimportovaný nákup), okno prorazí i podruhé.
  const nextDigestDay =
    prefs.lastDigestAt === null ? today : addDays(todayInPrague(prefs.lastDigestAt), 7);
  const urgent = queue.some((n) => {
    if (!n.urgent) return false;
    const timeTest = parseTimeTestKey(n.dedupeKey);
    return !timeTest || !alertedRecently.has(timeTest.isin) || timeTest.exemptFrom <= nextDigestDay;
  });
  const windowDays = prefs.emailFrequency === 'WEEKLY' && !(rules.urgentImmediately && urgent) ? 6.5 : 0.5;
  const windowOpen = sinceLastMs >= windowDays * DAY_MS;

  let emailed = 0;
  if (queue.length > 0 && windowOpen) {
    // claim-then-send: řádky se označí PŘED odesláním a posílá se jen to, co
    // tento běh skutečně získal (returning) — souběžný druhý běh (ruční
    // re-trigger přes plánovaný) tak nepošle tentýž digest podruhé; při
    // selhání odeslání se claim vrací, ať se e-mail příště zkusí znovu
    const claimed = await db
      .update(notifications)
      .set({ emailedAt: new Date() })
      .where(
        and(
          eq(notifications.userId, target.id),
          isNull(notifications.emailedAt),
          inArray(notifications.dedupeKey, queue.map((n) => n.dedupeKey)),
        ),
      )
      .returning({ dedupeKey: notifications.dedupeKey });
    const claimedKeys = new Set(claimed.map((c) => c.dedupeKey));
    const toSend = queue.filter((n) => claimedKeys.has(n.dedupeKey));
    if (toSend.length > 0) {
      const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
      const unsubscribeUrl = `${baseUrl}/api/odhlasit?token=${await unsubscribeToken(target.id)}`;
      try {
        await options.send({
          to: target.email,
          // patička jde z lib/contact.ts — identifikace i kontakt na jednom
          // místě, ať se digest nerozejde s ostatními e-maily (E-46, L13-06)
          ...digestEmail({
            entries: toSend,
            // „za týden“ jen tehdy, když opravdu odchází týdenní souhrn — ne
            // e-mail, který okno prorazil kvůli naléhavé události
            weekly: prefs.emailFrequency === 'WEEKLY' && sinceLastMs >= 6.5 * DAY_MS,
            summary: summaryNow,
            baseUrl,
            unsubscribeUrl,
          }),
          // RFC 8058: jednoklikové odhlášení. `/api/odhlasit` na to je připravené —
          // GET jen ptá (mail scannery nic nezmění), stav mění až POST, přesně
          // jak to jednoklik vyžaduje.
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
      } catch (error) {
        await db
          .update(notifications)
          .set({ emailedAt: null })
          .where(
            and(
              eq(notifications.userId, target.id),
              inArray(notifications.dedupeKey, toSend.map((n) => n.dedupeKey)),
            ),
          );
        throw error;
      }
      emailed = toSend.length;
      // posunout okno digestu (lastDigestAt i u DAILY — po přepnutí na WEEKLY
      // se hned neodešle další souhrn)
      await db
        .insert(notificationPrefData)
        .values({ userId: target.id, lastDigestAt: todayDate })
        .onConflictDoUpdate({
          target: notificationPrefData.userId,
          set: { lastDigestAt: todayDate },
        });
    }
  }
  if (suppressed.length > 0) {
    // potlačené preferencí označit vždy (třída 2) — bez ohledu na týdenní okno.
    // `urgent` se jim bere: neodeslané upozornění se nesmí počítat mezi ta,
    // která už jednou za týden prorazila okno (`alertedRecently`).
    await db
      .update(notifications)
      .set({ emailedAt: new Date(), urgent: false })
      .where(
        and(
          eq(notifications.userId, target.id),
          isNull(notifications.emailedAt),
          inArray(notifications.dedupeKey, suppressed.map((n) => n.dedupeKey)),
        ),
      );
  }

  return { created, emailed };
}

/**
 * Komu smí hlídač psát: účty s daňovým profilem a s OVĚŘENOU adresou.
 *
 * Ověření tu není formalita. Změna e-mailu v Nastavení uloží novou adresu jako
 * nepotvrzenou — a kdyby v ní byl překlep, chodil by přehled o cizích limitech
 * a termínech člověku, který s účtem nemá nic společného. Dokud byla rozesílka
 * jen pro předplatitele, týkalo se to hrstky účtů; od 8. 10. 2026 ji dostává
 * každý, takže by šlo o každou neověřenou adresu v databázi.
 *
 * Účet tím o nic nepřijde: upozornění se dál počítají a po potvrzení adresy
 * mu přijdou (nic se neoznačí jako odeslané, dokud opravdu neodešlo).
 */
export async function listNotificationTargets(db: Db): Promise<Array<{ id: string; email: string }>> {
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .innerJoin(taxpayerProfileData, eq(taxpayerProfileData.userId, user.id))
    .where(eq(user.emailVerified, true));
}
