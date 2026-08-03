import { join } from 'node:path';
import type { NextConfig } from 'next';

/* Dev overlay („N issues“ bublina) mate při vizuálních kontrolách a screenshotech
   — jediný trvalý nález je známý dev-only konflikt CSP × React eval. */

/**
 * Security headers (G10a). CSP bez nonce (Next inline runtime skripty vyžadují
 * 'unsafe-inline' u script-src — vědomý kompromis; nonce režim by vynutil
 * plně dynamické renderování všech stránek). Žádné externí zdroje: aplikace
 * nenačítá nic z CDN, fonty jsou self-hosted přes next/font.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
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

const nextConfig: NextConfig = {
  devIndicators: false,
  // Vlastní instance (Docker) potřebuje samostatný server.js se zabaleným
  // node_modules; na Vercelu se nechává vypnuté, aby build zůstal beze změny.
  // Trasování musí začínat v kořeni monorepa, jinak vypadnou workspace balíčky.
  ...(process.env.NEXT_OUTPUT_STANDALONE
    ? { output: 'standalone' as const, outputFileTracingRoot: join(import.meta.dirname, '../..') }
    : {}),
  // Next 16 zamyká dev server per distDir (.next/dev/lock) — oddělený distDir
  // umožní E2E dev server vedle běžícího `pnpm dev` (NEXT_DIST_DIR=.next-e2e)
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // workspace balíčky exportují TS zdrojáky — Next je transpiluje sám
  transpilePackages: ['@danero/engine', '@danero/importers', '@danero/shared'],
  // nativní/WASM balíčky nesmí do server bundle (PGlite si načítá WASM přes import.meta.url)
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'exceljs'],
  experimental: {
    // upload výpisů jde přes server action — default 1 MB by větší exporty
    // (XTB/IBKR XLSX) utnul syrovou 413 dřív, než doběhne česká kontrola
    // 20 MB v import/actions.ts (MAX_FILE_BYTES + rezerva na multipart)
    serverActions: { bodySizeLimit: '25mb' },
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
