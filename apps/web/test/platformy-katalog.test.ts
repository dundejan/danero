import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as importers from '@danero/importers';
import { PLATFORMS, PLATFORM_COUNTS } from '@/lib/brokers-catalog';

/**
 * Strážný test katalogu platforem.
 *
 * Katalog je marketingový slib i návod zároveň: „výpis čteme automaticky“
 * u platformy bez parseru je lež, na kterou uživatel přijde až po nahrání
 * souboru, a chybějící soubor loga je rozbitý obrázek na landingu. Obojí se
 * z kódu nepozná — proto tenhle test.
 */

/**
 * Čím se pozná výpis platformy s vlastním parserem. Sniffery jsou schválně
 * vyjmenované ručně: nová platforma s `method: 'file'` musí mít buď svůj
 * sniffer, nebo tady vědomě zapsanou výjimku i s důvodem.
 */
const SNIFFERS: Record<string, keyof typeof importers | 'sdílený parser'> = {
  portu: 'sniffPortuCsv',
  xtb: 'sniffXtbXlsx',
  degiro: 'isDegiroCsv',
  etoro: 'sniffEtoroXlsx',
  mt4: 'sniffMt4Html',
  mt5: 'sniffMt5Html',
  saxo: 'sniffSaxoXlsx',
  swissquote: 'sniffSwissquoteCsv',
  tastytrade: 'sniffTastytradeCsv',
  schwab: 'sniffSchwabCsv',
  fio: 'sniffFioCsv',
  revolut: 'sniffRevolutInvestCsv',
  anycoin: 'sniffAnycoinCsv',
  coinmate: 'sniffCoinmateCsv',
  coinbase: 'sniffCoinbaseCsv',
  kraken: 'sniffKrakenCsv',
  // RoboForex vlastní formát nemá — účty běží na MT4/MT5 a report je jejich
  // (návod na to uživatele posílá); z klientské zóny jde jen univerzální šablona
  roboforex: 'sdílený parser',
};

describe('katalog platforem', () => {
  it('id jsou unikátní', () => {
    const ids = PLATFORMS.map((platform) => platform.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('každé logo existuje v public/loga', () => {
    for (const platform of PLATFORMS) {
      if (!platform.logo) continue;
      const path = resolve(import.meta.dirname, '..', 'public', platform.logo.src.slice(1));
      expect(existsSync(path), `${platform.id}: chybí ${platform.logo.src}`).toBe(true);
    }
  });

  it('platforma s „výpis čteme automaticky“ má opravdu parser', () => {
    for (const platform of PLATFORMS.filter((p) => p.method === 'file')) {
      const sniffer = SNIFFERS[platform.id];
      expect(sniffer, `${platform.id}: method 'file' bez zapsaného parseru`).toBeDefined();
      if (sniffer === undefined || sniffer === 'sdílený parser') continue;
      expect(typeof importers[sniffer], `${platform.id}: ${sniffer} není v @danero/importers`).toBe(
        'function',
      );
    }
  });

  it('živé napojení má kotvu na kartu a vedený import odkazuje na šablonu', () => {
    for (const platform of PLATFORMS.filter((p) => p.method === 'api')) {
      expect(platform.connectAnchor, `${platform.id}: chybí connectAnchor`).toBeTruthy();
    }
    for (const platform of PLATFORMS.filter((p) => p.method === 'template')) {
      expect(platform.guide, `${platform.id}: návod nezmiňuje šablonu`).toContain('šablon');
    }
  });

  it('návod je česky a věcný (žádný prázdný ani zapomenutý text)', () => {
    for (const platform of PLATFORMS) {
      expect(platform.guide.length, `${platform.id}: příliš krátký návod`).toBeGreaterThan(30);
      expect(platform.guide.trim().endsWith('.'), `${platform.id}: návod bez tečky`).toBe(true);
      expect(platform.guide, `${platform.id}: TODO v návodu`).not.toMatch(/TODO|FIXME|doplnit/i);
    }
  });

  it('počty pro marketingové texty sedí na katalog', () => {
    expect(PLATFORM_COUNTS.api + PLATFORM_COUNTS.file + PLATFORM_COUNTS.template).toBe(
      PLATFORMS.length,
    );
  });
});
