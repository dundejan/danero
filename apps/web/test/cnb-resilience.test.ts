import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb } from '@/db';
import { fetchCnbYear, looksLikeCnbYearText, parseCnbYearText } from '@/lib/cnb';
import { withCron } from '@/lib/cron-auth';

/** Roční soubor ČNB s jednou nevalidní buňkou — přesně to, co shazovalo rok. */
const S_NA_BUNKOU = [
  'Datum|1 EUR|1 USD|100 JPY',
  '02.01.2026|25,120|N/A|15,320',
  '05.01.2026|25,080|22,430|-',
].join('\n');

const HTML_CHYBOVKA = `<!DOCTYPE html><html><head><title>Chyba</title></head>
<body><h1>Služba je dočasně nedostupná</h1></body></html>`;

const odpoved = (text: string): typeof fetch =>
  (async () => new Response(text, { status: 200 })) as typeof fetch;

describe('odolnost stahování kurzů ČNB', () => {
  it('G-4: nevalidní buňka (N/A, pomlčka) neshodí kurzy celého roku', () => {
    const rows = parseCnbYearText(S_NA_BUNKOU);
    // vypadnou jen ty dvě vadné buňky, zbytek roku zůstává
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.currency === 'USD' && r.day === '2026-01-02')).toBeUndefined();
    expect(rows.find((r) => r.currency === 'USD' && r.day === '2026-01-05')?.rate).toBe('22.43');
    expect(rows.find((r) => r.currency === 'EUR' && r.day === '2026-01-02')?.rate).toBe('25.12');
    expect(rows.find((r) => r.currency === 'JPY' && r.day === '2026-01-05')).toBeUndefined();
  });

  it('G-6: HTML chybová stránka s HTTP 200 se nesmí tvářit jako úspěch', async () => {
    expect(looksLikeCnbYearText(HTML_CHYBOVKA)).toBe(false);
    const db = await createPgliteDb();
    await expect(fetchCnbYear(db, 2026, odpoved(HTML_CHYBOVKA))).rejects.toThrow(
      /není kurzovní lístek/,
    );
  }, 30_000);

  it('G-5: duplicitní měna v hlavičce se před uložením deduplikuje', async () => {
    const db = await createPgliteDb();
    const duplicita = ['Datum|1 EUR|1 EUR', '02.01.2026|25,120|25,120'].join('\n');
    // bez deduplikace by tady na produkčním Postgresu spadl celý fx cron
    await expect(fetchCnbYear(db, 2026, odpoved(duplicita))).resolves.toBe(1);
  }, 30_000);
});

describe('log cron běhů (G-6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  const request = () =>
    new Request('https://danero.cz/api/cron/fx', {
      headers: { authorization: 'Bearer tajne' },
    });

  it('dokončení se loguje včetně počtu zpracovaných položek', async () => {
    process.env.CRON_SECRET = 'tajne';
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const handler = withCron('fx', async () => Response.json({ year: 2026, rows: 42 }));

    await handler(request());

    const events = info.mock.calls.map((call) => JSON.parse(String(call[0])));
    const finished = events.find((event) => event.event === 'cron.fx.finished');
    expect(finished).toBeDefined();
    expect(finished.rows).toBe(42);
    expect(finished.status).toBe(200);
    expect(typeof finished.durationMs).toBe('number');
  });

  it('selhání se loguje jako error a chyba propadne dál', async () => {
    process.env.CRON_SECRET = 'tajne';
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = withCron('fx', async () => {
      throw new Error('ČNB neodpovídá');
    });

    await expect(handler(request())).rejects.toThrow('ČNB neodpovídá');

    const events = error.mock.calls.map((call) => JSON.parse(String(call[0])));
    const failed = events.find((event) => event.event === 'cron.fx.failed');
    expect(failed).toBeDefined();
    expect(failed.error).toContain('ČNB neodpovídá');
  });
});
