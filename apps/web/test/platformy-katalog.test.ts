import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as importers from '@danero/importers';
import { AssetClassSchema } from '@danero/shared';
import {
  PLATFORMS,
  PLATFORM_COUNTS,
  TEMPLATE_RULES,
  UNIVERSAL_INFO,
} from '@/lib/brokers-catalog';

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
  it('hlášky Degira jmenují stejné menu jako katalog', () => {
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

/**
 * Návod je cesta, kterou uživatel proklikává. Kde platforma nabízí vedle
 * správného exportu i jiný (nebo jinou volbu v témže průvodci), musí návod
 * říct, který z nich čteme — jinak skončí u hlášky „formát nepoznáváme“
 * a u nás přibude falešný případ k rozboru.
 */
describe('návody jmenují export, který čteme, i ten, který ne', () => {
  const guide = (id: string): string => PLATFORMS.find((platform) => platform.id === id)!.guide;

  it('L2c-07: Revolut varuje před výpisem „Profit and loss statement“', () => {
    expect(guide('revolut')).toContain('Profit and loss statement');
    expect(guide('revolut')).toMatch(/nečteme/);
    // a pořád jmenuje ten správný
    expect(guide('revolut').match(/Account statement/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('L2d-07: Anycoin chce export všech měn (vyfiltrovaná měna rozbije každý obchod)', () => {
    expect(guide('anycoin')).toContain('všechny měny');
    expect(guide('anycoin')).toContain('Sekci „Daně“ nepoužívej');
  });

  it('L2d-09: Kraken říká zvolit CSV, počkat na vygenerování a ZIP jen podmíněně', () => {
    expect(guide('kraken')).toMatch(/formát\S* (zvol )?CSV/);
    expect(guide('kraken')).toContain('PDF');
    expect(guide('kraken')).toMatch(/generuje/);
    expect(guide('kraken')).toContain('ze seznamu exportů');
    expect(guide('kraken')).toMatch(/Pokud přijde ZIP/);
    expect(guide('kraken')).not.toMatch(/\. Přijde ZIP/);
    expect(guide('kraken')).toContain('ledgers.csv');
  });

  it('L2b-05: Schwab říká, že výpis Equity Awards zatím nečteme a co s ním', () => {
    expect(guide('schwab')).toContain('Transaction History');
    expect(guide('schwab')).toContain('Equity Awards');
    expect(guide('schwab')).toMatch(/zatím (ne|nečteme)/);
    expect(guide('schwab')).toContain('šablon');
  });
});

/**
 * L2c-02: katalog sliboval, že „formát je popsaný přímo v souboru“, a v šabloně
 * přitom o tvaru data, desetinném oddělovači ani o povolených hodnotách nebylo
 * slovo — uživatel se je dozvěděl až z chyb po nahrání. Pravidla proto stojí
 * tam, kde se šablona stahuje, a hlídá se, že sedí na parser.
 */
describe('univerzální šablona: pravidla jsou tam, kde se stahuje', () => {
  const source = (...path: string[]): string =>
    readFileSync(resolve(import.meta.dirname, '..', ...path), 'utf8');
  const rules = TEMPLATE_RULES.map((rule) => `${rule.label}: ${rule.text}`).join('\n');

  it('nikde už neslibujeme popis „přímo v souboru“', () => {
    expect(UNIVERSAL_INFO.guide).not.toContain('popsaný přímo v souboru');
    expect(source('lib', 'brokers-catalog.ts')).not.toContain('popsaný přímo v souboru');
    expect(source('components', 'platform-catalog.tsx')).not.toContain('popsaný přímo v souboru');
  });

  it('pravidla říkají tvar data i desetinný oddělovač — a příklady z nich parser přečte', () => {
    expect(rules).toContain('2026-03-05');
    expect(rules).toContain('5.3.2026');
    expect(rules).toMatch(/[Dd]esetinn/);
    expect(rules).toContain('1250,50');
    expect(rules).toContain('1250.50');
    for (const [date, price] of [
      ['2026-03-05', '1250,50'],
      ['5.3.2026', '1250.50'],
    ]) {
      const result = importers.parseUniversalCsv(
        `type;date;isin;quantity;price;currency\nBUY;${date};US0000000001;2;${price};USD`,
      );
      expect(result.errors, `${date} · ${price}`).toEqual([]);
      const tx = result.transactions[0] as { tradeDate: string; pricePerShare: { toString(): string } };
      expect(tx.tradeDate).toBe('2026-03-05');
      expect(tx.pricePerShare.toString()).toBe('1250.5');
    }
  });

  // A13-R1-01: šablona ke stažení píše desetinnou čárku a otevírá se v českém
  // Excelu, kde tečku napsat nejde (z „1.5“ uloží „01.V“). Pravidlo dřív tvrdilo,
  // že čárka i tečka „fungují stejně“, a parser přitom „2,125“ odmítal.
  it('pravidlo o číslech neslibuje víc, než parser dodrží — ani u čísla na tři desetinná místa', () => {
    expect(rules).not.toContain('fungují stejně');
    expect(rules).toMatch(/V Excelu piš desetinnou čárku/);
    expect(rules).toContain('2,125');
    expect(rules).toContain('2125');

    const quantityOf = (csv: string): string[] =>
      importers
        .parseUniversalCsv(csv)
        .transactions.flatMap((tx) => (tx.type === 'BUY' ? [tx.quantity.toString()] : []));

    // stažená šablona, v níž uživatel přepíše počet kusů prvního nákupu
    const firstBuy = ';;;;10;185,50;USD;';
    expect(importers.UNIVERSAL_TEMPLATE_EXCEL_CSV.split(firstBuy)).toHaveLength(2);
    const edited = importers.UNIVERSAL_TEMPLATE_EXCEL_CSV.replace(firstBuy, ';;;;2,125;185,50;USD;');
    const filled = importers.parseUniversalCsv(edited);
    expect(filled.errors).toEqual([]);
    expect(filled.transactions).toHaveLength(17);
    expect(quantityOf(edited)[0]).toBe('2.125');

    // „když desetinnou čárku píšou i jiná čísla v souboru; jinak … s chybou“
    const head = 'type;date;isin;quantity;price;currency';
    const proven = `${head}\nBUY;2026-03-05;US0000000001;2,125;1250,50;USD`;
    expect(importers.parseUniversalCsv(proven).errors).toEqual([]);
    expect(quantityOf(proven)).toEqual(['2.125']);
    const alone = importers.parseUniversalCsv(`${head}\nBUY;2026-03-05;US0000000001;2,125;1250;USD`);
    expect(alone.transactions).toEqual([]);
    expect(alone.errors).toHaveLength(1);
    expect(alone.errors[0]!.message).toContain('2125');
    // hláška neposílá k tečce toho, kdo ji v Excelu napsat nemůže, jako k jediné cestě
    expect(alone.errors[0]!.message).not.toMatch(/TEČKOU/);
  });

  it('pravidla vyjmenují všechny hodnoty, které parser ve sloupcích type, subtype a asset_class bere', () => {
    expect(rules).toContain('type');
    expect(rules).toContain('subtype');
    expect(rules).toContain('asset_class');
    for (const type of importers.UNIVERSAL_TEMPLATE_TYPES) {
      expect(rules, `chybí typ ${type}`).toContain(type);
    }
    // A13-R1-02: podtypy korporátní akce pravidla vyjmenovávají taky
    expect(importers.UNIVERSAL_TEMPLATE_SUBTYPES.length).toBeGreaterThanOrEqual(5);
    for (const subtype of importers.UNIVERSAL_TEMPLATE_SUBTYPES) {
      expect(rules, `chybí podtyp korporátní akce ${subtype}`).toContain(subtype);
    }
    for (const assetClass of AssetClassSchema.options) {
      expect(rules, `chybí druh aktiva ${assetClass}`).toContain(assetClass);
    }
  });

  // A13-R1-03: věta u odkazu na stažení slibuje poznámku u KAŽDÉHO řádku
  it('každý ukázkový řádek šablony má v posledním sloupci poznámku, jak slibuje návod', () => {
    expect(UNIVERSAL_INFO.guide).toContain('Každý ukázkový řádek má v posledním sloupci poznámku');
    const { headers, rows } = importers.parseCsv(importers.UNIVERSAL_TEMPLATE_EXCEL_CSV.slice(1), ';');
    expect(headers.at(-1)).toBe('note');
    expect(rows).toHaveLength(17);
    for (const row of rows) {
      expect(row.at(-1)!.trim(), `řádek ${row.slice(0, 5).join(';')} nemá poznámku`).not.toBe('');
    }
  });

  it('stránka pravidla vykresluje a karty platforem na ně odkazují', () => {
    const component = source('components', 'platform-catalog.tsx');
    expect(component).toContain('TEMPLATE_RULES.map');
    expect(component).toContain('id="sablona"');
    expect(component).toContain('href="#sablona"');
  });
});
