import { and, eq, inArray, isNull } from 'drizzle-orm';
import { filingDeadlines, type LimitStatus, type Position, type TaxYearResult } from '@danero/engine';
import { addDays, diffDays } from '@danero/shared';
import type { Db } from '@/db';
import { notificationPrefs, notifications, taxpayerProfiles, user } from '@/db/schema';
import { czDate, czk, plural, qty } from '@/lib/format';
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
}

/**
 * Události hlídače (docs/05 F4): blížící se osvobození pozic (30/7 dní),
 * čerstvě osvobozené pozice a vstup limitů do pásem CRITICAL/EXCEEDED.
 * Dedupe klíč zajistí, že každá událost vznikne jen jednou (per pozice+datum,
 * per limit+pásmo+rok).
 */
export function computeNotificationCandidates(args: {
  result: TaxYearResult;
  positions: Position[];
  labels: Map<string, string>;
  today: string;
}): NotificationCandidate[] {
  const { result, positions, labels, today } = args;
  const out = new Map<string, NotificationCandidate>();
  const add = (candidate: NotificationCandidate) => {
    if (!out.has(candidate.dedupeKey)) out.set(candidate.dedupeKey, candidate);
  };

  for (const position of positions) {
    const label = labels.get(position.isin) ?? position.isin;
    for (const lot of position.lots) {
      const amount = `${qty(lot.remaining)} ks ${label}`;
      if (!lot.isExempt && lot.daysToExempt <= 30 && lot.daysToExempt > 7) {
        add({
          dedupeKey: `tt30|${position.isin}|${lot.exemptFrom}`,
          type: 'TIME_TEST_30',
          title: `${label}: osvobození za ${lot.daysToExempt} dní`,
          body: `${amount} splní tříletý časový test ${czDate(lot.exemptFrom)} — od té doby je prodej bez daně.`,
        });
      }
      if (!lot.isExempt && lot.daysToExempt <= 7) {
        add({
          dedupeKey: `tt7|${position.isin}|${lot.exemptFrom}`,
          type: 'TIME_TEST_7',
          title: `${label}: osvobození už za ${lot.daysToExempt} ${lot.daysToExempt === 1 ? 'den' : 'dní'}`,
          // fakt + termín, žádný imperativ („počkej“) — individualizovaný pokyn
          // by se blížil radě dle § 1 zákona 523/1992 Sb. (nález V-4 právního auditu)
          body: `${amount} splní časový test ${czDate(lot.exemptFrom)}. Prodej po tomto datu bude od daně osvobozený — před ním se zisk daní celý.`,
        });
      }
      if (lot.isExempt && diffDays(lot.exemptFrom, today) <= 3) {
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
      applicable: true,
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
    if (event.status.zone === 'EXCEEDED') {
      add({
        dedupeKey: `limit|${event.key}|EXCEEDED|${year}`,
        type: 'LIMIT_EXCEEDED',
        title: `Prolomen ${event.label}`,
        body: `${usage}. ${event.consequence}`,
      });
    } else if (event.status.zone === 'CRITICAL') {
      add({
        dedupeKey: `limit|${event.key}|CRITICAL|${year}`,
        type: 'LIMIT_CRITICAL',
        title: `Blížíš se: ${event.label}`,
        body: `${usage} — přes 85 %. ${event.consequence}`,
      });
    } else if (event.status.zone === 'WARNING') {
      // web slibuje e-mail při 60, 85 a 100 % — 60% pásmo musí reálně existovat
      // (nález verifikace průvodce: dřív vznikaly události až od 85 %)
      add({
        dedupeKey: `limit|${event.key}|WARNING|${year}`,
        type: 'LIMIT_WARNING',
        title: `Za polovinou: ${event.label}`,
        body: `${usage} — přes 60 %. ${event.consequence}`,
      });
    }
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
  const { today, hadActivityLastYear, selfEmployed = false } = args;
  const year = Number(today.slice(0, 4));
  const taxYear = year - 1;
  const { paper, electronic, advisor } = filingDeadlines(taxYear);
  const out: NotificationCandidate[] = [];
  if (hadActivityLastYear && today >= `${year}-01-01` && today <= `${year}-01-31`) {
    const deadlineNote = selfEmployed
      ? `Jako OSVČ máš datovou schránku zřízenou ze zákona, takže se přiznání podává jen elektronicky (§ 72 odst. 6 daňového řádu) — do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`
      : `Písemné přiznání se podává do ${czDate(paper)}, elektronické do ${czDate(electronic)}, s daňovým poradcem do ${czDate(advisor)}.`;
    out.push({
      dedupeKey: `rocni|${taxYear}`,
      type: 'YEAR_SUMMARY',
      title: `Podklady za rok ${taxYear} jsou připravené`,
      body: `Daňový report za ${taxYear} máš hotový v aplikaci — čísla do přiznání, srovnání variant výpočtu i XML pro mojedane.cz. ${deadlineNote}`,
    });
  }
  // okna upomínek končí PŘESNĚ dnem termínu, ne pevným datem — jinak poslední
  // dny před termínem nepřijde nic zrovna tomu, kdo ještě nepodal
  if (!selfEmployed && hadActivityLastYear && today >= addDays(paper, -17) && today <= paper) {
    out.push({
      dedupeKey: `termin|papir|${year}`,
      type: 'DEADLINE',
      title: `Blíží se termín přiznání: ${czDate(paper)}`,
      body: `Písemné přiznání za rok ${taxYear} se podává do ${czDate(paper)}. Elektronické podání (mojedane.cz) má lhůtu do ${czDate(electronic)} — XML export najdeš v reportu.`,
    });
  }
  if (hadActivityLastYear && today >= addDays(electronic, -17) && today <= electronic) {
    const extra = selfEmployed
      ? ' Jako OSVČ podáváš přiznání jen elektronicky (§ 72 odst. 6 daňového řádu). Vedle přiznání se za stejné období podávají přehledy ČSSZ a zdravotní pojišťovně; Danero je nesleduje.'
      : '';
    out.push({
      dedupeKey: `termin|elektronicky|${year}`,
      type: 'DEADLINE',
      title: `Blíží se termín elektronického přiznání: ${czDate(electronic)}`,
      body: `Elektronické přiznání za rok ${taxYear} se podává do ${czDate(electronic)}. XML pro mojedane.cz vygeneruješ v reportu.${extra}`,
    });
  }
  return out;
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
    }
  );
}

/**
 * Podepsaný odhlašovací token (HMAC přes BETTER_AUTH_SECRET) — odkaz v e-mailu
 * funguje bez přihlášení, ale nejde zfalšovat pro cizí účet.
 */
export async function unsubscribeToken(userId: string): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const { resolveSecret } = await import('@/lib/auth');
  const sig = createHmac('sha256', resolveSecret()).update(`unsub|${userId}`).digest('hex');
  return `${Buffer.from(userId).toString('base64url')}.${sig}`;
}

