import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Strážný test konfigurace vlastní instance (`docker-compose.yml`,
 * `.dockerignore`, `docs/16-selfhosting.md`).
 *
 * Tři věci tu šly potichu špatně a žádný test o nich nevěděl, protože se
 * projeví až v běžícím kontejneru:
 *
 * - compose předával službě `web` jen vyjmenované proměnné, takže cokoli
 *   dalšího z tabulky v návodu (vyřazený šifrovací klíč, identifikace
 *   provozovatele, adresa upraveného repozitáře) se ze `.env` do aplikace
 *   nedostalo — a nic to neohlásilo,
 * - port aplikace byl publikovaný na všech rozhraních, tedy dosažitelný i mimo
 *   reverzní proxy: po nešifrovaném http a s limitem přihlášení, který jde
 *   obejít vlastní hlavičkou `X-Forwarded-For`,
 * - `.dockerignore` hlídal `.env` jen v kořeni; z `apps/web` by ho Next zabalil
 *   do výsledného obrazu.
 *
 * Soubory se čtou jako text — YAML parser kvůli tomu do závislostí nepatří.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const COMPOSE = read('docker-compose.yml');
const DOCKERIGNORE = read('.dockerignore');
const GUIDE = read('docs/16-selfhosting.md');
/** Jediná šablona `.env` v repozitáři — z ní si self-hoster zakládá svoje. */
const TEMPLATE = read('apps/web/.env.example');

/** Produkční zdrojáky aplikace (bez testů a závislostí) — cesta od `directory` a obsah. */
function productionSources(directory: string): { path: string; text: string }[] {
  const SKIPPED = new Set(['node_modules', 'test', 'e2e', 'public']);
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(?:ts|tsx|mjs)$/.test(path))
    .filter((path) => !path.split(sep).some((part) => SKIPPED.has(part) || part.startsWith('.')))
    .map((path) => ({ path, text: readFileSync(join(directory, path), 'utf8') }));
}

