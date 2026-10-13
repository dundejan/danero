/**
 * Read-only klient Trading212 Public API (https://docs.trading212.com/api).
 *
 * Strategie synchronizace (docs/03): historii NEmapujeme z JSON endpointů, ale necháme
 * T212 vygenerovat CSV export (`POST /equity/history/exports`) a ten prochází stejným
 * parserem jako ruční upload — jedna cesta, jedna sada testů. API dále dává aktuální
 * pozice pro rekonciliaci; ISIN nesou samy, číselník instrumentů je jen záloha.
 *
 * Autentizace: pár API Key + Secret přes HTTP Basic. Starší způsob — samotný klíč
 * v hlavičce `Authorization` — vede specifikace dál jako `legacyApiKeyHeader`;
 * klient umí obojí a `resolveClient` v aplikaci si zjistí, co pro daný klíč platí.
 *
 * API jde jen nad účty Invest a Stocks ISA (CFD ne) a klíč z režimu Practice
 * na ostré adrese končí 401.
 */

export interface Trading212ClientOptions {
  apiKey: string;
  /** Je-li zadán, použije se HTTP Basic (key:secret); jinak jde klíč přímo do Authorization. */
  apiSecret?: string;
  /** Default https://live.trading212.com/api/v0 (demo: https://demo.trading212.com/api/v0). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class Trading212ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'Trading212ApiError';
  }
}

/**
 * Otevřená pozice v jednotném tvaru. T212 ji posílá dvěma způsoby podle cesty
 * (viz `ENDPOINT_PATHS`) a `getPositions` je srovná na tenhle.
 */
export interface Trading212Position {
  ticker: string;
  quantity: number;
  /** Aktuální cena za kus v měně instrumentu. */
  currentPrice?: number;
  /** Nese ho jen dokumentovaná cesta `/equity/positions`; starší `/equity/portfolio` ne. */
  isin?: string;
  /** Měna instrumentu — taky jen z `/equity/positions`. */
  currency?: string;
}

export interface Trading212Instrument {
  ticker: string;
  isin: string;
  currencyCode: string;
  name: string;
  type?: string;
}

export interface Trading212AccountSummary {
  /** Hlavní měna účtu — zná ji jen dokumentovaná cesta `/equity/account/summary`. */
  currency?: string;
  /** Hotovost volná k investování. */
  freeCash?: number;
}

export interface ExportRequest {
  timeFrom: string; // ISO 8601
  timeTo: string;
  dataIncluded: {
    includeOrders: boolean;
    includeDividends: boolean;
    includeTransactions: boolean;
    includeInterest: boolean;
  };
}

export interface ExportStatus {
  reportId: number;
  timeFrom: string;
  timeTo: string;
  status: 'Queued' | 'Processing' | 'Running' | 'Canceled' | 'Failed' | 'Finished' | string;
  downloadLink?: string;
}

export interface ExportPollOptions {
  /** Prodleva mezi dotazy na stav exportu (GET /history/exports snese ~1 dotaz/min). */
  pollIntervalMs?: number;
  /** Kolikrát se na stav zeptáme, než čekání vzdáme. Celkem tedy `maxAttempts × pollIntervalMs`. */
  maxAttempts?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cesty endpointů: napřed ta z dokumentace, za ní starší, na které klient
 * běžel dřív. Dokumentace (https://docs.trading212.com/api, OpenAPI specifikace
 * z 13. 10. 2026) zná už jen první sloupec — `/equity/account/cash`
 * a `/equity/portfolio` z ní zmizely na přelomu let 2025 a 2026, exporty se
 * přestěhovaly pod `/equity`. Ostré API k témuž datu odpovídá na obojí
 * (nepřihlášený dotaz vrací 401 na všech šesti cestách, 404 na smyšlené).
 *
 * Starší cesta je záloha pro 404: kdyby T212 kteroukoli z dvojice vypnul,
 * sync ani připojení účtu nespadne. Bez zálohy by spadl KAŽDÝ sync, protože
 * klíč se ověřuje právě dotazem na účet — a mock, který by zrušenou cestu
 * obsluhoval dál, by to v testech zakryl.
 */
const ENDPOINT_PATHS = {
  account: ['/equity/account/summary', '/equity/account/cash'],
  positions: ['/equity/positions', '/equity/portfolio'],
  exports: ['/equity/history/exports', '/history/exports'],
} as const satisfies Record<string, readonly [string, string]>;

type EndpointName = keyof typeof ENDPOINT_PATHS;

/** Kolik nejdéle čekáme na jedno obnovení limitu a kolik celkem na jeden dotaz. */
const RATE_LIMIT_MAX_WAIT_SECONDS = 120;

/**
 * Jak dlouho po odpovědi 429 počkat. Dokumentace slibuje u každé odpovědi
 * `x-ratelimit-reset` (unixový čas, kdy se limit obnoví); `Retry-After`
 * nezmiňuje, ale kdyby přišel, má přednost. Bez obou se čeká 30 s — to je
 * případ exportů, které podle hlášení z fóra T212 (18. 9. 2026) u 429
 * neposílají ani jedno.
 *
 * Dokud se četlo jen `Retry-After`, čekalo se půl minuty i tam, kde se limit
 * obnoví za vteřinu (pozice 1 dotaz/s), a pět takových čekání je 150 s
 * z 225 s, které má běh jobů. Limity jsou navíc na ÚČET, ne na klíč, takže je
 * vyčerpá i jiná aplikace téhož uživatele.
 */
function rateLimitWaitSeconds(headers: Headers): number {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, RATE_LIMIT_MAX_WAIT_SECONDS);
  }
  const resetAt = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(resetAt) && resetAt > 0) {
    // +1 s: čas v hlavičce je na celé sekundy a hodiny dvou strojů se rozcházejí
    const untilReset = Math.max(resetAt - Date.now() / 1000, 0) + 1;
    return Math.min(untilReset, RATE_LIMIT_MAX_WAIT_SECONDS);
  }
  return 30;
}

