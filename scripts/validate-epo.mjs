#!/usr/bin/env node
/**
 * Ruční ověření EPO XML proti OFICIÁLNÍ TESTOVACÍ podatelně finanční správy
 * (https://adisspr.mfcr.cz/dpr/epo_podani?test=1). V testovacím režimu se podání
 * nikdy nepřijme — podatelna jen vrátí seznam kontrol (<Chyby>). Úspěch =
 * jediná „chyba" typu I se zkratkou TEST_REZIM, případně propustné P.
 *
 * NENÍ součást CI (vyžaduje síť) — spouštěj ručně: `pnpm validate:epo [soubor.xml]`.
 * Bez argumentu si skript vygeneruje vzorová podání (GENERAL i SEPARATE_16A)
 * přes engine a apps/web/lib/epo.ts — proto se pouští přes tsx (viz root
 * package.json), který zvládne extensionless TS importy workspace balíčků.
 */

const PODATELNA_URL = 'https://adisspr.mfcr.cz/dpr/epo_podani?test=1';

/** Popis typů kontrol podatelny (dle dokumentace EPO). */
const TYP_POPIS = {
  S: 'strukturální chyba (XML neodpovídá struktuře písemnosti)',
  N: 'nepropustná/věcná chyba',
  P: 'propustná chyba (upozornění)',
  I: 'informace',
};

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Vytáhne kontroly z odpovědi <Chyby><Chyba Polozka=".." Typ=".." Zkr=".."><Text>…</Text></Chyba>… */
function parseChyby(xml) {
  const chyby = [];
  for (const m of xml.matchAll(/<Chyba\b([^>]*)>\s*<Text>([\s\S]*?)<\/Text>/g)) {
    const attrs = Object.fromEntries(
      [...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, decodeEntities(v)]),
    );
    chyby.push({ ...attrs, text: decodeEntities(m[2].trim()) });
  }
  return chyby;
}

async function submit(label, xml) {
  console.log(`\n=== ${label} → ${PODATELNA_URL}`);
  const res = await fetch(PODATELNA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}\n${body.slice(0, 2000)}`);
    return false;
  }
  const chyby = parseChyby(body);
  if (chyby.length === 0) {
    console.log('Podatelna nevrátila žádné kontroly — surová odpověď:');
    console.log(body.slice(0, 2000));
    return false;
  }
  let ok = true;
  for (const ch of chyby) {
    const veca = ch.Typ === 'S' || ch.Typ === 'N';
    if (veca) ok = false;
    const kde = [ch.Polozka && `položka ${ch.Polozka}`, ch.Zkr].filter(Boolean).join(', ');
    console.log(
      `  [${ch.Typ ?? '?'}] ${TYP_POPIS[ch.Typ] ?? ''}${kde ? ` (${kde})` : ''}\n      ${ch.text}`,
    );
  }
  console.log(
    ok
      ? '  ✓ Bez věcných chyb — podání by ostrá podatelna přijala (TEST_REZIM je očekávaný).'
      : '  ✗ Podatelna hlásí věcné/strukturální chyby.',
  );
  return ok;
}

/** Vzorové podání: reálný průchod enginem (prodej CP + dividendy US/DE + úrok). */
async function buildSamples() {
  const { parseTransactions, TaxpayerProfileSchema } = await import(
    new URL('../packages/shared/src/index.ts', import.meta.url)
  );
  const { analyzeTaxYear, TAX_YEAR_2025 } = await import(
    new URL('../packages/engine/src/index.ts', import.meta.url)
  );
  const { generateDpfdp7 } = await import(new URL('../apps/web/lib/epo.ts', import.meta.url));

  const transactions = parseTransactions([
    { type: 'BUY', id: 'b1', isin: 'US0378331005', ticker: 'AAPL', quantity: '100', pricePerShare: '100', currency: 'USD', tradeDate: '2024-01-10', settlementDate: '2024-01-12' },
    { type: 'SELL', id: 's1', isin: 'US0378331005', quantity: '100', pricePerShare: '150', currency: 'USD', tradeDate: '2025-03-05', settlementDate: '2025-03-06' },
    { type: 'DIVIDEND', id: 'd1', isin: 'US0378331005', gross: '1000', withholdingTax: '150', currency: 'USD', date: '2025-05-10' },
    { type: 'DIVIDEND', id: 'd2', isin: 'DE0007164600', gross: '100', withholdingTax: '30', currency: 'EUR', date: '2025-06-01' },
    { type: 'INTEREST', id: 'i1', amount: '10', currency: 'USD', sourceCountry: 'US', date: '2025-07-01' },
    // krypto nad 100k → zdanitelné, v P2 musí vzniknout druhý řádek VetaJ (kod C)
    { type: 'BUY', id: 'cb1', isin: 'BTC', ticker: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '50000', currency: 'EUR', tradeDate: '2025-03-01' },
    { type: 'SELL', id: 'cs1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '60000', currency: 'EUR', tradeDate: '2025-06-15' },
  ]);
  const result = analyzeTaxYear({
    transactions,
    profile: TaxpayerProfileSchema.parse({ regime: 'PAUSAL' }),
    config: TAX_YEAR_2025,
  });
  // fiktivní testovací identita (stejná jako v empiricky ověřených vzorech)
  const personal = {
    dic: '8501011233',
    rodneCislo: '8501011233',
    prijmeni: 'Testovací',
    jmeno: 'Jan',
    ulice: 'Testovací',
    cisloPopisne: '1',
    obec: 'Praha 1',
    psc: '11000',
    ufoCil: '451',
    pracUfo: '2001',
  };
  return [
    ['vzorek GENERAL (P2 + P3 zápočet)', generateDpfdp7({ year: 2025, result, personal, varianta: 'GENERAL' }).xml],
    ['vzorek SEPARATE_16A (P2 + P4)', generateDpfdp7({ year: 2025, result, personal, varianta: 'SEPARATE_16A' }).xml],
  ];
}

const fileArg = process.argv[2];
let samples;
if (fileArg) {
  const { readFile } = await import('node:fs/promises');
  samples = [[fileArg, await readFile(fileArg, 'utf8')]];
} else {
  samples = await buildSamples();
}

let allOk = true;
for (const [label, xml] of samples) {
  try {
    if (!(await submit(label, xml))) allOk = false;
  } catch (error) {
    console.error(`  ✗ Odeslání selhalo (síť?): ${error?.message ?? error}`);
    allOk = false;
  }
}
process.exit(allOk ? 0 : 1);
