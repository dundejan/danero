import { E2E_OPERATOR } from './e2e/operator';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { EMAIL_LOG } from './playwright.config';

/**
 * E2E placených hranic (`pnpm test:e2e:paywall`).
 *
 * Vlastní konfigurace, protože jediné, co odlišuje hostovanou verzi od
 * self-hostu, je `DANERO_BILLING=stripe` — a ten se nedá zapnout v hlavní sadě,
 * kde scénáře naopak potřebují všechno odemčené. Do 9. 8. 2026 tak neexistoval
 * JEDINÝ E2E test placených hranic a prošlo tudy, že formulář pro napojení
 * brokera viděl i uživatel bez předplatného a odmítnutí přišlo až po odeslání.
 *
 * Stripe klíč tu netřeba: `resolveEntitlements` čte jen databázi, na Stripe API
 * nesahá. Vlastní port i distDir, ať sada může běžet vedle hlavní.
 */
const APP_PORT = 3220;

export default defineConfig({
  testDir: './e2e-paywall',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev',
      url: `http://localhost:${APP_PORT}`,
      env: {
        PORT: String(APP_PORT),
        BETTER_AUTH_URL: `http://localhost:${APP_PORT}`,
        PGLITE_DATA_DIR: mkdtempSync(join(tmpdir(), 'danero-paywall-')),
        // stejný soubor jako hlavní sada: e2e/helpers.ts si ho bere odtamtud
        // a filtruje podle adresáta, takže cizí řádky nevadí
        DANERO_EMAIL_LOG: EMAIL_LOG,
        DANERO_OPERATOR_NAME: E2E_OPERATOR.name,
        DANERO_OPERATOR_ICO: E2E_OPERATOR.ico,
        DANERO_OPERATOR_ADDRESS: E2E_OPERATOR.address,
        DANERO_CONTACT_EMAIL: E2E_OPERATOR.email,
        // tohle je celý smysl téhle konfigurace
        DANERO_BILLING: 'stripe',
        NEXT_DIST_DIR: '.next-paywall',
      },
      reuseExistingServer: Boolean(process.env.PW_REUSE),
      timeout: 120_000,
    },
  ],
});
