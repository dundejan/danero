#!/usr/bin/env node
/**
 * Ruční ověření EPO XML proti OFICIÁLNÍ TESTOVACÍ podatelně finanční správy
 * (https://adisspr.mfcr.cz/dpr/epo_podani?test=1). V testovacím režimu se podání
 * nikdy nepřijme — podatelna jen vrátí seznam kontrol (<Chyby>). Úspěch =
 * jediná „chyba“ typu I se zkratkou TEST_REZIM, případně propustné P.
 *
 * V CI se rozlišuje návratovým kódem (2 = služba nedostupná, tolerujeme;
 * 1 = podatelna XML odmítla, padáme) — `continue-on-error` se NEPOUŽÍVÁ, tím by
 * se ztratilo i odmítnutí obsahu. Ručně: `pnpm validate:epo
 * [soubor.xml]`. Bez argumentu si skript vygeneruje vzorová podání pokrývající
 * i struktury, na kterých se to v auditu lámalo (prázdný rok, tuzemský prodej,
 * rok jen se ztrátou, ztrátový druh vedle ziskového a zápočet daně z úroku)
 * přes engine a apps/web/lib/epo.ts — proto se pouští přes tsx (viz root
 * package.json), který zvládne extensionless TS importy workspace balíčků.
 * ⚠️ A s `--tsconfig apps/web/tsconfig.json`: `lib/epo.ts` importuje přes alias
 * `@/`, který se bez toho z kořene repozitáře nerozliší (`Cannot find module
 * '@/lib/priloha2'`) a skript spadne dřív, než pošle první vzorek.
 */

const PODATELNA_URL = 'https://adisspr.mfcr.cz/dpr/epo_podani?test=1';

// Vyhodnocení odpovědi je v apps/web/lib/epo-submission.ts, aby na něj dosáhly
// testy — do tohohle skriptu žádný nedosáhne, a přitom právě ono rozhoduje,
// jestli CI spadne (K3-12).
const { CHECK_TYPE_LABELS, classifyResponse } = await import(
  new URL('../apps/web/lib/epo-submission.ts', import.meta.url)
);

