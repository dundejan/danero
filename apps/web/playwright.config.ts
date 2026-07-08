import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E proti `next dev` s čistou PGlite DB v dočasném adresáři (každý běh od nuly,
 * registrace se neperou o e-maily). T212 volání jdou na lokální mock server —
 * E2E nikdy nesahá na živé API. Spouštění: `pnpm test:e2e` (mimo `pnpm test`).
 */
const APP_PORT = 3210;
const MOCK_PORT = 3211;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // PGlite = jediné DB připojení; scénáře jedou sériově, ať se dev server nezahltí
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
      command: 'node e2e/t212-mock-server.mjs',
      url: `http://localhost:${MOCK_PORT}/health`,
      env: { PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: 'pnpm dev',
      url: `http://localhost:${APP_PORT}`,
      env: {
        PORT: String(APP_PORT),
        // Better Auth ověřuje Origin proti baseURL — musí sedět na E2E port
        BETTER_AUTH_URL: `http://localhost:${APP_PORT}`,
        PGLITE_DATA_DIR: mkdtempSync(join(tmpdir(), 'danero-e2e-')),
        T212_API_BASE_URL: `http://localhost:${MOCK_PORT}/api/v0`,
        // dost pomalu, aby UI polling (3 s) stihl zachytit průběh po letech
        T212_POLL_INTERVAL_MS: '1500',
        IBKR_FLEX_BASE_URL: `http://localhost:${MOCK_PORT}/flex`,
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
