import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // e2e/ patří Playwrightu (pnpm test:e2e), vitest ho nesmí sbírat
    exclude: ['e2e/**', 'node_modules/**'],
    /**
     * Identifikace provozovatele jde od 10. 8. 2026 z prostředí (pravidlo 8
     * v CLAUDE.md). Bez ní by `lib/contact.ts` vracel „nenastaveno" ve všech
     * polích naráz — a test „adresu nese jen potvrzení objednávky" by pak
     * platil vždycky, protože by se ta jedna hodnota našla všude.
     * Hodnoty jsou zjevně smyšlené a navzájem rozlišitelné.
     */
    env: {
      DANERO_OPERATOR_NAME: 'Zkušební Provozovatel',
      DANERO_OPERATOR_ICO: '00000019',
      DANERO_OPERATOR_ADDRESS: 'Zkušební 1, 100 00 Zkušebno',
      DANERO_CONTACT_EMAIL: 'provozovatel@priklad.test',
      DANERO_CONTACT_PHONE: '+420 000 000 000',
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname),
    },
  },
});
