/**
 * Vygeneruje ukázkové XML písemnosti DPFDP7 za rok 2025 z demo datasetu
 * (fiktivní poplatník „Ukázka Demo") do public/marketing/ — doložení pro
 * marketing/demo, že export z Danera je přesně soubor pro podatelnu
 * mojedane.cz. Čistý skript bez serveru i DB.
 *
 * Spuštění (z apps/web, tsx čte tsconfig s aliasem „@/"):
 *   pnpm exec tsx scripts/generate-demo-epo.ts
 *
 * „Dnešek" dema je PEVNÝ (2026-07-10), aby byl výstup reprodukovatelný —
 * rok 2025 je tak historický rok datasetu se zdanitelnými prodeji,
 * dividendami i zápočtem (Přílohy 2 a 3 mají co ukázat).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeTaxYear } from '@danero/engine';
import { demoDataset, demoToday } from '@/lib/demo-data';
import { generateDpfdp7 } from '@/lib/epo';
import { engineInputForUser } from '@/lib/portfolio';

const YEAR = 2025; // poslední rok s oficiální strukturou DPFDP7

const today = demoToday(new Date('2026-07-10T12:00:00Z'));
const { txs, profile } = demoDataset(today);
const result = analyzeTaxYear(engineInputForUser(txs, profile, YEAR));

const { xml } = generateDpfdp7({
  year: YEAR,
  result,
  // fiktivní osobní údaje — ať je na první pohled jasné, že jde o ukázku
  personal: { jmeno: 'Ukázka', prijmeni: 'Demo', obec: 'Praha' },
});

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'marketing');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `ukazka-dpfdp7-${YEAR}.xml`);
writeFileSync(outFile, xml);
console.log(`Ukázkové DPFDP7 zapsáno: ${outFile} (${xml.length} B)`);
