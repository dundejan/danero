import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ordinalById } from '../src/ledger/ledger';
import { buy, run, sell } from './helpers';

/**
 * A2-3-10: daň nesmí záviset na jazykovém nastavení serveru.
 *
 * `String.prototype.localeCompare` bere řadicí pravidla z locale procesu
 * (ICU podle `LANG` / `LC_ALL`). Česká abeceda řadí digraf „ch“ až za „h“,
 * takže `'ibkr-ch1'.localeCompare('ibkr-h9')` vyjde pod `cs_CZ` opačně než
 * pod `en_US`. V enginu to bylo poslední kritérium řazení hned na dvou
 * místech — v pořadí událostí derivátů a v `orderLots`, kde rozhoduje, KTERÝ
 * lot se prodeji spáruje, tedy přímo nabývací cena a dílčí základ daně.
 *
 * Hostovaná služba běží na Vercelu, kde Node bez `LANG` rezolvuje `en-US`,
 * takže tam se to neprojevilo — vlastní instance podle docs/16 v českém
 * prostředí ano. A hlavně to porušovalo invariant, že výpočet je čistá funkce
 * reprodukovatelná od nuly.
 */

const ENGINE_SRC = join(import.meta.dirname, '..', 'src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return entry.endsWith('.ts') ? [full] : [];
  });
}

describe('engine je nezávislý na locale procesu', () => {
  it('nikde neřadí podle `localeCompare` nad identifikátory', () => {
    const provinilci = tsFiles(ENGINE_SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((radek, index) => {
          // v komentářích se o localeCompare mluví schválně (vysvětlení nálezu)
          const kod = radek.split('//')[0] ?? '';
          if (!kod.includes('.localeCompare(')) return [];
          // datumy v ISO tvaru řadí každé locale stejně (jen číslice a pomlčky)
          if (/Date\.localeCompare|acquisitionDate|saleDate|\bdate\b/.test(kod)) return [];
          return [`${file.slice(ENGINE_SRC.length + 1)}:${index + 1}: ${kod.trim()}`];
        }),
    );

    expect(provinilci).toEqual([]);
  });

  it('`ordinalById` řadí stejně bez ohledu na české řadicí pravidlo pro „ch“', () => {
    // pod cs_CZ vrací localeCompare opačné pořadí — ordinální porovnání ne
    expect(ordinalById({ id: 'ibkr-ch1' }, { id: 'ibkr-h9' })).toBe(-1);
    expect(ordinalById({ id: 'ibkr-h9' }, { id: 'ibkr-ch1' })).toBe(1);
    expect(ordinalById({ id: 'stejne' }, { id: 'stejne' })).toBe(0);
  });

  it('párování lotů téhož dne dá stejnou daň, ať se ID jmenují jakkoli', () => {
    // dva nákupy téhož dne za různé ceny → FIFO musí vzít vždy týž lot,
    // nezávisle na tom, jestli se ID řadí česky, nebo ordinálně
    const zaklad = (idLevny: string, idDrahy: string): string =>
      run([
        buy({ id: idLevny, quantity: '10', pricePerShare: '100', tradeDate: '2024-03-01' }),
        buy({ id: idDrahy, quantity: '10', pricePerShare: '900', tradeDate: '2024-03-01' }),
        sell({ id: 'prodej', quantity: '10', pricePerShare: '1000', tradeDate: '2025-06-02' }),
      ]).securities.base10Czk.toString();

    // „ch“ × „h“ je přesně dvojice, na které se locale rozchází
    expect(zaklad('lot-ch1', 'lot-h9')).toBe(zaklad('lot-a1', 'lot-b9'));
  });
});
