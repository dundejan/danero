import { XMLParser } from 'fast-xml-parser';

/**
 * Klient IBKR Flex Web Service (docs/03, docs/09 G2): dvoufázový protokol
 * SendRequest (token + query ID → referenceCode) → GetStatement (poll, dokud
 * se výpis generuje). Trpělivé retry — generování větších výpisů trvá minuty
 * a služba vrací 1019 „in progress“, případně 1018 „throttled“.
 */

const DEFAULT_BASE_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

/** Doména, které jediné smíme poslat Flex token (D-7). */
const IBKR_DOMAIN = 'interactivebrokers.com';

export interface IbkrFlexClientOptions {
  token: string;
  queryId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
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

/** Chybové kódy Flex Web Service přeložené do řeči uživatele. */
const ERROR_MESSAGES: Record<string, string> = {
  '1003': 'Výpis pro tuto query není dostupný — zkontroluj Query ID v IBKR (Performance & Reports → Flex Queries).',
  '1012': 'Token je neplatný nebo expiroval — vygeneruj v IBKR nový (Flex Web Service Configuration) a ulož ho znovu.',
  '1015': 'Token je neplatný — zkontroluj, že je zkopírovaný celý, bez mezer.',
  '1016': 'Token nepatří k tomuto účtu — zkontroluj, že query i token pochází ze stejného IBKR přihlášení.',
  '1020': 'Query ID neexistuje nebo k němu token nemá přístup — zkontroluj obojí v IBKR.',
};

interface StatementResponse {
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  referenceCode?: string;
  url?: string;
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
    url: text(response.Url),
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
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IbkrFlexClientOptions) {
    this.token = options.token;
    this.queryId = options.queryId;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * D-7: adresu pro vyzvednutí výpisu diktuje odpověď IBKR a my k ní připojíme
   * Flex token. Cizí hostname by tedy znamenal token poslaný cizímu serveru —
   * povolíme jen doménu IBKR (výpisy chodí i z jiné subdomény, než na kterou
   * se posílá SendRequest) nebo přesně tu, kterou má klient nakonfigurovanou
   * (mock v testech, vlastní proxy). Případný query string z odpovědi
   * zahazujeme — parametry si skládáme sami.
   */
  private resolveStatementUrl(raw: string | undefined): string {
    const fallback = `${this.baseUrl}/GetStatement`;
    if (!raw) return fallback;
    const base = new URL(fallback);
    let parsed: URL;
    try {
      parsed = new URL(raw, base);
    } catch {
      throw new IbkrFlexError(
        'bad-url',
        'IBKR vrátil nesrozumitelný odkaz na výpis — zkus synchronizaci za chvíli znovu.',
      );
    }
    const sameAsConfigured = parsed.origin === base.origin;
    const ibkrDomain =
      parsed.protocol === 'https:' &&
      (parsed.hostname === IBKR_DOMAIN || parsed.hostname.endsWith(`.${IBKR_DOMAIN}`));
    if (!sameAsConfigured && !ibkrDomain) {
      throw new IbkrFlexError(
        'bad-url',
        `IBKR vrátil odkaz na cizí adresu (${parsed.hostname}) — synchronizaci jsme zastavili a token nikam neposlali. Zkus to za chvíli znovu.`,
      );
    }
    return `${parsed.origin}${parsed.pathname}`;
  }

  private async get(url: string): Promise<string> {
    // HTTP vrstva: retry na 429/5xx a síťové chyby (max 5 pokusů, backoff)
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
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
          await sleep(5_000 * (attempt + 1));
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
        if (error instanceof IbkrFlexError && !['429'].includes(error.code)) throw error;
        lastError = error;
        await sleep(5_000 * (attempt + 1));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new IbkrFlexError('network', 'IBKR Flex služba neodpovídá — zkus to za chvíli znovu.');
  }

  /**
   * Fáze 1: objednání výpisu → referenceCode + URL pro vyzvednutí. Kód 1018
   * (throttling) je i tady dočasný — trpělivý retry, ne fatální chyba.
   */
  private async sendRequest(deadline: number, pollIntervalMs: number): Promise<{
    referenceCode: string;
    url: string;
  }> {
    for (;;) {
      const query = `t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(this.queryId)}&v=3`;
      const xml = await this.get(`${this.baseUrl}/SendRequest?${query}`);
      const response = readStatementResponse(xml);
      if (!response) {
        throw new IbkrFlexError(
          'bad-response',
          'Neočekávaná odpověď IBKR (SendRequest nevrátil XML) — zkus to za chvíli znovu.',
        );
      }
      if (response.status === 'Success' && response.referenceCode) {
        return {
          referenceCode: response.referenceCode,
          url: this.resolveStatementUrl(response.url),
        };
      }
      if (response.errorCode === '1018' && Date.now() < deadline) {
        await sleep(pollIntervalMs);
        continue;
      }
      throw translateError(response.errorCode, response.errorMessage);
    }
  }

  /**
   * Stáhne kompletní Flex XML výpis. Polluje GetStatement, dokud IBKR výpis
   * generuje (kód 1019) nebo škrtí (1018) — do `maxWaitMs`. `onPoll` se volá
   * při každém čekání (heartbeat pro nadřazený job).
   */
  async fetchStatementXml(
    pollIntervalMs = 10_000,
    maxWaitMs = 600_000,
    onPoll?: () => void | Promise<void>,
  ): Promise<string> {
    const deadline = Date.now() + maxWaitMs;
    const { referenceCode, url } = await this.sendRequest(deadline, pollIntervalMs);

    for (;;) {
      const query = `t=${encodeURIComponent(this.token)}&q=${encodeURIComponent(referenceCode)}&v=3`;
      const body = await this.get(`${url}?${query}`);

      // hotový výpis je FlexQueryResponse; FlexStatementResponse = stav/chyba
      if (body.includes('<FlexQueryResponse')) return body;

      const response = readStatementResponse(body);
      const code = response?.errorCode;
      if (code === '1019' || code === '1018' || code === '1021') {
        if (Date.now() >= deadline) {
          throw new IbkrFlexError(
            'timeout',
            'IBKR generuje výpis déle, než čekáme — zkus synchronizaci za pár minut znovu.',
          );
        }
        await onPoll?.();
        await sleep(pollIntervalMs);
        continue;
      }
      // surové XML tělo uživateli neukazujeme — jen kód a případný popis
      throw translateError(code, response?.errorMessage);
    }
  }
}
