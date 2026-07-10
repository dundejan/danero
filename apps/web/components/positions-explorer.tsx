'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PositionCard } from '@/components/position-card';
import { cn } from '@/lib/utils';

/**
 * Interaktivní tabulka pozic na /portfolio: hledání, řazení a stránkování
 * nad server-předpočítanými řádky (žádné Decimal přes hranici — texty jsou
 * hotové, pro řazení slouží čistá čísla v `sort`). Stejný stav řídí desktop
 * tabulku i mobilní seznam karet.
 */
export interface ExplorerRow {
  isin: string;
  label: string;
  name?: string;
  /** Počet kusů jako text bez jednotky (tabulka/karta si „ks" doplní samy). */
  qtyText: string;
  /** Cena za kus v měně instrumentu (undefined = broker cenu nedodal). */
  priceText?: string;
  /** Hodnota v Kč (undefined = bez ceny či kurzu). */
  valueText?: string;
  /** Plný text P/L pro tabulku (částka + procento). */
  plText?: string;
  /** Procento P/L — mobilní badge a řazení. */
  plPct?: number;
  plPositive?: boolean;
  /** „bez daně od …" / „vše bez daně" — mobilní karta. */
  exemptText: string;
  exemptDone: boolean;
  /** Text sloupce Bez daně (např. „12 ks"); undefined = „—". */
  exemptQtyText?: string;
  /** Čísla pro řazení; null = neznámé (řadí se vždy na konec). */
  sort: {
    label: string;
    qty: number | null;
    value: number | null;
    pl: number | null;
    exempt: number | null;
  };
}

type SortKey = 'label' | 'qty' | 'value' | 'pl' | 'exempt';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 10;

/** Bez diakritiky a velikosti písmen — „vaclav" najde „Václav". */
const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function compareRows(a: ExplorerRow, b: ExplorerRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  if (key === 'label') return sign * a.sort.label.localeCompare(b.sort.label, 'cs');
  const av = a.sort[key];
  const bv = b.sort[key];
  // neznámé hodnoty (bez ceny/kurzu) patří na konec bez ohledu na směr
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return sign * (av - bv);
}

function SortableTh({
  label,
  sortKey,
  active,
  dir,
  onSort,
  alignRight,
  title,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  alignRight?: boolean;
  title?: string;
}) {
  return (
    <th
      className={cn('py-2 pr-4', alignRight && 'text-right')}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide hover:text-inkoust',
          active && 'text-inkoust',
        )}
      >
        {label}
        <span aria-hidden className={active ? undefined : 'opacity-40'}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

