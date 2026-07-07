import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LimitStatus, Position, TaxYearResult } from '@danero/engine';
import { diffDays } from '@danero/shared';
import type { Db } from '@/db';
import { notifications, taxpayerProfiles, user } from '@/db/schema';
import { czDate, czk, qty } from '@/lib/format';
import { analyzeForUser, getProfile, loadTransactions } from '@/lib/portfolio';

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
          body: `${amount} splní časový test ${czDate(lot.exemptFrom)}. Pokud plánuješ prodej, počkej — ušetříš daň z celého zisku.`,
        });
      }
      if (lot.isExempt && diffDays(lot.exemptFrom, today) <= 3) {
        add({
          dedupeKey: `ttdone|${position.isin}|${lot.exemptFrom}`,
          type: 'TIME_TEST_DONE',
          title: `${label}: osvobozeno 🎉`,
          body: `${amount} od ${czDate(lot.exemptFrom)} splňuje časový test — prodej je osvobozený od daně a nepočítá se do žádného limitu.`,
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
      consequence:
        'Nad limit se daní prodeje bez splněného časového testu — zvaž, zda další prodeje letos počkají.',
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
    await db.insert(notifications).values(fresh.map((c) => ({ userId, ...c })));
  }
  return fresh.length;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}
export type EmailSender = (message: EmailMessage) => Promise<void>;

/** Resend za env klíčem; bez něj dev log (žádný setup, nic se neposílá). */
export function resolveEmailSender(): EmailSender {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return async (message) => {
      console.info(`[email:dev] to=${message.to} | ${message.subject}\n${message.text}`);
    };
  }
  const from = process.env.RESEND_FROM ?? 'Danero <notifikace@danero.cz>';
  return async (message) => {
    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
  };
}

/**
 * Denní běh pro jednoho uživatele: přepočet → nové události → jeden digest
 * e-mail se vším neodeslaným. Idempotentní (druhý běh v den nic neposílá).
 */
export async function processUserNotifications(
  db: Db,
  target: { id: string; email: string },
  options: { send: EmailSender; today?: string },
): Promise<{ created: number; emailed: number }> {
  const profile = await getProfile(db, target.id);
  if (!profile) return { created: 0, emailed: 0 };
  const txs = await loadTransactions(db, target.id);
  if (txs.length === 0) return { created: 0, emailed: 0 };

  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const analysis = analyzeForUser(txs, profile, year, today);
  const candidates = computeNotificationCandidates({
    result: analysis.result,
    positions: analysis.positions,
    labels: analysis.labels,
    today,
  });
  const created = await syncNotifications(db, target.id, candidates);

  const unEmailed = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, target.id), isNull(notifications.emailedAt)));
  if (unEmailed.length > 0) {
    const lines = unEmailed.map((n) => `• ${n.title}\n  ${n.body}`).join('\n\n');
    await options.send({
      to: target.email,
      subject:
        unEmailed.length === 1
          ? `Danero: ${unEmailed[0]!.title}`
          : `Danero: ${unEmailed.length} nových upozornění`,
      text: `${lines}\n\n—\nDetail najdeš na svém přehledu. Danero je výpočetní nástroj, nikoli daňové poradenství.`,
    });
    await db
      .update(notifications)
      .set({ emailedAt: new Date() })
      .where(and(eq(notifications.userId, target.id), isNull(notifications.emailedAt)));
  }

  return { created, emailed: unEmailed.length };
}

/** Všichni uživatelé pro cron (mají e-mail; profil se ověřuje uvnitř). */
export async function listNotificationTargets(db: Db): Promise<Array<{ id: string; email: string }>> {
  return db
    .select({ id: user.id, email: user.email })
    .from(user)
    .innerJoin(taxpayerProfiles, eq(taxpayerProfiles.userId, user.id));
}
