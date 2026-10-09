import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Strážce tenancy: každá cesta, kterou se dá do aplikace vstoupit, musí
 * nejdřív zjistit, KDO volá — jinak si data vezme kdokoli.
 *
 * Tenhle test vznikl ve 4. auditu a hned si vysloužil vlastní nález: první
 * verze hledala jen `export async function GET`, jenže všechny crony jsou
 * psané jako `export const GET = withCron(…)` a **`export const` je v tomhle
 * repu domácí styl** — skener je tedy neviděl a položka v allowlistu tu díru
 * ještě maskovala. Druhý slepý úhel byl seznam tří souborů `actions.ts`
 * natvrdo a stránky, které neznal vůbec.
 *
 * Pátá revize (L13-01) našla třetí kolo téhož: skener poznával cesty podle
 * JMÉNA souboru a tvar exportu hádal regulárním výrazem nad textem. Mlčel
 * proto u server action v souboru, který se nejmenuje `actions.ts`,
 * u `export const x = obal(async …)`, u handleru v `route.tsx` a u stránky,
 * která čte databázi přes pomocníka z `lib/`. A protože četl i komentáře,
 * poznámka „TODO: doplnit requireUser()" cestu propustila.
 *
 * Odtud tvar, který má dnes:
 *  - zdroják se PARSUJE (TypeScript), takže komentář ani řetězec nejsou kód
 *    a export se pozná v jakémkoli zápisu;
 *  - server action je každý export souboru s direktivou `'use server'`, ať se
 *    jmenuje jakkoli a leží kdekoli, a každá funkce s touž direktivou uvnitř;
 *  - handler je export se jménem HTTP metody v kterémkoli `route.*`;
 *  - kontroluje se TĚLO konkrétního exportu, ne celý soubor — jinak by jedna
 *    funkce s `requireUser` propustila všechny ostatní ve stejném souboru;
 *  - u stránek, layoutů a ostatních souborů, které Next vykresluje sám, se
 *    sledují importy do hloubky až k modulu s databází.
 */

const WEB_DIR = join(import.meta.dirname, '..');

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/**
 * Jediný modul, který vydává spojení do databáze (`getDb`). „Sahá na
 * databázi" tedy znamená „má k němu cestu importů": moduly v `lib/` dostávají
 * spojení parametrem (`db: Db`) a ze schématu berou jen popis tabulek, takže
 * samy od sebe nepřečtou nic — musí jim ho někdo po cestě podat.
 */
const DATABASE_MODULE = 'db/index.ts';

/** Přípony, které Next bere jako zdroják cesty (výchozí `pageExtensions`). */
const ROUTE_FILE = /^route\.[cm]?[jt]sx?$/;

/**
 * Soubory, které Next vykresluje nebo vydává sám od sebe, bez cizího importu:
 * stránka, layout a jejich příbuzní, plus generované metadatové soubory.
 */
const RENDERED_FILE =
  /^(?:page|layout|template|default|loading|not-found|forbidden|unauthorized|error|global-error|sitemap|robots|manifest|(?:opengraph-image|twitter-image|icon|apple-icon)\d*)\.[cm]?[jt]sx?$/;

/**
 * Čím se dá totožnost volajícího zjistit — jména VOLANÝCH funkcí. Není to
 * jen „přihlášený uživatel": cron se legitimuje sdíleným tajemstvím a odkaz
 * na odhlášení z e-mailu podepsaným tokenem, ze kterého userId teprve vypadne.
 */
const IDENTITY_CHECKS = new Set([
  'requireUser', // stránky a server actions
  'authApi', // server actions, které si session řeší přes Better Auth
  'currentUser', // veřejné stránky: session volitelně, dotaz se scopuje
  'getSession', // API routy
  'withCron', // cron: sdílené tajemství (lib/cron-auth.ts)
  'requireCronAuth',
  'verifyUnsubscribeToken', // HMAC token z e-mailu
]);

