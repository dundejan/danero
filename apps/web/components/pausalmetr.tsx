'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mikro-nástroj (docs/12): orientační čerpání limitu 50 000 Kč pro OSVČ
 * v paušálním režimu (§ 7a) — zdanitelné příjmy mimo samostatnou činnost.
 * Čistě klientské, nic se neukládá; přesný výpočet (kurzy ČNB, osvobození
 * per prodej) dělá aplikace z reálných dat. Formulace drží jazyk aplikace.
 */

const LIMIT = 50_000;

/** „12 345", „12 345,50" i „12345.50" → číslo; nesmysl → 0. */
function parseKc(value: string): number {
  const cleaned = value.replaceAll(/\s/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const KC = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

const POLE = [
  {
    id: 'dividendy',
    label: 'Zahraniční dividendy (brutto)',
    hint: 'Před sražením zahraniční daně, přepočtené na Kč — třeba z Trading 212 nebo IBKR.',
  },
  {
    id: 'uroky',
    label: 'Úroky a nájem',
    hint: 'Úroky, ze kterých ti v ČR nestrhli daň (zahraniční účty, dluhopisy), a příjmy z nájmu.',
  },
  {
    id: 'prodeje',
    label: 'Neosvobozené tržby z prodejů',
    hint: 'Prodeje cenných papírů jen pokud za rok přesáhly 100 000 Kč a kusy nemáš držené přes 3 roky; krypto nad vlastní limit 100 000 Kč; plnění z derivátů.',
  },
] as const;

type PoleId = (typeof POLE)[number]['id'];

export function Pausalmetr() {
  const [hodnoty, setHodnoty] = useState<Record<PoleId, string>>({
    dividendy: '',
    uroky: '',
    prodeje: '',
  });

  const celkem = POLE.reduce((sum, pole) => sum + parseKc(hodnoty[pole.id]), 0);
  const procento = Math.round((celkem / LIMIT) * 100);
  const vyplneno = Object.values(hodnoty).some((value) => value.trim() !== '');
  const zbyva = LIMIT - celkem;

  return (
    <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6 sm:p-8">
      <div className="space-y-5">
        {POLE.map((pole) => (
          <div key={pole.id}>
            <label htmlFor={`pm-${pole.id}`} className="text-sm font-medium">
              {pole.label}{' '}
              <span className="font-normal text-inkoust-tlumeny">Kč/rok</span>
            </label>
            <p className="mt-0.5 text-xs text-inkoust-tlumeny">{pole.hint}</p>
            <input
              id={`pm-${pole.id}`}
              inputMode="decimal"
              value={hodnoty[pole.id]}
              onChange={(event) =>
                setHodnoty((prev) => ({ ...prev, [pole.id]: event.target.value }))
              }
              placeholder="0"
              className="mt-2 w-full max-w-xs rounded-md border border-inkoust/25 bg-plocha px-3 py-2.5 text-sm shadow-sm outline-none focus:border-ruzova tabular-nums"
            />
          </div>
        ))}
      </div>

      {vyplneno && (
        <div role="status" className="mt-6 rounded-md border border-linka bg-pozadi p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold tabular-nums">
              {KC.format(celkem)} Kč z {KC.format(LIMIT)} Kč
            </p>
            <p
              className={cn(
                'font-mono text-sm font-semibold tabular-nums',
                procento >= 100
                  ? 'text-cervena'
                  : procento >= 60
                    ? 'text-jantar-text'
                    : 'text-zelena-text',
              )}
            >
              {procento} %
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-linka" aria-hidden>
            <div
              className={cn(
                'h-full rounded-full transition-all',
                procento >= 100 ? 'bg-cervena' : procento >= 60 ? 'bg-jantar' : 'bg-zelena',
              )}
              style={{ width: `${Math.min(procento, 100)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-inkoust-tlumeny">
            {celkem > LIMIT ? (
              <>
                Limit je prolomený — za tenhle rok podáš daňové přiznání a přehledy
                pro ČSSZ a zdravotní pojišťovnu. V paušálním režimu ale zůstáváš.
              </>
            ) : zbyva <= LIMIT * 0.4 ? (
              <>
                Do limitu ti zbývá {KC.format(zbyva)} Kč. Další dividenda nebo prodej
                už můžou rozhodnout — tohle je přesně chvíle, kdy se vyplatí hlídat
                každou položku.
              </>
            ) : (
              <>
                Do limitu ti zbývá {KC.format(zbyva)} Kč — zatím v klidu. Limit se
                ale plní každou zahraniční dividendou, i malou.
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-inkoust-tlumeny">
            Orientačně — přesně to spočítá aplikace z tvých dat, včetně kurzů ČNB
            a posouzení, které prodeje jsou osvobozené.{' '}
            <Link
              href="/demo/prehled"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Ukázka v demu →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
