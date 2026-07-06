/**
 * Read-only klient Trading212 Public API (https://docs.trading212.com/api).
 *
 * Strategie synchronizace (docs/03): historii NEmapujeme z JSON endpointů, ale necháme
 * T212 vygenerovat CSV export (`POST /history/exports`) a ten prochází stejným parserem
 * jako ruční upload — jedna cesta, jedna sada testů. API dále dává aktuální pozice
 * a metadata instrumentů (ticker → ISIN) pro rekonciliaci.
 *
 * Autentizace: klíč se posílá v hlavičce `Authorization`. Novější dokumentace zmiňuje
 * API Key + Secret (HTTP Basic) — klient umí obojí; ověř na svém účtu, která varianta
 * pro tvůj klíč platí.
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

export interface Trading212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  initialFillDate?: string;
}

export interface Trading212Instrument {
  ticker: string;
  isin: string;
  currencyCode: string;
  name: string;
  type?: string;
}

export interface Trading212CashSummary {
  free: number;
  total: number;
  invested: number;
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
  status: 'Queued' | 'Processing' | 'Running' | 'Finished' | 'Failed' | string;
  downloadLink?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class Trading212Client {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: Trading212ClientOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://live.trading212.com/api/v0').replace(/\/$/, '');
    this.authorization = options.apiSecret
      ? `Basic ${Buffer.from(`${options.apiKey}:${options.apiSecret}`).toString('base64')}`
      : options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
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
        // rate limit — čekej dle Retry-After, jinak 2 s
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000);
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

  /** Nejlevnější ověření platnosti klíče. */
  getCash(): Promise<Trading212CashSummary> {
    return this.request('/equity/account/cash');
  }

  /** Aktuální otevřené pozice — vstup rekonciliace. */
  getPositions(): Promise<Trading212Position[]> {
    return this.request('/equity/portfolio');
  }

  /** Číselník instrumentů (ticker → ISIN, měna). Velká odpověď — cachovat. */
  getInstruments(): Promise<Trading212Instrument[]> {
    return this.request('/equity/metadata/instruments');
  }

  /** Požádá o vygenerování CSV exportu historie (asynchronní; sleduj listExports). */
  requestExport(request: ExportRequest): Promise<{ reportId: number }> {
    return this.request('/history/exports', { method: 'POST', body: request });
  }

  listExports(): Promise<ExportStatus[]> {
    return this.request('/history/exports');
  }

  /** Stáhne hotový CSV export (downloadLink je podepsaná URL bez autentizace). */
  async downloadCsv(downloadLink: string): Promise<string> {
    const response = await (this.fetchImpl)(downloadLink, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Trading212ApiError(response.status, `Stažení exportu selhalo (${response.status})`);
    }
    return response.text();
  }

  /**
   * Vyžádá export, počká na vygenerování a vrátí CSV text (poll s limitem).
   * Pro cron sync v aplikaci; interaktivně raději requestExport + notifikace.
   */
  async fetchHistoryCsv(request: ExportRequest, pollIntervalMs = 5_000, maxWaitMs = 300_000): Promise<string> {
    const { reportId } = await this.requestExport(request);
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const exports = await this.listExports();
      const found = exports.find((e) => e.reportId === reportId);
      if (!found) continue;
      if (found.status === 'Failed') {
        throw new Trading212ApiError(500, `Export ${reportId} selhal na straně Trading212.`);
      }
      if (found.status === 'Finished' && found.downloadLink) {
        return this.downloadCsv(found.downloadLink);
      }
    }
    throw new Trading212ApiError(408, `Export ${reportId} nebyl vygenerován do ${maxWaitMs / 1000} s.`);
  }
}

export interface IsinPosition {
  isin: string;
  quantity: number;
  ticker: string;
}

/** Namapuje pozice (interní tickery T212) na ISIN přes číselník instrumentů. */
export function mapPositionsToIsin(
  positions: Trading212Position[],
  instruments: Trading212Instrument[],
): { positions: IsinPosition[]; unmatchedTickers: string[] } {
  const byTicker = new Map(instruments.map((i) => [i.ticker, i]));
  const mapped: IsinPosition[] = [];
  const unmatched: string[] = [];
  for (const position of positions) {
    const instrument = byTicker.get(position.ticker);
    if (instrument) {
      mapped.push({ isin: instrument.isin, quantity: position.quantity, ticker: position.ticker });
    } else {
      unmatched.push(position.ticker);
    }
  }
  return { positions: mapped, unmatchedTickers: unmatched };
}
