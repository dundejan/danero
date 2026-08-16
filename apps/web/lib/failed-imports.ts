import { createHash } from 'node:crypto';
import { firstLine, printableSample } from '@danero/importers';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { failedImports, user } from '@/db/schema';
import {
  alertRecipient,
  failedImportAlertEmail,
  failedImportResolvedEmail,
  resolveEmailSender,
} from '@/lib/email';
import { errorText, logEvent } from '@/lib/log';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Nepřečtené výpisy — originál si necháme, ať jde formát doplnit.
 *
 * Podpora brokerů vznikla proti fixturám a proti jednomu reálnému účtu. Co
 * doopravdy chodí ostatním, se pozná až z jejich souborů — a ty se do 13. 8. 2026
 * zahazovaly: uživatel dostal „Formát souboru nepoznáváme“ a tím to skončilo.
 * Nepoznaná hlavička není výjimka, takže o ní nevěděl ani log.
 *
 * Ukládá se **jen podmnožina selhání** — ta, kde může být vada na naší straně
 * (rozhoduje o tom příznak `unrecognized` v `lib/import-service.ts`). Prázdný
 * soubor ani PDF si neschováváme: tam je hláška návodná a chyba je jinde.
 */

/**
 * Kolik otevřených případů unese jeden uživatel. Soubor smí mít 4 MB
 * (`MAX_FILE_BYTES`), takže strop drží i nejhorší případ pod ~20 MB — a víc
 * než pět různých nečitelných výpisů stejně znamená, že je problém jinde.
 */
export const MAX_OPEN_CASES_PER_USER = 5;

/**
 * Strop velikosti schovávaného souboru.
 *
 * Ruční nahrání je omezené na 4 MB už formulářem, ale export stažený z API
 * brokera je, co broker pošle — a base64 z něj udělá o třetinu víc v jediném
 * řádku. Nad tímhle se soubor neschová (v logu je proč): dvacetimegový výpis
 * v databázi neopraví formát o nic líp než hlášení bez souboru.
 */
const MAX_KEPT_BYTES = 8 * 1024 * 1024;

/** Kolik znaků hlavičky posíláme do upozornění (obsah souboru NIKDY). */
const HEADER_SAMPLE_CHARS = 200;

/**
 * Limity e-mailů per uživatel a den. Automatické upozornění a hlášení od
 * uživatele mají VLASTNÍ kbelík schválně: kdyby sdílely jeden, uživatel s pěti
 * nečitelnými výpisy by ho vyčerpal automatikou a jeho vlastní hlášení — tedy
 * jediná informace, která případ dělá řešitelným — by se zahodilo, zatímco UI
 * mu slibuje „ozveme se".
 */
const ALERT_LIMITS = {
  auto: { key: 'import-alert', max: 3, windowMs: 24 * 60 * 60_000 },
  reported: { key: 'import-report', max: 5, windowMs: 24 * 60 * 60_000 },
} as const;

export interface FailedImportCase {
  id: string;
  userId: string;
  batchId: string;
  filename: string;
  byteSize: number;
  reason: string;
  reportedPlatform: string | null;
  reportedNote: string | null;
  reportedAt: Date | null;
  /** `upload` (uživatel nahrál) nebo `sync` (stáhli jsme si sami z API brokera). */
  source: string;
  status: string;
  resolutionNote: string | null;
  resolvedBatchId: string | null;
  createdAt: Date;
}

const sha256 = (data: ArrayBuffer): string =>
  createHash('sha256').update(new Uint8Array(data)).digest('hex');

/**
 * První řádek souboru pro upozornění. Dekóduje se jako UTF-8 i u binárního
 * smetí (přejmenovaný .xls) — `printableSample` řídicí znaky vyhodí, takže se
 * hlavička nemůže obtisknout do e-mailu syrová.
 */
function headerSample(data: ArrayBuffer): string {
  const text = new TextDecoder().decode(data.slice(0, 4096));
  // konec řádku hledej i u samotného `\r` (Excel pro Mac) — jinak je „hlavička“
  // celý soubor a do e-mailu by se dostaly řádky s obchody
  return printableSample(firstLine(text), HEADER_SAMPLE_CHARS);
}

/**
 * Schová nepřečtený soubor a upozorní provozovatele.
 *
 * Nikdy nevyhazuje: zachycení je doplňková služba, ne součást importu —
 * kdyby spadlo, uživatel už má dávku uloženou a hlášku zobrazenou.
 */
