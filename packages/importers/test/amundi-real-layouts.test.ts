/**
 * Moje Amundi — sešit „Export transakcí“ — a přehled aktuálních pozic.
 *
 * Obě rozložení jsou doložená skutečnými sešity, které 20. 11. 2026 přišly
 * jako nepřečtené výpisy. Fixtury z nich drží jen tvar; fondy, částky, ceny,
 * kusy i data jsou smyšlené.
 */
import { describe, expect, it } from 'vitest';
import {
  AMUNDI_BROKER,
  parseAmundiXlsx,
  POSITIONS_STATEMENT_MESSAGE,
  sniffAmundiXlsx,
  sniffEtoroXlsx,
  sniffMt5Xlsx,
  sniffPositionsStatementXlsx,
  sniffRevolutXlsx,
  sniffSaxoXlsx,
  sniffSaxoXlsxShape,
  sniffXtbFiscalReport,
  sniffXtbXlsx,
} from '../src';
import {
  AMUNDI_TRADE_ROWS,
  AMUNDI_TRADES_HEADER,
  buildAmundiXlsx,
  buildPositionsStatementXlsx,
  loadWorkbook,
  POSITIONS_HEADER,
} from './fixtures/amundi';
import { buildSaxoXlsx, SAXO_ROWS_EN } from './fixtures/saxo';
import { buildXtbXlsx, XTB_ROWS_EN } from './fixtures/xtb';

/** První řádek obchodů s přepsanými buňkami. */
const tradeRow = (overrides: Record<number, string> = {}): string[] => {
  const cells = [...AMUNDI_TRADE_ROWS[0]!];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return cells;
};

