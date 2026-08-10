#!/usr/bin/env node
/**
 * Ruční ověření EPO XML proti OFICIÁLNÍ TESTOVACÍ podatelně finanční správy
 * (https://adisspr.mfcr.cz/dpr/epo_podani?test=1). V testovacím režimu se podání
 * nikdy nepřijme — podatelna jen vrátí seznam kontrol (<Chyby>). Úspěch =
 * jediná „chyba“ typu I se zkratkou TEST_REZIM, případně propustné P.
 *
 * V CI běží jako NEPOVINNÝ krok (`continue-on-error`) — závisí na cizí službě
 * a na síti, takže výpadek ADIS nesmí shodit build. Ručně: `pnpm validate:epo
 * [soubor.xml]`. Bez argumentu si skript vygeneruje vzorová podání pokrývající
 * i struktury, na kterých se to v auditu lámalo (prázdný rok, tuzemský prodej,
 * rok jen se ztrátou, ztrátový druh vedle ziskového a zápočet daně z úroku)
 * přes engine a apps/web/lib/epo.ts — proto se pouští přes tsx (viz root
 * package.json), který zvládne extensionless TS importy workspace balíčků.
 */

const PODATELNA_URL = 'https://adisspr.mfcr.cz/dpr/epo_podani?test=1';

/** Popis typů kontrol podatelny (dle dokumentace EPO). */
const TYP_POPIS = {
  S: 'strukturální chyba (XML neodpovídá struktuře písemnosti)',
  N: 'nepropustná/věcná chyba',
  K: 'kritická chyba',
  P: 'propustná chyba (upozornění)',
  I: 'informace',
};

/**
 * Typy, které podání NEBLOKUJÍ. Schválně allowlist, ne denylist: podatelna
 * vrací i typy, které jsme neznali (`K` nám takhle proklouzl a skript hlásil
 * „podání by ostrá podatelna přijala“ i u písemnosti se dvěma kritickými
 * chybami — nález A3-02). Neznámý typ je proto blokující, ne tichý průchod.
 */
