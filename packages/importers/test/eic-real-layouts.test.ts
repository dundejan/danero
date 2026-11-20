/**
 * EIC — export pokynů z portálu.
 *
 * Rozložení je doložené skutečným exportem, který 20. 11. 2026 přišel jako
 * nepřečtený výpis (do té doby byl EIC jen „přes univerzální šablonu“).
 * Fixtura z něj drží jen tvar; fondy, částky, kusy, data, účet i čísla
 * pokynů jsou smyšlené.
 */
import { describe, expect, it } from 'vitest';
import { decodeUpload, EIC_BROKER, parseEicCsv, sniffEicCsv, sniffPortuCsv } from '../src';
import { DEGIRO_ACCOUNT_HEADER_CZ, DEGIRO_TRANSACTIONS_HEADER_CZ } from './fixtures/degiro';
import { EIC_FIXTURE, EIC_HEADER } from './fixtures/eic';
import { encodeCp1250, FIO_FIXTURE } from './fixtures/fio';
import { PORTU_HEADER } from './fixtures/portu';

/** Jeden řádek nákupu ve tvaru exportu, s volitelně přepsanými buňkami. */
function buyRow(overrides: Record<number, string> = {}): string {
  const cells = [
    '"Savings-Buy VANFTAW / EUR"',
    '"Koupě"',
    '"VANFTAW"',
    '1.257',
    '119.7295',
    '150.5',
    '"EUR"',
    '"1234567801"',
    '17.03.2025',
    '',
    '"Zaúčtovaný"',
    '"Novák Jan "',
    '"poradci"',
    '',
    '0.42',
    '',
    '',
    '0.0',
    '',
    '"Koupě"',
    '"IE00BK5BQT80"',
    '5000000104',
  ];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return cells.join(';');
}

const file = (...rows: string[]): string => [EIC_HEADER, ...rows, ''].join('\n');