describe('Moje Amundi: export transakcí', () => {
  it('skutečné rozložení se načte bez chyb a bez varování', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx());
    expect(result.broker).toBe(AMUNDI_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(3);
  });

  /** Typ je psaný z pohledu fondu: „Primární prodej“ je vydání podílových listů. */
  it('„Primární prodej“ je nákup: ISIN, název fondu, cena, měna a den zobchodování', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx());
    expect(result.transactions.every((tx) => tx.type === 'BUY')).toBe(true);
    const [first, second] = result.transactions;
    if (first?.type !== 'BUY' || second?.type !== 'BUY') throw new Error('unreachable');
    expect(first.isin).toBe('LU0000000018');
    expect(first.name).toBe('Vzorový akciový fond - A CZK (C)');
    expect(first.pricePerShare.toString()).toBe('12500');
    expect(first.currency).toBe('CZK');
    expect(first.tradeDate).toBe('2025-03-11');
    expect(first.fee).toBeUndefined();
    expect(second.currency).toBe('USD');
    expect(second.quantity.toString()).toBe('0.36');
  });

  /**
   * Zobrazené množství je zaokrouhlené na tři místa: 0,119 × 12 500 dá
   * 1 487,50, zaplaceno bylo 1 485,75. Kusy se proto dopočítávají z částky
   * a ceny, ať nabývací cena sedí na zaplacenou částku.
   */
  it('kusy se dopočítají z částky a ceny, ne ze zaokrouhleného množství', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx());
    const [first] = result.transactions;
    if (first?.type !== 'BUY') throw new Error('unreachable');
    expect(first.quantity.toString()).toBe('0.11886');
    expect(first.quantity.times(first.pricePerShare).toString()).toBe('1485.75');
  });

  it('množství, které částce a ceně neodpovídá, řádek zastaví', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx({ trades: [tradeRow({ 5: '1,190' })] }));
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('neodpovídá částce a ceně');
    expect(result.errors[0]?.line).toBe(2);
  });

  /**
   * Revize 20. 11. 2026: mez se odvozovala z počtu míst přečteného čísla,
   * jenže „1,000“ je po převodu 1 (nula míst) a mez vyšla 1 — nákup 1,9 ks
   * proti zobrazenému 1,000 prošel bez chyby.
   */
  it.each([
    ['1,000', '100,00', '190,00'],
    ['0,100', '100,00', '19,00'],
  ])('kontrola množství nepovolí koncovými nulami („%s“)', async (shown, price, amount) => {
    const result = await parseAmundiXlsx(
      await buildAmundiXlsx({ trades: [tradeRow({ 5: shown, 6: price, 7: amount })] }),
    );
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]?.message).toContain('neodpovídá částce a ceně');
  });

  it('buňky uložené jako čísla a datum se přečtou stejně jako text', async () => {
    const row = [new Date(Date.UTC(2025, 2, 11)), 'Primární prodej', 'Vzorový fond', 'LU0000000018', '', 0.119, 12500, 1485.75, 'CZK'];
    const result = await parseAmundiXlsx(await buildAmundiXlsx({ trades: [row] }));
    expect(result.errors).toEqual([]);
    const [tx] = result.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.tradeDate).toBe('2025-03-11');
    expect(tx.quantity.toString()).toBe('0.11886');
  });

  /** List, který lokalizaci neprozradí: „12.500“ je dvanáct a půl, nebo dvanáct a půl tisíce? */
  it('nerozhodnutelný zápis čísla se nehádá — řádek skončí chybou', async () => {
    const result = await parseAmundiXlsx(
      await buildAmundiXlsx({ trades: [tradeRow({ 5: '', 6: '12.500', 7: '1.485' })] }),
    );
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('list obchodů bez jediného řádku dostane varování, ne tichý úspěch', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx({ trades: [] }));
    expect(result.transactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('prázdný');
  });

  it('bez sloupce Množství se obchod načte stejně (parser ho nevyžaduje, sniffer taky ne)', async () => {
    const header = AMUNDI_TRADES_HEADER.filter((column) => column !== 'Množství');
    const row = tradeRow().filter((_, index) => index !== 5);
    const buffer = await buildAmundiXlsx({ tradesHeader: header, trades: [row] });
    expect(sniffAmundiXlsx(await loadWorkbook(buffer))).toBe(true);
    const result = await parseAmundiXlsx(buffer);
    expect(result.errors).toEqual([]);
    expect(result.transactions).toHaveLength(1);
  });

  it('list pokynů se nečte a import to řekne i s tím, že poplatek nezapočítal', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx());
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.message).toContain('„Transakce“');
    expect(result.skipped[0]?.message).toContain('Vstupní poplatek');
    const withoutOrders = await parseAmundiXlsx(await buildAmundiXlsx({ orders: null }));
    expect(withoutOrders.skipped).toEqual([]);
    expect(withoutOrders.transactions).toHaveLength(3);
  });

  it('odkup jsme ve skutečném exportu neviděli — neznámý typ končí chybou s doslovným zněním', async () => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx({ trades: [tradeRow({ 1: 'Zpětný odkup' })] }));
    expect(result.transactions).toEqual([]);
    expect(result.errors[0]?.message).toContain('Neznámý typ transakce „Zpětný odkup“');
  });

  it.each([
    [6, 'x', 'cena'],
    [6, '0,00', 'cena'],
    [7, '', 'částka'],
    [7, '1.485,75', 'částka'],
    [0, '31. 02. 2025', 'datum'],
    [8, 'Kč', 'měna'],
    [3, '', 'ISIN'],
  ])('nečitelná buňka (sloupec %i = „%s“) je chyba řádku, ne nula', async (index, value, _label) => {
    const result = await parseAmundiXlsx(await buildAmundiXlsx({ trades: [tradeRow({ [index]: value })] }));
    expect(result.transactions).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it('dva obsahově shodné obchody se neslijí a id jsou stabilní', async () => {
    const buffer = await buildAmundiXlsx({ trades: [tradeRow(), tradeRow()] });
    const first = await parseAmundiXlsx(buffer);
    const second = await parseAmundiXlsx(buffer);
    expect(first.transactions).toHaveLength(2);
    expect(new Set(first.transactions.map((tx) => tx.id)).size).toBe(2);
    expect(second.transactions.map((tx) => tx.id)).toEqual(first.transactions.map((tx) => tx.id));
  });
});

