'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

/**
 * Mini kalkulačka „Musím podat přiznání?“: pár segmentovaných otázek →
 * okamžitý orientační verdict. Čistý klientský stav (useState), žádný
 * formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační):
 * – tržby z prodejů CP do 100 000 Kč za rok → prodeje osvobozené („zlaté pravidlo“),
 * – vše drženo přes 3 roky → prodeje CP osvobozené (časový test),
 * – krypto má VLASTNÍ limit 100 000 Kč a od 15. 2. 2025 i vlastní tříletý test
 *   (R-10; test neplatí pro stablecoiny — hlídá nápověda),
 * – paušál + jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání,
 * – zaměstnanec + vedlejší zdanitelné příjmy nad 20 000 Kč → přiznání (§ 38g/2),
 * – jiné situation + zdanitelné příjmy nad 50 000 Kč celkem → přiznání (§ 38g/1),
 * – neosvobozené prodeje → přiznání,
 * – do limitů 50k/20k patří i kladná plnění z derivátů (R-08d/R-10f) —
 *   nápověda je musí jmenovat, jinak na ně tazatel odpoví „Ne“,
 * – „Nevím“ u dividend/úroků → poctivé „bez dat to nejde říct“ (neptáme se
 *   na nic, co aplikace zjistí sama — sem patří CTA na napojení dat).
 */

type Situation = 'zamestnanec' | 'pausal' | 'jine';
type IncomeAnswer = 'ne' | 'ano' | 'nevim';

const GOLDEN_RULE = 'Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.';