describe('EIC: export pokynů', () => {
  const result = parseEicCsv(EIC_FIXTURE);

  it('skutečné rozložení se načte bez chyb a bez varování', () => {
    expect(result.broker).toBe(EIC_BROKER);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('nákup: kusy, cena, měna, ISIN ze Share Isin, obchodní den a poplatek za vykonání', () => {
    expect(result.transactions).toHaveLength(3);
    const [first] = result.transactions;
    if (first?.type !== 'BUY') throw new Error('unreachable');
    expect(first.id).toBe('eic-5000000104');
    expect(first.isin).toBe('IE00BK5BQT80');
    expect(first.ticker).toBe('VANFTAW');
    expect(first.quantity.toString()).toBe('1.257');
    expect(first.pricePerShare.toString()).toBe('119.7295');
    expect(first.currency).toBe('EUR');
    expect(first.tradeDate).toBe('2025-03-17');
    expect(first.settlementDate).toBeUndefined();
    expect(first.fee?.amount.toString()).toBe('0.42');
    expect(first.fee?.currency).toBe('EUR');
    expect(first.account).toBe('1234567801');
  });

  /**
   * Hlavička má „Druh pokynu“ dvakrát: konverze má v prvním „Prodej“ (prodává
   * se koruna). Číst ji jako prodej by vyrobilo zdanitelný příjem z ničeho.
   */
  it('měnová konverze není prodej — přeskočí se s důvodem', () => {
    expect(result.transactions.every((tx) => tx.type === 'BUY')).toBe(true);
    expect(result.skipped).toHaveLength(3);
    expect(result.skipped[0]?.message).toContain('měnová konverze');
    expect(result.skipped[0]?.message).toContain('CZK → EUR');
  });

  it('soubor ve windows-1250 se po dekódování pozná i přečte', () => {
    const text = decodeUpload(encodeCp1250(EIC_FIXTURE));
    expect(sniffEicCsv(text)).toBe(true);
    const decoded = parseEicCsv(text);
    expect(decoded.errors).toEqual([]);
    expect(decoded.transactions).toHaveLength(3);
  });

  it('vyplněné datum vypořádání se převezme', () => {
    const settled = parseEicCsv(file(buyRow({ 9: '19.03.2025', 10: '"Vyspořádaný"' })));
    expect(settled.errors).toEqual([]);
    const [tx] = settled.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.settlementDate).toBe('2025-03-19');
  });

  it('prodej fondu jsme ve skutečném exportu neviděli — skončí chybou s doslovným zněním, ne odhadem', () => {
    const sale = parseEicCsv(file(buyRow({ 1: '"Prodej"', 19: '"Prodej"' })));
    expect(sale.transactions).toEqual([]);
    expect(sale.errors).toHaveLength(1);
    expect(sale.errors[0]?.message).toContain('Neznámý druh pokynu „Prodej“');
    expect(sale.errors[0]?.line).toBe(2);
  });

  it('pokyn v neznámém stavu se nezaúčtuje jako nákup', () => {
    const pending = parseEicCsv(file(buyRow({ 10: '"Zrušený"' })));
    expect(pending.transactions).toEqual([]);
    expect(pending.errors[0]?.message).toContain('„Zrušený“');
  });

  it('poplatek, který k nákupu nepatří, se nezapočte, ale ohlásí', () => {
    const withFxFee = parseEicCsv(file(buyRow({ 16: '0.45' })));
    expect(withFxFee.errors).toEqual([]);
    const [tx] = withFxFee.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.fee?.amount.toString()).toBe('0.42');
    expect(withFxFee.warnings).toHaveLength(1);
    expect(withFxFee.warnings[0]?.message).toContain('Poplatek za konverzi');
  });

  /**
   * Vstupní poplatek je ve skutečném exportu vždy 0.0 a poplatek za
   * vypořádání prázdný: nevíme, jestli jde o částku, nebo procento, ani jestli
   * už není v objemu. Revize 20. 11. 2026: první verze je potichu přičítala.
   */
  it('vstupní poplatek a poplatek za vypořádání se nepřičtou potichu — nezapočtou se a ohlásí', () => {
    const fees = parseEicCsv(file(buyRow({ 15: '0.52', 17: '1.5' })));
    expect(fees.errors).toEqual([]);
    const [tx] = fees.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.fee?.amount.toString()).toBe('0.42');
    expect(fees.warnings.map((warning) => warning.message)).toEqual([
      expect.stringContaining('Poplatek za vyspořádání'),
      expect.stringContaining('Vstupní poplatek'),
    ]);
  });

  it.each(['', '0.0000'])('chybějící nebo nulová cena („%s“) se dopočte z objemu', (price) => {
    const noPrice = parseEicCsv(file(buyRow({ 3: '1.25', 4: price })));
    expect(noPrice.errors).toEqual([]);
    const [tx] = noPrice.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.pricePerShare.toString()).toBe('120.4');
  });

  /** Předpona nestačí: „Vyspořádání probíhá“ není „Vyspořádané“. */
  it.each(['Vyspořádání probíhá', 'Zaúčtovaný - storno', ''])(
    'stav „%s“ není provedený pokyn',
    (status) => {
      const pending = parseEicCsv(file(buyRow({ 10: `"${status}"` })));
      expect(pending.transactions).toEqual([]);
      expect(pending.errors).toHaveLength(1);
    },
  );

  /**
   * Co nese druhý „Druh pokynu“ u odkupu fondu, nevíme. Kdyby to nebyl směr,
   * prodej s „Koupě“ jen ve druhém sloupci by se zaúčtoval jako nákup.
   */
  it('směr „Prodej“ s druhem „Koupě“ se nezaúčtuje jako nákup', () => {
    const mixed = parseEicCsv(file(buyRow({ 1: '"Prodej"' })));
    expect(mixed.transactions).toEqual([]);
    expect(mixed.errors[0]?.message).toContain('„Prodej“ a „Koupě“');
  });

  it('nečitelné číslo je chyba řádku, ne nula', () => {
    const broken = parseEicCsv(file(buyRow({ 3: '1 250,5.1' })));
    expect(broken.transactions).toEqual([]);
    expect(broken.errors[0]?.message).toContain('počet kusů');
  });

  /**
   * Lokalizace se rozhoduje za celý soubor: výpis jen s čísly o třech
   * desetinných místech důkaz nedá, a to se musí říct, ne potichu uhodnout.
   */
  it('soubor, který desetinný oddělovač neprozradí, dostane varování', () => {
    const ambiguous = parseEicCsv(file(buyRow({ 3: '1.250', 4: '', 5: '150.500', 14: '', 17: '' })));
    expect(ambiguous.errors).toEqual([]);
    const [tx] = ambiguous.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.quantity.toString()).toBe('1.25');
    expect(ambiguous.warnings).toHaveLength(1);
    expect(ambiguous.warnings[0]?.message).toContain('tisíckrát');
  });

  it('desetinná čárka v celém souboru se přečte stejně jako tečka', () => {
    const comma = parseEicCsv(
      file(buyRow({ 3: '1,250', 4: '120,4000', 5: '150,50', 14: '0,30', 17: '0,0' })),
    );
    expect(comma.errors).toEqual([]);
    const [tx] = comma.transactions;
    if (tx?.type !== 'BUY') throw new Error('unreachable');
    expect(tx.quantity.toString()).toBe('1.25');
    expect(tx.pricePerShare.toString()).toBe('120.4');
  });

  it('opakované čtení dává stejná id (základ idempotentního importu)', () => {
    const again = parseEicCsv(EIC_FIXTURE);
    expect(again.transactions.map((tx) => tx.id)).toEqual(result.transactions.map((tx) => tx.id));
    expect(new Set(result.transactions.map((tx) => tx.id)).size).toBe(result.transactions.length);
  });
});

