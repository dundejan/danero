import { desc, eq } from 'drizzle-orm';
import { SyncJobProgress, type SyncJobView } from '@/components/sync-job-progress';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label } from '@/components/ui/field';
import { getDb } from '@/db';
import { brokerAccounts, importBatches } from '@/db/schema';
import {
  syncStatusLabel,
  type BrokerAccountRow,
  type StoredReconciliation,
} from '@/lib/broker-sync';
import { loadAliases } from '@/lib/instrument-aliases';
import type { UnmappedSymbol } from '@/lib/import-service';
import { activeSyncJobsByAccount, toSyncJobView } from '@/lib/jobs';
import { requireUser } from '@/lib/session';
import { Toast } from '@/components/toast';
import { FileField } from '@/components/ui/file-field';
import { plural } from '@/lib/format';
import {
  deleteBatchAction,
  disconnectBrokerAction,
  saveAliasesAction,
  saveIbkrKeyAction,
  saveTrading212KeyAction,
  syncBrokerAction,
  uploadImportAction,
} from './actions';

export const metadata = { title: 'Zdroje dat — Danero' };

interface BatchIssues {
  errors?: Array<{ line: number; message: string }>;
  warnings?: Array<{ line: number; message: string }>;
  unmapped?: UnmappedSymbol[];
}

interface BrokerCopy {
  firstSync: string;
  regular: string;
  buttonFirst: string;
  note?: string;
}

/** Neutrální default — broker bez vlastních textů nesmí dostat cizí instrukce. */
const DEFAULT_COPY: BrokerCopy = {
  firstSync: 'Synchronizace stáhne historii od brokera a poběží na pozadí.',
  regular: 'Stahuje se aktuální historie od brokera.',
  buttonFirst: 'Synchronizovat',
};

/** Broker-specifické texty sync karty. */
const BROKER_COPY: Record<string, BrokerCopy> = {
  trading212: {
    firstSync:
      'První synchronizace projde všechny roky od založení účtu — kvůli limitům Trading212 může trvat i deset minut. Poběží na pozadí, průběh uvidíš tady.',
    regular: 'Stahuje se běžný rok; kompletní historie proběhla při prvním spuštění.',
    buttonFirst: 'Stáhnout kompletní historii',
    note: 'Trading212 ti k tomu pošle notifikace „dokumenty připraveny ke stažení“ — to jsme my, klidně je ignoruj.',
  },
  ibkr: {
    firstSync:
      'Synchronizace stáhne období nastavené ve Flex Query (typicky posledních 365 dní) a poběží na pozadí. Starší historii nahraj jednorázově jako XML soubory níž — nic se nezdvojí.',
    regular: 'Stahuje se období nastavené ve Flex Query (typicky posledních 365 dní).',
    buttonFirst: 'Synchronizovat',
  },
};