/** Jedna otázka se segmentovanými volbami ve stylu aplikace (aria-pressed). */
function Question<T extends string | boolean>({
  question,
  hint,
  options,
  value,
  onChange,
}: {
  question: string;
  hint?: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={question}>
      <p className="text-sm font-medium tabular-nums">{question}</p>
      {hint && <p className="mt-0.5 text-xs text-inkoust-tlumeny">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((volba) => (
          <button
            key={String(volba.value)}
            type="button"
            aria-pressed={value === volba.value}
            onClick={() => onChange(volba.value)}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              value === volba.value
                ? 'border-ruzova-syta bg-ruzova-syta text-white'
                : 'border-linka-ovladaci bg-plocha text-inkoust-tlumeny hover:border-ruzova hover:text-ruzova',
            )}
          >
            {volba.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Text otázky na ostatní zdanitelné příjmy podle situation (limit 50k / 20k / 50k).
 * Nápověda musí vyjmenovat i **deriváty**: do limitů vstupují kladná plnění
 * z opcí, futures a CFD (R-08d/R-10f, `limits.ts` je sčítá jako
 * `derivatives.taxableIncomeCzk`). Bez nich odpověděl obchodník s CFD „Ne“
 * a kalkulačka mu řekla, že přiznání řešit nemusí, i když limit prolomil.
 * Export kvůli testu znění.
 */
export const INCOME_QUESTION: Record<Situation, { question: string; hint: string }> = {
  pausal: {
    question: 'Máš letos jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč?',
    hint:
      'Třeba zahraniční dividendy, úroky, nájem, kladná plnění z derivátů (CFD, opce, futures) nebo prodeje a směny stablecoinů — osvobozené prodeje a české dividendy se srážkou se nepočítají.',
  },
  zamestnanec: {
    question: 'Máš letos vedle zaměstnání jiné zdanitelné příjmy nad 20 000 Kč?',
    hint:
      'Třeba zahraniční dividendy, úroky, nájem, kladná plnění z derivátů (CFD, opce, futures) nebo prodeje a směny stablecoinů — osvobozené prodeje se nepočítají.',
  },
  jine: {
    question: 'Máš letos zdanitelné příjmy nad 50 000 Kč celkem?',
    hint:
      'Včetně zahraničních dividend, úroků, nájmu, kladných plnění z derivátů (CFD, opce, futures) i prodejů a směn stablecoinů — osvobozené prodeje a příjmy zdaněné srážkou se nepočítají.',
  },
};

/**
 * Otázka na krypto. Nápověda **musí** vyjmenovat stablecoiny: § 4 odst. 1
 * písm. zj) elektronické peněžní tokeny z osvobození výslovně vylučuje (R-10a),
 * takže jejich prodej i směna se daní vždy a do stovky se nepočítají. Bez téhle
 * věty odpověděl člověk, který směnil 60 000 Kč v USDC, „Ne“ a kalkulačka mu
 * řekla, že přiznání řešit nemusí — přitom má 60 000 Kč zdanitelného příjmu
 * a jako zaměstnanec je 20 000 Kč hranice dávno pryč (nález E-3-03).
 * Export kvůli testu znění.
 */
export const CRYPTO_QUESTION = {
  question: 'Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?',
  hint:
    'Kryptoaktiva mají vlastní limit 100 000 Kč, nezávislý na akciích. Stablecoiny (USDT, USDC a další tokeny navázané na měnu) se do něj nepočítají — ty se daní vždy, takže je zahrň až do otázky na ostatní zdanitelné příjmy. Nemáš krypto? Dej Ne.',
} as const;

/**
 * Oznámení osvobozeného příjmu (§ 38v ZDP, R-09d). Patří k verdiktu
 * „přiznání řešit nemusíš“: kdo prodal za 6 milionů akcie držené pět let,
 * přiznání opravdu nepodává — ale oznámení podat musí a pokuta je 0,1–15 %
 * z částky (§ 38w). Zamlčet to je horší než zamlčet daň.
 */
export const OZNAMENI_5M =
  'Pozor na jednu výjimku: jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu přesto oznamuje (§ 38v zákona o daních z příjmů). Přiznání to není, lhůta je ale stejná.';

/**
 * Znění otázek na jednom místě — hláška „chybí odpověď“ (H-24) musí uživateli
 * říct přesně tu otázku, kterou vidí na stránce.
 */
const QUESTIONS = {
  situation: 'Jsi zaměstnanec, OSVČ v paušálu, nebo jiné?',
  sales: 'Prodal jsi letos akcie nebo ETF za víc než 100 000 Kč celkem?',
  holding: 'Držel jsi všechny prodané kusy déle než 3 roky?',
  crypto: CRYPTO_QUESTION.question,
  cryptoHolding: 'Držel jsi všechno prodané krypto déle než 3 roky?',
} as const;

const PRIJMY_DUVOD: Record<Situation, string> = {
  pausal:
    'Jiné zdanitelné příjmy nad 50 000 Kč znamenají, že daň za ten rok není rovna paušální dani — podáš přiznání a přehledy, v paušálním režimu ale zůstáváš.',
  zamestnanec:
    'Vedlejší zdanitelné příjmy nad 20 000 Kč vedle zaměstnání znamenají přiznání — i bez jediného prodeje.',
  jine: 'Zdanitelné příjmy nad 50 000 Kč za rok znamenají povinnost podat přiznání.',
};

/** Odpovědi kalkulačky; `null` = uživatel na otázku zatím neodpověděl. */
export interface CalculatorAnswers {
  situation: Situation | null;
  salesOver100k: boolean | null;
  allHeldThreeYears: boolean | null;
  kryptoNad100k: boolean | null;
  kryptoDrzeno3Roky: boolean | null;
  prijmy: IncomeAnswer | null;
}

export interface CalculatorOutcome {
  verdict: 'osvobozeno' | 'priznani' | 'nejasne' | null;
  reason: string | null;
  /**
   * Otázka, kterou uživatel přeskočil a bez níž verdict nevznikne. Podotázky
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
  situation,
  salesOver100k,
  allHeldThreeYears,
  kryptoNad100k,
  kryptoDrzeno3Roky,
  prijmy,
}: CalculatorAnswers): CalculatorOutcome {
  // prodeje CP jsou osvobozené limitem 100k, nebo splněným časovým testem;
  // null = na verdict zatím chybí odpověď
  const salesExempt =
    salesOver100k === null ? null : !salesOver100k ? true : allHeldThreeYears;
  // krypto: vlastní limit 100k a od 15. 2. 2025 i vlastní tříletý test (R-10)
  const kryptoOsvobozene =
    kryptoNad100k === null ? null : !kryptoNad100k ? true : kryptoDrzeno3Roky;

  let verdict: CalculatorOutcome['verdict'] = null;
  let reason: string | null = null;
  if (kryptoOsvobozene === false) {
    verdict = 'priznani';
    reason =
      'Prodeje a směny kryptoaktiv nad 100 000 Kč ročně bez tří let držení jsou zdanitelný příjem.';
  } else if (situation !== null && prijmy === 'ano') {
    verdict = 'priznani';
    reason = PRIJMY_DUVOD[situation];
  } else if (salesExempt === false) {
    verdict = 'priznani';
    reason = 'Prodeje nad 100 000 Kč bez tří let držení jsou zdanitelný příjem.';
  } else if (
    situation !== null &&
    salesExempt !== null &&
    kryptoOsvobozene !== null &&
    prijmy !== null
  ) {
    if (prijmy === 'nevim') {
      verdict = 'nejasne';
      reason =
        'Jestli dividendy a úroky limit přesáhly, zjistí Danero přesně z napojeného účtu nebo výpisu — včetně zahraniční srážkové daně.';
    } else {
      verdict = 'osvobozeno';
      reason = salesOver100k
        ? 'Po třech letech držení jsou prodeje osvobozené — a osvobozené příjmy do přiznání nepatří.'
        : GOLDEN_RULE;
    }
  }

  // otázky v pořadí, ve kterém je uživatel vidí (podmínky = podmínky vykreslení)
  const questions: Array<{ label: string; answered: boolean }> = [
    { label: QUESTIONS.situation, answered: situation !== null },
    ...(situation !== null ? [{ label: QUESTIONS.sales, answered: salesOver100k !== null }] : []),
    ...(salesOver100k === true
      ? [{ label: QUESTIONS.holding, answered: allHeldThreeYears !== null }]
      : []),
    ...(salesOver100k !== null
      ? [{ label: QUESTIONS.crypto, answered: kryptoNad100k !== null }]
      : []),
    ...(kryptoNad100k === true
      ? [{ label: QUESTIONS.cryptoHolding, answered: kryptoDrzeno3Roky !== null }]
      : []),
    ...(situation !== null && kryptoOsvobozene !== null
      ? [{ label: INCOME_QUESTION[situation].question, answered: prijmy !== null }]
      : []),
  ];
  const firstUnanswered = questions.findIndex((question) => !question.answered);
  // „přeskočená“ = nezodpovězená otázka, za kterou už uživatel na něco odpověděl
  const skippedQuestion =
    verdict === null &&
    firstUnanswered !== -1 &&
    questions.slice(firstUnanswered + 1).some((question) => question.answered)
      ? questions[firstUnanswered]!.label
      : null;

  return { verdict, reason, skippedQuestion };
}

export function KalkulackaPriznani({ showHeader = true }: { showHeader?: boolean }) {
  const [situation, setSituace] = useState<Situation | null>(null);
  const [salesOver100k, setProdejeNad100k] = useState<boolean | null>(null);
  const [allHeldThreeYears, setVseDrzeno3Roky] = useState<boolean | null>(null);
  const [kryptoNad100k, setKryptoNad100k] = useState<boolean | null>(null);
  const [kryptoDrzeno3Roky, setKryptoDrzeno3Roky] = useState<boolean | null>(null);
  const [prijmy, setPrijmy] = useState<IncomeAnswer | null>(null);

  // krypto: vlastní limit 100k a od 15. 2. 2025 i vlastní tříletý test (R-10) —
  // řídí, kdy se ukáže poslední otázka
  const kryptoOsvobozene =
    kryptoNad100k === null ? null : !kryptoNad100k ? true : kryptoDrzeno3Roky;

  const { verdict, reason, skippedQuestion } = evaluateCalculator({
    situation,
    salesOver100k,
    allHeldThreeYears,
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
        <Question<Situation>
          question={QUESTIONS.situation}
          options={[
            { value: 'zamestnanec', label: 'Zaměstnanec' },
            { value: 'pausal', label: 'OSVČ v paušálu' },
            { value: 'jine', label: 'Jiné' },
          ]}
          value={situation}
          onChange={(value) => {
            setSituace(value);
            // limit otázky na příjmy se situací mění (50k vs. 20k) — odpověď nepřenášet
            setPrijmy(null);
          }}
        />
        {situation !== null && (
          <Question<boolean>
            question={QUESTIONS.sales}
            hint="Počítá se, za kolik jsi prodal — ne zisk. Krypto má vlastní limit, přijde na řadu za chvíli."
            options={[
              { value: false, label: 'Ne' },
              { value: true, label: 'Ano' },
            ]}
            value={salesOver100k}
            onChange={setProdejeNad100k}
          />
        )}
        {salesOver100k === true && (
          <Question<boolean>
            question={QUESTIONS.holding}
            options={[
              { value: true, label: 'Ano, všechny' },
              { value: false, label: 'Ne' },
            ]}
            value={allHeldThreeYears}
            onChange={setVseDrzeno3Roky}
          />
        )}
        {salesOver100k !== null && (
          <Question<boolean>
            question={CRYPTO_QUESTION.question}
            hint={CRYPTO_QUESTION.hint}
            options={[
              { value: false, label: 'Ne' },
              { value: true, label: 'Ano' },
            ]}
            value={kryptoNad100k}
            onChange={(value) => {
              setKryptoNad100k(value);
              // podotázka na držení se týká jen odpovědi Ano — odpověď nepřenášet
              setKryptoDrzeno3Roky(null);
            }}
          />
        )}
        {kryptoNad100k === true && (
          <Question<boolean>
            question={QUESTIONS.cryptoHolding}
            hint="Od 15. 2. 2025 má i krypto tříletý test — počítá se i držení před tímto datem. U stablecoinů (USDT, USDC…) je test sporný — počítáme bezpečně, jako by neplatil."
            options={[
              { value: true, label: 'Ano, všechno' },
              { value: false, label: 'Ne' },
            ]}
            value={kryptoDrzeno3Roky}
            onChange={setKryptoDrzeno3Roky}
          />
        )}
        {situation !== null && kryptoOsvobozene !== null && (
          <Question<IncomeAnswer>
            question={INCOME_QUESTION[situation].question}
            hint={INCOME_QUESTION[situation].hint}
            options={[
              { value: 'ne', label: 'Ne' },
              { value: 'ano', label: 'Ano' },
              { value: 'nevim', label: 'Nevím' },
            ]}
            value={prijmy}
            onChange={setPrijmy}
          />
        )}
      </div>

      {/* přeskočená otázka: bez tohohle bloku by kalkulačka jen mlčela a
          uživatel by nevěděl, že na verdict něco chybí (H-24) */}
      {skippedQuestion && (
        <div role="status" className="mt-6 rounded-md border border-linka bg-pozadi p-4">
          <p className="font-semibold">Ještě jedna odpověď a verdict je hotový.</p>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Chybí odpověď na otázku „{skippedQuestion}“ — doplň ji výš.
          </p>
        </div>
      )}

      {verdict && (
        <div
          role="status"
          className={cn(
            'mt-6 rounded-md border p-4',
            verdict === 'osvobozeno' && 'border-zelena/40 bg-zelena/5',
            verdict === 'priznani' && 'border-ruzova/30 bg-ruzova/5',
            verdict === 'nejasne' && 'border-linka bg-pozadi',
          )}
        >
          <p className="font-semibold tabular-nums">
            {verdict === 'osvobozeno' && 'Vypadá to, že přiznání kvůli investicím řešit nemusíš.'}
            {verdict === 'priznani' && 'Nejspíš podáš přiznání — Danero ti připraví podklady.'}
            {verdict === 'nejasne' && 'Tohle bez dat s jistotou říct nejde.'}
          </p>
          <p
            className={cn(
              'mt-1 text-sm tabular-nums',
              reason === GOLDEN_RULE ? 'font-semibold text-zelena-text' : 'text-inkoust-tlumeny',
            )}
          >
            {reason}
          </p>
          {verdict !== 'nejasne' && (
            <p className="mt-2 text-xs text-inkoust-tlumeny">
              Orientačně — přesně to spočítá aplikace z tvých dat.
            </p>
          )}
          {/* R-09d: osvobozeno ≠ bez povinností — oznámení nad 5 mil. Kč má
              vlastní pokutu 0,1–15 % (§ 38w), takže se o něm musí dozvědět
              i ten, komu kalkulačka řekla „nemusíš“ */}
          {verdict === 'osvobozeno' && (
            <p className="mt-2 text-xs text-inkoust-tlumeny">{OZNAMENI_5M}</p>
          )}
          <p className="mt-3 text-sm text-inkoust-tlumeny">
            {verdict === 'osvobozeno' &&
              'Limity se počítají každý rok znovu — Danero je pohlídá, ať to tak zůstane.'}
            {verdict === 'priznani' &&
              'Danero spočítá přesnou daň a v březnu ti připraví podklady i XML pro podatelnu.'}
            {verdict === 'nejasne' &&
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
              className="rounded-md border border-linka-ovladaci bg-plocha px-4 py-2 text-sm font-semibold shadow-sm hover:border-ruzova hover:text-ruzova"
            >
              Založit účet
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