describe('sniffAmundiXlsx (autodetekce)', () => {
  it('pozná sešit podle listu obchodů a nevezmou ho jiné sniffery', async () => {
    const workbook = await loadWorkbook(await buildAmundiXlsx());
    expect(sniffAmundiXlsx(workbook)).toBe(true);
    for (const sniff of [sniffXtbXlsx, sniffXtbFiscalReport, sniffEtoroXlsx, sniffSaxoXlsx, sniffSaxoXlsxShape, sniffMt5Xlsx, sniffRevolutXlsx]) {
      expect(sniff(workbook), sniff.name).toBe(false);
    }
    expect(sniffPositionsStatementXlsx(workbook)).toBe(false);
  });

  it('cizí sešity nebere', async () => {
    expect(sniffAmundiXlsx(await loadWorkbook(await buildXtbXlsx({ rows: XTB_ROWS_EN })))).toBe(false);
    expect(sniffAmundiXlsx(await loadWorkbook(await buildSaxoXlsx({ rows: SAXO_ROWS_EN })))).toBe(false);
    expect(sniffAmundiXlsx(await loadWorkbook(await buildPositionsStatementXlsx()))).toBe(false);
  });

  /** Sniffer ⊆ parser: bez vyžadovaného sloupce odmítnou sešit oba. */
  it.each(['Zobchodování', 'Typ', 'ISIN', 'Cena', 'Částka', 'Měna'])(
    'bez sloupce „%s“ sešit odmítne sniffer i parser',
    async (dropped) => {
      const header = AMUNDI_TRADES_HEADER.filter((column) => column !== dropped);
      const buffer = await buildAmundiXlsx({ tradesHeader: header, trades: [] });
      expect(sniffAmundiXlsx(await loadWorkbook(buffer))).toBe(false);
      const result = await parseAmundiXlsx(buffer);
      expect(result.errors[0]?.message).toContain('nevypadá jako export transakcí');
    },
  );
});

describe('přehled aktuálních pozic', () => {
  it('pozná se podle sloupců a žádný parser ho nevezme', async () => {
    const workbook = await loadWorkbook(await buildPositionsStatementXlsx());
    expect(sniffPositionsStatementXlsx(workbook)).toBe(true);
    for (const sniff of [sniffXtbXlsx, sniffXtbFiscalReport, sniffEtoroXlsx, sniffSaxoXlsx, sniffSaxoXlsxShape, sniffMt5Xlsx, sniffRevolutXlsx, sniffAmundiXlsx]) {
      expect(sniff(workbook), sniff.name).toBe(false);
    }
  });

  /** Sešit s datem je historie — ta patří parseru nebo k rozboru, ne sem. */
  it('sešit se sloupcem data přehled pozic není', async () => {
    const withDate = await buildPositionsStatementXlsx([...POSITIONS_HEADER, 'Datum nákupu']);
    expect(sniffPositionsStatementXlsx(await loadWorkbook(withDate))).toBe(false);
    const tradeDay = await buildPositionsStatementXlsx([...POSITIONS_HEADER, 'Obchodní den']);
    expect(sniffPositionsStatementXlsx(await loadWorkbook(tradeDay))).toBe(false);
  });

  /**
   * Revize 20. 11. 2026: sloupec navíc může být přesně to, co hláška
   * prohlašuje za chybějící, a druhý list může nést historii — obojí má
   * propadnout jako nepoznaný formát a schovat se k rozboru.
   */
  it.each(['Nakoupeno dne', 'Nákupní cena', 'Valuta', 'Time'])(
    'sloupec navíc („%s“) → přehled pozic to není',
    async (extra) => {
      const buffer = await buildPositionsStatementXlsx([...POSITIONS_HEADER, extra]);
      expect(sniffPositionsStatementXlsx(await loadWorkbook(buffer))).toBe(false);
    },
  );

  it('sešit s dalším listem (historie) přehled pozic není', async () => {
    const buffer = await buildPositionsStatementXlsx(POSITIONS_HEADER, {
      name: 'Transakce',
      rows: [
        ['Datum', 'Směr', 'ISIN', 'Počet', 'Cena', 'Měna'],
        ['11. 03. 2025', 'Nákup', 'CZ0000000013', 100, 6.1, 'CZK'],
      ],
    });
    expect(sniffPositionsStatementXlsx(await loadWorkbook(buffer))).toBe(false);
  });

  it('bez tržní hodnoty to přehled pozic není', async () => {
    const header = POSITIONS_HEADER.filter((column) => column !== 'Tržní hodnota');
    expect(sniffPositionsStatementXlsx(await loadWorkbook(await buildPositionsStatementXlsx(header)))).toBe(false);
  });

  it('hláška říká, co chybí a co nahrát místo toho', () => {
    expect(POSITIONS_STATEMENT_MESSAGE).toContain('přehled transakcí');
    expect(POSITIONS_STATEMENT_MESSAGE).not.toContain('nepoznáváme');
  });
});
