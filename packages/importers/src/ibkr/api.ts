import { XMLParser } from 'fast-xml-parser';

/**
 * Klient IBKR Flex Web Service (docs/03, docs/09 G2): dvoufázový protokol
 * SendRequest (token + query ID → referenceCode) → GetStatement (poll, dokud
 * se výpis generuje). Trpělivé retry — generování větších výpisů trvá minuty
 * a služba vrací 1019 „in progress“, případně 1018 „throttled“.
 *
 * Podle dokumentace IBKR (interactivebrokers.com/docs/web-api/flex-web-service
 * a ibkrguides „Flex Web Service Version 3“, stav 13. 10. 2026). Limit je
 * 1 dotaz za sekundu a 10 za minutu na token.
 */

const DEFAULT_BASE_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

/** Nejdelší období, které jde přes parametr `p` vyžádat. */
const MAX_PERIOD_DAYS = 365;

/**
 * Kódy, u kterých IBKR sám píše „Please try again shortly“ — výpis se
 * generuje, data ještě nejsou připravená, server je přetížený nebo škrtí.
 * Opakují se v obou fázích; do 13. 10. 2026 jen 1018, 1019 a 1021, takže
 * třeba 1001 nebo 1009 ukončily synchronizaci na první pokus.
 */
const TRANSIENT_CODES = new Set([
  '1001',
  '1004',
  '1005',
  '1006',
  '1007',
  '1008',
  '1009',
  '1018',
  '1019',
  '1021',
]);

export interface IbkrFlexClientOptions {
  token: string;
  queryId: string;
  /**
   * Kolik posledních dní výpis pokryje (parametr `p`, „Period Override“,
   * nejvýš 365). Posílá se VŽDY: období uložené ve Flex Query služba ve
   * verzi 3 nedodržuje spolehlivě — uživatelé hlásí, že „Last 365 Calendar
   * Days“ vrátí přes API jediný den (csingley/ibflex #109, 5–6/2026).
   */
  periodDays?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Volby čekání na vygenerovaný výpis — obdoba `ExportPollOptions` u Trading212. */
export interface StatementPollOptions {
  /** Prodleva mezi dotazy na stav výpisu. */
  pollIntervalMs?: number;
  /**
   * Kolikrát se celkem uspí (objednání i vyzvedávání dohromady), než čekání
   * vzdáme. Nejdelší možné čekání je tedy `maxAttempts × pollIntervalMs`.
   */
  maxAttempts?: number;
  /** Heartbeat pro nadřazený job — volá se před každým uspáním. */
  onPoll?: () => void | Promise<void>;
}

export class IbkrFlexError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IbkrFlexError';
  }
}

/**
 * Chybové kódy Flex Web Service přeložené do řeči uživatele. Významy podle
 * tabulky IBKR (…/flex-web-service/error-codes): 1003 je „Statement is not
 * available“ a 1020 „Invalid request“ — špatné Query ID hlásí 1014.
 */
const ERROR_MESSAGES: Record<string, string> = {
  '1003': 'IBKR teď výpis nemá k dispozici — zkus synchronizaci později. Kdyby to trvalo, zkontroluj v IBKR, že Flex Query existuje a má zapnuté sekce (Performance & Reports → Flex Queries).',
  '1010': 'Tahle Flex Query je starého typu, který IBKR už nepodporuje — vytvoř si novou Activity Flex Query a ulož její Query ID.',
  '1011': 'Flex Web Service je u tohohle účtu vypnutá — zapni ji v IBKR (Performance & Reports → Flex Queries → Flex Web Service Configuration).',
  '1012': 'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.',
  '1013': 'Token je omezený na konkrétní IP adresu, a Danero se připojuje z adres, které se mění. Vygeneruj v IBKR nový token a pole pro IP adresu nech prázdné.',
  '1014': 'Query ID IBKR nezná — zkontroluj ho v IBKR (Performance & Reports → Flex Queries, ikona „i“ u názvu query) a ulož znovu.',
  '1015': 'Token je neplatný — zkontroluj, že je zkopírovaný celý, bez mezer.',
  '1016': 'Token nepatří k tomuto účtu — zkontroluj, že query i token pochází ze stejného IBKR přihlášení.',
  '1020': 'IBKR požadavek odmítl jako neplatný — zkontroluj token i Query ID, jestli jsou zkopírované celé a patří k sobě.',
};

interface StatementResponse {
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  referenceCode?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

function readStatementResponse(xml: string): StatementResponse | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }
  const response = parsed.FlexStatementResponse as Record<string, unknown> | undefined;
  if (!response) return null;
  const text = (value: unknown): string | undefined =>
    value === undefined || value === null ? undefined : String(value);
  return {
    status: text(response.Status),
    errorCode: text(response.ErrorCode),
    errorMessage: text(response.ErrorMessage),
    referenceCode: text(response.ReferenceCode),
  };
}

