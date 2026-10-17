import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

/* Dev overlay („N issues“ bublina) mate při vizuálních kontrolách a screenshotech
   — jediný trvalý nález je známý dev-only konflikt CSP × React eval. */

/**
 * Security headers (G10a). CSP bez nonce (Next inline runtime skripty vyžadují
 * 'unsafe-inline' u script-src — vědomý kompromis; nonce režim by vynutil
 * plně dynamické renderování všech stránek). Žádné externí zdroje: aplikace
 * nenačítá nic z CDN a písmo je systémové (žádné webové fonty).
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  /**
   * HSTS bez `preload` je VĚDOMÉ rozhodnutí (K8-10), ne přehlédnutí.
   *
   * `preload` zapíše doménu do seznamu zadrátovaného v prohlížečích — a ven
   * z něj se dostává měsíce (jedna verze prohlížeče = jedno kolo). Kdyby
   * kterákoli budoucí subdoména (status page, dokumentace, něco u třetí
   * strany) neuměla HTTPS, byla by pro všechny návštěvníky nedosažitelná
   * a zpátky by to nešlo vzít. Dvouletý `max-age` s `includeSubDomains`
   * chrání všechny opakované návštěvníky; nechráněná zůstává jen úplně první
   * návštěva, kterou stejně kryje přesměrování na HTTPS.
   */
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // dev: React vyžaduje eval() (source mapy, Fast Refresh) — striktní CSP
      // bez 'unsafe-eval' házela chybu do konzole na každé stránce; produkce
      // zůstává bez eval
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

/**
 * Next 16 zamyká dev server per distDir (.next/dev/lock) — oddělený distDir
 * umožní E2E dev server vedle běžícího `pnpm dev` (NEXT_DIST_DIR=.next-e2e).
 */
const distDir = process.env.NEXT_DIST_DIR || '.next';

/**
 * Vlastní distDir dostane vlastní tsconfig.
 *
 * Next si při každém startu připíše do `include` v tsconfigu cesty typů svého
 * distDiru (`<distDir>/types/**`), a když tam nejsou, soubor přepíše. S každým
 * `NEXT_DIST_DIR` tak v `tsconfig.json` přibyly dva řádky, které se buď ručně
 * vracely, nebo se commitly (`.next-a11y`, `.next-oprava-e` v něm ležely
 * měsíce). Jinému distDiru než `.next` proto dáme odvozený soubor, který
 * z hlavního jen dědí: do konfigurace s `extends` Next nezapisuje vůbec
 * (`writeConfigurationDefaults` u ní automatické nastavení vzdává), takže
 * nesahá ani na něj, ani na `tsconfig.json`. Kontrola typů je stejná jako
 * u výchozího buildu — typy tras přicházejí přes `next-env.d.ts`, ne přes
 * `include` (ten by stejně přebilo `exclude: [".next"]`). Odvozené soubory
 * jsou v `.gitignore`.
 */
function tsconfigPathFor(dir: string): string | undefined {
  if (dir === '.next') return undefined;
  const file = `tsconfig.${dir.replace(/^\.+/, '').replace(/[^a-zA-Z0-9-]+/g, '-')}.json`;
  const path = join(import.meta.dirname, file);
  // Jediný atomický zápis (`wx` = jen když soubor není) místo dotazu
  // „existuje?“ a zápisu po něm: mezi těmi dvěma kroky by ho mohl založit
  // souběžný start a my bychom mu ho přepsali.
  try {
    writeFileSync(path, `${JSON.stringify({ extends: './tsconfig.json' }, null, 2)}\n`, {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return file;
}
const tsconfigPath = tsconfigPathFor(distDir);

const nextConfig: NextConfig = {
  devIndicators: false,
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  // Vlastní instance (Docker) potřebuje samostatný server.js se zabaleným
  // node_modules; na Vercelu se nechává vypnuté, aby build zůstal beze změny.
  // Trasování musí začínat v kořeni monorepa, jinak vypadnou workspace balíčky.
  ...(process.env.NEXT_OUTPUT_STANDALONE
    ? { output: 'standalone' as const, outputFileTracingRoot: join(import.meta.dirname, '../..') }
    : {}),
  distDir,
  // `X-Powered-By: Next.js` jen napovídá, na jaké zranitelnosti zkoušet
  // (pasivní sken OWASP ZAP, bezpečnostní revize 15. 10. 2026)
  poweredByHeader: false,
  // Metadata z `generateMetadata` Next jinak streamuje na konec `<body>` všem
  // kromě vyjmenovaných robotů — a v tom seznamu chybí SeznamBot i roboti AI
  // vyhledávačů, kteří JavaScript nespouštějí. Ověřovací tag Seznamu
  // (`seznam-wmt`) musí být v `<head>` úvodu, jinak ověření webu neprojde.
  // Async metadata máme jen na úvodu (čtení env) a u detailu pozice, takže
  // blokující metadata pro všechny nic nestojí.
  htmlLimitedBots: /.*/,
  // workspace balíčky exportují TS zdrojáky — Next je transpiluje sám
  transpilePackages: ['@danero/engine', '@danero/importers', '@danero/shared'],
  // nativní/WASM balíčky nesmí do server bundle (PGlite si načítá WASM přes import.meta.url)
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'exceljs'],
  experimental: {
    // Upload výpisů jde přes server action a default 1 MB by větší exporty
    // (XTB/IBKR XLSX) utnul syrovou 413 dřív, než doběhne česká kontrola.
    // Strop drží MAX_FILE_BYTES v import/actions.ts (4 MB) — tady je o něco
    // víc kvůli multipart režii. Výš než 4,5 MB to nemá smysl posouvat:
    // tam těleso požadavku utne sám Vercel (změřeno, nález F-3-3).
    serverActions: { bodySizeLimit: '4.4mb' },
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  /**
   * Stránky placených tarifů zanikly 8. 10. 2026, kdy se Danero stalo celé
   * bezplatným. Odkazy na ně ale žijí dál ve starých e-mailech (potvrzení
   * objednávky, upomínka před obnovou) a ve vyhledávačích — místo 404 proto
   * vedou tam, kde se čtenář dozví, co platí teď.
   *
   * `/demo` (odkazy z e-mailů, z `/vitejte` a starších zmínek) je vstup do
   * prohlídky. Dřív to byla stránka s `redirect()`, jenže hranice Suspense
   * z `app/demo/loading.tsx` stihla začít streamovat a Next přesměrování dodal
   * jako stav 200 s `<meta http-equiv="refresh">` — robot viděl prázdnou
   * stránku kanonizovanou sama na sebe (SEO audit, K2). Tady je to skutečné
   * 307 dřív, než se cokoli vykreslí. Dočasné schválně: vstup do dema se může
   * přesunout a trvalé přesměrování si prohlížeče pamatují.
   */
  async redirects() {
    return [
      { source: '/predplatne/:path*', destination: '/cenik', permanent: true },
      { source: '/odstoupeni', destination: '/podminky', permanent: true },
      { source: '/demo', destination: '/demo/prehled', permanent: false },
    ];
  },
};

export default nextConfig;
