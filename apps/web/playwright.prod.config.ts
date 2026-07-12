import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * E2E proti produkčnímu buildu (`next build && next start`) — použij, když na
 * stroji už běží `next dev` téhož projektu (Next 16 druhý dev server odmítne),
 * nebo když chceš suite ověřit proti prod chování. Vše kromě příkazu webserveru
 * dědí z playwright.config.ts (porty, env, mock T212/IBKR, čistá PGlite).
 * Spouštění: `pnpm test:e2e:prod`.
 */
const baseServers = Array.isArray(base.webServer)
  ? base.webServer
  : base.webServer
    ? [base.webServer]
    : [];

export default defineConfig({
  ...base,
  webServer: baseServers.map((server) =>
    server.command === 'pnpm dev'
      ? // build v příkazu: `next start` nad starým .next by zeleně otestoval starý kód;
        // rate limit auth endpointů se v produkci zapíná a E2E registrace by po
        // páté dostávaly 429 → explicitní vypnutí jen pro tento běh
        {
          ...server,
          command: 'pnpm build && pnpm start',
          timeout: 600_000,
          env: {
            ...server.env,
            DANERO_DISABLE_RATE_LIMIT: '1',
            // v produkčním režimu si aplikace secrety negeneruje (dev je má
            // v .data/) — bez nich spadne první registrace; hodnoty jsou
            // jednorázové pro lokální E2E, nic se jimi nechrání
            BETTER_AUTH_SECRET: 'danero-e2e-prod-secret-0123456789abcdef',
            DANERO_ENCRYPTION_KEY:
              '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
            CRON_SECRET: 'danero-e2e-cron-secret',
          },
        }
      : server,
  ),
});
