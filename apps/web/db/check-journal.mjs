/**
 * Kontrola pořadí migrací (M-3).
 *
 * Drizzle při migraci porovnává jen timestamp NEJNOVĚJŠÍ aplikované migrace,
 * nikdy hash — migrace se starším `when`, než má poslední aplikovaná, se tiše
 * přeskočí navždy a `drizzle-kit check` k tomu řekne „Everything's fine“.
 * Stane se to pokaždé, když dva lidé vygenerují migraci paralelně a dřív
 * vygenerovaná se mergne později: na čerstvé databázi (dev, CI, PGlite) se
 * aplikuje, na produkci ne.
 *
 *   node db/check-journal.mjs [cesta/k/_journal.json]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const journalPath = process.argv[2] ?? join(import.meta.dirname, 'migrations/meta/_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const entries = journal.entries ?? [];
const problems = [];

if (entries.length === 0) problems.push('Žurnál migrací je prázdný.');

entries.forEach((entry, index) => {
  if (entry.idx !== index) {
    problems.push(`Migrace ${entry.tag}: idx ${entry.idx} neodpovídá pořadí v žurnálu (${index}).`);
  }
  const prefix = Number(String(entry.tag).slice(0, 4));
  if (prefix !== index) {
    problems.push(`Migrace ${entry.tag}: číslo v názvu neodpovídá pořadí v žurnálu (${index}).`);
  }
  const previous = entries[index - 1];
  if (previous && !(entry.when > previous.when)) {
    problems.push(
      `Migrace ${entry.tag} má when ${entry.when}, což není víc než ${previous.when} u ${previous.tag}. ` +
        'Drizzle by ji na produkci tiše přeskočil — vygeneruj ji znovu (nebo when zvyš ručně).',
    );
  }
});

// soubory a žurnál si musí odpovídat: migrace bez záznamu se nikdy nespustí,
// záznam bez souboru migraci shodí
const dir = join(dirname(journalPath), '..');
const files = new Set(readdirSync(dir).filter((name) => name.endsWith('.sql')));
for (const entry of entries) {
  if (!files.delete(`${entry.tag}.sql`)) problems.push(`Chybí soubor migrace ${entry.tag}.sql.`);
}
for (const orphan of files) problems.push(`Migrace ${orphan} není v žurnálu — nikdy se nespustí.`);

if (problems.length > 0) {
  console.error('Žurnál migrací není v pořádku:');
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}
console.log(`Žurnál migrací je v pořádku (${entries.length} migrací, when roste).`);