/** Řádky bloku pod klíčem `key` v odsazení `indent` — do dalšího klíče téže nebo vyšší úrovně. */
function yamlBlock(source: string, key: string, indent: number): string[] {
  const lines = source.split('\n');
  const start = lines.indexOf(`${' '.repeat(indent)}${key}:`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^ {0,${indent}}\\S`).test(line));
  return rest
    .slice(0, end === -1 ? undefined : end)
    .filter((line) => !line.trimStart().startsWith('#'));
}

const WEB = yamlBlock(COMPOSE, 'web', 2).join('\n');
const WEB_ENVIRONMENT = yamlBlock(WEB, 'environment', 4);
const WEB_PORTS = yamlBlock(WEB, 'ports', 4).map((line) =>
  line
    .trim()
    .replace(/^- /, '')
    .replace(/^['"]|['"]$/g, ''),
);

/** Proměnné, které mají v tabulce „Konfigurace“ vlastní řádek. */
const DOCUMENTED = new Set(
  [...GUIDE.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map((match) => match[1]),
);

describe('vlastní instance: docker-compose.yml', () => {
  it('extrakce bloků našla službu web — jinak by test hlídal prázdno', () => {
    expect(WEB).toContain('build: .');
    expect(WEB_ENVIRONMENT.length).toBeGreaterThan(3);
    expect(WEB_PORTS).toHaveLength(1);
  });

  it('služba web dostane celé .env, ne jen vyjmenované proměnné', () => {
    const envFile = yamlBlock(WEB, 'env_file', 4).join('\n');
    expect(envFile).toMatch(/path: \.env$/m);
  });

  it('PORT z .env se dovnitř kontejneru nedostane — mapování i healthcheck míří na 3000', () => {
    expect(WEB_ENVIRONMENT.map((line) => line.trim())).toContain("PORT: '3000'");
    expect(WEB_PORTS[0]).toMatch(/:3000$/);
    expect(WEB).toContain('http://localhost:3000/api/health');
  });

  it('povinné kontroly a složená DATABASE_URL zůstávají v environment (má přednost před env_file)', () => {
    const environment = WEB_ENVIRONMENT.join('\n');
    expect(environment).toMatch(/DATABASE_URL: postgres:\/\/danero:\$\{POSTGRES_PASSWORD:\?/);
    for (const name of [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'DANERO_ENCRYPTION_KEY',
      'CRON_SECRET',
    ]) {
      expect(environment).toContain(`${name}: \${${name}:?`);
    }
  });

  it('blok environment nepřebíjí RESEND_FROM prázdným řetězcem', () => {
    // `RESEND_FROM: ${RESEND_FROM:-}` dá aplikaci '' místo „nenastaveno“ a výchozí
    // odesílatel (`??`) se neuplatní — nepovinné proměnné nese jen env_file.
    // Že prázdný řetězec dorazí i přes env_file, hlídá blok o šabloně níž.
    expect(WEB_ENVIRONMENT.join('\n')).not.toContain('RESEND_FROM');
  });

  it('port aplikace je publikovaný jen na loopbacku, otevřít ho jde jen vědomě proměnnou', () => {
    expect(WEB_PORTS[0]).toMatch(/^\$\{DANERO_BIND_ADDRESS:-127\.0\.0\.1\}:/);
  });

  it('každou proměnnou, kterou compose dosazuje, návod jmenuje v tabulce', () => {
    const referenced = new Set(
      [...COMPOSE.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
    );
    expect(referenced.size).toBeGreaterThan(5);
    expect([...referenced].filter((name) => !DOCUMENTED.has(name))).toEqual([]);
  });
});

/**
 * D07-R1-01: `env_file` předá kontejneru i řádky šablony, které self-hoster
 * nechal prázdné (`DANERO_TRUSTED_PROXIES=`) — jako prázdný řetězec, ne jako
 * chybějící proměnnou. Kód, který se ptá „je to `undefined`?“, pak u prázdného
 * řádku vynechá výchozí hodnotu, kterou šablona i návod slibují. Takhle
 * prázdná `DANERO_TRUSTED_PROXIES` vypnula důvěryhodné proxy a klienti za další
 * proxy sdíleli jeden kbelík limitu přihlášení.
 *
 * Hlídá se zdroják, ne běh: u každé proměnné, kterou šablona nabízí prázdnou,
 * nesmí produkční kód rozlišovat `''` od nenastavené (`=== undefined`, `??`
 * s jinou náhradou než `''`). Chování samotné ověřuje `test/auth-ip.test.ts`.
 */
describe('vlastní instance: prázdný řádek šablony .env.example', () => {
  const EMPTY_IN_TEMPLATE = [...TEMPLATE.matchAll(/^([A-Z][A-Z0-9_]*)=[ \t]*$/gm)].map(
    (match) => match[1] as string,
  );
  const SOURCES = productionSources(join(ROOT, 'apps', 'web'));

  /**
   * Výraz hned za čtením, který prázdný řetězec od nenastavené rozliší:
   * porovnání s `undefined`/`null`, nebo `??` s jinou náhradou než `''`.
   */
  const STRICT = String.raw`\s*(?:\?\?(?!\s*(?:''|""))|[!=]==?\s*(?:undefined|null)\b)`;

  /** Místa, kde kód čte `name` způsobem, který `''` a `undefined` rozliší. */
  function strictReads(name: string): string[] {
    const found: string[] = [];
    for (const { path, text } of SOURCES) {
      if (new RegExp(String.raw`\benv\.${name}\b` + STRICT).test(text)) {
        found.push(`${path}: env.${name}`);
      }
      // přes pomocnou proměnnou: `const fromEnv = process.env.X;` … `fromEnv === undefined`
      const alias = new RegExp(
        String.raw`\b(?:const|let)\s+(\w+)\s*=\s*(?:process\.)?env\.${name}\s*;`,
        'g',
      );
      for (const match of text.matchAll(alias)) {
        // jen do konce funkce — stejné jméno si o kus níž bere jiná proměnná
        const rest = text.slice(match.index + match[0].length);
        const end = rest.search(/^\}/m);
        const scope = end === -1 ? rest : rest.slice(0, end);
        if (new RegExp(String.raw`\b${match[1]}\b` + STRICT).test(scope)) {
          found.push(`${path}: ${match[1]} (= env.${name})`);
        }
      }
    }
    return found;
  }

  it('šablona nabízí prázdné řádky a každou takovou proměnnou kód opravdu čte', () => {
    // jinak by hledání níž prošlo jen proto, že čtení má tvar, který nevidí
    expect(EMPTY_IN_TEMPLATE).toContain('DANERO_TRUSTED_PROXIES');
    expect(EMPTY_IN_TEMPLATE.length).toBeGreaterThan(10);
    const unread = EMPTY_IN_TEMPLATE.filter(
      (name) => !SOURCES.some(({ text }) => new RegExp(String.raw`\benv\.${name}\b`).test(text)),
    );
    expect(unread).toEqual([]);
  });

  it('hledání přísného čtení pozná oba tvary, které hlídá', () => {
    const probe = (text: string): boolean => new RegExp(String.raw`\bvalue\b` + STRICT).test(text);
    expect(probe('if (value === undefined) return DEFAULTS;')).toBe(true);
    expect(probe("const from = value ?? 'Danero';")).toBe(true);
    expect(probe("const list = (value ?? '').split(',');")).toBe(false);
    expect(probe('if (!value) return null;')).toBe(false);
    expect(probe('return value?.trim() || null;')).toBe(false);
  });

  it('žádná proměnná ze šablony neznamená prázdná něco jiného než nevyplněná', () => {
    expect(EMPTY_IN_TEMPLATE.flatMap(strictReads)).toEqual([]);
  });

  it('šablona i návod slibují u nevyplněné DANERO_TRUSTED_PROXIES výchozí rozsahy', () => {
    expect(TEMPLATE).toMatch(
      /Nevyplněno = výchozí seznam privátních rozsahů[^\n]*\nDANERO_TRUSTED_PROXIES=$/m,
    );
    const row = GUIDE.split('\n').find((line) => line.startsWith('| `DANERO_TRUSTED_PROXIES` |'));
    expect(row).toContain('Nevyplněno = privátní rozsahy');
  });
});

describe('vlastní instance: .dockerignore', () => {
  const patterns = DOCKERIGNORE.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  // Kořenové soubory — u nich je vzor platný jen pro kořen kontextu správně.
  const ROOT_ONLY = new Set(['.git', 'Dockerfile', 'docker-compose.yml']);

  it('každý vzor podle jména má dvojníka pro celý strom', () => {
    // Vzor bez lomítka platí jen pro kořen kontextu. `apps/web/.env` tak prošel
    // do builder stage a Next ho při `output: 'standalone'` zabalil do obrazu.
    const twin = (pattern: string): string =>
      pattern.startsWith('!') ? `!**/${pattern.slice(1)}` : `**/${pattern}`;
    const rootOnly = patterns.filter(
      (pattern) =>
        !pattern.includes('/') && !ROOT_ONLY.has(pattern) && !patterns.includes(twin(pattern)),
    );
    expect(rootOnly).toEqual([]);
  });

  it('tajemství, logy a vedlejší build adresáře zůstávají mimo obraz v celém stromu', () => {
    for (const pattern of ['**/.env', '**/.env.*', '**/*.log', '**/.next-*', '**/.vercel']) {
      expect(patterns).toContain(pattern);
    }
  });

  it('výjimka pro .env.example přichází až po vzorech, které ruší', () => {
    // v .dockerignore vyhrává poslední shoda
    for (const [exception, pattern] of [
      ['!.env.example', '.env.*'],
      ['!**/.env.example', '**/.env.*'],
    ] as const) {
      expect(patterns).toContain(exception);
      expect(patterns.indexOf(exception)).toBeGreaterThan(patterns.indexOf(pattern));
    }
  });
});

describe('vlastní instance: docs/16-selfhosting.md', () => {
  it('tabulka jmenuje identifikaci provozovatele a adresy pro poštu', () => {
    const expected = [
      'DANERO_OPERATOR_NAME',
      'DANERO_OPERATOR_ICO',
      'DANERO_OPERATOR_ADDRESS',
      'DANERO_CONTACT_EMAIL',
      'DANERO_CONTACT_PHONE',
      'DANERO_ALERT_EMAIL',
      'RESEND_REPLY_TO',
    ];
    expect(expected.filter((name) => !DOCUMENTED.has(name))).toEqual([]);
  });

  it('říká, co se bez identifikace provozovatele vypíše', () => {
    expect(GUIDE).toContain('nenastaveno');
    expect(GUIDE).toContain('operatorContact');
  });

  it('říká, že .env jde do kontejneru celé a že port poslouchá jen na 127.0.0.1', () => {
    expect(GUIDE).toContain('env_file');
    expect(GUIDE).toContain('DANERO_BIND_ADDRESS');
    expect(GUIDE).toContain('127.0.0.1');
  });

  it('jmenuje nejnižší verzi Docker Compose, která zápis env_file s required přečte', () => {
    // D07-R1-02: `env_file` s `path`/`required` umí Compose až od 2.24. Starší
    // soubor odmítne anglickou hláškou validátoru („env_file.0 must be a
    // string“), která na příčinu neukáže — a aktualizace podle návodu neproběhne.
    expect(yamlBlock(WEB, 'env_file', 4).join('\n')).toContain('required: false');
    const section = (heading: string): string =>
      GUIDE.split(/^## /m).find((part) => part.startsWith(heading)) ?? '';
    const MINIMUM = /Docker Compose 2\.24/;
    // v požadavcích — čte je ten, kdo instaluje poprvé
    expect(section('Co budeš potřebovat')).toMatch(MINIMUM);
    // a u aktualizace — tam na to narazí ten, kdo má starší instalaci
    const update = section('Nejrychlejší cesta: Docker')
      .split(/^- /m)
      .find((item) => item.startsWith('**Aktualizace:**'));
    expect(update).toMatch(MINIMUM);
    // hlavička compose souboru je první místo, kam se člověk po chybě podívá
    expect(COMPOSE.split('\nservices:')[0]).toMatch(MINIMUM);
  });
});
