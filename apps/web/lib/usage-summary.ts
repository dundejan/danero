import { and, count, eq, exists, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/db';
import { brokerAccounts, failedImports, importBatches, transactions, user } from '@/db/schema';
import {
  alertRecipient,
  composeMessage,
  resolveEmailSender,
  type EmailMessage,
  type EmailSender,
} from '@/lib/email';
import { now as clockNow, TAX_TIME_ZONE, today } from '@/lib/clock';
import { errorText, logEvent } from '@/lib/log';
import { checkRateLimit, releaseRateLimit } from '@/lib/rate-limit';

/**
 * Týdenní souhrn používání pro provozovatele (K11 z plánu propagace).
 *
 * Proč existuje: bez něj nejde poznat, jestli propagace něco přivedla —
 * aplikace nemá admin ani statistiky a sahat kvůli počtu registrací do
 * produkční databáze je zbytečné riziko. Souhrn proto jednou týdně pošle na
 * `DANERO_ALERT_EMAIL` (jinak na kontakt provozovatele, `alertRecipient`)
 * **jen počty**: žádné adresy, jména ani identifikátory účtů. Agregát není
 * osobní údaj, takže se nemění nic z toho, co popisuje `/soukromi`.
 *
 * Posílá se z denního cronu údržby, jen v pondělí (`isSummaryDay`). Cron se
 * na Vercelu spouští kdykoli během zadané hodiny a výjimečně i dvakrát, proto
 * odeslání hlídá claim v tabulce limitů (`checkRateLimit` s `max: 1`). Při
 * selhání se claim vrací, takže druhé spuštění téhož pondělí to zkusí znovu;
 * v úterý už podmínka dne neprojde a souhrn za ten týden vypadne. Je to vědomá
 * cena za jednoduchost: chybějící týden je vidět (a selhání je v logu jako
 * error), zdvojený souhrn by mátl.
 */

/** Klíč claimu v `app_rate_limits`. */
export const USAGE_SUMMARY_CLAIM = 'usage-summary:weekly';

/** Šest dní: delší než dvojí běh téhož dne, kratší než týden do dalšího pondělí. */
const CLAIM_WINDOW_MS = 6 * 24 * 60 * 60_000;

const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface UsageSummary {
  /** Začátek sledovaného týdne (včetně). */
  from: Date;
  /** Konec sledovaného týdne (bez). */
  to: Date;
  /** Účty založené v týdnu. */
  signups: number;
  /** …z nich s potvrzeným e-mailem. */
  signupsVerified: number;
  /** …z nich s daty: aspoň jedna transakce nebo napojený broker. */
  signupsWithData: number;
  /** Všechny účty k `to`. */
  accounts: number;
  accountsVerified: number;
  accountsWithData: number;
  /** Napojené brokerské účty (API klíč) celkem a nové v týdnu. */
  brokerConnections: number;
  brokerConnectionsNew: number;
  /** Importy (dávky) v týdnu — ruční nahrání i synchronizace. */
  imports: number;
  /** Výpisy, které jsme v týdnu nepřečetli. */
  failedImports: number;
}

/**
 * Účet s daty = aspoň jedna transakce, nebo napojený broker (sync může ještě
 * běžet) — obojí vzniklé před koncem týdne `to`, ať „ke konci týdne“ platí
 * i tady. Bez meze by se data nahraná v pondělí ráno, před odesláním,
 * připsala minulému týdnu.
 */
function hasData(db: Db, to: Date): SQL {
  return or(
    exists(
      db
        .select({ one: sql`1` })
        .from(transactions)
        .where(and(eq(transactions.userId, user.id), lt(transactions.createdAt, to))),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(brokerAccounts)
        .where(and(eq(brokerAccounts.userId, user.id), lt(brokerAccounts.createdAt, to))),
    ),
  ) as SQL;
}

async function countUsers(db: Db, where: SQL | undefined): Promise<number> {
  const [row] = await db.select({ n: count() }).from(user).where(where);
  return row?.n ?? 0;
}

/** Odchylka pražského času od UTC v daném okamžiku, v milisekundách. */
function pragueOffsetMs(instant: Date): number {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: TAX_TIME_ZONE,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '');
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -minutes : minutes) * 60_000;
}