/** Vrací 'ok' | 'rejected' | 'unreachable' — viz classifyResponse. */
async function submit(label, xml) {
  console.log(`\n=== ${label} → ${PODATELNA_URL}`);
  const res = await fetch(PODATELNA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body: xml,
  });
  const body = await res.text();
  const { verdict, checks, reason } = classifyResponse({ status: res.status, body });
  if (verdict === 'unreachable') {
    console.error(`  ⚠️ Ověření neproběhlo: ${reason}`);
    console.error(body.slice(0, 2000));
    return verdict;
  }
  for (const check of checks) {
    const where = [check.Polozka && `položka ${check.Polozka}`, check.Zkr].filter(Boolean).join(', ');
    console.log(
      `  [${check.Typ ?? '?'}] ${CHECK_TYPE_LABELS[check.Typ] ?? 'NEZNÁMÝ TYP KONTROLY'}${where ? ` (${where})` : ''}\n      ${check.text}`,
    );
  }
  console.log(
    verdict === 'ok'
      ? '  ✓ Bez věcných chyb — podání by ostrá podatelna přijala (TEST_REZIM je očekávaný).'
      : '  ✗ Podatelna hlásí věcné/strukturální chyby.',
  );
  return verdict;
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
  const emptyYear = analyzeTaxYear({
    transactions: parseTransactions([]),
    profile,
    config: TAX_YEAR_2025,
  });
  const domesticSale = analyzeTaxYear({
    transactions: parseTransactions([
      { type: 'BUY', id: 'cb', isin: 'CZ0005112300', quantity: '100', pricePerShare: '500', currency: 'CZK', tradeDate: '2024-02-01', settlementDate: '2024-02-05' },
      { type: 'SELL', id: 'cs', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1500', currency: 'CZK', tradeDate: '2025-04-01', settlementDate: '2025-04-03' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });
  const lossTxs = [
    { type: 'BUY', id: 'zb', isin: 'US5949181045', quantity: '100', pricePerShare: '200', currency: 'USD', tradeDate: '2024-02-01', settlementDate: '2024-02-05' },
    { type: 'SELL', id: 'zs', isin: 'US5949181045', quantity: '100', pricePerShare: '100', currency: 'USD', tradeDate: '2025-04-01', settlementDate: '2025-04-03' },
  ];
  const lossOnly = analyzeTaxYear({
    transactions: parseTransactions(lossTxs),
    profile,
    config: TAX_YEAR_2025,
  });
  // ztrátový druh (rozdíl 0) VEDLE ziskového — úhrn 4. sloupce Přílohy 2 se
  // sčítá jen z kladných hodnot, tahle kombinace to na podatelně ověří
  const mixedTypes = analyzeTaxYear({
    transactions: parseTransactions([
      ...lossTxs,
      { type: 'BUY', id: 'mb', isin: 'BTC', ticker: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '50000', currency: 'EUR', tradeDate: '2025-03-01' },
      { type: 'SELL', id: 'ms', isin: 'BTC', assetClass: 'CRYPTO', quantity: '1', pricePerShare: '60000', currency: 'EUR', tradeDate: '2025-06-15' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });

  // K3-01: § 16a u poplatníka, kterému zůstala nevyčerpaná sleva na poplatníka.
  // Vzorky výš to nepoznají — mají ř. 60 nad slevou (obě formule ř. 91 splynou).
  // Tenhle má ř. 60 = 0 a ř. 414 = 3 270 Kč, tedy zároveň pod slevou a nad
  // hranicí § 38b.
  const dividendNoWithholding = analyzeTaxYear({
    transactions: parseTransactions([
      { type: 'DIVIDEND', id: 'k3d', isin: 'IE00B4L5Y983', gross: '1000', withholdingTax: '0', currency: 'USD', sourceCountry: 'IE', date: '2025-05-10' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });
  // K3-02: daň 195 Kč, tedy uvnitř okna § 38b — ř. 91 musí být 0.
  const tinyTax = analyzeTaxYear({
    transactions: parseTransactions([
      { type: 'BUY', id: 'k2b', isin: 'CZ0005112300', quantity: '100', pricePerShare: '1000', currency: 'CZK', tradeDate: '2024-01-10', settlementDate: '2024-01-12' },
      { type: 'SELL', id: 'k2s', isin: 'CZ0005112300', quantity: '100', pricePerShare: '3069', currency: 'CZK', tradeDate: '2025-03-05', settlementDate: '2025-03-06' },
    ]),
    profile,
    config: TAX_YEAR_2025,
  });

  const gen = (label, res, varianta = 'GENERAL', extra = {}) => [
    label,
    generateDpfdp7({ year: 2025, result: res, personal, varianta, ...extra }).xml,
  ];
  return [
    gen('vzorek GENERAL (P2 + P3 zápočet)', result),
    gen('vzorek SEPARATE_16A (P2 + P4)', result, 'SEPARATE_16A'),
    gen('rok bez zdanitelných investičních příjmů (A3-01)', emptyYear),
    gen('čistě tuzemský prodej — kod10 bez „Z“ (A3-05)', domesticSale),
    gen('rok jen se ztrátovým prodejem (A3-13)', lossOnly),
    gen('ztrátový druh vedle ziskového — nulový rozdíl v tabulce (A3-13)', mixedTypes),
    gen('§ 16a s NEVYČERPANOU slevou na poplatníka (K3-01)', dividendNoWithholding, 'SEPARATE_16A'),
    gen('daň 195 Kč — uvnitř okna § 38b (K3-02)', tinyTax),
    // K3-07: samotný `dap_typ="D"` podatelna odmítne — kontroluje i vzorce
    // 6. oddílu (ř. 80 = ř. 79 − ř. 78, ř. 83 = ř. 82 − ř. 81).
    gen('opravné přiznání (K3-07)', result, 'GENERAL', { dapTyp: 'O' }),
    gen('dodatečné přiznání s 6. oddílem (K3-07)', result, 'GENERAL', {
      dapTyp: 'D',
      dodatecne: {
        zjistenoDne: '2026-08-05',
        posledniZnamaDanCzk: '100',
        posledniZnamaZtrataCzk: '0',
      },
    }),
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
 * E-3-14: kdyby měl krok v CI `continue-on-error`, ztratilo by se s výpadkem
 * sítě i ODMÍTNUTÍ podatelnou — zatímco landing i FAQ nesou odznak „XML ověřená
 * zkušební podatelnou“. Výpadek sítě a odmítnutí obsahu jsou dvě různé věci:
 * první se toleruje, druhá musí být vidět.
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
    // K3-12: „odmítla“ smí padnout jen na odpověď, ve které podatelna opravdu
    // vydala verdikt. HTTP 503 ani údržbová stránka vrácená se stavem 200
    // odmítnutí nejsou — a psát to do souhrnu běhu by byla nepravda.
    const verdict = await submit(label, xml);
    if (verdict === 'rejected') rejected += 1;
    else if (verdict === 'unreachable') unreachable += 1;
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
