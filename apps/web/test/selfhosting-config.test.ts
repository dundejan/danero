import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('nepovinná proměnná se nepředává jako prázdný řetězec', () => {
    // `RESEND_FROM: ${RESEND_FROM:-}` dá aplikaci '' místo „nenastaveno“ a výchozí
    // odesílatel (`??`) se neuplatní — nepovinné proměnné nese jen env_file.
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
});