/**
 * Pražská půlnoc dne `iso` jako okamžik. Odchylku bere z UTC půlnoci téhož
 * dne: přechod na letní čas i zpět je až v 1:00 UTC, takže se obě půlnoci
 * vždy shodnou v odchylce.
 */
function pragueMidnight(iso: string): Date {
  const utcMidnight = new Date(`${iso}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - pragueOffsetMs(utcMidnight));
}

/**
 * Kalendářní týden po–ne v pražském čase, který skončil poslední půlnocí před
 * `now`. V pondělí ráno, kdy běží cron, je to právě uplynulý týden.
 */
export function previousWeek(now: Date): { from: Date; to: Date } {
  const todayIso = today(now);
  const weekAgoIso = new Date(new Date(`${todayIso}T12:00:00Z`).getTime() - WEEK_MS)
    .toISOString()
    .slice(0, 10);
  return { from: pragueMidnight(weekAgoIso), to: pragueMidnight(todayIso) };
}

/**
 * Počty za týden po–ne před `now` (`previousWeek`). Jen čtení; data se berou,
 * jak jsou — smazané účty v nich nejsou (řádky zmizely i s nimi), takže
 * „celkem“ je stav ke konci týdne, ne součet všech registrací v historii.
 */
export async function computeUsageSummary(db: Db, now: Date): Promise<UsageSummary> {
  const { from, to } = previousWeek(now);
  const createdInWeek = and(gte(user.createdAt, from), lt(user.createdAt, to));
  const createdBefore = lt(user.createdAt, to);
  const verified = eq(user.emailVerified, true);

  const [signups, signupsVerified, signupsWithData] = await Promise.all([
    countUsers(db, createdInWeek),
    countUsers(db, and(createdInWeek, verified)),
    countUsers(db, and(createdInWeek, hasData(db, to))),
  ]);
  const [accounts, accountsVerified, accountsWithData] = await Promise.all([
    countUsers(db, createdBefore),
    countUsers(db, and(createdBefore, verified)),
    countUsers(db, and(createdBefore, hasData(db, to))),
  ]);

  const [[brokerTotal], [brokerNew], [importRows], [failedRows]] = await Promise.all([
    db.select({ n: count() }).from(brokerAccounts).where(lt(brokerAccounts.createdAt, to)),
    db
      .select({ n: count() })
      .from(brokerAccounts)
      .where(and(gte(brokerAccounts.createdAt, from), lt(brokerAccounts.createdAt, to))),
    db
      .select({ n: count() })
      .from(importBatches)
      .where(and(gte(importBatches.createdAt, from), lt(importBatches.createdAt, to))),
    db
      .select({ n: count() })
      .from(failedImports)
      .where(and(gte(failedImports.createdAt, from), lt(failedImports.createdAt, to))),
  ]);

  return {
    from,
    to,
    signups,
    signupsVerified,
    signupsWithData,
    accounts,
    accountsVerified,
    accountsWithData,
    brokerConnections: brokerTotal?.n ?? 0,
    brokerConnectionsNew: brokerNew?.n ?? 0,
    imports: importRows?.n ?? 0,
    failedImports: failedRows?.n ?? 0,
  };
}

const dayMonth = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: TAX_TIME_ZONE,
  day: 'numeric',
  month: 'numeric',
});

/** „2. 11.–8. 11.“ — poslední den je den PŘED `to` (interval je polootevřený). */
function periodLabel(summary: UsageSummary): string {
  const lastDay = new Date(summary.to.getTime() - 1);
  return `${dayMonth.format(summary.from)}–${dayMonth.format(lastDay)}`;
}

/** „3 (2 potvrzené, 1 s daty)“ — podíl rovnou vedle čísla, ať se nepočítá z hlavy. */
const share = (part: number, whole: number): string =>
  whole === 0 ? '0 %' : `${Math.round((part / whole) * 100)} %`;

export function usageSummaryEmail(summary: UsageSummary): Omit<EmailMessage, 'to'> {
  const period = periodLabel(summary);
  return composeMessage({
    subject: `Danero: týden v číslech (${period})`,
    preheader: `Nové účty: ${summary.signups}, s daty: ${summary.signupsWithData}.`,
    blocks: [
      { kind: 'h', text: `Za týden ${period}` },
      {
        kind: 'rows',
        rows: [
          ['Nové účty', String(summary.signups)],
          [
            'Potvrdily e-mail',
            `${summary.signupsVerified} (${share(summary.signupsVerified, summary.signups)})`,
          ],
          [
            'Nahrály data nebo napojily brokera',
            `${summary.signupsWithData} (${share(summary.signupsWithData, summary.signups)})`,
          ],
          ['Nově napojení brokeři', String(summary.brokerConnectionsNew)],
          ['Importy (nahrání i synchronizace)', String(summary.imports)],
          ['Nepřečtené výpisy', String(summary.failedImports)],
        ],
      },
      { kind: 'h', text: 'Celkem ke konci týdne' },
      {
        kind: 'rows',
        rows: [
          ['Účty', String(summary.accounts)],
          [
            'S potvrzeným e-mailem',
            `${summary.accountsVerified} (${share(summary.accountsVerified, summary.accounts)})`,
          ],
          [
            'S daty',
            `${summary.accountsWithData} (${share(summary.accountsWithData, summary.accounts)})`,
          ],
          ['Napojení brokeři', String(summary.brokerConnections)],
        ],
      },
      {
        kind: 'note',
        text: 'Jen počty, bez osobních údajů. Smazané účty v číslech nejsou. „S daty“ znamená aspoň jednu transakci nebo napojeného brokera; kdo se registroval v neděli, data často nahraje až další týden.',
      },
    ],
    footer: ['Danero — provozní souhrn pro provozovatele, chodí každé pondělí, uživatelům ne.'],
  });
}

/** Pondělí v Praze. Cron údržby běží v 1:00 UTC, tedy ve 2–3 h pražského času. */
export function isSummaryDay(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TAX_TIME_ZONE,
    weekday: 'short',
  }).format(now);
  return weekday === 'Mon';
}

export type UsageSummaryOutcome = 'sent' | 'not-today' | 'already-sent' | 'no-recipient' | 'failed';

/**
 * Pošle souhrn, je-li pondělí a nebyl-li tento týden už odeslaný. Výjimku ven
 * nepouští: cron údržby má úklid dat jako hlavní úkol a nedoručený souhrn ho
 * nesmí shodit. Selhání jde do logu a do výsledku (`failed`).
 *
 * Co tím nepokryjeme: když funkce skončí na časovém limitu mezi claimem
 * a odesláním, claim zůstane a souhrn za týden tiše chybí; když se ztratí
 * jen odpověď Resendu, claim se vrátí a druhý běh téhož dne pošle souhrn
 * podruhé. Obojí je u provozního e-mailu přijatelné.
 */
export async function sendWeeklyUsageSummary(
  db: Db,
  now: Date = clockNow(),
  send?: EmailSender,
): Promise<UsageSummaryOutcome> {
  if (!isSummaryDay(now)) return 'not-today';
  const to = alertRecipient();
  if (!to) {
    logEvent('warn', 'usage_summary.no_recipient');
    return 'no-recipient';
  }
  let claimed: boolean;
  try {
    claimed = await checkRateLimit(db, USAGE_SUMMARY_CLAIM, {
      max: 1,
      windowMs: CLAIM_WINDOW_MS,
    });
  } catch (error) {
    // claim nevznikl, takže není co vracet
    logEvent('error', 'usage_summary.failed', { error: errorText(error) });
    return 'failed';
  }
  if (!claimed) return 'already-sent';
  try {
    const summary = await computeUsageSummary(db, now);
    await (send ?? resolveEmailSender())({ to, ...usageSummaryEmail(summary) });
    logEvent('info', 'usage_summary.sent', {
      signups: summary.signups,
      signupsWithData: summary.signupsWithData,
    });
    return 'sent';
  } catch (error) {
    await releaseRateLimit(db, USAGE_SUMMARY_CLAIM).catch(() => undefined);
    logEvent('error', 'usage_summary.failed', { error: errorText(error) });
    return 'failed';
  }
}
