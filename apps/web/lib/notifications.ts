import { and, eq, inArray, isNull } from 'drizzle-orm';
import { filingDeadlines, type LimitStatus, type Position, type TaxYearResult } from '@danero/engine';
import { addDays, diffDays } from '@danero/shared';
import type { Db } from '@/db';
import { notificationPrefs, notifications, taxpayerProfiles, user } from '@/db/schema';
import { EPO_SUPPORTED_YEARS } from '@/lib/epo';
import { operatorSignature } from '@/lib/contact';
import {
  DEFAULT_NOTIFICATION_RULES,
  formatNumberList,
  notificationRules,
  summaryPeriod,
  type NotificationRules,
} from '@/lib/notification-rules';
import { czDate, czk, pct, plural, qty } from '@/lib/format';
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
        const dny = plural(lot.daysToExempt, 'den', 'dny', 'dní');
        add({
          dedupeKey: `tt${lead}|${position.isin}|${lot.exemptFrom}`,
          type: `TIME_TEST_${lead}`,
          urgent: soon,
          title: soon
            ? `${label}: osvobození už za ${lot.daysToExempt} ${dny}`
            : `${label}: osvobození za ${lot.daysToExempt} ${dny}`,
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
  const limitEvents: Array<{
    key: string;
    applicable: boolean;
    status: LimitStatus;
    label: string;
    consequence: string;
  }> = [
    {
      key: '50k',
      applicable: result.limits.flatTax50k.applicable,
      status: result.limits.flatTax50k.status,
      label: 'limit 50 000 Kč pro paušální daň',
      consequence: 'Při překročení za rok podáváš přiznání a přehledy (v paušálním režimu zůstáváš).',
    },
    {
      key: '20k',
      applicable: result.limits.employee20k.applicable,
      status: result.limits.employee20k.status,
      label: 'limit 20 000 Kč vedlejších příjmů',
      consequence: 'Při překročení za rok podáváš daňové přiznání.',
    },
    {
      key: '100k',
      // K6b-02: `true` natvrdo posílalo měřák „X ze 100 000" i poplatníkovi
      // s obchodním majetkem, který na osvobození podle § 4/1 t) nárok nemá
      // (R-02f) — v přehledu se přitom správně nezobrazoval.
      applicable: result.limits.limit100k.applicable,
      status: result.limits.limit100k,
      label: 'limit 100 000 Kč pro osvobození prodejů',
      // fakt bez imperativu: individualizovaný pokyn („zvaž, počkej“) je za
      // hranicí § 1 zákona 523/1992 Sb. (nález V-4 auditu) — rada patří leda
      // obecně do marketingu, ne do e-mailu s čísly konkrétního člověka
      consequence: 'Nad limit se daní prodeje bez splněného časového testu.',
    },
    {
      key: 'krypto100k',
      applicable: true,
      status: result.limits.cryptoLimit100k,
      label: 'limit 100 000 Kč pro osvobození krypta',
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
    add({
      dedupeKey: `limit|${event.key}|${thresholdKey(top)}|${year}`,
      type: breached ? 'LIMIT_EXCEEDED' : top >= 85 ? 'LIMIT_CRITICAL' : 'LIMIT_WARNING',
      urgent: breached,
      title: breached
        ? `Prolomen ${event.label}`
        : top >= 85
          ? `Blížíš se: ${event.label}`
          : `Za polovinou: ${event.label}`,
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
  const xmlDostupne = EPO_SUPPORTED_YEARS.includes(taxYear);
  const xmlSlib = xmlDostupne ? ' i XML pro mojedane.cz' : '';
  const xmlOdkaz = xmlDostupne ? ' — XML export najdeš v reportu' : '';
  const xmlVeta = xmlDostupne ? ' XML pro mojedane.cz vygeneruješ v reportu.' : '';
  const out: NotificationCandidate[] = [];
  if (hadActivityLastYear && today >= `${year}-01-01` && today <= `${year}-01-31`) {
    const deadlineNote = selfEmployed
      ? `Jako OSVČ máš datovou schránku zřízenou ze zákona, takže se přiznání podává jen elektronicky (§ 72 odst. 6 daňového řádu) — do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`
      : `Písemné přiznání se podává do ${czDate(paper)}, elektronické do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`;
    out.push({
      dedupeKey: `rocni|${taxYear}`,
      type: 'YEAR_SUMMARY',
      title: `Podklady za rok ${taxYear} jsou připravené`,
      body: `Daňový report za ${taxYear} máš hotový v aplikaci — čísla do přiznání, srovnání variant výpočtu${xmlSlib}. ${deadlineNote}`,
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
      body: `Písemné přiznání za rok ${taxYear} se podává do ${czDate(paper)}. Elektronické podání (mojedane.cz) má lhůtu do ${czDate(electronic)}${xmlOdkaz}.`,
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
      body: `Elektronické přiznání za rok ${taxYear} se podává do ${czDate(electronic)}.${xmlVeta}${extra}`,
    });
  }
  return out;
}

/**
 * Pravidelný přehled (měsíční/čtvrtletní): jediná událost, která vzniká i ve
 * chvíli, kdy se NIC nestalo — od toho je. Shrne, kde je uživatel s limity,
 * co ho nejdřív čeká a na kolik zatím vychází daň, aby nemusel nic otvírat.
 *
 * Období je součástí dedupe klíče, takže za měsíc (čtvrtletí) odejde nejvýš
 * jeden — i když cron poběží každý den. V titulku ale období NENÍ: přehled
 * odchází první den období a nese stav k tomu dni, takže „Přehled za srpen“
 * odeslaný 1. srpna by popisoval červenec. Je to snímek k datu, ne uzávěrka.
 */
export function summaryCandidate(args: {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  today: string;
  period: string;
}): NotificationCandidate {
  const { result, positions, labels, today, period } = args;

  const limits: Array<{ label: string; status: LimitStatus }> = [
    ...(result.limits.flatTax50k.applicable
      ? [{ label: 'limit 50 000 Kč pro paušální daň', status: result.limits.flatTax50k.status }]
      : []),
    ...(result.limits.employee20k.applicable
      ? [{ label: 'limit 20 000 Kč vedlejších příjmů', status: result.limits.employee20k.status }]
      : []),
    { label: 'limit 100 000 Kč pro osvobození prodejů', status: result.limits.limit100k },
    ...(result.limits.cryptoLimit100k.usedCzk.gt(0)
      ? [{ label: 'limit 100 000 Kč pro osvobození krypta', status: result.limits.cryptoLimit100k }]
      : []),
  ];
  const limitLines = limits.map(
    (limit) =>
      `${limit.label}: ${czk(limit.status.usedCzk)} z ${czk(limit.status.limitCzk)} (${pct(limit.status.ratio * 100)})`,
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

  const taxCzk =
    result.tax.recommended === 'GENERAL' ? result.tax.general.taxCzk : result.tax.separate16a.taxCzk;

  return {
    dedupeKey: `souhrn|${period}`,
    type: 'SUMMARY',
    title: `Přehled k ${czDate(today)}`,
    // fakt a čísla, žádný pokyn (V-4) — stejná pravidla jako u ostatních e-mailů
    body: `Stav k ${czDate(today)} za rok ${result.year}. ${limitLines.join('. ')}. ${nextLine} Orientační daň z investic zatím ${czk(taxCzk)}.`,
  };
}

/** Preference uživatele; chybějící řádek = vše zapnuté, denní souhrn (G8d, H3). */
export async function getNotificationPrefs(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId));
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
import type { EmailSender } from '@/lib/email';
export { resolveEmailSender, type EmailMessage, type EmailSender } from '@/lib/email';

/**
 * Denní běh pro jednoho uživatele: přepočet → nové události (do DB VŽDY,
 * přehled v aplikaci je úplný) → jeden digest e-mail podle preferencí
 * (typy + frekvence DAILY/WEEKLY). Idempotentní (druhý běh v den nic neposílá).
 */
export async function processUserNotifications(
  db: Db,
  target: { id: string; email: string },
  options: { send: EmailSender; today?: string },
): Promise<{ created: number; emailed: number }> {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const prefs = await getNotificationPrefs(db, target.id);
  const rules = notificationRules(prefs);

  let created = 0;
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

  // E-mailová fronta (H3) — čekající notifikace se dělí do tří tříd:
  // 1. odeslané v digestu → emailedAt (idempotence, druhý běh nic neposílá),
  // 2. potlačené preferencí (master vypnutý nebo vypnutý typ) → TAKY emailedAt
  //    (nesmí se hromadit — po zapnutí nesmí přijít měsíce staré události),
  // 3. čekající na týdenní okno (WEEKLY, digest byl nedávno) → NEoznačovat,
  //    pošlou se v příštím týdenním souhrnu.
  const pending = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, target.id), isNull(notifications.emailedAt)));
  const emailAllowed = (type: string): boolean => {
    if (!prefs.emailEnabled) return false;
    // pravidelný přehled má vlastní vypínač (kadenci) — a musí platit i pro
    // řádek, který už vznikl: kdo si přehled vypne den po jeho založení,
    // nesmí ho v nejbližším souhrnu přesto dostat
    if (type === 'SUMMARY') return rules.summaryFrequency !== 'OFF';
    if (type === 'YEAR_SUMMARY' || type === 'DEADLINE') return prefs.calendarEmails;
    return type.startsWith('TIME_TEST') ? prefs.timeTestEvents : prefs.limitEvents;
  };
  const suppressed = pending.filter((n) => !emailAllowed(n.type));
  const queue = pending.filter((n) => emailAllowed(n.type));

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
  const urgent = queue.some((n) => n.urgent);
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
      const lines = toSend.map((n) => `• ${n.title}\n  ${n.body}`).join('\n\n');
      const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
      const odhlasit = `${baseUrl}/api/odhlasit?token=${await unsubscribeToken(target.id)}`;
      try {
        await options.send({
          to: target.email,
          subject:
            toSend.length === 1
              ? `Danero: ${toSend[0]!.title}`
              : prefs.emailFrequency === 'WEEKLY'
                ? 'Danero: souhrn upozornění za týden'
                : `Danero: ${toSend.length} ${plural(toSend.length, 'nové upozornění', 'nová upozornění', 'nových upozornění')}`,
          // patička jde z lib/contact.ts — identifikace i kontakt na jednom místě,
          // ať se digest nerozejde s potvrzením objednávky (nález E-46)
          text: `${lines}\n\n—\nDetail najdeš v přehledu: ${baseUrl}/prehled\nDanero je výpočetní nástroj, nikoli daňové poradenství.\nOdhlásit e-mailová upozornění: ${odhlasit}\n\n${operatorSignature().slice(1).join('\n')}`,
          // RFC 8058: jednoklikové odhlášení. `/api/odhlasit` na to je připravené —
          // GET jen ptá (mail scannery nic nezmění), stav mění až POST, přesně
          // jak to jednoklik vyžaduje.
          headers: {
            'List-Unsubscribe': `<${odhlasit}>`,
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
        .insert(notificationPrefs)
        .values({ userId: target.id, lastDigestAt: todayDate })
        .onConflictDoUpdate({
          target: notificationPrefs.userId,
          set: { lastDigestAt: todayDate },
        });
    }
  }
  if (suppressed.length > 0) {
    // potlačené preferencí označit vždy (třída 2) — bez ohledu na týdenní okno
    await db
      .update(notifications)
      .set({ emailedAt: new Date() })
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

/** Všichni uživatelé pro cron (mají e-mail; profil se ověřuje uvnitř). */
export async function listNotificationTargets(db: Db): Promise<Array<{ id: string; email: string }>> {
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .innerJoin(taxpayerProfiles, eq(taxpayerProfiles.userId, user.id));
}