function translateError(code: string | undefined, fallback: string | undefined): IbkrFlexError {
  const known = code ? ERROR_MESSAGES[code] : undefined;
  return new IbkrFlexError(
    code ?? 'unknown',
    known ?? `IBKR Flex služba vrátila chybu ${code ?? ''}: ${fallback ?? 'bez popisu'}`,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class IbkrFlexClient {
  private readonly token: string;
  private readonly queryId: string;
  private readonly periodDays: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IbkrFlexClientOptions) {
    this.token = options.token;
    this.queryId = options.queryId;
    this.periodDays = Math.min(Math.max(Math.trunc(options.periodDays ?? MAX_PERIOD_DAYS), 1), MAX_PERIOD_DAYS);
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get(url: string): Promise<string> {
    // HTTP vrstva: retry na 429/5xx a síťové chyby. Tři pokusy po nejvýš 60 s
    // a dvě prodlevy dají 195 s — pod rozpočtem jednoho běhu jobů (225 s).
    // Pět pokusů (375 s) přesáhlo i strop funkce na hostingu: neodpovídající
    // službu neukončila naše chyba, ale platforma, a job zůstal viset.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(5_000 * attempt);
      try {
        const response = await this.fetchImpl(url, {
          headers: { 'User-Agent': 'danero/1.0' },
          signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new IbkrFlexError(
            String(response.status),
            `IBKR Flex služba neodpovídá (HTTP ${response.status}) — zkus synchronizaci za chvíli znovu.`,
          );
          continue;
        }
        if (!response.ok) {
          throw new IbkrFlexError(
            String(response.status),
            `IBKR Flex služba odmítla požadavek (HTTP ${response.status}) — zkontroluj token a Query ID v nastavení.`,
          );
        }
        return await response.text();
      } catch (error) {
        if (error instanceof IbkrFlexError) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof IbkrFlexError
      ? lastError
      : new IbkrFlexError('network', 'IBKR Flex služba neodpovídá — zkus to za chvíli znovu.');
  }

  /**
   * Fáze 1: objednání výpisu → referenceCode. Dočasné kódy (`TRANSIENT_CODES`)
   * se trpělivě opakují. Pokusy se berou ze SPOLEČNÉHO rozpočtu s vyzvedáváním,
   * aby se celkové čekání nesečetlo nad strop.
   *
   * `<Url>` z odpovědi se NEČTE: dokumentace říká „The <url> returned in the
   * response body should be ignored“ a služba v ní dodnes posílá i starou
   * adresu, která na všechno vrací 1001. Výpis se vyzvedává na téže základní
   * adrese — token tak nikdy neodejde jinam, než kam je klient nastavený.
   */
  private async sendRequest(
    budget: { attemptsLeft: number },
    pollIntervalMs: number,
    onPoll?: () => void | Promise<void>,
  ): Promise<string> {
    for (;;) {
      const query = `t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(this.queryId)}&p=${this.periodDays}&v=3`;
      const xml = await this.get(`${this.baseUrl}/SendRequest?${query}`);
      const response = readStatementResponse(xml);
      if (!response) {
        throw new IbkrFlexError(
          'bad-response',
          'Neočekávaná odpověď IBKR (SendRequest nevrátil XML) — zkus to za chvíli znovu.',
        );
      }
      if (response.status === 'Success' && response.referenceCode) {
        return response.referenceCode;
      }
      if (
        response.errorCode !== undefined &&
        TRANSIENT_CODES.has(response.errorCode) &&
        budget.attemptsLeft > 0
      ) {
        budget.attemptsLeft -= 1;
        await onPoll?.();
        await sleep(pollIntervalMs);
        continue;
      }
      throw translateError(response.errorCode, response.errorMessage);
    }
  }

  /**
   * Stáhne kompletní Flex XML výpis. Polluje GetStatement, dokud IBKR výpis
   * generuje (kód 1019) nebo škrtí (1018) — nejvýš `maxAttempts` uspání.
   * `onPoll` se volá při každém čekání (heartbeat pro nadřazený job).
   *
   * ⚠️ Strop je v POČTU POKUSŮ, ne v čase. Časový rozpočet (do 31. 8. 2026
   * `maxWaitMs = 600_000`) se kontroloval PŘED uspáním, takže reálné čekání
   * bylo o celý interval delší než rozpočet — a ten se rovnal rozpočtu celého
   * ticku cronu (`DEFAULT_JOB_BUDGET_MS`), takže jediný pomalý výpis ho utnul
   * uprostřed. Stejná vada a stejná oprava jako u Trading212
   * (`ExportPollOptions.maxAttempts`).
   */
  async fetchStatementXml(options: StatementPollOptions = {}): Promise<string> {
    const pollIntervalMs = options.pollIntervalMs ?? 10_000;
    const maxAttempts = options.maxAttempts ?? 58;
    const budget = { attemptsLeft: maxAttempts };
    const referenceCode = await this.sendRequest(budget, pollIntervalMs, options.onPoll);

    for (;;) {
      const query = `t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(referenceCode)}&v=3`;
      const body = await this.get(`${this.baseUrl}/GetStatement?${query}`);

      // hotový výpis je FlexQueryResponse; FlexStatementResponse = stav/chyba
      if (body.includes('<FlexQueryResponse')) return body;

      const response = readStatementResponse(body);
      const code = response?.errorCode;
      if (code !== undefined && TRANSIENT_CODES.has(code)) {
        if (budget.attemptsLeft <= 0) {
          throw new IbkrFlexError(
            'timeout',
            `IBKR negeneroval výpis ani po ${maxAttempts} dotazech (${Math.round((maxAttempts * pollIntervalMs) / 1000)} s) — zkus synchronizaci za pár minut znovu.`,
          );
        }
        budget.attemptsLeft -= 1;
        await options.onPoll?.();
        await sleep(pollIntervalMs);
        continue;
      }
      // surové XML tělo uživateli neukazujeme — jen kód a případný popis
      throw translateError(code, response?.errorMessage);
    }
  }
}