const unexpectedPositionsShape = (): Trading212ApiError =>
  new Trading212ApiError(
    502,
    'Trading212 vrátil pozice nebo číselník instrumentů v jiném tvaru, než čekáme — porovnání pozic proto neproběhlo. Bývá to změna na straně brokera; zkus synchronizaci za chvíli znovu, a jestli to bude trvat, dej nám vědět.',
  );

/** Pozice, jak ji posílá jedna nebo druhá cesta (viz `ENDPOINT_PATHS`). */
interface RawPosition {
  ticker?: unknown;
  quantity?: unknown;
  currentPrice?: unknown;
  instrument?: { ticker?: unknown; isin?: unknown; currency?: unknown } | null;
}

/**
 * `/equity/positions` nese instrument jako vnořený objekt i s ISIN a měnou,
 * `/equity/portfolio` jen ticker na nejvyšší úrovni. Položka bez tickeru nebo
 * počtu kusů je tvar, který neznáme — a zahodit ji potichu nejde: pozice
 * chybějící v odpovědi by vypadala jako kusy, které u brokera nemáš.
 */
function normalizePosition(raw: unknown): Trading212Position {
  if (typeof raw !== 'object' || raw === null) throw unexpectedPositionsShape();
  const item = raw as RawPosition;
  const ticker = item.instrument?.ticker ?? item.ticker;
  if (typeof ticker !== 'string' || ticker === '' || typeof item.quantity !== 'number') {
    throw unexpectedPositionsShape();
  }
  const isin = item.instrument?.isin;
  const currency = item.instrument?.currency;
  return {
    ticker,
    quantity: item.quantity,
    ...(typeof item.currentPrice === 'number' ? { currentPrice: item.currentPrice } : {}),
    ...(typeof isin === 'string' && isin !== '' ? { isin } : {}),
    ...(typeof currency === 'string' && currency !== '' ? { currency } : {}),
  };
}

export class Trading212Client {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;
  /** Endpointy, u kterých dokumentovaná cesta vrátila 404 a jede se po starší. */
  private readonly onLegacyPath = new Set<EndpointName>();