/**
 * Vědomé výjimky — klíč je `soubor#export`, hodnota důvod.
 *
 * Sem patří jen cesta, která **žádná uživatelská data nevydává ani nemění**.
 * „Zatím to nikdo nezneužil" důvod není.
 *
 * Pozor u stránek: výjimka platí pro celý soubor. Strážce sleduje importy po
 * souborech, ne po funkcích, takže stránka na tomhle seznamu může později
 * začít volat i funkci, která do databáze opravdu sáhne, a on o tom mlčí.
 * Kdo na vyjmenovanou stránku sahá, kontroluje to sám.
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
  'app/demo/prehled/page.tsx#default':
    'demo nad smyšlenými daty z lib/demo-data.ts: z lib/notifications.ts bere jen čistou funkci computeNotificationCandidates; k databázi z toho modulu vede až odesílání e-mailů, které stránka nevolá',
};

/** Zdrojáky aplikace: cesta relativně k `apps/web` (vždy s lomítky) → obsah. */
type SourceTree = ReadonlyMap<string, string>;

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/**
 * Adresáře, které nejsou součástí běžící aplikace. Všechno ostatní se
 * prochází — nový adresář se najde sám.
 */
const SKIPPED_DIRS = new Set(['node_modules', 'test', 'e2e', 'scripts', 'public']);

function loadSourceTree(): SourceTree {
  const tree = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // tečkové adresáře jsou výstupy buildu a lokální data (.next*, .data)
        if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (SOURCE_FILE.test(entry.name)) {
        tree.set(relative(WEB_DIR, full).split(sep).join('/'), readFileSync(full, 'utf8'));
      }
    }
  };
  walk(WEB_DIR);
  return tree;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);

/** Direktiva (`'use server'`) platí jen v úvodním bloku řetězcových výrazů. */
function hasDirective(statements: ts.NodeArray<ts.Statement>, directive: string): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === directive) return true;
  }
  return false;
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

/** Deklarace na nejvyšší úrovni souboru — kvůli `export { a as b }`. */
function localDeclaration(source: ts.SourceFile, name: string): ts.Node | undefined {
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (bindingNames(declaration.name).includes(name)) return declaration;
      }
    }
  }
  return undefined;
}

interface ExportedBinding {
  /** Jméno, pod kterým je export vidět zvenku. */
  name: string;
  /** Uzel s tělem toho jednoho exportu — ne celý soubor. */
  node: ts.Node;
}

/**
 * Všechny hodnotové exporty souboru v jakémkoli zápisu: `export function`,
 * `export const x = obal(…)`, `export const { GET, POST } = …`,
 * `export default`, `export { a as b }` i přeexport z jiného modulu.
 *
 * Kde se tělo nedá dohledat ve stejném souboru (přeexport, `export *`),
 * je tělem samotný příkaz exportu — kontrola totožnosti v něm není, takže
 * cesta skončí mezi nehlídanými a musí se obhájit výjimkou.
 */
function exportedBindings(source: ts.SourceFile): ExportedBinding[] {
  const found: ExportedBinding[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      found.push({
        name: isDefault ? 'default' : (statement.name?.text ?? 'default'),
        node: statement,
      });
    } else if (ts.isVariableStatement(statement)) {
      if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) found.push({ name, node: declaration });
      }
    } else if (ts.isExportAssignment(statement)) {
      const local = ts.isIdentifier(statement.expression)
        ? localDeclaration(source, statement.expression.text)
        : undefined;
      found.push({ name: 'default', node: local ?? statement });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          const local = statement.moduleSpecifier
            ? undefined
            : localDeclaration(source, (element.propertyName ?? element.name).text);
          found.push({ name: element.name.text, node: local ?? statement });
        }
      } else {
        found.push({ name: clause ? clause.name.text : '*', node: statement });
      }
    }
  }
  return found;
}

