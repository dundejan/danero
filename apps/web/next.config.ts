import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace balíčky exportují TS zdrojáky — Next je transpiluje sám
  transpilePackages: ['@danero/engine', '@danero/importers', '@danero/shared'],
  // nativní/WASM balíčky nesmí do server bundle (PGlite si načítá WASM přes import.meta.url)
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
};

export default nextConfig;
