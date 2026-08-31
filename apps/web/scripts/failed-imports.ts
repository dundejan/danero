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
 *   pnpm --filter @danero/web exec tsx scripts/failed-imports.ts delete <id>
 *
 * ⚠️ `retry`, `retry-all` a `reject` **posílají e-mail uživateli**, takže kromě
 * `DATABASE_URL` potřebují i `DANERO_OPERATOR_NAME`, `DANERO_OPERATOR_ICO`,
 * `DANERO_OPERATOR_ADDRESS`, `DANERO_CONTACT_EMAIL` a `BETTER_AUTH_URL`
 * (a `RESEND_API_KEY`, jinak se zpráva neodešle). Bez nich se skript zastaví
 * dřív, než cokoli udělá — do 4. auditu se místo toho odeslala zpráva
 * podepsaná „Danero — nenastaveno" s odkazem na localhost (K2-04).
 * `list`, `dump` a `delete` nic neposílají a jedou i bez nich: prohlídnout si
 * případ nebo vyhovět žádosti o výmaz nemá blokovat chybějící IČO.
 *
 * ⚠️ Bez `DATABASE_URL` sáhne na lokální PGlite — ta snese **jediné připojení**,
 * takže souběžně běžící dev server skript zablokuje (a naopak).
 *
 * `retry` běží pod skutečným userId, takže dedupe i číselník aliasů fungují
 * normálně: opakované spuštění nic nezdvojí a uživateli přijde e-mail jen
 * tehdy, když se import povedl. Uzavřený případ (`fixed`/`rejected`) už žádný
 * podpříkaz kromě `delete` nevezme — druhý pokus by uživateli poslal druhý
 * e-mail o výpisu, který je dávno vyřízený (K2-05).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from '@/db';
import { eraseCase, rejectCase, retryCase } from '@/lib/failed-import-review';
import { caseOverview, listOpenCases, loadOpenCase } from '@/lib/failed-imports';
import { emailEnvError, missingEmailEnv } from '@/lib/operator-env';

const [command, ...args] = process.argv.slice(2);

function usage(): never {
  console.error(
    'Použití: failed-imports list | dump <id> [adresář] | retry <id> | retry-all |' +
      ' reject <id> "důvod" | delete <id>',
  );
  process.exit(1);
}

/** Povinný argument — chybějící id případu je překlep, ne prázdná hodnota. */
function required(index: number): string {
  return args[index] ?? usage();
}

/**
 * Předletová kontrola: bez identifikace provozovatele a bez adresy aplikace
 * by odchozí zpráva vypadala jako phishing. Volá se PŘED jakoukoli změnou dat,
 * ať se běh nezastaví v půlce.
 */
function requireEmailEnv(): void {
  const missing = missingEmailEnv();
  if (missing.length === 0) return;
  console.error(emailEnvError(missing));
  process.exit(1);
}

/** „0 kB“ vypadá jako prázdný soubor, a to je jiná diagnóza. */
const velikost = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} kB`;

/** Hláška k případu, na který se nedá sáhnout. Stav v ní být musí — bez něj je rada k ničemu. */
function reportUnavailable(caseId: string, result: { outcome: 'missing' } | { outcome: 'closed'; status: string }): never {
  console.error(
    result.outcome === 'missing'
      ? `Případ ${caseId} neexistuje.`
      : `Případ ${caseId} je už uzavřený (stav ${result.status}) — soubor k němu` +
          ' nemáme a uživateli o něm e-mail už odešel. Otevřené případy vypíše „list“.',
  );
  process.exit(1);
}

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
  const item = await loadOpenCase(db, caseId);
  if (!item) {
    // uzavřený případ obsah nemá (maže se při uzavření) — hláška to musí říct
    const overview = await caseOverview(db, caseId);
    reportUnavailable(
      caseId,
      overview ? { outcome: 'closed', status: overview.status } : { outcome: 'missing' },
    );
  }
  mkdirSync(dir, { recursive: true });
  // id v názvu: dva uživatelé nahrají „transactions.csv“ a přepsaly by se
  const path = join(dir, `${item.id}-${item.filename.replace(/[^\w.-]+/g, '_')}`);
  writeFileSync(path, Buffer.from(item.data));
  console.log(`Zapsáno: ${path} (${item.byteSize} B)`);
  console.log(`Důvod:   ${item.reason}`);
  console.log(`Hlásil:  ${item.reportedPlatform ?? '—'} ${item.reportedNote ?? ''}`);
}

async function retry(caseId: string): Promise<void> {
  const db = await getDb();
  const result = await retryCase(db, caseId);
  if (result.outcome === 'missing' || result.outcome === 'closed') reportUnavailable(caseId, result);
  if (result.outcome === 'unresolved') {
    console.log(
      `${caseId}: ${result.unrecognized ? 'pořád nepoznáváme' : 'projde, ale nic z něj nevypadlo'}` +
        ` — ${result.reason ?? 'bez hlášky'}`,
    );
    return;
  }
  const { summary } = result;
  console.log(
    `${caseId}: hotovo — ${summary.added} nových, ${summary.duplicates} duplicit, ` +
      `${summary.errors.length} chyb. Uživateli (${result.email}) odešel e-mail.`,
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
  const result = await rejectCase(db, caseId, note);
  if (result.outcome !== 'rejected') reportUnavailable(caseId, result);
  console.log(
    `${caseId}: uzavřeno jako nečitelné. Uživateli (${result.email}) odešel e-mail,` +
      ' uschovaný soubor jsme smazali.',
  );
}

async function erase(caseId: string): Promise<void> {
  const db = await getDb();
  const result = await eraseCase(db, caseId);
  if (result.outcome === 'missing') {
    console.error(`Případ ${caseId} neexistuje.`);
    process.exit(1);
  }
  console.log(
    `${caseId}: smazáno i s uschovaným souborem (${result.filename}, uživatel ${result.email}).` +
      ' E-mail se neposílá — o výmaz požádal sám.',
  );
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
      requireEmailEnv();
      return retry(required(0));
    case 'retry-all':
      requireEmailEnv();
      return retryAll();
    case 'reject':
      // Bez vysvětlení případ nezavírej: uživatel dostane e-mail „číst to neumíme“
      // a jediné, co mu pomůže, je věta o tom, co má stáhnout místo toho.
      requireEmailEnv();
      return reject(required(0), required(1));
    case 'delete':
      return erase(required(0));
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
