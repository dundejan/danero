import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary'],
      /**
       * Práh hlídá jen engine: je to čistá daňová logika bez I/O a každý
       * nepokrytý řádek je pravidlo R-xx, které nikdo nezkouší. Hodnoty jsou
       * o 1–2 body pod stavem z 9. 10. 2026 (řádky 97,7 %, větve 94,2 %,
       * funkce 97,9 %) — práh má chytit propad, ne nutit k honbě za procenty.
       * Větve mezi běhy kolísají o desetiny procenta (property testy nemají
       * pevný seed), proto u nich zůstává rezerva celé dva body.
       */
      thresholds: {
        lines: 96,
        statements: 96,
        branches: 92,
        functions: 96,
      },
    },
  },
});