/** Funkce s direktivou `'use server'` uvnitř těla — action zapsaná u komponenty. */
function inlineServerFunctions(source: ts.SourceFile): ExportedBinding[] {
  const found: ExportedBinding[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)) &&
      node.body &&
      ts.isBlock(node.body) &&
      hasDirective(node.body.statements, 'use server')
    ) {
      const own = ts.isArrowFunction(node) ? undefined : node.name;
      const holder = ts.isVariableDeclaration(node.parent) ? node.parent.name : undefined;
      const label = own ?? holder;
      found.push({
        name: `inline:${label && ts.isIdentifier(label) ? label.text : 'anonymous'}`,
        node,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Volá se v uzlu některá z funkcí, které zjišťují totožnost? */
function callsIdentityCheck(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(current)) {
      const callee = current.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name !== undefined && IDENTITY_CHECKS.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

/** Import, který po překladu zmizí, k databázi nevede. */
function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return (
    !clause.name &&
    named !== undefined &&
    ts.isNamedImports(named) &&
    named.elements.length > 0 &&
    named.elements.every((element) => element.isTypeOnly)
  );
}

/** Odkud soubor bere kód: `import`, přeexport, `import()` i `require()`. */
function importSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
];

/** Styly, obrázky a data — do grafu importů nepatří. */
const ASSET_IMPORT = /\.(?:css|json|svg|png|jpe?g|webp|ico|woff2?)$/;

/** Cesta, kterou se dá do aplikace vstoupit zvenku. */
interface EntryPoint {
  /** Cesta k souboru relativně k `apps/web`, vždy s lomítky. */
  file: string;
  /** Jméno exportu (`GET`, `uploadImportAction`, `default`). */
  name: string;
  /** Proč cesta kontrolou neprošla; `undefined` = zjišťuje si, kdo volá. */
  problem: string | undefined;
}

interface ScanResult {
  entries: EntryPoint[];
  /** Místní importy, které se nepodařilo dohledat — graf by na nich oslepl. */
  unresolvedImports: string[];
}

function scan(tree: SourceTree): ScanResult {
  const parsed = new Map<string, ts.SourceFile>();
  const parse = (file: string): ts.SourceFile => {
    let source = parsed.get(file);
    if (!source) {
      source = ts.createSourceFile(file, tree.get(file) ?? '', ts.ScriptTarget.Latest, true);
      parsed.set(file, source);
    }
    return source;
  };

  const isServerActionModule = (file: string): boolean =>
    hasDirective(parse(file).statements, 'use server');

  const unresolvedImports: string[] = [];
  const localImports = (file: string): string[] => {
    const resolved: string[] = [];
    for (const specifier of importSpecifiers(parse(file))) {
      let base: string;
      if (specifier.startsWith('@/')) base = specifier.slice(2);
      else if (specifier.startsWith('.')) base = posix.join(posix.dirname(file), specifier);
      else continue; // balíček z node_modules nebo workspace — databázi aplikace nezná
      if (ASSET_IMPORT.test(base)) continue;
      const hit = RESOLVE_SUFFIXES.map((suffix) => base + suffix).find((path) => tree.has(path));
      if (hit) resolved.push(hit);
      else unresolvedImports.push(`${file} → ${specifier}`);
    }
    return resolved;
  };

  /**
   * Nejkratší řetěz importů ze souboru k modulu s databází, na kterém se
   * NIKDO nezeptá, kdo volá. Dál se nejde přes soubor, který totožnost sám
   * zjišťuje (dotaz za ním je jeho věc), ani přes modul se server actions
   * (ten je vlastní vstupní cesta a hlídá se zvlášť).
   */
  const unguardedPathToDatabase = (start: string): string[] | undefined => {
    const queue: string[][] = [[start]];
    const seen = new Set([start]);
    while (queue.length > 0) {
      const chain = queue.shift()!;
      const file = chain[chain.length - 1]!;
      if (file === DATABASE_MODULE) return chain;
      if (callsIdentityCheck(parse(file))) continue;
      if (chain.length > 1 && isServerActionModule(file)) continue;
      for (const next of localImports(file)) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push([...chain, next]);
      }
    }
    return undefined;
  };

  const bodyProblem = (node: ts.Node): string | undefined =>
    callsIdentityCheck(node) ? undefined : 'v těle exportu není kontrola totožnosti';

  const entries: EntryPoint[] = [];
  for (const file of [...tree.keys()].sort()) {
    const source = parse(file);
    const base = file.slice(file.lastIndexOf('/') + 1);
    const inApp = file.startsWith('app/');

    if (isServerActionModule(file)) {
      // `'use server'` soubor: KAŽDÝ export je vzdáleně volatelná funkce
      for (const { name, node } of exportedBindings(source)) {
        entries.push({ file, name, problem: bodyProblem(node) });
      }
      continue;
    }
    for (const { name, node } of inlineServerFunctions(source)) {
      entries.push({ file, name, problem: bodyProblem(node) });
    }
    if (inApp && ROUTE_FILE.test(base)) {
      for (const { name, node } of exportedBindings(source)) {
        // `export *` může handler přinést odjinud — nejde ho přejít mlčky
        if (!HTTP_METHODS.has(name) && name !== '*') continue;
        entries.push({ file, name, problem: bodyProblem(node) });
      }
    } else if (inApp && RENDERED_FILE.test(base)) {
      // stránka je celá jedna cesta; bez cesty k databázi nemá co scopovat
      const chain = unguardedPathToDatabase(file);
      entries.push({
        file,
        name: 'default',
        problem: chain && `k databázi vede bez kontroly totožnosti: ${chain.join(' → ')}`,
      });
    }
  }
  return { entries, unresolvedImports };
}

const keyOf = (entry: EntryPoint): string => `${entry.file}#${entry.name}`;

/** Cesty, které nezjišťují, kdo volá — bez ohledu na seznam výjimek. */
const unscopedEntries = (result: ScanResult): EntryPoint[] =>
  result.entries.filter((entry) => entry.problem !== undefined);

describe('strážce tenancy: žádná cesta bez zjištění, kdo volá', () => {
  const result = scan(loadSourceTree());
  const entries = result.entries;

  it('najde i handlery psané jako `export const GET = withCron(…)`', () => {
    const cronHandlers = entries.filter((entry) => entry.file.startsWith('app/api/cron/'));
    // pět cronů (šestý, srovnání plateb, zanikl s placenými tarify), každý
    // s jedním GET — první verze skeneru z nich neviděla ani jeden
    expect(cronHandlers.length).toBeGreaterThanOrEqual(5);
    for (const handler of cronHandlers) expect(handler.name).toBe('GET');
  });

  it('zná i server actions a stránky, ne jen API routy', () => {
    expect(entries.some((entry) => entry.file.endsWith('/actions.ts'))).toBe(true);
    expect(entries.some((entry) => entry.file.endsWith('/page.tsx'))).toBe(true);
    expect(entries.some((entry) => entry.file.endsWith('/layout.tsx'))).toBe(true);
    // pojistka proti tichému rozpadu procházení stromu
    expect(entries.length).toBeGreaterThan(40);
  });

  it('graf importů vidí až k databázi a žádný místní import mu neunikne', () => {
    // bez těchhle dvou pojistek by sledování importů mohlo potichu oslepnout:
    // stačí přesunout `getDb` jinam nebo zavést nový alias cest
    const tree = loadSourceTree();
    expect(tree.get(DATABASE_MODULE), `${DATABASE_MODULE} má vydávat getDb`).toMatch(
      /export\s+(?:async\s+)?function\s+getDb\b/,
    );
    expect(result.unresolvedImports, 'tyhle importy strážce neumí dohledat').toEqual([]);
  });

  it('každá cesta si zjistí totožnost volajícího, nebo je na seznamu výjimek', () => {
    const unscoped = unscopedEntries(result)
      .filter((entry) => !(keyOf(entry) in ALLOWLIST))
      .map((entry) => `${keyOf(entry)} — ${entry.problem}`);
    expect(
      unscoped,
      'tyhle cesty nezjišťují, kdo volá — doplň kontrolu totožnosti, nebo je dej do ALLOWLIST i s důvodem',
    ).toEqual([]);
  });

  it('seznam výjimek nedrží cestu, která už neexistuje nebo výjimku nepotřebuje', () => {
    const needed = new Set(unscopedEntries(result).map(keyOf));
    for (const key of Object.keys(ALLOWLIST)) {
      expect(
        needed,
        `výjimka "${key}" je zbytečná: cesta v aplikaci není, nebo už kontrolou projde sama`,
      ).toContain(key);
    }
  });
});

/**
 * Strážce hlídá sám sebe: smyšlený strom se všemi tvary, které dřívější
 * verze přehlédly (L13-01) nebo naopak hlásily neprávem. Bez těchhle případů
 * se slepý úhel pozná až ve chvíli, kdy jím něco proteče.
 */
describe('strážce tenancy: slepé úhly dřívějších verzí', () => {
  const guarded = `
    import { requireUser } from '@/lib/session';
    import { getDb } from '@/db';
  `;
  const tree: SourceTree = new Map([
    ['db/index.ts', `export async function getDb() { return null; }`],
    [
      'lib/session.ts',
      `import { getDb } from '@/db';
       export async function requireUser() { return auth.api.getSession({ db: await getDb() }); }`,
    ],
    [
      'lib/ledger.ts',
      `import { getDb } from '@/db';
       export async function loadLedgerOf(userId: string) { return [await getDb(), userId]; }`,
    ],
    ['lib/labels.ts', `export const label = (value: string): string => value.trim();`],

    // --- server actions -----------------------------------------------------
    [
      // soubor se nejmenuje actions.ts a neleží v app/
      'lib/remote/ledger-server.ts',
      `'use server';
       import { getDb } from '@/db';
       export async function exportAnyLedger(userId: string) { return [await getDb(), userId]; }`,
    ],
    [
      'app/(app)/ledger/actions.ts',
      `'use server';
       ${guarded}
       const withLog = (fn) => fn;
       async function purge(userId: string) { await getDb(); return userId; }
       // export const ghostAction = async () => {};
       export const wrappedAction = withLog(async (userId: string) => { await getDb(); return userId; });
       export async function commentedAction(userId: string) {
         // TODO: doplnit requireUser()
         /* const user = await requireUser(); */
         await getDb();
         return userId;
       }
       export async function quotedAction() { return 'requireUser() zavoláme příště'; }
       export { purge as renamedAction };
       export { loadLedgerOf as forwardedAction } from '@/lib/ledger';
       export const scopedWrappedAction = withLog(async () => { const user = await requireUser(); return user; });
       export async function scopedAction() { const user = await requireUser(); return user; }
       export type LedgerRow = { id: string };`,
    ],
    [
      // action zapsaná přímo u komponenty: stránka se ptá, action ne
      'app/(app)/inline/page.tsx',
      `${guarded}
       export default async function InlinePage() {
         const user = await requireUser();
         async function wipe(userId: string) { 'use server'; await getDb(); return userId; }
         const keep = async () => { 'use server'; return requireUser(); };
         return [user, wipe, keep];
       }`,
    ],

    // --- API routy ----------------------------------------------------------
    [
      'app/api/ledger/route.tsx',
      `import { getDb } from '@/db';
       export async function GET() { return Response.json(await getDb()); }
       export const dynamic = 'force-dynamic';`,
    ],
    [
      'app/api/bundle/route.js',
      `const handlers = { GET: async () => new Response(), POST: async () => new Response() };
       export const { GET, POST } = handlers;`,
    ],
    [
      'app/api/scoped/route.ts',
      `export const GET = withCron(async () => new Response());
       export async function POST(request) { await auth.api.getSession({ headers: request.headers }); return new Response(); }`,
    ],

    // --- stránky a spol. ----------------------------------------------------
    [
      'app/leak/page.tsx',
      `import { loadLedgerOf } from '@/lib/ledger';
       export default async function LeakPage() { return loadLedgerOf('x'); }`,
    ],
    [
      'app/leak/layout.tsx',
      `import { loadLedgerOf } from '../../lib/ledger';
       export default async function LeakLayout({ children }) { await loadLedgerOf('x'); return children; }`,
    ],
    [
      'app/lazy/page.tsx',
      `export default async function LazyPage() { const { loadLedgerOf } = await import('@/lib/ledger'); return loadLedgerOf('x'); }`,
    ],
    [
      'app/static/page.tsx',
      `// tady se getDb( nevolá a z '@/db' se nic nebere
       import type { Row } from '@/lib/ledger';
       import { type Other } from '@/db';
       import { label } from '@/lib/labels';
       export default function StaticPage() { return label('ahoj'); }`,
    ],
    [
      'app/scoped/page.tsx',
      `import { requireUser } from '@/lib/session';
       import { loadLedgerOf } from '@/lib/ledger';
       export default async function ScopedPage() { const user = await requireUser(); return loadLedgerOf(user.id); }`,
    ],
    [
      // komponenta se ptá sama; stránka nad ní už nemusí
      'app/shell/page.tsx',
      `import { Shell } from '@/components/shell';
       export default function ShellPage() { return Shell(); }`,
    ],
    [
      'components/shell.tsx',
      `import { currentUser } from '@/lib/session';
       import { loadLedgerOf } from '@/lib/ledger';
       export async function Shell() { const user = await currentUser(); return user && loadLedgerOf(user.id); }`,
    ],
    [
      // k databázi jen přes server actions — ty jsou vlastní cesta
      'app/form/page.tsx',
      `import { scopedAction } from '@/app/(app)/ledger/actions';
       export default function FormPage() { return scopedAction; }`,
    ],
  ]);
  const result = scan(tree);

  it('pozná každou vstupní cestu podle direktivy a tvaru exportu, ne podle jména souboru', () => {
    expect(result.entries.map(keyOf)).toEqual([
      'app/(app)/inline/page.tsx#inline:wipe',
      'app/(app)/inline/page.tsx#inline:keep',
      'app/(app)/inline/page.tsx#default',
      'app/(app)/ledger/actions.ts#wrappedAction',
      'app/(app)/ledger/actions.ts#commentedAction',
      'app/(app)/ledger/actions.ts#quotedAction',
      'app/(app)/ledger/actions.ts#renamedAction',
      'app/(app)/ledger/actions.ts#forwardedAction',
      'app/(app)/ledger/actions.ts#scopedWrappedAction',
      'app/(app)/ledger/actions.ts#scopedAction',
      'app/api/bundle/route.js#GET',
      'app/api/bundle/route.js#POST',
      'app/api/ledger/route.tsx#GET',
      'app/api/scoped/route.ts#GET',
      'app/api/scoped/route.ts#POST',
      'app/form/page.tsx#default',
      'app/lazy/page.tsx#default',
      'app/leak/layout.tsx#default',
      'app/leak/page.tsx#default',
      'app/scoped/page.tsx#default',
      'app/shell/page.tsx#default',
      'app/static/page.tsx#default',
      'lib/remote/ledger-server.ts#exportAnyLedger',
    ]);
    expect(result.unresolvedImports).toEqual([]);
  });

  it('nahlásí cestu bez kontroly totožnosti a komentář ani řetězec ji nepropustí', () => {
    expect(unscopedEntries(result).map(keyOf)).toEqual([
      'app/(app)/inline/page.tsx#inline:wipe',
      'app/(app)/ledger/actions.ts#wrappedAction',
      'app/(app)/ledger/actions.ts#commentedAction',
      'app/(app)/ledger/actions.ts#quotedAction',
      'app/(app)/ledger/actions.ts#renamedAction',
      'app/(app)/ledger/actions.ts#forwardedAction',
      'app/api/bundle/route.js#GET',
      'app/api/bundle/route.js#POST',
      'app/api/ledger/route.tsx#GET',
      'app/lazy/page.tsx#default',
      'app/leak/layout.tsx#default',
      'app/leak/page.tsx#default',
      'lib/remote/ledger-server.ts#exportAnyLedger',
    ]);
  });

  it('u stránky vypíše řetěz importů, kterým se k databázi dostala', () => {
    const leak = result.entries.find((entry) => keyOf(entry) === 'app/leak/page.tsx#default');
    expect(leak?.problem).toBe(
      'k databázi vede bez kontroly totožnosti: app/leak/page.tsx → lib/ledger.ts → db/index.ts',
    );
  });

  it('import, který nejde dohledat, neschová', () => {
    const broken = scan(
      new Map([
        ['app/broken/page.tsx', `import { gone } from '@/lib/gone';\nexport default gone;`],
      ]),
    );
    expect(broken.unresolvedImports).toEqual(['app/broken/page.tsx → @/lib/gone']);
  });
});
