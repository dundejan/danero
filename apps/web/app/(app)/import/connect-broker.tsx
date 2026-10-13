import { Card } from '@/components/ui/card';
import { DisclosureRow } from '@/components/ui/disclosure';
import { describedByError, Field, Input } from '@/components/ui/field';
import { SubmitButton } from '@/components/ui/submit-button';
import { saveIbkrKeyAction, saveTrading212KeyAction } from './actions';

/**
 * Řádky „přidat zdroj“ pro brokery, které umíme napojit klíčem jen pro čtení.
 * Zavřený řádek je jen jméno; formulář i návod, kde klíč vzít, se ukážou po
 * rozbalení. `id` řádku je kód brokera — vede na něj odkaz z uvítání
 * a z nápovědy k výpisům (`OpenOnHash` ho při příchodu rozbalí).
 *
 * `name` atributy polí jsou česky a nemění se (čtou je server actions).
 */

/** Název práva nebo položky menu v cizí aplikaci — opisuje se přesně. */
function Term({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>;
}

/**
 * Návod, kde klíč vzít — rozbalovací odkaz uvnitř rozbaleného řádku.
 *
 * Vypadá jako `Disclosure`, ale ten tu použít nejde: jeho šipka se otáčí podle
 * nejbližšího předka se skupinou `disclosure`, a tím je uvnitř `DisclosureRow`
 * už otevřený řádek — šipka by ukazovala „otevřeno“ i nad zavřeným návodem.
 * Proto vlastní skupina.
 */
function KeyGuide({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="disclosure group/guide">
      <summary className="type-footnote inline-flex min-h-11 items-center gap-1.5 font-medium text-accent-text active:opacity-60 md:min-h-7">
        <svg
          viewBox="0 0 8 12"
          aria-hidden
          className="h-[0.7em] w-auto shrink-0 fill-none stroke-current transition-transform duration-150 ease-(--ease-out) group-open/guide:rotate-90"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1.5 1.5L6 6l-4.5 4.5" />
        </svg>
        {summary}
      </summary>
      <div className="type-footnote space-y-2 pb-2 pt-1 text-pretty text-ink-muted">{children}</div>
    </details>
  );
}

export function ConnectTrading212({ invalid }: { invalid: boolean }) {
  return (
    <DisclosureRow id="trading212" title="Trading 212" defaultOpen={invalid}>
      {/* záporný okraj ruší odsazení obsahu rozbalovacího řádku — panel drží šířku řádku */}
      <Card className="-mr-6 space-y-4 text-ink">
        <KeyGuide summary="Kde klíč vezmu">
            <p>
              Položku API uvidíš jen na ostrém účtu Invest nebo Stocks ISA — klíč z režimu
              Practice ani z účtu CFD tady fungovat nebude.
            </p>
            <p>
              V Trading 212 otevři <Term>Settings → API (Beta) → Generate API key</Term>,
              potvrď upozornění na rizika a nastav:
            </p>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                <Term>Name:</Term> třeba „Danero“ (jen popisek pro tebe)
              </li>
              <li>
                <Term>IP restrictions:</Term> Neomezené — Danero volá API ze svého serveru
                a adresy se mění
              </li>
              <li>
                <Term>Permissions — zaškrtni jen tyto (vše jen čtení):</Term> Account data · History
                (+ dividends, orders, transactions) · Metadata · Portfolio
              </li>
              <li>
                <Term>Nezaškrtávej:</Term> Orders (execute i read) · Pies — Danero nikdy
                nepotřebuje právo obchodovat ani cokoli měnit na tvém účtu.
              </li>
            </ul>
            <p>
              K čemu která práva jsou: History = stažení historie obchodů, dividend a úroků;
              Portfolio + Metadata = kontrola, že vypočtené pozice sedí s brokerem; Account
              data = ověření, že klíč funguje.
            </p>
            <p>Po vygenerování ti Trading 212 ukáže dvě hodnoty — zkopíruj sem obě.</p>
        </KeyGuide>
        <form action={saveTrading212KeyAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ID klíče API" htmlFor="id-klice">
              <Input id="id-klice" name="id-klice" autoComplete="off" spellCheck={false} />
            </Field>
            <Field
              label="Tajný klíč"
              htmlFor="tajny-klic"
              hint="Zobrazí se jen jednou. Když ti zmizí, vygeneruj nový."
              error={invalid ? 'Vlož platný tajný klíč (aspoň 10 znaků).' : undefined}
              errorId="tajny-klic-error"
            >
              <Input
                id="tajny-klic"
                name="tajny-klic"
                type="password"
                required
                autoComplete="new-password"
                {...describedByError(invalid, 'tajny-klic-error')}
              />
            </Field>
          </div>
          <SubmitButton variant="secondary" pendingLabel="Ukládám…">
            Připojit
          </SubmitButton>
        </form>
      </Card>
    </DisclosureRow>
  );
}

export function ConnectIbkr({ invalid }: { invalid: boolean }) {
  return (
    <DisclosureRow
      id="ibkr"
      title="Interactive Brokers"
      meta="i účty u Lynx"
      defaultOpen={invalid}
    >
      {/* záporný okraj ruší odsazení obsahu rozbalovacího řádku — panel drží šířku řádku */}
      <Card className="-mr-6 space-y-4 text-ink">
        <KeyGuide summary="Kde token a Query ID vezmu">
            <p>
              Potřebuješ dvě věci: <Term>Flex Query</Term> (říká, co se stahuje) a{' '}
              <Term>token</Term> (přístup jen ke čtení výpisů). Účet u Lynx běží na
              infrastruktuře IBKR — postup je stejný, jen se přihlašuješ přes web Lynxu.
            </p>
            <p>V IBKR Client Portal:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <Term>Performance &amp; Reports → Flex Queries → „+“ u Activity Flex Query.</Term>{' '}
                Pojmenuj ji třeba „Danero“. (Trade Confirmation Flex Query nestačí — nemá
                dividendy ani úroky.)
              </li>
              <li>
                Zapni sekce a úrovně přesně takto: Trades = Executions · Cash Transactions = Detail
                · Corporate Actions = Detail · Transfers = Detail · Open Positions = Summary
                a v každé sekci zvol <Term>Select All</Term> sloupce (musí obsahovat ISIN).
              </li>
              <li>
                V Delivery Configuration nastav <Term>Format XML</Term> a{' '}
                <Term>Period „Last 365 Calendar Days“</Term>. Ulož; <Term>Query ID</Term> najdeš
                po kliknutí na ikonu „i“ vedle názvu query.
              </li>
              <li>
                Na téže stránce otevři ozubeným kolem{' '}
                <Term>Flex Web Service Configuration</Term>, službu zapni a vygeneruj{' '}
                <Term>token</Term>: platnost nastav na <Term>1 Year</Term> (výchozí je 6 hodin)
                a pole pro IP adresu nech prázdné — Danero se připojuje z adres, které se mění.
              </li>
            </ol>
            <p>
              Máš u IBKR starší historii? Synchronizace sahá rok zpět. Starší roky stáhni ručně:
              u téže query klikni na šipku <Term>Run</Term>, zvol <Term>Custom Date Range</Term>{' '}
              (nejvýš 365 dní) a formát XML, a soubory nahraj jako výpis. IBKR takhle vydá letošek
              a čtyři předchozí roky; co je starší, doplň univerzální šablonou.
            </p>
            <p>
              Účet připojený před 13. 10. 2026: daň z transakce v nákladech obchodu a daň sraženou
              z úroku jsme do té doby nečetli. U dřív stažených dat je doplníš tak, že ve Zdrojích
              dat vrátíš starší importy IBKR zpět a pustíš synchronizaci znovu.
            </p>
        </KeyGuide>
        <form action={saveIbkrKeyAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Token Flex Web Service"
              htmlFor="token"
              error={invalid ? 'Vlož platný token (aspoň 10 znaků) a číselné Query ID.' : undefined}
              errorId="token-error"
            >
              <Input
                id="token"
                name="token"
                type="password"
                required
                autoComplete="new-password"
                {...describedByError(invalid, 'token-error')}
              />
            </Field>
            <Field label="Query ID" htmlFor="id-dotazu">
              <Input
                id="id-dotazu"
                name="id-dotazu"
                required
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
          <SubmitButton variant="secondary" pendingLabel="Ukládám…">
            Připojit
          </SubmitButton>
        </form>
      </Card>
    </DisclosureRow>
  );
}
