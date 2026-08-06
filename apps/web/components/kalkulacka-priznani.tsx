'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Mini kalkulačka „Musím podat přiznání?“: pár segmentovaných otázek →
 * okamžitý orientační verdikt. Čistý klientský stav (useState), žádný
 * formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační):
 * – tržby z prodejů CP do 100 000 Kč za rok → prodeje osvobozené („zlaté pravidlo“),
 * – vše drženo přes 3 roky → prodeje CP osvobozené (časový test),
 * – krypto má VLASTNÍ limit 100 000 Kč a od 15. 2. 2025 i vlastní tříletý test
 *   (R-10; test neplatí pro stablecoiny — hlídá nápověda),
 * – paušál + jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání,
 * – zaměstnanec + vedlejší zdanitelné příjmy nad 20 000 Kč → přiznání (§ 38g/2),
 * – jiné situace + zdanitelné příjmy nad 50 000 Kč celkem → přiznání (§ 38g/1),
 * – neosvobozené prodeje → přiznání,
 * – „Nevím“ u dividend/úroků → poctivé „bez dat to nejde říct“ (neptáme se
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
    napoveda:
      'Třeba zahraniční dividendy, úroky nebo nájem — osvobozené prodeje a české dividendy se srážkou se nepočítají.',
  },
  zamestnanec: {
    otazka: 'Máš letos vedle zaměstnání jiné zdanitelné příjmy nad 20 000 Kč?',
    napoveda: 'Třeba zahraniční dividendy, úroky nebo nájem — osvobozené prodeje se nepočítají.',
  },
  jine: {
    otazka: 'Máš letos zdanitelné příjmy nad 50 000 Kč celkem?',
    napoveda:
      'Včetně zahraničních dividend, úroků či nájmu — osvobozené prodeje a příjmy zdaněné srážkou se nepočítají.',
  },
};

/**
 * Znění otázek na jednom místě — hláška „chybí odpověď“ (H-24) musí uživateli
 * říct přesně tu otázku, kterou vidí na stránce.
 */
const QUESTIONS = {
  situation: 'Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?',
  sales: 'Prodal jsi letos akcie nebo ETF za víc než 100 000 Kč celkem?',
  holding: 'Držel jsi všechny prodané kusy déle než 3 roky?',
  crypto: 'Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?',
  cryptoHolding: 'Držel jsi všechno prodané krypto déle než 3 roky?',
} as const;

const PRIJMY_DUVOD: Record<Situace, string> = {
  pausal:
    'Jiné zdanitelné příjmy nad 50 000 Kč znamenají, že daň za ten rok není rovna paušální dani — podáš přiznání a přehledy, v paušálním režimu ale zůstáváš.',
  zamestnanec:
    'Vedlejší zdanitelné příjmy nad 20 000 Kč vedle zaměstnání znamenají přiznání — i bez jediného prodeje.',
  jine: 'Zdanitelné příjmy nad 50 000 Kč za rok znamenají povinnost podat přiznání.',
};

/** Odpovědi kalkulačky; `null` = uživatel na otázku zatím neodpověděl. */
export interface CalculatorAnswers {
  situace: Situace | null;
  prodejeNad100k: boolean | null;
  vseDrzeno3Roky: boolean | null;
  kryptoNad100k: boolean | null;
  kryptoDrzeno3Roky: boolean | null;
  prijmy: OdpovedPrijmy | null;
}

export interface CalculatorOutcome {
  verdikt: 'osvobozeno' | 'priznani' | 'nejasne' | null;
  duvod: string | null;
  /**
   * Otázka, kterou uživatel přeskočil a bez níž verdikt nevznikne. Podotázky
   * se totiž objevují průběžně, takže jde jednu minout a odpovědět až na
   * pozdější — dřív se v takovém případě nevykreslilo vůbec nic a kalkulačka
   * mlčela, aniž by řekla, co jí chybí (H-24).
   */
  skippedQuestion: string | null;
}

/**
 * Verdikt kalkulačky z odpovědí. Čistá funkce bez JSX — export kvůli testům.
 */
