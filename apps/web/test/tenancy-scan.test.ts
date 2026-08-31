import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážce tenancy: každá cesta, kterou se dá do aplikace vstoupit, musí
 * nejdřív zjistit, KDO volá — jinak si data vezme kdokoli.
 *
 * Tenhle test vznikl ve 4. auditu a hned si vysloužil vlastní nález: první
 * verze hledala jen `export async function GET`, jenže všech šest cronů je
 * psaných jako `export const GET = withCron(…)` a **`export const` je v tomhle
 * repu domácí styl** — skener je tedy neviděl a položka v allowlistu tu díru
 * ještě maskovala. Druhý slepý úhel byl seznam tří souborů `actions.ts`
 * natvrdo a stránky, které neznal vůbec.
 *
 * Odtud tvar, který má dnes: strom se prochází (nový soubor se najde sám),
 * `export const` i `export function` se hledají naráz a kontroluje se TĚLO
 * konkrétního exportu, ne celý soubor — jinak by jedna funkce s `requireUser`
 * propustila všechny ostatní ve stejném souboru.
 */

const WEB_DIR = join(import.meta.dirname, '..');
const APP_DIR = join(WEB_DIR, 'app');

const HTTP_METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

/**
 * Čím se dá totožnost volajícího zjistit. Není to jen „přihlášený uživatel":
 * cron se legitimuje sdíleným tajemstvím, Stripe podpisem webhooku a odkaz
 * na odhlášení z e-mailu podepsaným tokenem, ze kterého userId teprve vypadne.
 */