export function PositionsExplorer({
  rows,
  showExempt,
}: {
  rows: ExplorerRow[];
  showExempt: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      // výchozí směr: abecedně vzestupně, čísla sestupně (největší nahoře)
      setSortDir(key === 'label' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const needle = normalize(query.trim());
  const filtered = needle
    ? rows.filter((row) => normalize(`${row.label} ${row.name ?? ''} ${row.isin}`).includes(needle))
    : rows;
  const sorted = [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir));

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to = from + pageRows.length - 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Hledat pozici…"
          aria-label="Hledat pozici (název, ticker nebo ISIN)"
          className="h-9 w-full max-w-xs rounded-md border border-linka bg-plocha px-3 text-sm text-inkoust placeholder:text-inkoust-tlumeny"
        />
        {/* mobil: řazení jako select — hlavičky tabulky tam nejsou */}
        <label className="flex items-center gap-2 text-xs text-inkoust-tlumeny md:hidden">
          Řadit
          <select
            value={`${sortKey}-${sortDir}`}
            onChange={(event) => {
              const [key, dir] = event.target.value.split('-') as [SortKey, SortDir];
              setSortKey(key);
              setSortDir(dir);
              setPage(1);
            }}
            className="h-8 rounded-md border border-linka bg-plocha px-2 text-xs text-inkoust"
          >
            <option value="value-desc">Hodnota ↓</option>
            <option value="value-asc">Hodnota ↑</option>
            <option value="label-asc">Název A–Z</option>
            <option value="label-desc">Název Z–A</option>
            <option value="qty-desc">Kusů ↓</option>
            <option value="qty-asc">Kusů ↑</option>
            <option value="pl-desc">Zisk/ztráta ↓</option>
            <option value="pl-asc">Zisk/ztráta ↑</option>
            {showExempt && <option value="exempt-desc">Bez daně ↓</option>}
            {showExempt && <option value="exempt-asc">Bez daně ↑</option>}
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-inkoust-tlumeny">Nic nenalezeno pro „{query.trim()}“.</p>
      ) : (
        <>
          {/* mobil: karty místo tabulky (H4) — táž stránka filtrovaného výsledku */}
          <div className="space-y-2 md:hidden">
            {pageRows.map((row) => (
              <PositionCard
                key={row.isin}
                isin={row.isin}
                label={row.label}
                name={row.name}
                primaryText={row.valueText ?? `${row.qtyText} ks`}
                secondaryText={row.valueText ? `${row.qtyText} ks` : undefined}
                pl={
                  row.plText !== undefined && row.plPositive !== undefined
                    ? {
                        text:
                          row.plPct !== undefined
                            ? `${row.plPct >= 0 ? '+' : ''}${row.plPct.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
                            : row.plText,
                        positive: row.plPositive,
                      }
                    : null
                }
                exemptText={row.exemptText}
                exemptDone={row.exemptDone}
              />
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-inkoust-tlumeny">
                  <SortableTh
                    label="Instrument"
                    sortKey="label"
                    active={sortKey === 'label'}
                    dir={sortDir}
                    onSort={toggleSort}
                  />
                  <SortableTh
                    label="Kusů"
                    sortKey="qty"
                    active={sortKey === 'qty'}
                    dir={sortDir}
                    onSort={toggleSort}
                    alignRight
                  />
                  {/* bez řazení — ceny jsou v měnách instrumentů a mezi měnami
                      by pořadí nedávalo smysl; srovnatelná je Hodnota (Kč) */}
                  <th
                    className="py-2 pr-4 text-right"
                    title="Ceny jsou v různých měnách — pro srovnání řaď podle hodnoty v Kč"
                  >
                    Cena/ks
                  </th>
                  <SortableTh
                    label="Hodnota (Kč)"
                    sortKey="value"
                    active={sortKey === 'value'}
                    dir={sortDir}
                    onSort={toggleSort}
                    alignRight
                  />
                  <SortableTh
                    label="Nerealizovaný zisk/ztráta"
                    sortKey="pl"
                    active={sortKey === 'pl'}
                    dir={sortDir}
                    onSort={toggleSort}
                    alignRight
                    title="Rozdíl aktuální hodnoty a nabývací ceny — zisk/ztráta, kdybys prodal teď (před zdaněním); řadí se podle procenta"
                  />
                  {showExempt && (
                    <SortableTh
                      label="Bez daně"
                      sortKey="exempt"
                      active={sortKey === 'exempt'}
                      dir={sortDir}
                      onSort={toggleSort}
                      alignRight
                    />
                  )}
                </tr>
              </thead>
              <tbody className="font-mono">
                {pageRows.map((row) => (
                  <tr key={row.isin} className="border-t border-linka">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/portfolio/${row.isin}`}
                        className="font-medium text-inkoust hover:text-ruzova"
                      >
                        {row.label}
                      </Link>
                      <span className="block text-xs text-inkoust-tlumeny">
                        {row.name ? `${row.name} · ` : ''}
                        {row.isin}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right">{row.qtyText}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">
                      {row.priceText ?? '—'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">
                      {row.valueText ?? '—'}
                    </td>
                    <td
                      className={cn(
                        'whitespace-nowrap py-2 pr-4 text-right',
                        row.plPositive !== undefined && (row.plPositive ? 'text-zelena' : 'text-cervena'),
                      )}
                    >
                      {row.plText ?? '—'}
                    </td>
                    {showExempt && (
                      <td className="py-2 text-right">
                        {row.exemptQtyText ? (
                          <span className="text-zelena">{row.exemptQtyText}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sorted.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-inkoust-tlumeny">
              <span>
                {from}–{to} z {sorted.length} pozic
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Předchozí stránka"
                  className="rounded-md border border-linka px-2 py-1 font-medium text-inkoust hover:border-ruzova hover:text-ruzova disabled:pointer-events-none disabled:opacity-40"
                >
                  ‹
                </button>
                <span className="font-mono">
                  {currentPage} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage === pageCount}
                  aria-label="Další stránka"
                  className="rounded-md border border-linka px-2 py-1 font-medium text-inkoust hover:border-ruzova hover:text-ruzova disabled:pointer-events-none disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
