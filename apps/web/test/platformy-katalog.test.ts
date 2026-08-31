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

  /**
   * K7b-10: parser Degira posílal uživatele do menu „Aktivita“, katalog do
   * „Inboxu“ — dvě různá jména téhož menu v jednom produktu, takže jedno
   * z nich muselo být špatně. Katalog je zdroj pravdy; hlášky parseru na něj
   * musí sedět. Test je průchozí i pro další platformy, které v hlášce
   * jmenují cestu v portálu.
   */
  it('hlášky Degira jmenují stejné menu jako katalog', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      resolve(import.meta.dirname, '..', '..', '..', 'packages', 'importers', 'src', 'degiro', 'csv.ts'),
      'utf8',
    );
    const guide = PLATFORMS.find((platform) => platform.id === 'degiro')!.guide;
    const menu = guide.split('→')[0]!.trim(); // „Inbox“
    expect(menu).toBeTruthy();
    for (const message of source.matchAll(/nahraj \w+\.csv z Degiro \(([^)]+)\)/g)) {
      expect(message[1], 'hláška parseru jmenuje jiné menu než katalog').toContain(menu);
    }
    // a že těch hlášek vůbec nějaké jsou (jinak by test nic nehlídal)
    expect([...source.matchAll(/nahraj \w+\.csv z Degiro \(/g)]).toHaveLength(2);
  });

  /**
   * K7b-07: návod sliboval, že „Dluhopisy z Portu Opportunity mají vlastní
   * výpis“, ale parser pro ten výpis neexistuje — a katalog jinde tvrdí, že
   * výpis přečteme automaticky. Slib, který nemáme čím splnit, musí být
   * v návodu přiznaný.
   */
  it('návod nenabízí export, pro který parser nemáme (Portu Opportunity)', () => {
    const guide = PLATFORMS.find((platform) => platform.id === 'portu')!.guide;
    expect(guide).toContain('Opportunity');
    expect(guide).toMatch(/číst neumíme|zatím nečteme/);
    expect(guide).toContain('šablon');
  });

  it('počty pro marketingové texty sedí na katalog', () => {
    expect(PLATFORM_COUNTS.api + PLATFORM_COUNTS.file + PLATFORM_COUNTS.template).toBe(
      PLATFORMS.length,
    );
  });
});
