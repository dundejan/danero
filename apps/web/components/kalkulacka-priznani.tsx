'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Mini kalkulačka „Musím podat přiznání?": pár segmentovaných otázek →
 * okamžitý orientační verdikt. Čistý klientský stav (useState), žádný
 * formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační):
 * – tržby z prodejů CP do 100 000 Kč za rok → prodeje osvobozené („zlaté pravidlo"),
 * – vše drženo přes 3 roky → prodeje CP osvobozené (časový test),
 * – krypto má VLASTNÍ limit 100 000 Kč a časový test na něj neplatí (R-10),
 * – paušál + jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání,
 * – zaměstnanec + vedlejší zdanitelné příjmy nad 20 000 Kč → přiznání (§ 38g/2),
 * – jiné situace + zdanitelné příjmy nad 50 000 Kč celkem → přiznání (§ 38g/1),
 * – neosvobozené prodeje → přiznání,
 * – „Nevím" u dividend/úroků → poctivé „bez dat to nejde říct" (neptáme se
 *   na nic, co aplikace zjistí sama — sem patří CTA na napojení dat).
 */

type Situace = 'zamestnanec' | 'pausal' | 'jine';
type OdpovedPrijmy = 'ne' | 'ano' | 'nevim';

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
              'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
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

/** Text otázky na dividendy/úroky podle situace (limit 50k / 20k / 50k). */
const PRIJMY_OTAZKA: Record<Situace, { otazka: string; napoveda: string }> = {
  pausal: {
    otazka: 'Máš letos jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč?',
    napoveda: 'Třeba dividendy, úroky nebo nájem.',
  },
  zamestnanec: {
    otazka: 'Máš letos vedle zaměstnání jiné zdanitelné příjmy nad 20 000 Kč?',
    napoveda: 'Třeba zahraniční dividendy, úroky nebo nájem — osvobozené prodeje se nepočítají.',
  },
  jine: {
    otazka: 'Máš letos zdanitelné příjmy nad 50 000 Kč celkem?',
    napoveda: 'Včetně dividend, úroků či nájmu — osvobozené prodeje se nepočítají.',
  },
};

const PRIJMY_DUVOD: Record<Situace, string> = {
  pausal:
    'Jiné zdanitelné příjmy nad 50 000 Kč prolomí paušální režim — přiznání se podává kvůli nim.',
  zamestnanec:
    'Vedlejší zdanitelné příjmy nad 20 000 Kč vedle zaměstnání znamenají přiznání — i bez jediného prodeje.',
  jine: 'Zdanitelné příjmy nad 50 000 Kč za rok znamenají povinnost podat přiznání.',
};

export function KalkulackaPriznani({ showHeader = true }: { showHeader?: boolean }) {
  const [situace, setSituace] = useState<Situace | null>(null);
  const [prodejeNad100k, setProdejeNad100k] = useState<boolean | null>(null);
  const [vseDrzeno3Roky, setVseDrzeno3Roky] = useState<boolean | null>(null);
  const [kryptoNad100k, setKryptoNad100k] = useState<boolean | null>(null);
  const [prijmy, setPrijmy] = useState<OdpovedPrijmy | null>(null);

  // prodeje CP jsou osvobozené limitem 100k, nebo splněným časovým testem;
  // null = na verdikt zatím chybí odpověď
  const prodejeOsvobozene =
    prodejeNad100k === null ? null : !prodejeNad100k ? true : vseDrzeno3Roky;

  let verdikt: 'osvobozeno' | 'priznani' | 'nejasne' | null = null;
  let duvod: string | null = null;
  if (kryptoNad100k === true) {
    verdikt = 'priznani';
    duvod =
      'Prodeje a směny kryptoaktiv nad 100 000 Kč ročně jsou zdanitelné — tříletý test na krypto neplatí.';
  } else if (situace !== null && prijmy === 'ano') {
    verdikt = 'priznani';
    duvod = PRIJMY_DUVOD[situace];
  } else if (prodejeOsvobozene === false) {
    verdikt = 'priznani';
    duvod = 'Prodeje nad 100 000 Kč bez tří let držení jsou zdanitelný příjem.';
  } else if (
    situace !== null &&
    prodejeOsvobozene !== null &&
    kryptoNad100k !== null &&
    prijmy !== null
  ) {
    if (prijmy === 'nevim') {
      verdikt = 'nejasne';
      duvod =
        'Jestli dividendy a úroky limit přesáhly, zjistí Danero přesně z napojeného účtu nebo výpisu — včetně zahraniční srážkové daně.';
    } else {
      verdikt = 'osvobozeno';
      duvod = prodejeNad100k
        ? 'Po třech letech držení jsou prodeje osvobozené — a osvobozené příjmy do přiznání nepatří.'
        : ZLATE_PRAVIDLO;
    }
  }

  return (
    <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6 sm:p-8">
      {/* na samostatné /kalkulacka nese nadpis stránka — hlavička by se dublovala */}
      {showHeader && (
        <>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
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
          onChange={(hodnota) => {
            setSituace(hodnota);
            // limit otázky na příjmy se situací mění (50k vs. 20k) — odpověď nepřenášet
            setPrijmy(null);
          }}
        />
        {situace !== null && (
          <Otazka<boolean>
            otazka="Prodal jsi letos akcie nebo ETF za víc než 100 000 Kč celkem?"
            napoveda="Počítá se, za kolik jsi prodal — ne zisk. Krypto má vlastní limit, přijde na řadu za chvíli."
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
        {prodejeNad100k !== null && (
          <Otazka<boolean>
            otazka="Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?"
            napoveda="Kryptoaktiva mají samostatný limit 100 000 Kč a tříletý test na ně neplatí. Nemáš krypto? Dej Ne."
            volby={[
              { hodnota: false, popisek: 'Ne' },
              { hodnota: true, popisek: 'Ano' },
            ]}
            hodnota={kryptoNad100k}
            onChange={setKryptoNad100k}
          />
        )}
        {situace !== null && kryptoNad100k !== null && (
          <Otazka<OdpovedPrijmy>
            otazka={PRIJMY_OTAZKA[situace].otazka}
            napoveda={PRIJMY_OTAZKA[situace].napoveda}
            volby={[
              { hodnota: 'ne', popisek: 'Ne' },
              { hodnota: 'ano', popisek: 'Ano' },
              { hodnota: 'nevim', popisek: 'Nevím' },
            ]}
            hodnota={prijmy}
            onChange={setPrijmy}
          />
        )}
      </div>

      {verdikt && (
        <div
          role="status"
          className={cn(
            'mt-6 rounded-md border p-4',
            verdikt === 'osvobozeno' && 'border-zelena/40 bg-zelena/5',
            verdikt === 'priznani' && 'border-ruzova/30 bg-ruzova/5',
            verdikt === 'nejasne' && 'border-linka bg-pozadi',
          )}
        >
          <p className="font-semibold tabular-nums">
            {verdikt === 'osvobozeno' && 'Vypadá to, že přiznání kvůli investicím řešit nemusíš.'}
            {verdikt === 'priznani' && 'Nejspíš podáš přiznání — Danero ti připraví podklady.'}
            {verdikt === 'nejasne' && 'Tohle bez dat s jistotou říct nejde.'}
          </p>
          <p
            className={cn(
              'mt-1 text-sm tabular-nums',
              duvod === ZLATE_PRAVIDLO ? 'font-semibold text-zelena-text' : 'text-inkoust-tlumeny',
            )}
          >
            {duvod}
          </p>
          {verdikt !== 'nejasne' && (
            <p className="mt-2 text-xs text-inkoust-tlumeny">
              Orientačně — přesně to spočítá aplikace z tvých dat.
            </p>
          )}
          <p className="mt-3 text-sm text-inkoust-tlumeny">
            {verdikt === 'osvobozeno' &&
              'Limity se počítají každý rok znovu — Danero je pohlídá, ať to tak zůstane.'}
            {verdikt === 'priznani' &&
              'Danero spočítá přesnou daň a v březnu ti připraví podklady i XML pro podatelnu.'}
            {verdikt === 'nejasne' &&
              'Napoj brokera nebo nahraj výpis — na nic dalšího se ptát nebudeme.'}
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