  constructor(options: Trading212ClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://live.trading212.com/api/v0').replace(/\/$/, '');
    this.authorization = options.apiSecret
      ? `Basic ${Buffer.from(`${options.apiKey}:${options.apiSecret}`).toString('base64')}`
      : options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let lastStatus = 0;
    let waitedSeconds = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: this.authorization,
          ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      lastStatus = response.status;
      if (response.status === 429) {
        // Čekání má strop i v součtu: pět čekání po 120 s by bylo deset minut,
        // dvakrát víc, než kolik smí běžet celá funkce (docs/08, limity Vercelu).
        const waitSeconds = rateLimitWaitSeconds(response.headers);
        if (waitedSeconds + waitSeconds > RATE_LIMIT_MAX_WAIT_SECONDS) break;
        waitedSeconds += waitSeconds;
        await sleep(waitSeconds * 1000);
        continue;
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Trading212ApiError(
          response.status,
          `Trading212 API ${response.status} na ${path}${detail ? `: ${detail.slice(0, 300)}` : ''}`,
        );
      }
      return (await response.json()) as T;
    }
    throw new Trading212ApiError(lastStatus, `Trading212 API: rate limit i po opakování (${path})`);
  }

  /**
   * Dotaz na endpoint, který má dvě cesty (`ENDPOINT_PATHS`). Na 404 z té
   * dokumentované se zkusí starší a volba se zapamatuje — opakovaný pokus
   * stojí požadavek a u exportů je limit 1 za 30 s.
   */
  private async requestEndpoint<T>(
    name: EndpointName,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    const [documented, legacy] = ENDPOINT_PATHS[name];
    if (this.onLegacyPath.has(name)) return this.request<T>(legacy, init);
    try {
      return await this.request<T>(documented, init);
    } catch (error) {
      if (!(error instanceof Trading212ApiError) || error.status !== 404) throw error;
      const result = await this.request<T>(legacy, init);
      this.onLegacyPath.add(name);
      return result;
    }
  }

  /**
   * Nejlevnější ověření platnosti klíče. Odpověď se čte shovívavě (obě cesty
   * ji mají jinak) — o tom, jestli klíč platí, rozhoduje stavový kód.
   */
  async getAccountSummary(): Promise<Trading212AccountSummary> {
    const body = await this.requestEndpoint<{
      currency?: unknown;
      free?: unknown;
      cash?: { availableToTrade?: unknown } | null;
    } | null>('account');
    const freeCash = body?.cash?.availableToTrade ?? body?.free;
    return {
      ...(typeof body?.currency === 'string' ? { currency: body.currency } : {}),
      ...(typeof freeCash === 'number' ? { freeCash } : {}),
    };
  }

  /** Aktuální otevřené pozice — vstup rekonciliace. */
  async getPositions(): Promise<Trading212Position[]> {
    const body = await this.requestEndpoint<unknown>('positions');
    if (!Array.isArray(body)) throw unexpectedPositionsShape();
    return body.map(normalizePosition);
  }

  /**
   * Číselník instrumentů (ticker → ISIN, měna). Odpověď má několik megabajtů
   * a limit je 1 dotaz za 50 s — ptej se jen tehdy, když pozice ISIN nenesou
   * samy (`positionsCarryIsin`).
   */
  getInstruments(): Promise<Trading212Instrument[]> {
    return this.request('/equity/metadata/instruments');
  }

  /** Požádá o vygenerování CSV exportu historie (asynchronní; sleduj listExports). */
  requestExport(request: ExportRequest): Promise<{ reportId: number }> {
    return this.requestEndpoint('exports', { method: 'POST', body: request });
  }

  listExports(): Promise<ExportStatus[]> {
    return this.requestEndpoint('exports');
  }

  /**
   * Stáhne hotový CSV export (downloadLink je podepsaná URL bez autentizace).
   * Useknuté tělo (přerušený přenos) se naparsuje BEZ jediné chyby a rok by se
   * pak navždy považoval za stažený — proto se délka porovnává s Content-Length.
   * Komprimovanou odpověď neověřujeme (hlavička platí pro komprimované bajty).
   */
  async downloadCsv(downloadLink: string): Promise<string> {
    const response = await (this.fetchImpl)(downloadLink, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Trading212ApiError(response.status, `Stažení exportu selhalo (${response.status})`);
    }
    const text = await response.text();
    const declared = response.headers.get('content-length');
    const encoding = (response.headers.get('content-encoding') ?? 'identity').toLowerCase();
    const actual = new TextEncoder().encode(text).length;
    if (declared !== null && encoding === 'identity' && Number(declared) !== actual) {
      throw new Trading212ApiError(
        502,
        `Stažený export je neúplný — přišlo ${actual} z ${declared} bajtů, přenos se zřejmě přerušil. Spusť synchronizaci znovu.`,
      );
    }
    return text;
  }

  /**
   * Vyžádá export, počká na vygenerování a vrátí CSV text (poll s limitem).
   * Pro cron sync v aplikaci; interaktivně raději requestExport + notifikace.
   *
   * Čekání je vedené POČTEM dotazů, ne časovým rozpočtem (K5-16). Časový
   * rozpočet se totiž kontroloval před uspáním, takže se o celý interval
   * překračoval: naměřeno 10 dotazů a 671 s tam, kde volající zadal 600 s.
   * Export, který se nikdy neobjeví (`reportId` chybí v seznamu), tím spolykal
   * víc, než kolik má celý tick cronu na VŠECHNY joby — a zbylé roky i účty
   * se ten běh nestihly vůbec.
   */
  async fetchHistoryCsv(request: ExportRequest, options: ExportPollOptions = {}): Promise<string> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const maxAttempts = options.maxAttempts ?? 60;
    const { reportId } = await this.requestExport(request);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await sleep(pollIntervalMs);
      const exports = await this.listExports();
      const found = exports.find((e) => e.reportId === reportId);
      if (!found) continue;
      // `Canceled` je konečný stav stejně jako `Failed`: hotový už nebude, takže
      // čekat do stropu by skončilo jako 408 a větou „broker teď neodpovídá“,
      // přestože odpověděl.
      if (found.status === 'Failed' || found.status === 'Canceled') {
        throw new Trading212ApiError(
          500,
          found.status === 'Canceled'
            ? `Export ${reportId} byl na straně Trading212 zrušen.`
            : `Export ${reportId} selhal na straně Trading212.`,
        );
      }
      if (found.status === 'Finished' && found.downloadLink) {
        return this.downloadCsv(found.downloadLink);
      }
    }
    throw new Trading212ApiError(
      408,
      `Export ${reportId} nebyl vygenerován ani po ${maxAttempts} dotazech (${Math.round((maxAttempts * pollIntervalMs) / 1000)} s).`,
    );
  }
}

