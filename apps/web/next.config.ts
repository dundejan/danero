import type { NextConfig } from 'next';

/* Dev overlay („N issues" bublina) mate při vizuálních kontrolách a screenshotech
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
      "script-src 'self' 'unsafe-inline'",
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
  // workspace balíčky exportují TS zdrojáky — Next je transpiluje sám
  transpilePackages: ['@danero/engine', '@danero/importers', '@danero/shared'],
  // nativní/WASM balíčky nesmí do server bundle (PGlite si načítá WASM přes import.meta.url)
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'exceljs'],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
