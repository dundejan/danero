import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážný test limitů hostingu.
 *
 * Hostovaná instance běží na Vercel Hobby (zdarma). Ten má dva limity, které
 * neohlásí chybu v aplikaci, ale **shodí celé nasazení**:
 *
 * - cron smí běžet nejvýš jednou denně — častější výraz skončí hláškou
 *   „Hobby accounts are limited to daily cron jobs“,
 * - `maxDuration` funkce smí být nejvýš 300 s — ať je zapsaná exportem
 *   v routě, nebo klíčem `functions` ve `vercel.json`.
 *
 * Obojí se pozná až při deployi, tedy po pushi do main. Tenhle test to chytí
 * dřív. Kdo provozuje vlastní instanci na placeném tarifu nebo v Dockeru, může
 * si limity zvednout — ale v repozitáři drží hodnoty, se kterými projde Hobby.
 *
 * Častější běh záchranného cronu jobů zajišťuje `.github/workflows/jobs-rescue.yml`.
 */
const MAX_DURATION_S = 300;
const APP_DIR = join(import.meta.dirname, '..', 'app');
const VERCEL_JSON = join(import.meta.dirname, '..', 'vercel.json');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('limity hostingu (Vercel Hobby)', () => {
  it(`žádná routa ani stránka nežádá maxDuration nad ${MAX_DURATION_S} s`, () => {
    const found: Array<{ file: string; seconds: number }> = [];
    for (const file of sourceFiles(APP_DIR)) {
      const match = /^export const maxDuration = (\d+);/m.exec(readFileSync(file, 'utf8'));
      if (match) found.push({ file, seconds: Number(match[1]) });
    }
    // kdyby regulár přestal sedět na zápis v kódu, test by tiše hlídal prázdno
    expect(found.length).toBeGreaterThan(5);
    expect(found.filter((entry) => entry.seconds > MAX_DURATION_S)).toEqual([]);
  });

  it(`vercel.json nezvedá maxDuration žádné funkci nad ${MAX_DURATION_S} s`, () => {
    // Klíč `functions` je druhá cesta k témuž limitu (L13-07). Export v routě
    // má před ním přednost, takže škodí hlavně glob typu `app/**/*`: dosedne
    // na všechny routy a stránky BEZ vlastního exportu, a ty předchozí test
    // nevidí.
    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as {
      functions?: Record<string, { maxDuration?: unknown }>;
    };
    const overLimit = Object.entries(config.functions ?? {})
      .filter(([, settings]) => settings.maxDuration !== undefined)
      // cokoli jiného než číslo do limitu — i hodnotu zapsanou jako text Vercel odmítne
      .filter(
        ([, settings]) =>
          typeof settings.maxDuration !== 'number' || settings.maxDuration > MAX_DURATION_S,
      )
      .map(([glob, settings]) => ({ glob, maxDuration: settings.maxDuration }));
    expect(overLimit).toEqual([]);
  });

  it('každý cron ve vercel.json běží nejvýš jednou denně', () => {
    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons.length).toBeGreaterThan(0);
    for (const cron of config.crons) {
      const [minute, hour] = cron.schedule.split(' ');
      // jedno pevné číslo v minutě i hodině = právě jeden běh za den
      expect(minute, `${cron.path}: minuta v „${cron.schedule}“`).toMatch(/^\d+$/);
      expect(hour, `${cron.path}: hodina v „${cron.schedule}“`).toMatch(/^\d+$/);
    }
  });

  it('crony, které na sebe navazují, dělí aspoň hodina', () => {
    // Hobby spouští cron kdykoli během jeho hodiny (±59 min), takže pořadí
    // kurzy → sync → e-maily drží jen rozestup celých hodin.
    const config = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const hourOf = (path: string): number => {
      const cron = config.crons.find((entry) => entry.path === path);
      expect(cron, `cron ${path} chybí ve vercel.json`).toBeDefined();
      return Number(cron!.schedule.split(' ')[1]);
    };
    const fx = hourOf('/api/cron/fx');
    const sync = hourOf('/api/cron/sync-brokers');
    const notify = hourOf('/api/cron/notify');
    expect(sync - fx).toBeGreaterThanOrEqual(1);
    expect(notify - sync).toBeGreaterThanOrEqual(1);
  });
});