const IDENTITY_CHECKS = [
  /requireUser\s*\(/, // stránky a server actions
  /authApi\s*\(/, // server actions, které si session řeší přes Better Auth
  /currentUser\s*\(/, // veřejné stránky: session volitelně, dotaz se scopuje
  /getSession\s*\(/, // API routy
  /withCron\s*\(/, // cron: sdílené tajemství (lib/cron-auth.ts)
  /requireCronAuth\s*\(/,
  /verifyUnsubscribeToken\s*\(/, // HMAC token z e-mailu
  /constructEventAsync\s*\(/, // podpis Stripe webhooku
];

/**
 * Vědomé výjimky — klíč je `soubor#export`, hodnota důvod.
 *
 * Sem patří jen cesta, která **žádná uživatelská data nevydává ani nemění**.
 * „Zatím to nikdo nezneužil" důvod není.
 */
const ALLOWLIST: Record<string, string> = {
  'app/api/auth/[...all]/route.ts#GET':
    'handler Better Authu samotného — autentizaci dělá on, scopovat před ním není co',
  'app/api/auth/[...all]/route.ts#POST':
    'handler Better Authu samotného — autentizaci dělá on, scopovat před ním není co',
  'app/api/health/route.ts#GET':
    'provozní stav instance (migrace, kontakt provozovatele) — do databáze uživatelů nesahá',
  'app/api/sablona/route.ts#GET':
    'statická univerzální šablona CSV z @danero/importers — konstanta v kódu, žádný dotaz',
};

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/** Cesta ven z aplikace: HTTP handler, server action nebo stránka. */
interface EntryPoint {
  /** Cesta k souboru relativně k `apps/web`, vždy s lomítky. */
  file: string;
  /** Jméno exportu (`GET`, `uploadImportAction`, `default`). */
  name: string;
  /** Tělo toho jednoho exportu — ne celý soubor. */
  body: string;
}

/**
 * Tělo jednoho exportu: od jeho deklarace po další `export` na začátku řádku.
 * Hrubé, ale spolehlivé — a hlavně to nepustí funkci jen proto, že session
 * řeší její soused ve stejném souboru.
 */
function exportBody(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = source.search(
    new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+${escaped}\\b|const\\s+${escaped}\\s*[:=])`),
  );
  if (start < 0) return source;
  const rest = source.slice(start + 1);
  const end = rest.search(/\nexport\s/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Jména exportovaných HTTP handlerů — OBĚ podoby zápisu. */
function handlerNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HTTP_METHODS})\\b`, 'g'),
  )) {
    names.add(match[1]!);
  }
  // `export const GET = withCron(…)` — takhle jsou psané všechny crony
  for (const match of source.matchAll(
    new RegExp(`export\\s+const\\s+(${HTTP_METHODS})\\s*[:=]`, 'g'),
  )) {
    names.add(match[1]!);
  }
  return [...names];
}

/** Exportované server actions (`'use server'` soubor = každý export je cesta). */
function actionNames(source: string): string[] {
  return [
    ...source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g),
    ...source.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*async/g),
  ].map((match) => match[1]!);
}

function entryPoints(): EntryPoint[] {
  const found: EntryPoint[] = [];
  for (const full of walk(APP_DIR)) {
    const file = relative(WEB_DIR, full).split(sep).join('/');
    const base = file.slice(file.lastIndexOf('/') + 1);
    const source = readFileSync(full, 'utf8');
    if (base === 'route.ts') {
      for (const name of handlerNames(source)) {
        found.push({ file, name, body: exportBody(source, name) });
      }
    } else if (base === 'actions.ts') {
      for (const name of actionNames(source)) {
        found.push({ file, name, body: exportBody(source, name) });
      }
    } else if (base === 'page.tsx') {
      // stránka je celá jedna cesta — `default` export si data načítá sám
      found.push({ file, name: 'default', body: source });
    }
  }
  return found;
}

/** Stránka, která na databázi vůbec nesahá, nemá co scopovat. */
const touchesDatabase = (body: string): boolean =>
  /getDb\s*\(|from '@\/db'|from '@\/db\/schema'/.test(body);

describe('strážce tenancy: žádná cesta bez zjištění, kdo volá', () => {
  const cesty = entryPoints();

  it('najde i handlery psané jako `export const GET = withCron(…)`', () => {
    const crony = cesty.filter((cesta) => cesta.file.startsWith('app/api/cron/'));
    // šest cronů, každý s jedním GET — první verze skeneru z nich neviděla ani jeden
    expect(crony.length).toBeGreaterThanOrEqual(6);
    for (const cron of crony) expect(cron.name).toBe('GET');
  });

  it('zná i server actions a stránky, ne jen API routy', () => {
    expect(cesty.some((cesta) => cesta.file.endsWith('/actions.ts'))).toBe(true);
    expect(cesty.some((cesta) => cesta.file.endsWith('/page.tsx'))).toBe(true);
    // pojistka proti tichému rozpadu procházení stromu
    expect(cesty.length).toBeGreaterThan(40);
  });

  it('každá cesta si zjistí totožnost volajícího, nebo je na seznamu výjimek', () => {
    const nescopovane: string[] = [];
    for (const cesta of cesty) {
      const klic = `${cesta.file}#${cesta.name}`;
      if (klic in ALLOWLIST) continue;
      // veřejná stránka bez jediného dotazu do databáze nemá co scopovat
      if (cesta.name === 'default' && !touchesDatabase(cesta.body)) continue;
      if (IDENTITY_CHECKS.some((vzor) => vzor.test(cesta.body))) continue;
      nescopovane.push(klic);
    }
    expect(
      nescopovane,
      'tyhle cesty nezjišťují, kdo volá — doplň kontrolu totožnosti, nebo je dej do ALLOWLIST i s důvodem',
    ).toEqual([]);
  });

  it('seznam výjimek nedrží cestu, která už neexistuje', () => {
    const klice = new Set(cesty.map((cesta) => `${cesta.file}#${cesta.name}`));
    for (const klic of Object.keys(ALLOWLIST)) {
      expect(klice, `výjimka "${klic}" ukazuje na cestu, která v aplikaci není`).toContain(klic);
    }
  });
});
