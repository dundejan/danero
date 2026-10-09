import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Mutační testy: jedna sada nad enginem i sdíleným modelem.
// Alias je nutný — Stryker kopíruje strom do pískoviště a `node_modules`
// jen symlinkuje, takže `@danero/shared` by jinak vedl na NEZMUTOVANÉ zdroje
// v původním stromu a mutanti ve sdíleném balíčku by nikdy neumřeli.
export default defineConfig({
  resolve: {
    alias: {
      '@danero/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/engine/test/**/*.test.ts', 'packages/shared/test/**/*.test.ts'],
    // výkonnostní test měří čas, ne správnost — pod instrumentací jen zdržuje
    exclude: ['**/node_modules/**', 'packages/engine/test/perf-ledger.test.ts'],
  },
});