describe('sniffEicCsv (autodetekce)', () => {
  it('pozná export pokynů, i když má jen hlavičku', () => {
    expect(sniffEicCsv(EIC_FIXTURE)).toBe(true);
    expect(sniffEicCsv(EIC_HEADER)).toBe(true);
  });

  it('nesplete se s jinými středníkovými exporty a ty se nespletou s ním', () => {
    expect(sniffEicCsv('')).toBe(false);
    expect(sniffEicCsv('foo;bar\n1;2')).toBe(false);
    expect(sniffEicCsv(PORTU_HEADER)).toBe(false);
    expect(sniffEicCsv(DEGIRO_TRANSACTIONS_HEADER_CZ)).toBe(false);
    expect(sniffEicCsv(DEGIRO_ACCOUNT_HEADER_CZ)).toBe(false);
    expect(sniffEicCsv(FIO_FIXTURE)).toBe(false);
    expect(sniffPortuCsv(EIC_FIXTURE)).toBe(false);
  });

  /** Sniffer ⊆ parser: co sniffer pustí, parser nesmí odmítnout na hlavičce. */
  it('bez kteréhokoli vyžadovaného sloupce soubor odmítne sniffer i parser shodně', () => {
    const headers = EIC_HEADER.split(';');
    for (const dropped of ['Fond', 'Cena', 'Stav', 'Share Isin', 'ID']) {
      const text = [headers.filter((header) => header !== dropped).join(';'), ''].join('\n');
      expect(sniffEicCsv(text), dropped).toBe(false);
      expect(parseEicCsv(text).errors[0]?.message, dropped).toContain('nevypadá jako export pokynů z EIC');
    }
    // sloupec, který parser nevyžaduje, nesmí chtít ani sniffer
    const withoutAdvisor = file(buyRow()).replace(';Poradce', ';Jiný sloupec');
    expect(sniffEicCsv(withoutAdvisor)).toBe(true);
    expect(parseEicCsv(withoutAdvisor).transactions).toHaveLength(1);
  });
});
