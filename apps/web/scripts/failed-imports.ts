/**
 * Rozbor výpisů, které Danero nepřečetlo (`lib/failed-imports.ts`).
 *
 * Nástroj pro provozovatele, ne pro uživatele: originál nahraného souboru je
 * jediný způsob, jak doplnit formát, který jsme nepoznali. Upozornění o novém
 * případu chodí e-mailem, tohle je druhá půlka — dostat se k souboru, opravit
 * parser a výpis uživateli doimportovat.
 *
 * Spuštění (z apps/web; proti produkci s DATABASE_URL v prostředí):
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts list
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts dump <id> [adresář]
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts retry <id>
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts retry-all
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts reject <id> "důvod"
 *
 * ⚠️ Bez `DATABASE_URL` sáhne na lokální PGlite — ta snese **jediné připojení**,
 * takže souběžně běžící dev server skript zablokuje (a naopak).
 *
 * `retry` běží pod skutečným userId, takže dedupe i číselník aliasů fungují
 * normálně: opakované spuštění nic nezdvojí a uživateli přijde e-mail jen
 * tehdy, když se import povedl.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, gte } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditLog, importBatches } from '@/db/schema';
import { listOpenCases, loadCase, resolveCase } from '@/lib/failed-imports';
import { importFile } from '@/lib/import-service';

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.error(
    'Použití: failed-imports list | dump <id> [adresář] | retry <id> | retry-all | reject <id> "důvod"',
  );
  process.exit(1);
}

/** Povinný argument — chybějící id případu je překlep, ne prázdná hodnota. */
function required(index: number): string {
  return args[index] ?? usage();
}

/** „0 kB“ vypadá jako prázdný soubor, a to je jiná diagnóza. */
const velikost = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;

async function list(): Promise<void> {
  const db = await getDb();
  const cases = await listOpenCases(db);
  if (cases.length === 0) {
    console.log('Žádné otevřené případy.');
    return;
  }
  for (const item of cases) {
    console.log(
      [
        `${item.id}  ${item.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`,
        `  soubor:    ${item.filename} (${velikost(item.byteSize)})`,
        `  uživatel:  ${item.email}`,
        `  platforma: ${item.reportedPlatform ?? '— (uživatel nenahlásil)'}`,
        ...(item.reportedNote ? [`  poznámka:  ${item.reportedNote}`] : []),
        `  důvod:     ${item.reason}`,
      ].join('\n'),
    );
    console.log('');
  }
  console.log(`Celkem ${cases.length}.`);
}

async function dump(caseId: string, dir = '.data/failed-imports'): Promise<void> {
  const db = await getDb();
  const item = await loadCase(db, caseId);
  if (!item) {
    console.error(`Případ ${caseId} neexistuje.`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  // id v názvu: dva uživatelé nahrají „transactions.csv“ a přepsaly by se
  const path = join(dir, `${item.id}-${item.filename.replace(/[^\w.-]+/g, '_')}`);
  writeFileSync(path, Buffer.from(item.data));
  console.log(`Zapsáno: ${path} (${item.byteSize} B)`);
  console.log(`Důvod:   ${item.reason}`);
  console.log(`Hlásil:  ${item.reportedPlatform ?? '—'} ${item.reportedNote ?? ''}`);
}

/**
 * Zkusí případ naimportovat znovu (typicky po opravě parseru).
 *
 * Jde přes `importFile`, ne `importFileIsolated`: to druhé při neúspěchu
 * schová soubor ZNOVU a případ přepíše na právě vzniklou dávku — panel by
 * uživateli přeskočil na záznam, který sám nenahrál. Neúspěšný pokus tady po
 * sobě uklidí i tu prázdnou dávku, takže v historii uživatele nezůstane nic.
 */
async function retry(caseId: string): Promise<void> {
  const db = await getDb();
  const item = await loadCase(db, caseId);
  if (!item) {
    console.error(`Případ ${caseId} neexistuje.`);
    process.exit(1);
  }
  const startedAt = new Date();
  const summary = await importFile(db, item.userId, item.filename, item.data);
  const nothingImported = summary.added === 0 && summary.duplicates === 0;
  if (summary.unrecognized || nothingImported) {
    await db.delete(importBatches).where(eq(importBatches.id, summary.batchId));
    // `importParsed` zapíše audit ještě před dávkou, takže po neúspěchu zbývá
    // uživateli v Nastavení „Import výpisu“ souboru, který sám nenahrál
    await db
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.userId, item.userId),
          eq(auditLog.type, 'IMPORT'),
          gte(auditLog.createdAt, startedAt),
        ),
      );
    console.log(
      `${caseId}: ${summary.unrecognized ? 'pořád nepoznáváme' : 'projde, ale nic z něj nevypadlo'}` +
        ` — ${summary.errors[0]?.message ?? 'bez hlášky'}`,
    );
    return;
  }
  await resolveCase(db, caseId, {
    status: 'fixed',
    batchId: summary.batchId,
    added: summary.added,
  });
  console.log(
    `${caseId}: hotovo — ${summary.added} nových, ${summary.duplicates} duplicit, ` +
      `${summary.errors.length} chyb. Uživateli (${item.email}) odešel e-mail.`,
  );
}

async function retryAll(): Promise<void> {
  const db = await getDb();
  const cases = await listOpenCases(db);
  console.log(`Zkouším ${cases.length} případů…`);
  // Jeden poškozený soubor (importFile na rozdíl od importFileIsolated vyhazuje)
  // ani neodeslaný e-mail nesmí zbytek fronty tiše přeskočit.
  let failed = 0;
  for (const item of cases) {
    try {
      await retry(item.id);
    } catch (error) {
      failed += 1;
      console.error(`${item.id}: pokus spadl — ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed > 0) console.error(`Neúspěšných pokusů: ${failed} z ${cases.length}.`);
}

async function reject(caseId: string, note: string): Promise<void> {
  const db = await getDb();
  const item = await loadCase(db, caseId);
  if (!item) {
    console.error(`Případ ${caseId} neexistuje.`);
    process.exit(1);
  }
  await resolveCase(db, caseId, { status: 'rejected', note });
  console.log(`${caseId}: uzavřeno jako nečitelné. Uživateli (${item.email}) odešel e-mail.`);
}

// obal místo top-level await: apps/web není ESM balík, takže tsx tenhle
// soubor překládá do CJS a top-level await by se do něj nevešel
async function main(): Promise<void> {
  switch (command) {
    case 'list':
      return list();
    case 'dump':
      return dump(required(0), args[1]);
    case 'retry':
      return retry(required(0));
    case 'retry-all':
      return retryAll();
    case 'reject':
      // Bez vysvětlení případ nezavírej: uživatel dostane e-mail „číst to neumíme“
      // a jediné, co mu pomůže, je věta o tom, co má stáhnout místo toho.
      return reject(required(0), required(1));
    default:
      usage();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
