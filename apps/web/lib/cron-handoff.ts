import { after } from 'next/server';
import { errorText, logEvent } from '@/lib/log';

/**
 * Jak dlouho čekáme na odpověď navazující invokace. Není to čekání na její
 * dokončení: každá invokace má vlastní limit běhu, tohle je jen pojistka, že
 * požadavek opravdu odešel.
 */
const HANDOFF_TIMEOUT_MS = 10_000;

/**
 * Předá zbytek práce další invokaci cron routy — jedna funkce smí běžet jen
 * omezenou dobu (`maxDuration`), takže frontu delší než jeden běh zpracuje
 * řetěz po sobě jdoucích volání. Volající musí sám zaručit, že řetěz skončí
 * (předává jen po skutečném postupu).
 *
 * K5-12: `fetch` na chybový stav NEVYHAZUJE. Selhání navazující invokace (500)
 * se sice zaloguje v ní samé, ale požadavek, který do aplikace vůbec nedorazil
 * (Vercel 429/502) nebo skončil na 401 (přenastavené CRON_SECRET), by prošel
 * jako úspěšné předání — a zbytek fronty by nedostal nic, aniž by se to kdekoli
 * objevilo jako chyba. Proto se kontroluje i stav odpovědi.
 *
 * @param name název cronu do logu (`cron.<name>.handoff`)
 * @param detail čísla do logu, podle kterých se pozná, kde řetěz stál
 */
export function handOffCron(name: string, target: URL, detail: Record<string, number>): void {
  logEvent('info', `cron.${name}.handoff`, detail);
  after(async () => {
    try {
      const response = await fetch(target, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        signal: AbortSignal.timeout(HANDOFF_TIMEOUT_MS),
      });
      if (!response.ok) {
        logEvent('error', `cron.${name}.handoff_failed`, {
          ...detail,
          status: response.status,
          error: `štafeta odmítnuta se stavem ${response.status}`,
        });
      }
    } catch (error) {
      // TimeoutError = navazující invokace běží dál sama, jen jsme přestali
      // čekat na její odpověď; cokoli jiného je skutečné selhání předání
      if (error instanceof Error && error.name === 'TimeoutError') return;
      logEvent('error', `cron.${name}.handoff_failed`, { ...detail, error: errorText(error) });
    }
  });
}

/** Kolik invokací smí řetěz jobů nejvýš mít — pojistka proti zacyklení. */
const MAX_JOB_HOPS = 40;

/**
 * Adresa, na které běží záchranný cron jobů téhle instance. Server action ji
 * z požadavku nezná, proto se skládá z veřejné adresy aplikace.
 */
const jobsCronUrl = (base: string): URL => new URL('/api/cron/jobs', base);

/**
 * Nechá zbytek fronty jobů dojet v další invokaci `/api/cron/jobs`.
 *
 * Volá se, když po běhu zůstalo ve frontě něco, co má pokračovat hned: job,
 * který se přerušil kvůli limitu běhu (`SyncPaused`), nebo joby, na které se
 * nedostalo. Bez předání by čekaly na příští plánované spuštění cronu — na
 * Vercel Hobby až den, protože častější cron než denní tam nejde.
 *
 * `hop` počítá, kolikátá invokace řetězu to je. Řetěz končí sám (každá část
 * plného syncu stáhne aspoň rok a roků je konečně mnoho), `MAX_JOB_HOPS` je
 * jen pojistka pro případ, že by se v tom někdo spletl.
 */
export function continueJobsElsewhere(origin: string | URL, hop: number): void {
  if (!process.env.CRON_SECRET) {
    // bez tajemství by navazující volání skončilo na 401 — zbytek dojede
    // s příštím plánovaným během cronu (dev, vlastní instance bez cronů)
    return;
  }
  if (hop >= MAX_JOB_HOPS) {
    logEvent('error', 'cron.jobs.handoff_failed', {
      hop,
      error: `řetěz jobů dosáhl stropu ${MAX_JOB_HOPS} invokací — zbytek počká na příští cron`,
    });
    return;
  }
  const target = jobsCronUrl(String(origin));
  target.searchParams.set('hop', String(hop + 1));
  handOffCron('jobs', target, { hop: hop + 1 });
}

/** Pořadí invokace v řetězu jobů z `?hop=` (0 = spuštěno plánovačem). */
export function hopFrom(request: Request): number {
  const raw = Number(new URL(request.url).searchParams.get('hop') ?? '0');
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}