/** Připojený broker: stav synchronizace + spuštění + rekonciliace + odpojení. */
function ConnectedBroker({
  account,
  activeJob,
}: {
  account: BrokerAccountRow;
  activeJob: SyncJobView | null;
}) {
  const reconciliation = (account.lastReconciliation ?? null) as StoredReconciliation | null;
  const copy = BROKER_COPY[account.broker] ?? DEFAULT_COPY;

  if (activeJob) {
    return <SyncJobProgress initialJob={activeJob} accountId={account.id} broker={account.label} />;
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-inkoust-tlumeny">
          <span className="font-semibold text-zelena">Připojeno.</span>{' '}
          {account.lastSyncedAt
            ? `Naposledy ${account.lastSyncedAt.toLocaleString('cs-CZ')} (${syncStatusLabel(account.lastSyncStatus)}). ${copy.regular}`
            : copy.firstSync}{' '}
          {copy.note}
        </p>
        <form action={syncBrokerAction}>
          <input type="hidden" name="accountId" value={account.id} />
          <SubmitButton variant="secondary" pendingLabel="Spouštím…">
            {account.lastSyncedAt ? 'Synchronizovat teď' : copy.buttonFirst}
          </SubmitButton>
        </form>
      </div>
      {reconciliation && (
        <div className="space-y-1 border-t border-linka pt-3">
          {reconciliation.ok ? (
            <p className="text-sm font-medium text-zelena">
              Pozice sedí s {account.label} ({reconciliation.matchedCount}{' '}
              {plural(reconciliation.matchedCount, 'instrument', 'instrumenty', 'instrumentů')}).
            </p>
          ) : reconciliation.error ? (
            <>
              <p className="text-sm font-medium text-cervena">
                Synchronizace selhala: {reconciliation.error}
              </p>
              <p className="text-sm text-inkoust-tlumeny">
                Klidně ji spusť znovu — co už se stáhlo, zůstává, a nic se nezdvojí.
              </p>
            </>
          ) : reconciliation.warning ? (
            <p className="text-sm font-medium text-jantar">{reconciliation.warning}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-jantar">
                Pozice nesedí s {account.label} — pravděpodobně chybí historie nebo
                korporátní akce:
              </p>
              {reconciliation.issues.map((issue) => (
                <p key={issue.isin} className="font-mono text-xs text-inkoust-tlumeny">
                  {issue.isin}: vypočteno {issue.expected}, broker {issue.actual}
                  {issue.suggestedSplitRatio &&
                    ` → vypadá to na split ${issue.suggestedSplitRatio.from}:${issue.suggestedSplitRatio.to}`}
                </p>
              ))}
              {reconciliation.unmatchedTickers.length > 0 && (
                <p className="font-mono text-xs text-inkoust-tlumeny">
                  Nespárované tickery: {reconciliation.unmatchedTickers.join(', ')}
                </p>
              )}
              <p className="text-xs text-inkoust-tlumeny">
                Malé rozdíly bývají dnešní obchody, které broker do exportu propíše se
                zpožděním — další synchronizace je srovná sama. Trvalý rozdíl znamená
                chybějící historii nebo korporátní akci.
              </p>
            </>
          )}
        </div>
      )}
      <div className="border-t border-linka pt-3">
        <p className="mb-2 text-xs text-inkoust-tlumeny">
          Klíč je uložen šifrovaně (AES-256-GCM) a nikdy se nezobrazuje.
        </p>
        <form action={disconnectBrokerAction}>
          <input type="hidden" name="accountId" value={account.id} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Odpojuji…">
            Odpojit {account.label}
          </SubmitButton>
        </form>
      </div>
    </>
  );
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string; ulozeno?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const { chyba, ulozeno } = await searchParams;
  const [batches, unmappedSource, accounts, aliases] = await Promise.all([
    db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, user.id))
      .orderBy(desc(importBatches.createdAt))
      .limit(20),
    // pro číselník se díváme hlouběji než historie (20) — výzva nesmí zmizet
    // jen proto, že uživatel mezitím importoval další soubory
    db
      .select({ issues: importBatches.issues })
      .from(importBatches)
      .where(eq(importBatches.userId, user.id))
      .orderBy(desc(importBatches.createdAt))
      .limit(200),
    db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, user.id)),
    loadAliases(db, user.id),
  ]);
  const t212 = accounts.find((account) => account.broker === 'trading212');
  const ibkr = accounts.find((account) => account.broker === 'ibkr');

  // nenamapované symboly z importů (bez těch, které už uživatel doplnil)
  const unmappedMap = new Map<string, UnmappedSymbol>();
  for (const batch of unmappedSource) {
    for (const item of ((batch.issues as BatchIssues).unmapped ?? [])) {
      const known =
        item.broker === 'xtb' ? aliases.xtb[item.symbol] : aliases.fio[item.symbol];
      if (!known) unmappedMap.set(`${item.broker}|${item.symbol}`, item);
    }
  }
  const unmappedSymbols = [...unmappedMap.values()];

  // aktivní job per účet → místo tlačítka a rekonciliace živý průběh
  // (jeden dotaz; cestou se samoléčí zaseknuté joby vč. odpojených účtů)
  const activeJobs = await activeSyncJobsByAccount(db, user.id);

  // chyby formulářů připojení mají specifickou inline hlášku v kartě brokera
  const inlineOnly = chyba === 'api-klic' || chyba === 'ibkr';

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">Zdroje dat</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Stačí připojit brokera — Danero si stáhne historii samo a pak ji denně
          aktualizuje. Ruční nahrání souborů je záložní varianta (a cesta pro jiné brokery
          přes{' '}
          <a
            className="font-medium text-ruzova"
            href="https://github.com/dundejan/danero/blob/main/docs/06-import.md"
          >
            univerzální šablonu
          </a>
          ).
        </p>
      </header>

      {chyba && !inlineOnly && (
        <Toast
          key={crypto.randomUUID()}
          kind="chyba"
          text={
            chyba === 'velikost'
              ? 'Soubor je větší než 20 MB — rozděl export na kratší období.'
              : chyba === 'isin'
                ? 'ISIN má tvar 2 písmena + 10 znaků (např. US0378331005) — zkontroluj vyplněné hodnoty.'
                : chyba === 'mena'
                  ? 'Měna má tvar 3 písmena (např. USD) — zkontroluj vyplněné hodnoty.'
                  : chyba === 'limit'
                    ? 'Příliš mnoho nahrání za sebou — počkej chvíli a zkus to znovu.'
                    : chyba === 'zadny-ucet'
                      ? 'Tenhle účet u brokera už neexistuje — obnov stránku.'
                      : 'Vyber aspoň jeden CSV, XML nebo XLSX soubor.'
          }
        />
      )}
      {ulozeno === 'ciselnik' && (
        <Toast
          key={crypto.randomUUID()}
          kind="ok"
          text="Číselník uložen. Nahraj soubor znovu — doplněné symboly se teď naimportují (a nic se nezdvojí)."
        />
      )}

      {unmappedSymbols.length > 0 && (
        <Card className="space-y-3 border-jantar">
          <CardTitle>Doplň chybějící údaje instrumentů</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Importy obsahují symboly, ke kterým broker neexportuje ISIN
            {unmappedSymbols.some((s) => s.needsCurrency) && ' a měnu instrumentu'}. Najdeš je
            na výpisu brokera nebo vyhledáním „[symbol] ISIN“. Po uložení nahraj soubor znovu —
            obchody těchto symbolů se bez doplnění neimportují.
          </p>
          <form action={saveAliasesAction} className="space-y-2">
            <input type="hidden" name="count" value={unmappedSymbols.length} />
            {unmappedSymbols.map((item, index) => (
              <div
                key={`${item.broker}|${item.symbol}`}
                className="flex flex-wrap items-center gap-3"
              >
                <input type="hidden" name={`broker-${index}`} value={item.broker} />
                <input type="hidden" name={`symbol-${index}`} value={item.symbol} />
                <span className="w-32 font-mono text-sm">
                  {item.symbol}
                  <span className="block text-xs text-inkoust-tlumeny">{item.broker}</span>
                </span>
                <input
                  name={`isin-${index}`}
                  placeholder="ISIN (US0378331005)"
                  required
                  pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]"
                  className="w-48 rounded-md border border-linka bg-plocha px-3 py-1.5 font-mono text-sm"
                />
                {item.needsCurrency && (
                  <input
                    name={`currency-${index}`}
                    placeholder="Měna (USD)"
                    required
                    pattern="[A-Za-z]{3}"
                    className="w-28 rounded-md border border-linka bg-plocha px-3 py-1.5 font-mono text-sm"
                  />
                )}
              </div>
            ))}
            <SubmitButton pendingLabel="Ukládám…">Uložit číselník</SubmitButton>
          </form>
        </Card>
      )}

      {/* ── Napojení na brokery: jedna karta per broker — nepřipojený ukazuje
          formulář s návodem, připojený stav synchronizace a odpojení ─────── */}
      <section className="space-y-3">
        <CardTitle>Napojení na brokery</CardTitle>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card className="space-y-3" id="trading212">
            <CardTitle>Trading212 — automatická synchronizace</CardTitle>
            {t212 ? (
              <ConnectedBroker
                account={t212}
                activeJob={activeJobs.has(t212.id) ? toSyncJobView(activeJobs.get(t212.id)!) : null}
              />
            ) : (
              <>
                <p className="text-sm text-inkoust-tlumeny">
                  Připoj klíč jen pro čtení — Danero si stáhne historii, denně ji
                  aktualizuje a hlídá, že pozice sedí.
                </p>
                <details className="text-sm text-inkoust-tlumeny">
                  <summary className="cursor-pointer font-medium text-inkoust">
                    Jak vygenerovat klíč (návod)
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p>
                      V Trading212 otevři <strong>Settings → API (Beta) → Generate key</strong> a
                      nastav:
                    </p>
                    <ul className="space-y-1">
                      <li>
                        <strong className="text-inkoust">Name:</strong> třeba „Danero“ (jen popisek
                        pro tebe)
                      </li>
                      <li>
                        <strong className="text-inkoust">IP restrictions:</strong> Neomezené —
                        Danero volá API ze svého serveru a adresy se mění
                      </li>
                      <li>
                        <strong className="text-inkoust">Permissions — zaškrtni jen tyto (vše jen
                        čtení):</strong>{' '}
                        <span className="font-mono text-xs">
                          Account data · History (+ dividends, orders, transactions) · Metadata ·
                          Portfolio
                        </span>
                      </li>
                      <li className="text-cervena">
                        <strong>Nezaškrtávej:</strong>{' '}
                        <span className="font-mono text-xs">Orders (execute i read) · Pies</span> —
                        Danero nikdy nepotřebuje právo obchodovat ani cokoli měnit na tvém účtu.
                      </li>
                    </ul>
                    <p>
                      K čemu která práva jsou: History = stažení historie obchodů, dividend a
                      úroků; Portfolio + Metadata = kontrola, že vypočtené pozice sedí s brokerem;
                      Account data = ověření, že klíč funguje.
                    </p>
                  </div>
                </details>
                {chyba === 'api-klic' && (
                  <p className="text-sm text-cervena">Vlož platný tajný klíč (aspoň 10 znaků).</p>
                )}
                <p className="text-sm text-inkoust-tlumeny">
                  Po vygenerování ti Trading212 ukáže <strong>dvě hodnoty</strong> — zkopíruj
                  sem obě. Pozor: <strong>Tajný klíč se zobrazuje jen jednou</strong>; kdyby
                  zmizel, prostě vygeneruj nový.
                </p>
                <form action={saveTrading212KeyAction} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="keyId">ID klíče API</Label>
                      <Input id="keyId" name="keyId" autoComplete="off" spellCheck={false} />
                    </div>
                    <div>
                      <Label htmlFor="secret">Tajný klíč</Label>
                      <Input id="secret" name="secret" type="password" required autoComplete="new-password" />
                    </div>
                  </div>
                  <SubmitButton pendingLabel="Ukládám…">Připojit</SubmitButton>
                </form>
              </>
            )}
          </Card>

          <Card className="space-y-3" id="ibkr">
            <CardTitle>Interactive Brokers — automatická synchronizace</CardTitle>
            {ibkr ? (
              <ConnectedBroker
                account={ibkr}
                activeJob={activeJobs.has(ibkr.id) ? toSyncJobView(activeJobs.get(ibkr.id)!) : null}
              />
            ) : (
              <>
                <p className="text-sm text-inkoust-tlumeny">
                  Potřebuješ dvě věci: <strong>Flex Query</strong> (říká, co se stahuje) a{' '}
                  <strong>token</strong> (přístup jen ke čtení výpisů).
                </p>
                <details className="text-sm text-inkoust-tlumeny">
                  <summary className="cursor-pointer font-medium text-inkoust">
                    Jak nastavit Flex Query a token (návod)
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p>V IBKR Client Portal:</p>
                    <ol className="list-decimal space-y-1 pl-5">
                      <li>
                        <strong className="text-inkoust">Performance &amp; Reports → Flex Queries
                        → „+“ u Activity Flex Query.</strong>{' '}
                        Pojmenuj ji třeba „Danero“.
                      </li>
                      <li>
                        Zapni sekce a úrovně přesně takto:{' '}
                        <span className="font-mono text-xs">
                          Trades = Executions · Cash Transactions = Detail · Corporate Actions =
                          Detail · Transfers = Detail · Open Positions = Summary
                        </span>{' '}
                        a v každé sekci zvol <strong className="text-inkoust">Select All</strong>{' '}
                        sloupce (musí obsahovat ISIN).
                      </li>
                      <li>
                        V Delivery Configuration nastav{' '}
                        <strong className="text-inkoust">Format XML</strong> a{' '}
                        <strong className="text-inkoust">Period „Last 365 Calendar Days“</strong>.
                        Ulož a poznamenej si <strong className="text-inkoust">Query ID</strong>{' '}
                        (číslo u názvu query).
                      </li>
                      <li>
                        <strong className="text-inkoust">Settings → Account Settings → Flex Web
                        Service</strong>{' '}
                        → aktivuj a zkopíruj <strong className="text-inkoust">token</strong>.
                      </li>
                    </ol>
                    <p>
                      Máš u IBKR historii starší než rok? Vytvoř si tutéž query ještě jednou
                      s obdobím po letech (Custom Date Range), stáhni XML ručně a nahraj je
                      níž v ručním nahrání — jednorázově, dál už vše řeší synchronizace.
                    </p>
                  </div>
                </details>
                {chyba === 'ibkr' && (
                  <p className="text-sm text-cervena">
                    Vlož platný token (aspoň 10 znaků) a číselné Query ID.
                  </p>
                )}
                <form action={saveIbkrKeyAction} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="token">Token Flex Web Service</Label>
                      <Input id="token" name="token" type="password" required autoComplete="new-password" />
                    </div>
                    <div>
                      <Label htmlFor="queryId">Query ID</Label>
                      <Input
                        id="queryId"
                        name="queryId"
                        required
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  <SubmitButton pendingLabel="Ukládám…">Připojit</SubmitButton>
                </form>
              </>
            )}
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <Card className="space-y-3">
          <CardTitle>Ruční nahrání výpisů (záložní varianta)</CardTitle>
          <form action={uploadImportAction} className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <FileField
              name="soubory"
              ariaLabel="Soubory s výpisy (CSV, XML nebo XLSX)"
              accept=".csv,text/csv,.xml,text/xml,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              multiple
              required
            />
            <SubmitButton pendingLabel="Nahrávám a počítám…">Nahrát výpisy</SubmitButton>
          </form>
          <details className="text-xs text-inkoust-tlumeny">
            <summary className="cursor-pointer font-medium text-inkoust">
              Jak získat výpis od brokera (návody)
            </summary>
            <ul className="mt-2 space-y-2">
              <li>
                <strong className="text-inkoust">Trading212:</strong> History → Export → CSV,
                zaškrtni všechny kategorie, po jednom roce. (Nebo připoj API — karta výš.)
              </li>
              <li>
                <strong className="text-inkoust">Interactive Brokers:</strong> Flex Query XML
                (návod u karty Interactive Brokers výš) — pro historii starší než rok vytvoř
                query s obdobím po letech a stáhni XML ručně.
              </li>
              <li>
                <strong className="text-inkoust">Degiro:</strong> Aktivita → Transakce → Export
                (CSV) a Aktivita → Výpis účtu → Export (CSV) — nahraj OBA soubory (obchody jsou
                v Transactions, dividendy a poplatky v Account).
              </li>
              <li>
                <strong className="text-inkoust">XTB:</strong> xStation → Historie účtu → Full
                report (XLSX). XTB neexportuje ISIN ani měnu instrumentu — při prvním importu
                tě požádáme o doplnění (zapamatujeme si je).
              </li>
              <li>
                <strong className="text-inkoust">Fio e-Broker:</strong> Obchody → Export do CSV
                (po jednom roce). Fio neexportuje ISIN — doplníš ho při importu.
              </li>
              <li>
                <strong className="text-inkoust">Jiný broker:</strong>{' '}
                <a href="/api/sablona" className="font-medium text-ruzova" download>
                  stáhni univerzální šablonu
                </a>{' '}
                s ukázkovými řádky (umí i korporátní akce a převody se zachováním nabytí)
                a vyplň ji z výpisu.
              </li>
            </ul>
            <p className="mt-2">
              Opakované nahrání nic nezdvojí — deduplikace je součástí importu a funguje
              i napříč soubory.
            </p>
          </details>
        </Card>
      </section>

      <section className="space-y-3">
        <CardTitle>Historie importů</CardTitle>
        {batches.length === 0 && (
          <p className="text-sm text-inkoust-tlumeny">
            Zatím žádná data. Nahraj export od brokera a Danero pohlídá zbytek.
          </p>
        )}
        {batches.map((batch) => {
          const issues = batch.issues as BatchIssues;
          // prázdný export (T212 vrací pro roky před založením účtu prázdný
          // soubor) není chyba uživatele — nezobrazovat červeně jako chyby.
          // POZOR: poznává se VÝHRADNĚ nulovými počty (parser od fixu vrací
          // pro prázdný soubor 0 chyb) — sniffování chybových hlášek by
          // maskovalo skutečné chyby formátu (0 přidaných + chyba parsování).
          const isEmptyPeriod =
            batch.added === 0 &&
            batch.duplicates === 0 &&
            batch.skippedCount === 0 &&
            batch.errorCount === 0 &&
            batch.warningCount === 0;
          return (
            <Card key={batch.id} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm">{batch.filename}</span>
                <span className="flex items-baseline gap-3 text-xs text-inkoust-tlumeny">
                  {batch.createdAt.toLocaleString('cs-CZ')} · {batch.broker}
                  <form action={deleteBatchAction}>
                    <input type="hidden" name="batchId" value={batch.id} />
                    <button
                      type="submit"
                      className="font-medium text-inkoust-tlumeny hover:text-cervena"
                      title="Smaže jen záznam o importu — transakce zůstávají"
                    >
                      Smazat záznam
                    </button>
                  </form>
                </span>
              </div>
              {isEmptyPeriod ? (
                <p className="font-mono text-xs text-inkoust-tlumeny">
                  prázdné období (žádné obchody)
                </p>
              ) : (
                <>
                  <p className="font-mono text-xs text-inkoust-tlumeny">
                    {batch.added} {plural(batch.added, 'nová', 'nové', 'nových')} ·{' '}
                    {batch.duplicates} {plural(batch.duplicates, 'duplicita', 'duplicity', 'duplicit')} ·{' '}
                    <span className={batch.errorCount > 0 ? 'text-cervena' : undefined}>
                      {batch.errorCount} {plural(batch.errorCount, 'chyba', 'chyby', 'chyb')}
                    </span>{' '}
                    · {batch.warningCount} varování · {batch.skippedCount} přeskočeno
                  </p>
                  {(issues.errors ?? []).slice(0, 10).map((issue) => (
                    <p key={`e-${issue.line}`} className="text-xs text-cervena">
                      Řádek {issue.line}: {issue.message}
                    </p>
                  ))}
                  {(issues.warnings ?? []).slice(0, 5).map((issue) => (
                    <p key={`w-${issue.line}`} className="text-xs text-jantar">
                      Řádek {issue.line}: {issue.message}
                    </p>
                  ))}
                </>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}
