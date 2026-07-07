import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // e2e/ patří Playwrightu (pnpm test:e2e), vitest ho nesmí sbírat
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
    },
  },
});
