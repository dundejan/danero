/**
 * Mock broker API pro E2E testy (Playwright ho startuje jako webServer):
 * Trading212 (export se objednává POSTem a polluje) i IBKR Flex Web Service
 * (SendRequest → GetStatement). Data: test/t212-data.mjs a test/ibkr-data.mjs.
 */
import { createServer } from 'node:http';
import { FLEX_SEND_OK, IBKR_FLEX_XML } from '../test/ibkr-data.mjs';
import { CASH, csvByYear, INSTRUMENTS, PORTFOLIO } from '../test/t212-data.mjs';

const PORT = Number(process.env.PORT ?? 3211);
const CSV_BY_YEAR = csvByYear('E2ESYNC');

const reportYears = new Map();
let lastReportId = 100;

const json = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * Selhání na objednávku: účet připojený s ID klíče (Trading 212) nebo tokenem
 * (IBKR) ve tvaru `selhani-<kód>` dostane místo dat chybu s tím kódem. Scénáře
 * tak zkouší, co uživatel uvidí, když broker neodpovídá nebo klíč nefunguje.
 */
const FAILURE_KEY = /^selhani-(\d+)/;

/**
 * Kód selhání, o které si požadavek Trading 212 řekl svým klíčem: ID klíče
 * v hlavičce Basic, nebo samotný tajný klíč (starší způsob přihlášení, na
 * který klient po 401 přechází — klíč `selhani-401…` proto musí nést obojí).
 */
function requestedT212Failure(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, value] = header.split(' ');
  const key =
    scheme === 'Basic' && value
      ? Buffer.from(value, 'base64').toString('utf8').split(':')[0]
      : header;
  const match = FAILURE_KEY.exec(key);
  return match ? Number(match[1]) : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/health') return json(res, { ok: true });

  // ── IBKR Flex Web Service ────────────────────────────────────────────────
  if (path === '/flex/SendRequest') {
    res.writeHead(200, { 'content-type': 'text/xml' });
    const failure = FAILURE_KEY.exec(url.searchParams.get('t') ?? '');
    if (failure) {
      return res.end(
        `<FlexStatementResponse><Status>Fail</Status><ErrorCode>${failure[1]}</ErrorCode><ErrorMessage>Mock failure ${failure[1]}</ErrorMessage></FlexStatementResponse>`,
      );
    }
    return res.end(FLEX_SEND_OK(`http://localhost:${PORT}/flex/GetStatement`));
  }
  if (path === '/flex/GetStatement') {
    // E2E vrací výpis hned — poll cestu (1019) pokrývají unit testy
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(IBKR_FLEX_XML);
  }

  // ── Trading212 ───────────────────────────────────────────────────────────
  const t212Failure = requestedT212Failure(req);
  // 401 a 403 odmítnou už ověření klíče, ostatní kódy až objednávku exportu
  if (
    t212Failure !== null &&
    (t212Failure === 401 || t212Failure === 403 || path === '/api/v0/history/exports')
  ) {
    for await (const chunk of req) void chunk;
    res.writeHead(t212Failure, { 'content-type': 'application/json', 'retry-after': '1' });
    return res.end(JSON.stringify({ code: 'MockFailure', message: `Mock failure ${t212Failure}` }));
  }
  if (path === '/api/v0/equity/account/cash') {
    return json(res, CASH);
  }
  if (path === '/api/v0/history/exports' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const year = Number(JSON.parse(body).timeFrom.slice(0, 4));
    lastReportId += 1;
    reportYears.set(lastReportId, year);
    return json(res, { reportId: lastReportId });
  }
  if (path === '/api/v0/history/exports') {
    return json(res, [
      {
        reportId: lastReportId,
        status: 'Finished',
        downloadLink: `http://localhost:${PORT}/downloads/${lastReportId}.csv`,
      },
    ]);
  }
  const download = /^\/downloads\/(\d+)\.csv$/.exec(path);
  if (download) {
    const year = reportYears.get(Number(download[1]));
    res.writeHead(200, { 'content-type': 'text/csv' });
    return res.end(CSV_BY_YEAR[year] ?? '');
  }
  if (path === '/api/v0/equity/portfolio') {
    return json(res, PORTFOLIO);
  }
  if (path === '/api/v0/equity/metadata/instruments') {
    return json(res, INSTRUMENTS);
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: `Mock nezná ${req.method} ${path}` }));
});

server.listen(PORT, () => {
  console.log(`T212 mock server běží na :${PORT}`);
});
