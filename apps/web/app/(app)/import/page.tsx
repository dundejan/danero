import { desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { AppToolbar } from '@/components/app-toolbar';
import { ClearFeedbackUrl } from '@/components/clear-feedback-url';
import { Toast } from '@/components/toast';
import { buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { OpenOnHash } from '@/components/ui/open-on-hash';
import { Group } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { getDb } from '@/db';
import { brokerAccounts, importBatches } from '@/db/schema';
import { casesForBatches } from '@/lib/failed-imports';
import {
  feedbackPlacement,
  HISTORY_MAX,
  HISTORY_PAGE,
  historyLimit,
  IMPORT_HISTORY_ANCHOR,
  importFeedback,
  isFirstDataUpload,
  uploadedBatchIds,
} from '@/lib/import-feedback';
import type { UnmappedSymbol } from '@/lib/import-service';
import { isIsinOnlyBroker, loadAliases } from '@/lib/instrument-aliases';
import { activeSyncJobsByAccount, toSyncJobView } from '@/lib/jobs';
import { getProfile } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { firstParam } from '@/lib/utils';
import { AliasForm } from './alias-form';
import { ConnectIbkr, ConnectTrading212 } from './connect-broker';
import { ConnectedAccount } from './connected-account';
import { ImportHistory, type BatchIssues } from './import-history';
import { UnreadStatements } from './unread-statements';
import { UploadPanel } from './upload-panel';

export const metadata = { title: 'Zdroje dat — Danero' };

// syncBrokerAction pouští přes after() sync (poll exportů T212 po 65 s) —
// default limit server action by běh utnul hned. 300 s je strop Vercel Hobby;
// plná historie se do něj nevejde, proto se sync umí přerušit a navázat.
export const maxDuration = 300;

/**
 * Chybové hlášky podle kódu v adrese (`?chyba=`). Chyba říká, co se stalo
 * a jak dál — proto jsou delší než potvrzení a zůstávají vidět čtvrt minuty.
 */
const ERROR_TEXTS: Record<string, string> = {
  velikost:
    'Soubor je větší než 4 MB — víc hosting v jednom nahrání nepropustí. Stáhni export po kratších obdobích (třeba po roce) a nahraj je postupně; nic se nezdvojí. U brokera, kterého umíme napojit automaticky, se limitu vyhneš úplně.',
  isin: 'ISIN má tvar 2 písmena + 10 znaků (např. US0378331005) — zkontroluj vyplněné hodnoty.',
  mena: 'Měna má tvar 3 písmena (např. USD) — zkontroluj vyplněné hodnoty.',
  limit: 'Příliš mnoho nahrání za sebou — počkej chvíli a zkus to znovu.',
  'zadny-ucet': 'Tenhle účet u brokera už neexistuje — obnov stránku.',
  'hlaseni-prazdne': 'Vyber platformu nebo napiš poznámku — bez toho nám hlášení nepomůže.',
  'hlaseni-neexistuje': 'Tenhle výpis už mezitím vyřešený je — obnov stránku.',
  vraceni: 'Tenhle import už vrácený je — obnov stránku.',
  ulozeni:
    'Aspoň jeden soubor se nepodařilo uložit — na naší straně selhala databáze. Se souborem nic není a nic se nezdvojí: zkus ho nahrát znovu za chvíli a v historii importů si zkontroluj, co se stihlo uložit.',
  'isin-pouzity':
    'ISIN ani měnu nejde přepsat u titulu, pod kterým už máš uložené transakce — po dalším nahrání výpisu by se obchody i dividendy uložily podruhé. Chceš je opravit? Nejdřív v historii importů rozbal ten import a vrať ho zpět, pak údaj ulož a výpis nahraj znovu. Ostatní řádky jsou uložené.',
};

const DEFAULT_ERROR_TEXT = 'Vyber aspoň jeden CSV, XML, XLSX nebo HTML soubor.';

/**
 * Zdroje dat: odkud se do Danera dostávají obchody. Stránka je poskládaná
 * podle toho, co na ní člověk dělá, shora dolů:
 *
 * 1. co je potřeba doplnit (číselník titulů) — jen když něco chybí,
 * 2. připojené účty: stav, poslední synchronizace, synchronizovat / odpojit,
 * 3. přidat zdroj: nahrát výpis (s nápovědou, kde ho stáhnout), nebo napojit
 *    brokera klíčem jen pro čtení,
 * 4. výpisy, které jsme nepřečetli, a historie importů s vrácením zpět —
 *    v širokém okně ve vlastním sloupci vedle zdrojů.
 *
 * Výklad (proč jen pro čtení, jak se pozná formát, limity) je ve
 * vysvětlivkách a rozbalovacích řádcích; nevratné akce potvrzuje dialog.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const chyba = firstParam(params.chyba);
  const ulozeno = firstParam(params.ulozeno);
  const feedback = importFeedback(params);
  // Jeden dotaz pro historii, číselník i nepřečtené výpisy. Historie z něj
  // ukazuje prvních `limit` (20, odkazem „Zobrazit starší“ po dvaceti dál);
  // číselník a nepřečtené výpisy se dívají na všechno načtené — výzva nesmí
  // zmizet jen proto, že uživatel mezitím importoval další soubory (R2-05).
  const limit = historyLimit(params);
  const [recentBatches, accounts, aliases] = await Promise.all([
    db
      .select()
      .from(importBatches)
      .where(eq(importBatches.userId, user.id))
      .orderBy(desc(importBatches.createdAt))
      .limit(HISTORY_MAX),
    db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, user.id)),
    loadAliases(db, user.id),
  ]);
  const batches = recentBatches.slice(0, limit);
  // kotva, která na stránce není, nechá polohu být — seznam se jen prodlouží
  const olderHref =
    recentBatches.length > limit
      ? `/import?historie=${Math.min(limit + HISTORY_PAGE, HISTORY_MAX)}#starsi`
      : undefined;
  // Krok 2 cesty nového uživatele: profil má, data ještě ne. Stav se
  // neukládá, odvozuje se z účtu (stejně jako na /vitejte).
  const withoutSources = recentBatches.length === 0 && accounts.length === 0;
  // Konec kroku 2: nahrání právě přineslo první data. Příznak je z adresy,
  // proto se ověří i na účtu — přehled má smysl nabídnout jen tomu, kdo má
  // profil (bez něj by ho přehled poslal do Nastavení) a opravdu nějaká data.
  const firstDataUploaded =
    isFirstDataUpload(params) && recentBatches.some((batch) => batch.added > 0);
  const hasProfile =
    withoutSources || firstDataUploaded ? (await getProfile(db, user.id)) !== null : false;
  const awaitingFirstData = withoutSources && hasProfile;
  const offerOverview = firstDataUploaded && hasProfile;
  // výsledek nahrání a vrácení stojí nad historií, ostatní hlášky plavou
  const placement = feedbackPlacement(params);
  const t212 = accounts.find((account) => account.broker === 'trading212');
  const ibkr = accounts.find((account) => account.broker === 'ibkr');

  // nenamapované symboly z importů (bez těch, které už uživatel doplnil)
  const unmappedMap = new Map<string, UnmappedSymbol>();
  for (const batch of recentBatches) {
    for (const item of ((batch.issues as BatchIssues).unmapped ?? [])) {
      const known =
        item.broker === 'xtb'
          ? aliases.xtb[item.symbol]
          : isIsinOnlyBroker(item.broker)
            ? aliases.isinOnly[item.broker][item.symbol]
            : undefined;
      if (!known) unmappedMap.set(`${item.broker}|${item.symbol}`, item);
    }
  }
  const unmappedSymbols = [...unmappedMap.values()];
  // Symboly, u kterých server odmítl ISIN kvůli kontrolní číslici (L14-06).
  // Z adresy se berou jen ty, které ve formuláři opravdu jsou — cizí text
  // z odkazu se do hlášky neopisuje.
  const rejectedSymbols = [params.symbol]
    .flat()
    .filter((symbol) => unmappedSymbols.some((item) => item.symbol === symbol));
  const checkDigitMessage =
    (rejectedSymbols.length === 0
      ? 'ISIN nesedí'
      : `${rejectedSymbols.length === 1 ? 'U symbolu' : 'U symbolů'} ${rejectedSymbols.join(', ')} ISIN nesedí`) +
    ': jeho poslední číslice je kontrolní a ke zbytku kódu nepasuje — nejspíš překlep při opisování (zaměněný nebo přehozený znak). Zkontroluj ho znak po znaku a ulož znovu; správně vyplněné řádky jsou uložené.';

  // aktivní job per účet → místo tlačítka a stavu živý průběh
  // (jeden dotaz; cestou se samoléčí zaseknuté joby vč. odpojených účtů)
  const activeJobs = await activeSyncJobsByAccount(db, user.id);

  // Nepřečtené výpisy (originál si necháváme k rozboru). Otevřený případ po
  // uživateli něco chce, takže je vidět, i když jeho dávka z historie vypadla;
  // vyřízený zůstává jen po dobu, co je jeho dávka na očích.
  const failedCases = await casesForBatches(
    db,
    user.id,
    recentBatches.map((batch) => batch.id),
  );
  const shownBatchIds = new Set(batches.map((batch) => batch.id));
  // v pořadí historie, tedy od nejnovějšího
  const unreadCases = recentBatches.flatMap((batch) => {
    const item = failedCases.get(batch.id);
    return item && (item.status === 'open' || shownBatchIds.has(batch.id)) ? [item] : [];
  });

  // chyby formulářů připojení mají hlášku přímo u pole
  const inlineOnly = chyba === 'api-klic' || chyba === 'ibkr';
  // kód je z adresy — do slovníku se sahá jen na vlastní klíče (ne `constructor` apod.)
  const errorText =
    chyba === 'isin-kontrola'
      ? checkDigitMessage
      : chyba !== undefined && Object.hasOwn(ERROR_TEXTS, chyba)
        ? ERROR_TEXTS[chyba]!
        : DEFAULT_ERROR_TEXT;

  return (
    <>
      <AppToolbar title="Zdroje dat" />
      <OpenOnHash />
      <div className="max-w-[72rem] space-y-14 pt-2 md:pt-4">
        {awaitingFirstData && (
          <Notice title="Krok 2 ze 2 — přidej svoje obchody">
            Nahraj výpis, nebo napoj brokera. Hned potom se otevře přehled, portfolio i podklady
            k přiznání.
          </Notice>
        )}
        {chyba && !inlineOnly && (
          <Toast key={crypto.randomUUID()} kind="chyba" text={errorText} />
        )}
        {/* Výsledek připojení, odpojení a spuštění synchronizace. Plave, protože
            akce končí na kotvě účtu u brokera a hláška nahoře na stránce by
            zůstala mimo obrazovku (L7d-01). Výsledek nahrání a vrácení je
            v toku stránky nad historií — viz níž. */}
        {feedback && placement === 'floating' && (
          <Toast key={crypto.randomUUID()} kind={feedback.kind} floating text={feedback.text} />
        )}
        {ulozeno === 'ciselnik' && (
          <Toast
            key={crypto.randomUUID()}
            kind="ok"
            floating
            text="Číselník uložen. Nahraj soubor znovu — doplněné symboly se teď naimportují (a nic se nezdvojí)."
          />
        )}
        {ulozeno === 'hlaseni' && (
          <Toast
            key={crypto.randomUUID()}
            kind="ok"
            floating
            text="Díky — máme to. Dáme ti e-mailem vědět, jakmile výpis zpracujeme."
          />
        )}

        {/* Vlevo zdroje (co mám a jak přidat další), vpravo co z nich přišlo.
            V širokém okně tak výsledek nahrání naskočí hned vedle formuláře;
            v úzkém jde historie pod zdroje a stránka na ni po nahrání skočí. */}
        <div className="@container">
          <div className="grid gap-x-(--column-gap) gap-y-14 @3xl:grid-cols-2">
            <div className="min-w-0 space-y-14">
              {unmappedSymbols.length > 0 && <AliasForm symbols={unmappedSymbols} />}

              {accounts.length > 0 && (
                <Section title="Připojené účty">
                  <div className="space-y-10">
                    {accounts.map((account) => {
                      const job = activeJobs.get(account.id);
                      return (
                        <ConnectedAccount
                          key={account.id}
                          account={account}
                          activeJob={job ? toSyncJobView(job) : null}
                        />
                      );
                    })}
                  </div>
                </Section>
              )}

              <UploadPanel />

              {(!t212 || !ibkr) && (
                <Section
                  title="Synchronizovat automaticky"
                  info={
                    <InfoPopover
                      label="Automatická synchronizace"
                      title="Jak napojení funguje"
                      align="start"
                    >
                      <p>
                        Vložíš klíč jen pro čtení a Danero si historii stáhne samo, každý den ji
                        doplní a hlídá, že spočítané pozice sedí s brokerem.
                      </p>
                      <p>
                        Právo obchodovat ani cokoli měnit Danero nepotřebuje — klíči ho
                        nedávej. Ukládáme ho šifrovaně (AES-256-GCM) a nikde ho nezobrazujeme.
                      </p>
                    </InfoPopover>
                  }
                >
                  <Group className="-mt-2" aria-label="Brokeři s automatickou synchronizací">
                    {!t212 && <ConnectTrading212 invalid={chyba === 'api-klic'} />}
                    {!ibkr && <ConnectIbkr invalid={chyba === 'ibkr'} />}
                  </Group>
                </Section>
              )}
            </div>

            {/* Jedna kotva pro obě sekce: po nahrání stránka skočí sem a nepřečtený
                výpis (ten jediný po uživateli něco chce) je nad historií vidět hned. */}
            <div id={IMPORT_HISTORY_ANCHOR} className="min-w-0 scroll-mt-20">
              {/* Výsledek nahrání a vrácení stojí v toku stránky hned nad tím,
                  o čem mluví. Plovoucí hláška na telefonu ležela přesně přes
                  první řádek historie (R2-25). Nemizí sama: po prvním nahrání
                  nese další krok cesty nového uživatele. */}
              {feedback && placement === 'history' && (
                <>
                  <ClearFeedbackUrl />
                  <Notice
                    className="mb-8"
                    role={feedback.kind === 'chyba' ? 'alert' : 'status'}
                    tone={feedback.kind === 'chyba' ? 'danger' : 'success'}
                    title={feedback.text}
                    action={
                      offerOverview && (
                        <Link
                          href="/prehled"
                          className={buttonVariants({ variant: 'tinted', size: 'sm' })}
                        >
                          Hotovo, otevřít přehled
                        </Link>
                      )
                    }
                  />
                </>
              )}
              <div className="space-y-14">
                <UnreadStatements cases={unreadCases} />
                <ImportHistory
                  batches={batches}
                  olderHref={olderHref}
                  highlightedBatchIds={uploadedBatchIds(params)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