export interface IsinPosition {
  isin: string;
  quantity: number;
  ticker: string;
  /** Aktuální cena za kus v měně instrumentu. */
  currentPrice?: number;
  currency?: string;
}

/** Nesou pozice ISIN samy? Pak číselník instrumentů není k párování potřeba. */
export const positionsCarryIsin = (positions: Trading212Position[]): boolean =>
  positions.every((position) => position.isin !== undefined);

/**
 * Namapuje pozice (interní tickery T212) na ISIN: vezme ho z pozice samé,
 * a kde ho pozice nenese (starší cesta API), dohledá ho v číselníku
 * instrumentů.
 *
 * Tvar odpovědi se ověřuje, i když typy slibují pole: `request()` vrací, co
 * přijde, takže změna na straně brokera (obalení do `{ items: […] }`, chybová
 * struktura s HTTP 200) skončí uvnitř `for…of` jako `TypeError`. Naměřeno:
 * uživatel četl v UI „positions is not iterable“ — anglickou runtime hlášku,
 * ze které nepozná, jestli je vada u něj, u brokera, nebo u nás.
 */
export function mapPositionsToIsin(
  positions: Trading212Position[],
  instruments: Trading212Instrument[] = [],
): { positions: IsinPosition[]; unmatchedTickers: string[] } {
  if (!Array.isArray(positions) || !Array.isArray(instruments)) {
    throw unexpectedPositionsShape();
  }
  const byTicker = new Map(instruments.map((i) => [i.ticker, i]));
  const mapped: IsinPosition[] = [];
  const unmatched: string[] = [];
  for (const position of positions) {
    const instrument = byTicker.get(position.ticker);
    const isin = position.isin ?? instrument?.isin;
    if (isin) {
      mapped.push({
        isin,
        quantity: position.quantity,
        ticker: position.ticker,
        currentPrice: position.currentPrice,
        currency: position.currency ?? instrument?.currencyCode,
      });
    } else {
      unmatched.push(position.ticker);
    }
  }
  return { positions: mapped, unmatchedTickers: unmatched };
}