export async function keepFailedUpload(
  db: Db,
  args: {
    userId: string;
    batchId: string;
    filename: string;
    data: ArrayBuffer;
    reason: string;
    /** `sync` = stažené z API brokera; pak známe i platformu a nemáme se nač ptát. */
    source?: 'upload' | 'sync';
    /** Platforma, je-li známá bez ptaní (sync). */
    platform?: string;
  },
): Promise<string | null> {
  try {
    if (args.data.byteLength > MAX_KEPT_BYTES) {
      logEvent('warn', 'failed_import.too_large', {
        filename: args.filename,
        byteSize: args.data.byteLength,
      });
      return null;
    }
    const contentHash = sha256(args.data);
    // Strop platí jen pro NOVÝ případ. Kdyby se počítal i u souboru, který už
    // svůj případ má, pátý otevřený případ by zablokoval i pouhé přepnutí
    // existujícího případu na čerstvou dávku — a panel „pracujeme na tom“ by
    // uživateli visel u staršího importu než toho, který má před očima.
    const [known] = await db
      .select({ id: failedImports.id })
      .from(failedImports)
      .where(
        and(eq(failedImports.userId, args.userId), eq(failedImports.contentHash, contentHash)),
      );
    if (!known) {
      const open = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(failedImports)
        .where(and(eq(failedImports.userId, args.userId), eq(failedImports.status, 'open')));
      if ((open[0]?.count ?? 0) >= MAX_OPEN_CASES_PER_USER) {
        logEvent('warn', 'failed_import.cap_reached', { userId: args.userId });
        return null;
      }
    }

    // Týž soubor podruhé je pořád JEDEN případ (klíč je otisk obsahu) — jinak
    // by opakované nahrání nasbíralo pět kopií a strop by padl na jediný výpis.
    // Případ se ale přepne na novou dávku, ať panel visí u toho importu, který
    // má uživatel před očima; uzavřeného případu se to netýká.
    const [saved] = await db
      .insert(failedImports)
      .values({
        id: crypto.randomUUID(),
        userId: args.userId,
        batchId: args.batchId,
        filename: args.filename,
        byteSize: args.data.byteLength,
        contentHash,
        content: Buffer.from(args.data).toString('base64'),
        reason: args.reason,
        source: args.source ?? 'upload',
        reportedPlatform: args.platform ?? null,
      })
      .onConflictDoUpdate({
        target: [failedImports.userId, failedImports.contentHash],
        set: { batchId: args.batchId, filename: args.filename, reason: args.reason },
        setWhere: eq(failedImports.status, 'open'),
      })
      .returning({ id: failedImports.id, notifiedAt: failedImports.notifiedAt });
    if (!saved) return null;

    // upozornění na týž soubor podruhé provozovateli neposílej — ví o něm
    if (saved.notifiedAt === null) await sendAlert(db, saved.id, headerSample(args.data), 'auto');
    return saved.id;
  } catch (error) {
    logEvent('error', 'failed_import.keep_failed', {
      filename: args.filename,
      error: errorText(error),
    });
    return null;
  }
}

/**
 * Upozornění provozovateli. Vlastní try/catch: nedoručený e-mail nesmí shodit
 * import ani hlášení uživatele, ale musí být vidět v logu.
 */
async function sendAlert(
  db: Db,
  caseId: string,
  sample: string,
  kind: keyof typeof ALERT_LIMITS,
): Promise<void> {
  try {
    const to = alertRecipient();
    if (!to) {
      logEvent('warn', 'failed_import.no_alert_recipient', { caseId });
      return;
    }
    const [row] = await db
      .select({
        id: failedImports.id,
        userId: failedImports.userId,
        filename: failedImports.filename,
        byteSize: failedImports.byteSize,
        reason: failedImports.reason,
        reportedPlatform: failedImports.reportedPlatform,
        reportedNote: failedImports.reportedNote,
        reportedAt: failedImports.reportedAt,
        email: user.email,
      })
      .from(failedImports)
      .innerJoin(user, eq(user.id, failedImports.userId))
      .where(eq(failedImports.id, caseId));
    if (!row) return;

    const limit = ALERT_LIMITS[kind];
    if (!(await checkRateLimit(db, `${limit.key}:${row.userId}`, limit))) {
      logEvent('warn', 'failed_import.alert_rate_limited', { caseId, kind });
      return;
    }

    await resolveEmailSender()({
      to,
      ...failedImportAlertEmail({
        caseId: row.id,
        filename: row.filename,
        byteSize: row.byteSize,
        reason: row.reason,
        headerSample: sample,
        userEmail: row.email,
        reportedPlatform: row.reportedPlatform,
        reportedNote: row.reportedNote,
        reported: row.reportedAt !== null,
      }),
    });
    await db
      .update(failedImports)
      .set({ notifiedAt: new Date() })
      .where(eq(failedImports.id, caseId));
  } catch (error) {
    logEvent('error', 'failed_import.alert_failed', { caseId, error: errorText(error) });
  }
}

/** Nejdelší poznámka od uživatele — delší text patří do e-mailu, ne do formuláře. */
export const MAX_NOTE_CHARS = 500;

/**
 * Uživatel doplnil, odkud výpis je. Provozovateli o tom jde druhé upozornění —
 * teprve tohle je informace, se kterou se dá formát dohledat.
 *
 * Prázdné hlášení se **neuloží**: `reportedAt` schová formulář natrvalo, takže
 * jedno omylem odeslané prázdno by uživatele připravilo o jedinou možnost, jak
 * nám tu informaci dát, a provozovateli by přišlo druhé upozornění bez jediného
 * nového údaje. Uzavřený případ se taky nehlásí — hlásit se dá jen to, co ještě
 * čeká.
 */
