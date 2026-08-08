import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '@/db';
import { importBatches, notifications, session, verification } from '@/db/schema';

/**
 * Denní retence provozních tabulek. Audit log si uklízí lib/audit.ts, okna
 * rate limitů lib/rate-limit.ts a joby lib/jobs.ts (poslední job na klíč nese
 * resume stav syncu, proto zůstává bez ohledu na stáří) — tady žije zbytek,
 * který dosud neuklízel nikdo a jen rostl.
 *
 * Pravidlo je všude stejné: smazat se smí jen to, co už nikdo nepotřebuje.
 * Kde by smazání rozbilo funkci, je retence delší a v komentáři je proč.
 */

/** Kolik řádků smaže jeden DELETE. */
const RETENTION_BATCH = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const daysBefore = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/**
 * Mazání po dávkách.
 *
 * `IN (…)` se všemi mazanými id spadne nad 65 534 parametry na
 * `MAX_PARAMETERS_EXCEEDED` — a protože pak nesmaže NIC, backlog už nikdy
 * neklesne a denní údržba je rozbitá natrvalo (audit G-R2: nad 70 002 joby
 * smazáno 0). Dávkování drží krátkou transakci, takže úklid neblokuje provoz,
 * a `returning` netahá statisíce řádků do paměti funkce naráz.
 */
export async function deleteInBatches(
  removeBatch: (limit: number) => Promise<unknown[]>,
): Promise<number> {
  let deleted = 0;
  for (;;) {
    const batch = await removeBatch(RETENTION_BATCH);
    deleted += batch.length;
    // kratší dávka = řádky došly (další DELETE by jen zbytečně zamykal)
    if (batch.length < RETENTION_BATCH) return deleted;
  }
}

/**
 * Prošlé přihlašovací relace. Session po `expiresAt` se přihlásit nedá — je to
 * jen záznam o dávno skončeném přihlášení, a /soukromi u záznamů o přihlášeních
 * slibuje 90 dní. Tabulka přitom roste nejrychleji ze všech (řádek na každé
 * přihlášení) a nemazalo ji nic.
 */
export function pruneSessions(db: Db, now = new Date()): Promise<number> {
  return deleteInBatches((limit) =>
    db
      .delete(session)
      .where(
        inArray(
          session.id,
          db
            .select({ id: session.id })
            .from(session)
            .where(lt(session.expiresAt, now))
            .limit(limit),
        ),
      )
      .returning({ id: session.id }),
  );
}

/**
 * Prošlé jednorázové tokeny Better Authu (ověření e-mailu, obnova hesla, změna
 * e-mailu). Po expiraci se s nimi nedá nic provést, ale drží e-mailovou
 * adresu i samotný token — držet je nemáme proč ani vteřinu navíc.
 */
export function pruneVerifications(db: Db, now = new Date()): Promise<number> {
  return deleteInBatches((limit) =>
    db
      .delete(verification)
      .where(
        inArray(
          verification.id,
          db
            .select({ id: verification.id })
            .from(verification)
            .where(lt(verification.expiresAt, now))
            .limit(limit),
        ),
      )
      .returning({ id: verification.id }),
  );
}

/**
 * Doručená upozornění hlídače.
 *
 * Retence je záměrně delší než u zbytku: dedupe klíč událostí o limitech nese
 * ROK (`limit|100k|EXCEEDED|2026`) a denní běh takovou událost umí po celý ten
 * rok založit znovu — kdyby se mezitím smazala, přijde uživateli druhý stejný
 * e-mail. Po 400 dnech je rok, kterého se událost týká, uzavřený a cron
 * (počítá vždy běžný rok) už ho nikdy nepřepočítá. Neodeslaná upozornění
 * (`emailedAt IS NULL`) čekají ve frontě na digest a nemažou se vůbec.
 */
export const NOTIFICATION_RETENTION_DAYS = 400;

export async function pruneNotifications(db: Db, now = new Date()): Promise<number> {
  const cutoff = daysBefore(now, NOTIFICATION_RETENTION_DAYS);
  // (userId, dedupeKey) je složený primární klíč, takže dávkování přes
  // `IN (poddotaz)` by chtělo řádkový konstruktor v syrovém SQL. Není proč:
  // mažou se jen odeslaná upozornění starší 400 dnů, což je po prvním běhu
  // denní přírůstek, ne backlog.
  const deleted = await db
    .delete(notifications)
    .where(and(lt(notifications.createdAt, cutoff), isNotNull(notifications.emailedAt)))
    .returning({ dedupeKey: notifications.dedupeKey });
  return deleted.length;
}

/**
 * Historie importů (/import). Je to čistě log: transakce na dávce nevisí —
 * i ruční „smazat záznam o importu" v UI je nechává na místě. Po 90 dnech
 * tedy platí totéž co pro audit log.
 */
export const IMPORT_BATCH_RETENTION_DAYS = 90;

export function pruneImportBatches(db: Db, now = new Date()): Promise<number> {
  const cutoff = daysBefore(now, IMPORT_BATCH_RETENTION_DAYS);
  return deleteInBatches((limit) =>
    db
      .delete(importBatches)
      .where(
        inArray(
          importBatches.id,
          db
            .select({ id: importBatches.id })
            .from(importBatches)
            .where(lt(importBatches.createdAt, cutoff))
            .limit(limit),
        ),
      )
      .returning({ id: importBatches.id }),
  );
}
