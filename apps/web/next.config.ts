import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // workspace balíčky exportují TS zdrojáky — Next je transpiluje sám
  transpilePackages: ['@danero/engine', '@danero/importers', '@danero/shared'],
};

export default nextConfig;