export async function verifyUnsubscribeToken(token: string): Promise<string | null> {
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const userId = Buffer.from(encoded, 'base64url').toString('utf8');
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const { resolveSecret } = await import('@/lib/auth');
  const expected = createHmac('sha256', resolveSecret()).update(`unsub|${userId}`).digest('hex');
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? userId : null;
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
      const candidates = [
        ...computeNotificationCandidates({
          result: analysis.result,
          positions: analysis.positions,
          labels: analysis.labels,
          today,
        }),
        ...calendarCandidates({
          today,
          hadActivityLastYear: txs.some((tx) =>
            ('tradeDate' in tx ? tx.tradeDate : tx.date).startsWith(lastYearPrefix),
          ),
          // § 72 odst. 6 DŘ: OSVČ má datovou schránku ze zákona → jen elektronicky (E-23)
          selfEmployed: profile.regime === 'PAUSAL' || profile.regime === 'OSVC',
        }),
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
  const windowOpen = sinceLastMs >= (prefs.emailFrequency === 'WEEKLY' ? 6.5 : 0.5) * DAY_MS;

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
          text: `${lines}\n\n—\nDetail najdeš v přehledu: ${baseUrl}/prehled\nDanero je výpočetní nástroj, nikoli daňové poradenství.\nOdhlásit e-mailová upozornění: ${odhlasit}\n\nJan Dunder, IČO 19642661, Žitomírská 640/3, 101 00 Praha 10`,
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
