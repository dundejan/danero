/**
 * ŽIVÉ ověření Trading212 API (opt-in): spusť s read-only klíčem
 *
 *   T212_API_KEY=xxx pnpm --filter @danero/importers test
 *   (volitelně T212_API_SECRET=yyy — ověří variantu HTTP Basic)
 *
 * Ověřuje celou API cestu plánovanou pro F3: autentizaci, pozice + instrumenty,
 * serverové vygenerování CSV exportu (stejný parser jako ruční upload) a
 * rekonciliaci pozic. Bez env proměnné se přeskakuje. Nic nezapisuje — klíč
 * stačí read-only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Transaction } from '@danero/shared';
import { buildLedger, positionsAt, resolveOptions, WarningCollector } from '@danero/engine';
import {
  dedupeTransactions,
  mapPositionsToIsin,
  parseTrading212Csv,
  reconcilePositions,
  Trading212Client,
  TRADING212_BROKER,
} from '../src';

const apiKey = process.env['T212_API_KEY'];
const apiSecret = process.env['T212_API_SECRET'];

const realDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real');

describe.skipIf(!apiKey)('živé Trading212 API (T212_API_KEY)', () => {
  it(
    'auth → pozice → serverový CSV export → parser → rekonciliace',
    { timeout: 720_000 },
    async () => {
      const client = new Trading212Client({ apiKey: apiKey!, apiSecret });

      // 1) autentizace — nejlevnější endpoint
      const cash = await client.getCash();
      console.info(`[api] klíč platí (${apiSecret ? 'HTTP Basic' : 'klíč v Authorization'}); hotovost: ${cash.free}`);

      // 2) pozice + mapování ticker → ISIN
      const [positions, instruments] = await Promise.all([
        client.getPositions(),
        client.getInstruments(),
      ]);
      const mapped = mapPositionsToIsin(positions, instruments);
      console.info(`[api] pozic: ${positions.length}, spárováno na ISIN: ${mapped.positions.length}`);
      if (mapped.unmatchedTickers.length > 0) {
        console.warn(`[api] nespárované tickery: ${mapped.unmatchedTickers.join(', ')}`);
      }
      expect(mapped.unmatchedTickers).toEqual([]);

      // 3) serverový export běžného roku → stejný parser jako ruční upload
      const now = new Date();
      const year = now.getUTCFullYear();
      console.info(`[api] žádám o export ${year} (generování může trvat i minuty)…`);
      const csv = await client.fetchHistoryCsv(
        {
          timeFrom: `${year}-01-01T00:00:00Z`,
          timeTo: now.toISOString().slice(0, 19) + 'Z',
          dataIncluded: {
            includeOrders: true,
            includeDividends: true,
            includeTransactions: true,
            includeInterest: true,
          },
        },
        65_000, // GET /history/exports snese ~1 dotaz/min
        600_000,
      );
      const imported = parseTrading212Csv(csv);
      console.info(
        `[api] export ${year}: ${imported.transactions.length} transakcí, ` +
          `${imported.errors.length} chyb, ${imported.warnings.length} varování`,
      );
      for (const error of imported.errors) console.error(`[api] :${error.line} ${error.message}`);
      expect(imported.errors).toEqual([]);

      // 4) rekonciliace: API export + případné ruční exporty starších let z fixtures/real
      const all: Transaction[] = [...imported.transactions];
      const files = existsSync(realDir)
        ? readdirSync(realDir).filter((f) => f.toLowerCase().endsWith('.csv'))
        : [];
      for (const file of files) {
        all.push(...parseTrading212Csv(readFileSync(join(realDir, file), 'utf8')).transactions);
      }
      const { fresh, duplicates } = dedupeTransactions(TRADING212_BROKER, all);
      console.info(
        `[api] k rekonciliaci ${fresh.length} transakcí (${duplicates} duplicit; ` +
          `${files.length} ručních souborů z fixtures/real)`,
      );

      const ledger = buildLedger(fresh, resolveOptions(), new WarningCollector());
      const computed = positionsAt(ledger, now.toISOString().slice(0, 10)).map((p) => ({
        isin: p.isin,
        quantity: p.totalRemaining,
      }));
      const report = reconcilePositions(computed, mapped.positions);
      if (report.ok) {
        console.info(`[api] ✓ rekonciliace sedí (${report.matchedIsins.length} pozic)`);
      } else {
        for (const issue of report.issues) {
          console.warn(
            `[api] ${issue.kind} ${issue.isin}: vypočteno ${issue.expectedQuantity.toFixed(4)}, ` +
              `broker ${issue.brokerQuantity.toFixed(4)}` +
              (issue.suggestedSplitRatio
                ? ` → návrh SPLIT ${issue.suggestedSplitRatio.from}:${issue.suggestedSplitRatio.to}`
                : ''),
          );
        }
        if (files.length === 0) {
          console.warn(
            '[api] Nesoulady jsou očekávané — API export pokrývá jen běžný rok. ' +
              'Vlož ruční exporty starších let do fixtures/real a spusť znovu.',
          );
        }
      }
    },
  );
});
