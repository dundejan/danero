import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPgliteDb } from '@/db';
import {
  ensureCnbYears,
  fetchCnbYear,
  looksLikeCnbYearText,
  parseCnbYearText,
  resetCnbBackfillState,
} from '@/lib/cnb';
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
    const { rows } = parseCnbYearText(S_NA_BUNKOU);
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

  /**
   * K5-06: hlavička zůstane, ale řádky pod ní změní formát (tady datum na ISO).
   * `looksLikeCnbYearText` stojí na hlavičce, takže tohle propustí — a cron by
   * odpověděl HTTP 200 s nulou uložených kurzů. Naměřeno před opravou:
   * `{ vratilo: 0, datovychRadku: 2, rozparsovano: 0 }`, bez jediné výjimky.
   */
  it('K5-06: změna formátu řádků pod nezměněnou hlavičkou musí spadnout nahlas', async () => {
    const zmenaFormatu = [
      'Datum|1 EUR|1 USD',
      '2026-01-02|25,120|22,430',
      '2026-01-05|25,080|22,410',
    ].join('\n');
    expect(looksLikeCnbYearText(zmenaFormatu)).toBe(true); // hlavička je v pořádku
    expect(parseCnbYearText(zmenaFormatu)).toEqual({ rows: [], dataLines: 2 });
    const db = await createPgliteDb();
    await expect(fetchCnbYear(db, 2026, odpoved(zmenaFormatu))).rejects.toThrow(
      /ani z jednoho jsme nepřečetli kurz/,
    );
  }, 30_000);

  /**
   * Protipól: „0 řádků = selhání“ by křičelo každý Nový rok. 1. ledna je
   * svátek, ČNB nevyhlašuje a roční soubor je legitimně jen hlavička — cron
   * stahuje běžný rok, takže by tenhle stav nastal vždycky.
   */
  it('K5-06: prázdný rok (jen hlavička) selhat NESMÍ', async () => {
    const prazdnyRok = 'Datum|1 EUR|1 USD';
    expect(parseCnbYearText(prazdnyRok)).toEqual({ rows: [], dataLines: 0 });
    const db = await createPgliteDb();
    await expect(fetchCnbYear(db, 2026, odpoved(prazdnyRok))).resolves.toBe(0);
  }, 30_000);

  it('G-5: duplicitní měna v hlavičce se před uložením deduplikuje', async () => {
    const db = await createPgliteDb();
    const duplicita = ['Datum|1 EUR|1 EUR', '02.01.2026|25,120|25,120'].join('\n');
    // bez deduplikace by tady na produkčním Postgresu spadl celý fx cron
    await expect(fetchCnbYear(db, 2026, odpoved(duplicita))).resolves.toBe(1);
  }, 30_000);

  /**
   * F-3-5: `ensureCnbYears` běží uvnitř renderu stránky a nic ho
   * nededuplikovalo — 20 souběžných renderů znamenalo 60 stažení z cnb.cz
   * (naměřeno), při 10leté historii a 50 uživatelích 550 požadavků v jedné
   * vlně. A protože `fetchCnbYear` má timeout 60 s na rok, každý neúspěch
   * ukrajoval z rozpočtu stránky.
   */
  it('souběžné rendery sdílejí jedno stažení na rok, ne jedno na render', async () => {
    resetCnbBackfillState();
    const db = await createPgliteDb();
    let stazeni = 0;
    const pomaly: typeof fetch = (async () => {
      stazeni += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(['Datum|1 EUR', '02.01.2026|25,120'].join('\n'), { status: 200 });
    }) as typeof fetch;

    const roky = [2024, 2025, 2026];
    await Promise.all(
      Array.from({ length: 20 }, () => ensureCnbYears(db, roky, pomaly)),
    );

    expect(stazeni).toBe(roky.length);
  }, 30_000);

  it('po neúspěchu se rok chvíli nezkouší znovu (timeout 60 s na pokus)', async () => {
    resetCnbBackfillState();
    const db = await createPgliteDb();
    let pokusy = 0;
    const rozbity: typeof fetch = (async () => {
      pokusy += 1;
      return new Response('mimo provoz', { status: 503 });
    }) as typeof fetch;

    await expect(ensureCnbYears(db, [2026], rozbity)).rejects.toThrow(/HTTP 503/);
    // druhý render v pauze už ČNB neobtěžuje a nezdržuje uživatele
    await expect(ensureCnbYears(db, [2026], rozbity)).resolves.toBeUndefined();
    expect(pokusy).toBe(1);

    // po vypršení pauzy (tady simulované resetem stavu) se to zkusí znovu
    resetCnbBackfillState();
    await expect(ensureCnbYears(db, [2026], rozbity)).rejects.toThrow(/HTTP 503/);
    expect(pokusy).toBe(2);
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