export type ReportOutcome = 'ok' | 'prazdne' | 'neexistuje';

export async function reportFailedImport(
  db: Db,
  userId: string,
  caseId: string,
  input: { platform: string; note: string },
): Promise<ReportOutcome> {
  const platform = input.platform.trim().slice(0, 120);
  const note = input.note.trim().slice(0, MAX_NOTE_CHARS);
  if (!platform && !note) return 'prazdne';

  const [updated] = await db
    .update(failedImports)
    .set({
      reportedPlatform: platform || null,
      reportedNote: note || null,
      reportedAt: new Date(),
    })
    .where(
      and(
        eq(failedImports.id, caseId),
        eq(failedImports.userId, userId),
        eq(failedImports.status, 'open'),
      ),
    )
    .returning({ id: failedImports.id, content: failedImports.content });
  if (!updated) return 'neexistuje';

  await sendAlert(db, updated.id, headerSample(base64ToArrayBuffer(updated.content)), 'reported');
  return 'ok';
}

/** Sloupce případu bez obsahu souboru — ten se čte jen tam, kde je opravdu potřeba. */
const CASE_COLUMNS = {
  id: failedImports.id,
  userId: failedImports.userId,
  batchId: failedImports.batchId,
  filename: failedImports.filename,
  byteSize: failedImports.byteSize,
  reason: failedImports.reason,
  reportedPlatform: failedImports.reportedPlatform,
  reportedNote: failedImports.reportedNote,
  reportedAt: failedImports.reportedAt,
  source: failedImports.source,
  status: failedImports.status,
  resolutionNote: failedImports.resolutionNote,
  resolvedBatchId: failedImports.resolvedBatchId,
  createdAt: failedImports.createdAt,
} as const;

/** Případy k dávkám, které stránka /import zrovna vypisuje. */
export async function casesForBatches(
  db: Db,
  userId: string,
  batchIds: string[],
): Promise<Map<string, FailedImportCase>> {
  if (batchIds.length === 0) return new Map();
  const rows = await db
    .select(CASE_COLUMNS)
    .from(failedImports)
    .where(and(eq(failedImports.userId, userId), inArray(failedImports.batchId, batchIds)));
  return new Map(rows.map((row) => [row.batchId, row]));
}

export const base64ToArrayBuffer = (value: string): ArrayBuffer => {
  const buffer = Buffer.from(value, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

/* ── Rozbor: čte a uzavírá je skript `scripts/failed-imports.ts` ──────────── */

/** Otevřené případy, nejnovější první (pro výpis v nástroji provozovatele). */
export async function listOpenCases(db: Db): Promise<Array<FailedImportCase & { email: string }>> {
  return db
    .select({ ...CASE_COLUMNS, email: user.email })
    .from(failedImports)
    .innerJoin(user, eq(user.id, failedImports.userId))
    .where(eq(failedImports.status, 'open'))
    .orderBy(desc(failedImports.createdAt));
}

/** Jeden případ i s obsahem souboru (obsah nikam jinam nechodí). */
export async function loadCase(
  db: Db,
  caseId: string,
): Promise<(FailedImportCase & { email: string; data: ArrayBuffer }) | null> {
  const [row] = await db
    .select({ ...CASE_COLUMNS, content: failedImports.content, email: user.email })
    .from(failedImports)
    .innerJoin(user, eq(user.id, failedImports.userId))
    .where(eq(failedImports.id, caseId));
  if (!row) return null;
  const { content, ...rest } = row;
  return { ...rest, data: base64ToArrayBuffer(content) };
}

/**
 * Uzavře případ a dá o tom vědět uživateli.
 *
 * E-mail jde PŘÍMO, ne přes digest `api/cron/notify` — ten běží jen platícím,
 * takže uživatel zdarma by se výsledek vlastního nahrání nikdy nedozvěděl.
 */
export async function resolveCase(
  db: Db,
  caseId: string,
  outcome: { status: 'fixed' | 'rejected'; note?: string; batchId?: string; added?: number },
): Promise<boolean> {
  const [row] = await db
    .update(failedImports)
    .set({
      status: outcome.status,
      resolutionNote: outcome.note ?? null,
      resolvedBatchId: outcome.batchId ?? null,
      resolvedAt: new Date(),
    })
    .where(eq(failedImports.id, caseId))
    .returning({ id: failedImports.id, filename: failedImports.filename, userId: failedImports.userId });
  if (!row) return false;

  const [target] = await db.select({ email: user.email }).from(user).where(eq(user.id, row.userId));
  if (!target) return true;

  await resolveEmailSender()({
    to: target.email,
    ...failedImportResolvedEmail({
      filename: row.filename,
      outcome: outcome.status,
      added: outcome.added,
      note: outcome.note,
    }),
  });
  return true;
}
