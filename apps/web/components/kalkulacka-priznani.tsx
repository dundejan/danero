'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mini kalkulačka „Musím podat přiznání?" pro landing: pár segmentovaných
 * otázek → okamžitý orientační verdikt. Čistý klientský stav (useState),
 * žádný formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační):
 * – tržby z prodejů do 100 000 Kč za rok → prodeje osvobozené („zlaté pravidlo"),
 * – vše drženo přes 3 roky → prodeje osvobozené (časový test),
 * – paušál + jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání,
 * – neosvobozené prodeje → přiznání.
 */

type Situace = 'zamestnanec' | 'pausal' | 'jine';

const ZLATE_PRAVIDLO = 'Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.';

/** Jedna otázka se segmentovanými volbami ve stylu aplikace (aria-pressed). */
function Otazka<T extends string | boolean>({
  otazka,
  napoveda,
  volby,
  hodnota,
  onChange,
}: {
  otazka: string;
  napoveda?: string;
  volby: readonly { hodnota: T; popisek: string }[];
  hodnota: T | null;
  onChange: (hodnota: T) => void;
}) {
  return (
    <div role="group" aria-label={otazka}>
      <p className="text-sm font-medium tabular-nums">{otazka}</p>
      {napoveda && <p className="mt-0.5 text-xs text-inkoust-tlumeny">{napoveda}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {volby.map((volba) => (
          <button
            key={String(volba.hodnota)}
            type="button"
            aria-pressed={hodnota === volba.hodnota}
            onClick={() => onChange(volba.hodnota)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
              hodnota === volba.hodnota
                ? 'border-ruzova-syta bg-ruzova-syta text-white'
                : 'border-linka bg-plocha text-inkoust-tlumeny hover:border-ruzova hover:text-ruzova',
            )}
          >
            {volba.popisek}
          </button>
        ))}
      </div>
    </div>
  );
}

export function KalkulackaPriznani({ showHeader = true }: { showHeader?: boolean }) {
  const [situace, setSituace] = useState<Situace | null>(null);
  const [prodejeNad100k, setProdejeNad100k] = useState<boolean | null>(null);
  const [vseDrzeno3Roky, setVseDrzeno3Roky] = useState<boolean | null>(null);
  const [jinePrijmyNad50k, setJinePrijmyNad50k] = useState<boolean | null>(null);

  // prodeje jsou osvobozené limitem 100k, nebo splněným časovým testem;
  // null = na verdikt zatím chybí odpověď
  const prodejeOsvobozene =
    prodejeNad100k === null ? null : !prodejeNad100k ? true : vseDrzeno3Roky;

  let verdikt: 'osvobozeno' | 'priznani' | null = null;
  let duvod: string | null = null;
  if (situace === 'pausal' && jinePrijmyNad50k === true) {
    // stačí samo o sobě — na odpovědích o prodejích už nezáleží
    verdikt = 'priznani';
    duvod =
      'Jiné zdanitelné příjmy nad 50 000 Kč prolomí paušální režim — přiznání se podává kvůli nim.';
  } else if (
    situace !== null &&
    prodejeOsvobozene !== null &&
    (situace !== 'pausal' || jinePrijmyNad50k !== null)
  ) {
    if (prodejeOsvobozene) {
      verdikt = 'osvobozeno';
      duvod = prodejeNad100k
        ? 'Po třech letech držení jsou prodeje osvobozené — a osvobozené příjmy do přiznání nepatří.'
        : ZLATE_PRAVIDLO;
    } else {
      verdikt = 'priznani';
      duvod = 'Prodeje nad 100 000 Kč bez tří let držení jsou zdanitelný příjem.';
    }
  }

  return (
    <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6 sm:p-8">
      {/* na samostatné /kalkulacka nese nadpis stránka — hlavička by se dublovala */}
      {showHeader && (
        <>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova">
            Kalkulačka
          </p>
          <h2
            id="kalkulacka-nadpis"
            className="mt-3 font-display text-2xl font-bold tracking-tight"
          >
            Musím podat přiznání?
          </h2>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Odpověz na pár otázek — bez čísel z výpisů a bez registrace.
          </p>
        </>
      )}

      <div className={showHeader ? 'mt-6 space-y-5' : 'space-y-5'}>
        <Otazka<Situace>
          otazka="Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?"
          volby={[
            { hodnota: 'zamestnanec', popisek: 'Zaměstnanec' },
            { hodnota: 'pausal', popisek: 'OSVČ v paušálu' },
            { hodnota: 'jine', popisek: 'Jiné' },
          ]}
          hodnota={situace}
          onChange={setSituace}
        />
        {situace !== null && (
          <Otazka<boolean>
            otazka="Prodal jsi letos akcie, ETF nebo krypto za víc než 100 000 Kč celkem?"
            napoveda="Počítá se, za kolik jsi prodal — ne zisk."
            volby={[
              { hodnota: false, popisek: 'Ne' },
              { hodnota: true, popisek: 'Ano' },
            ]}
            hodnota={prodejeNad100k}
            onChange={setProdejeNad100k}
          />
        )}
        {prodejeNad100k === true && (
          <Otazka<boolean>
            otazka="Držel jsi všechny prodané kusy déle než 3 roky?"
            volby={[
              { hodnota: true, popisek: 'Ano, všechny' },
              { hodnota: false, popisek: 'Ne' },
            ]}
            hodnota={vseDrzeno3Roky}
            onChange={setVseDrzeno3Roky}
          />
        )}
        {situace === 'pausal' && prodejeNad100k !== null && (
          <Otazka<boolean>
            otazka="Máš letos jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč?"
            napoveda="Třeba dividendy, úroky nebo nájem."
            volby={[
              { hodnota: false, popisek: 'Ne' },
              { hodnota: true, popisek: 'Ano' },
            ]}
            hodnota={jinePrijmyNad50k}
            onChange={setJinePrijmyNad50k}
          />
        )}
      </div>

      {verdikt && (
        <div
          role="status"
          className={cn(
            'mt-6 rounded-md border p-4',
            verdikt === 'osvobozeno' ? 'border-zelena/40 bg-zelena/5' : 'border-ruzova/30 bg-ruzova/5',
          )}
        >
          <p className="font-semibold tabular-nums">
            {verdikt === 'osvobozeno'
              ? 'Vypadá to, že přiznání kvůli investicím řešit nemusíš.'
              : 'Nejspíš podáš přiznání — Danero ti připraví podklady.'}
          </p>
          <p
            className={cn(
              'mt-1 text-sm tabular-nums',
              duvod === ZLATE_PRAVIDLO ? 'font-semibold text-zelena' : 'text-inkoust-tlumeny',
            )}
          >
            {duvod}
          </p>
          <p className="mt-2 text-xs text-inkoust-tlumeny">
            Orientačně — přesně to spočítá aplikace z tvých dat.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/demo/prehled"
              className="rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Vyzkoušet demo
            </Link>
            <Link
              href="/registrace"
              className="rounded-md border border-inkoust/25 bg-plocha px-4 py-2 text-sm font-semibold shadow-sm hover:border-ruzova hover:text-ruzova dark:border-inkoust/40"
            >
              Založit účet
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