const NEBLOKUJICI = new Set(['P', 'I']);

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
    const veca = !NEBLOKUJICI.has(ch.Typ);
    if (veca) ok = false;
    const kde = [ch.Polozka && `položka ${ch.Polozka}`, ch.Zkr].filter(Boolean).join(', ');
    console.log(
      `  [${ch.Typ ?? '?'}] ${TYP_POPIS[ch.Typ] ?? 'NEZNÁMÝ TYP KONTROLY'}${kde ? ` (${kde})` : ''}\n      ${ch.text}`,
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
    // úrok se srážkou ve státě, kde smlouva zdanění u zdroje dovoluje (JP, čl. 11)
    // → vlastní stát v Příloze 3 bez jediné dividendy (R-07f, nález A3-12)
    { type: 'INTEREST', id: 'i2', amount: '100', currency: 'USD', withholdingTax: '10', sourceCountry: 'JP', date: '2025-07-02' },
    // krypto nad 100k → zdanitelné, v P2 musí vzniknout druhý řádek VetaJ (kod C)
    { type: 'BUY', id: 'cb1', isin: 'BTC', ticker: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '50000', currency: 'EUR', tradeDate: '2025-03-01' },
    { type: 'SELL', id: 'cs1', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '60000', currency: 'EUR', tradeDate: '2025-06-15' },
    // deriváty → v P2 musí vzniknout třetí řádek VetaJ (kod F, R-12n)
    { type: 'BUY', id: 'db1', isin: 'OPT:AAPL-C200', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '1000', currency: 'USD', tradeDate: '2025-02-03' },
    { type: 'SELL', id: 'ds1', isin: 'OPT:AAPL-C200', assetClass: 'DERIVATIVE', quantity: '1', pricePerShare: '1500', currency: 'USD', tradeDate: '2025-06-10' },
  ]);
  const profile = TaxpayerProfileSchema.parse({ regime: 'PAUSAL' });
  const result = analyzeTaxYear({ transactions, profile, config: TAX_YEAR_2025 });
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
  // Dva vzorky nestačí: struktury, které podatelna odmítala, mezi nimi nebyly
  // (nález A3-02). Posíláme proto i ty, na kterých se to v auditu lámalo —
  // prázdný rok, čistě tuzemský prodej a rok jen se ztrátou.
  const prazdny = analyzeTaxYear({
    transactions: parseTransactions([]),
    profile,
    config: TAX_YEAR_2025,
  });
  const tuzemsky = analyzeTaxYear({
    transactions: parseTransactions([
      { type: 'BUY', id: 'cb', isin: 'CZ0005112300', quantity: '100', pricePerShare: '500', currency: 'CZK', tradeDate: '2024-02-01', settlementDate: '2024-02-05' },
      { type: 'SELL', id: 'cs', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1500', currency: 'CZK', tradeDate: '2025-04-01', settlementDate: '2025-04-03' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });
  const ztratove = [
    { type: 'BUY', id: 'zb', isin: 'US5949181045', quantity: '100', pricePerShare: '200', currency: 'USD', tradeDate: '2024-02-01', settlementDate: '2024-02-05' },
    { type: 'SELL', id: 'zs', isin: 'US5949181045', quantity: '100', pricePerShare: '100', currency: 'USD', tradeDate: '2025-04-01', settlementDate: '2025-04-03' },
  ];
  const ztrata = analyzeTaxYear({
    transactions: parseTransactions(ztratove),
    profile,
    config: TAX_YEAR_2025,
  });
  // ztrátový druh (rozdíl 0) VEDLE ziskového — úhrn 4. sloupce Přílohy 2 se
  // sčítá jen z kladných hodnot, tahle kombinace to na podatelně ověří
  const smisene = analyzeTaxYear({
    transactions: parseTransactions([
      ...ztratove,
      { type: 'BUY', id: 'mb', isin: 'BTC', ticker: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '50000', currency: 'EUR', tradeDate: '2025-03-01' },
      { type: 'SELL', id: 'ms', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '60000', currency: 'EUR', tradeDate: '2025-06-15' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });

  const gen = (label, res, varianta = 'GENERAL') => [
    label,
    generateDpfdp7({ year: 2025, result: res, personal, varianta }).xml,
  ];
  return [
    gen('vzorek GENERAL (P2 + P3 zápočet)', result),
    gen('vzorek SEPARATE_16A (P2 + P4)', result, 'SEPARATE_16A'),
    gen('rok bez zdanitelných investičních příjmů (A3-01)', prazdny),
    gen('čistě tuzemský prodej — kod10 bez „Z“ (A3-05)', tuzemsky),
    gen('rok jen se ztrátovým prodejem (A3-13)', ztrata),
    gen('ztrátový druh vedle ziskového — nulový rozdíl v tabulce (A3-13)', smisene),
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

/**
 * E-3-14: krok v CI má `continue-on-error`, protože závisí na cizí službě —
 * jenže tím se ztratilo i ODMÍTNUTÍ podatelnou, zatímco landing i FAQ nesou
 * odznak „XML ověřená zkušební podatelnou“. Výpadek sítě a odmítnutí obsahu
 * jsou dvě různé věci: první se toleruje, druhá musí být vidět.
 *
 * Rozlišujeme je návratovým kódem (2 = síť/služba nedostupná, 1 = podatelna
 * XML odmítla) a zápisem do souhrnu běhu, aby se odmítnutí nedalo přehlédnout
 * v tisícovce řádků logu.
 */
async function writeSummary(text) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(path, `${text}\n`);
}

let rejected = 0;
let unreachable = 0;
for (const [label, xml] of samples) {
  try {
    if (!(await submit(label, xml))) rejected += 1;
  } catch (error) {
    console.error(`  ✗ Odeslání selhalo (síť?): ${error?.message ?? error}`);
    unreachable += 1;
  }
}

if (rejected > 0) {
  await writeSummary(
    `### ❌ Zkušební podatelna odmítla ${rejected} z ${samples.length} vzorků XML\n` +
      'Landing i FAQ přitom tvrdí „XML ověřená zkušební podatelnou“. ' +
      'Než se to spraví, je to nepravdivé tvrzení — detaily v logu kroku.',
  );
  process.exit(1);
}
if (unreachable > 0) {
  await writeSummary(
    `### ⚠️ Zkušební podatelnu se nepodařilo oslovit (${unreachable} z ${samples.length})\n` +
      'Nejspíš výpadek ADIS nebo sítě — obsah XML tím ověřený NENÍ.',
  );
  process.exit(2);
}
await writeSummary(`### ✅ Zkušební podatelna přijala všech ${samples.length} vzorků XML`);
process.exit(0);