export function evaluateCalculator({
  situace,
  prodejeNad100k,
  vseDrzeno3Roky,
  kryptoNad100k,
  kryptoDrzeno3Roky,
  prijmy,
}: CalculatorAnswers): CalculatorOutcome {
  // prodeje CP jsou osvobozené limitem 100k, nebo splněným časovým testem;
  // null = na verdikt zatím chybí odpověď
  const prodejeOsvobozene =
    prodejeNad100k === null ? null : !prodejeNad100k ? true : vseDrzeno3Roky;
  // krypto: vlastní limit 100k a od 15. 2. 2025 i vlastní tříletý test (R-10)
  const kryptoOsvobozene =
    kryptoNad100k === null ? null : !kryptoNad100k ? true : kryptoDrzeno3Roky;

  let verdikt: CalculatorOutcome['verdikt'] = null;
  let duvod: string | null = null;
  if (kryptoOsvobozene === false) {
    verdikt = 'priznani';
    duvod =
      'Prodeje a směny kryptoaktiv nad 100 000 Kč ročně bez tří let držení jsou zdanitelný příjem.';
  } else if (situace !== null && prijmy === 'ano') {
    verdikt = 'priznani';
    duvod = PRIJMY_DUVOD[situace];
  } else if (prodejeOsvobozene === false) {
    verdikt = 'priznani';
    duvod = 'Prodeje nad 100 000 Kč bez tří let držení jsou zdanitelný příjem.';
  } else if (
    situace !== null &&
    prodejeOsvobozene !== null &&
    kryptoOsvobozene !== null &&
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

  // otázky v pořadí, ve kterém je uživatel vidí (podmínky = podmínky vykreslení)
  const questions: Array<{ label: string; answered: boolean }> = [
    { label: QUESTIONS.situation, answered: situace !== null },
    ...(situace !== null ? [{ label: QUESTIONS.sales, answered: prodejeNad100k !== null }] : []),
    ...(prodejeNad100k === true
      ? [{ label: QUESTIONS.holding, answered: vseDrzeno3Roky !== null }]
      : []),
    ...(prodejeNad100k !== null
      ? [{ label: QUESTIONS.crypto, answered: kryptoNad100k !== null }]
      : []),
    ...(kryptoNad100k === true
      ? [{ label: QUESTIONS.cryptoHolding, answered: kryptoDrzeno3Roky !== null }]
      : []),
    ...(situace !== null && kryptoOsvobozene !== null
      ? [{ label: PRIJMY_OTAZKA[situace].otazka, answered: prijmy !== null }]
      : []),
  ];
  const firstUnanswered = questions.findIndex((question) => !question.answered);
  // „přeskočená“ = nezodpovězená otázka, za kterou už uživatel na něco odpověděl
  const skippedQuestion =
    verdikt === null &&
    firstUnanswered !== -1 &&
    questions.slice(firstUnanswered + 1).some((question) => question.answered)
      ? questions[firstUnanswered]!.label
      : null;

  return { verdikt, duvod, skippedQuestion };
}

export function KalkulackaPriznani({ showHeader = true }: { showHeader?: boolean }) {
  const [situace, setSituace] = useState<Situace | null>(null);
  const [prodejeNad100k, setProdejeNad100k] = useState<boolean | null>(null);
  const [vseDrzeno3Roky, setVseDrzeno3Roky] = useState<boolean | null>(null);
  const [kryptoNad100k, setKryptoNad100k] = useState<boolean | null>(null);
  const [kryptoDrzeno3Roky, setKryptoDrzeno3Roky] = useState<boolean | null>(null);
  const [prijmy, setPrijmy] = useState<OdpovedPrijmy | null>(null);

  // krypto: vlastní limit 100k a od 15. 2. 2025 i vlastní tříletý test (R-10) —
  // řídí, kdy se ukáže poslední otázka
  const kryptoOsvobozene =
    kryptoNad100k === null ? null : !kryptoNad100k ? true : kryptoDrzeno3Roky;

  const { verdikt, duvod, skippedQuestion } = evaluateCalculator({
    situace,
    prodejeNad100k,
    vseDrzeno3Roky,
    kryptoNad100k,
    kryptoDrzeno3Roky,
    prijmy,
  });

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
          otazka={QUESTIONS.situation}
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
            otazka={QUESTIONS.sales}
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
            otazka={QUESTIONS.holding}
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
            otazka={QUESTIONS.crypto}
            napoveda="Kryptoaktiva mají vlastní limit 100 000 Kč, nezávislý na akciích. Nemáš krypto? Dej Ne."
            volby={[
              { hodnota: false, popisek: 'Ne' },
              { hodnota: true, popisek: 'Ano' },
            ]}
            hodnota={kryptoNad100k}
            onChange={(hodnota) => {
              setKryptoNad100k(hodnota);
              // podotázka na držení se týká jen odpovědi Ano — odpověď nepřenášet
              setKryptoDrzeno3Roky(null);
            }}
          />
        )}
        {kryptoNad100k === true && (
          <Otazka<boolean>
            otazka={QUESTIONS.cryptoHolding}
            napoveda="Od 15. 2. 2025 má i krypto tříletý test — počítá se i držení před tímto datem. U stablecoinů (USDT, USDC…) je test sporný — počítáme bezpečně, jako by neplatil."
            volby={[
              { hodnota: true, popisek: 'Ano, všechno' },
              { hodnota: false, popisek: 'Ne' },
            ]}
            hodnota={kryptoDrzeno3Roky}
            onChange={setKryptoDrzeno3Roky}
          />
        )}
        {situace !== null && kryptoOsvobozene !== null && (
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

      {/* přeskočená otázka: bez tohohle bloku by kalkulačka jen mlčela a
          uživatel by nevěděl, že na verdikt něco chybí (H-24) */}
      {skippedQuestion && (
        <div role="status" className="mt-6 rounded-md border border-linka bg-pozadi p-4">
          <p className="font-semibold">Ještě jedna odpověď a verdikt je hotový.</p>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Chybí odpověď na otázku „{skippedQuestion}“ — doplň ji výš.
          </p>
        </div>
      )}

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
              className={buttonVariants({ variant: 'primary' })}
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
