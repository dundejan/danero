'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FilingLimitTexts } from '@/lib/filing-limits';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { StatusLabel, type Tone } from '@/components/ui/status';

/**
 * Mini kalkulačka „Musím podat přiznání?“: pár segmentovaných otázek →
 * okamžitý orientační verdict. Čistý klientský stav (useState), žádný
 * formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Rozvržení: otázky ve čtecím sloupci, verdikt v panelu vedle nich (na úzkém
 * okně pod nimi). Panel je na stránce od začátku, takže je vidět, kde se
 * odpověď objeví, a na širokém okně zůstává při odpovídání na očích.
 * U otázky je vidět jen to, bez čeho se na ni nedá správně odpovědět
 * (co se počítá a co ne); „proč“ je ve vysvětlivce.
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační):
 * – tržby z prodejů CP do 100 000 Kč za rok → prodeje osvobozené („zlaté pravidlo“),
 * – vše drženo přes 3 roky → prodeje CP osvobozené (časový test),
 * – krypto má VLASTNÍ limit 100 000 Kč a od 15. 2. 2025 i vlastní tříletý test
 *   (R-10; test neplatí pro stablecoiny — hlídá nápověda),
 * – paušál + jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání,
 * – zaměstnanec + vedlejší zdanitelné příjmy nad limit § 38g/2 → přiznání
 *   (R-09b: do ZO 2026 20 000 Kč, od ZO 2027 40 000 Kč),
 * – jiné situation + zdanitelné příjmy nad limit § 38g/1 celkem → přiznání
 *   (R-09a: do ZO 2026 50 000 Kč, od ZO 2027 100 000 Kč),
 * – částky obou limitů § 38g připraví server z konfigurace roku
 *   (`lib/filing-limits.ts`) pro běžný rok — a s nimi i limity roku
 *   předchozího, aby nápověda v roce změny řekla obě částky (`limitYearNote`),
 * – neosvobozené prodeje → přiznání,
 * – do těchhle limitů patří i kladná plnění z derivátů (R-08d/R-10f) —
 *   nápověda je musí jmenovat, jinak na ně tazatel odpoví „Ne“,
 * – „Nevím“ u dividend/úroků → poctivé „bez dat to nejde říct“ (neptáme se
 *   na nic, co aplikace zjistí sama — sem patří CTA na napojení dat).
 */

type Situation = 'zamestnanec' | 'pausal' | 'jine';
type IncomeAnswer = 'ne' | 'ano' | 'nevim';

const GOLDEN_RULE = 'Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.';

/** Vysvětlivka k otázce: čeho se týká a pár krátkých odstavců. */
interface QuestionInfo {
  label: string;
  body: readonly string[];
}

/**
 * Jedna otázka: znění, nejvýš jedna věta toho, co se počítá, a segmentový
 * přepínač s odpověďmi (skupina pojmenovaná zněním otázky, tlačítka
 * s `aria-pressed`). Nezodpovězená otázka nemá vybraný žádný segment.
 */
function Question<T extends string | boolean>({
  question,
  hint,
  info,
  options,
  value,
  onChange,
}: {
  question: string;
  hint?: string;
  info?: QuestionInfo;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="py-6 first:pt-0 last:pb-0">
      <div className="flex items-start gap-1.5">
        <p className="type-title-3 text-pretty">{question}</p>
        {info && (
          <InfoPopover label={info.label} align="start">
            {info.body.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </InfoPopover>
        )}
      </div>
      {hint && <p className="type-footnote mt-1.5 text-pretty text-ink-muted">{hint}</p>}
      <SegmentedControl
        ariaLabel={question}
        segments={options.map((option) => ({ key: String(option.value), label: option.label }))}
        value={value === null ? '' : String(value)}
        onChange={(key) => {
          const picked = options.find((option) => String(option.value) === key);
          if (picked) onChange(picked.value);
        }}
        // větší než přepínač pohledu v liště: tady je odpověď hlavní ovládání
        size="md"
        className={cn('mt-4 w-full', options.length > 2 ? 'max-w-md' : 'max-w-60')}
      />
    </div>
  );
}

/**
 * Věta do nápovědy, která limitu § 38g přiřadí rok — jen když se proti
 * předchozímu roku změnil (R-09a, R-09b: od ZO 2027 100 000 / 40 000 Kč místo
 * 50 000 / 20 000 Kč).
 *
 * Otázka se ptá na „letos“, jenže v lednu až květnu se na kalkulačku chodí
 * hlavně kvůli přiznání za rok PŘEDCHOZÍ. Kdo měl v roce 2026 vedle zaměstnání
 * 30 000 Kč dividend, odpověděl by v únoru 2027 na „nad 40 000 Kč?“ po pravdě
 * „Ne“ a četl by, že přiznání řešit nemusí — přitom za rok 2026 platí 20 000 Kč
 * a přiznání podává (A20-R1-02). Když se limit nezměnil, na roce nezáleží
 * a nápověda zůstává krátká.
 */
function limitYearNote(
  year: number,
  limit: string,
  previousYear: number,
  previousLimit: string,
): string {
  return limit === previousLimit
    ? ''
    : `Limit ${limit} platí pro příjmy za rok ${year} — za rok ${previousYear} to bylo ještě ${previousLimit}. `;
}

/**
 * Text otázky na ostatní zdanitelné příjmy podle situation (limit paušální
 * daně / vedlejších příjmů zaměstnance / obecný). Limit 50 000 Kč paušální
 * daně (§ 7a) se rokem nemění, limity § 38g přicházejí v `limits`; s limity
 * roku předchozího (`previous`) nápověda řekne, kterého roku se částka týká
 * (`limitYearNote`) — bez nich se na znění otázky nic nemění.
 * Nápověda musí vyjmenovat i **deriváty**: do limitů vstupují kladná plnění
 * z opcí, futures a CFD (R-08d/R-10f, `limits.ts` je sčítá jako
 * `derivatives.taxableIncomeCzk`). Bez nich odpověděl obchodník s CFD „Ne“
 * a kalkulačka mu řekla, že přiznání řešit nemusí, i když limit prolomil.
 * Export kvůli testu znění.
 */
export function incomeQuestions(
  limits: FilingLimitTexts,
  previous: FilingLimitTexts = limits,
): Record<Situation, { question: string; hint: string }> {
  const { employee, general } = limits;
  return {
    pausal: {
      question: 'Máš letos jiné zdanitelné příjmy mimo podnikání nad 50 000 Kč?',
      hint: 'Třeba zahraniční dividendy, úroky, nájem, kladná plnění z derivátů (CFD, opce, futures) nebo prodeje a směny stablecoinů — osvobozené prodeje a české dividendy se srážkou se nepočítají.',
    },
    zamestnanec: {
      question: `Máš letos vedle zaměstnání jiné zdanitelné příjmy nad ${employee}?`,
      hint: `${limitYearNote(limits.year, employee, previous.year, previous.employee)}Třeba zahraniční dividendy, úroky, nájem, kladná plnění z derivátů (CFD, opce, futures) nebo prodeje a směny stablecoinů — osvobozené prodeje se nepočítají.`,
    },
    jine: {
      question: `Máš letos zdanitelné příjmy nad ${general} celkem?`,
      hint: `${limitYearNote(limits.year, general, previous.year, previous.general)}Včetně zahraničních dividend, úroků, nájmu, kladných plnění z derivátů (CFD, opce, futures) i prodejů a směn stablecoinů — osvobozené prodeje a příjmy zdaněné srážkou se nepočítají.`,
    },
  };
}

/**
 * Otázka na krypto. Nápověda **musí** vyjmenovat stablecoiny: § 4 odst. 1
 * písm. zj) elektronické peněžní tokeny z osvobození výslovně vylučuje (R-10a),
 * takže jejich prodej i směna se daní vždy a do stovky se nepočítají. Bez téhle
 * věty odpověděl člověk, který směnil 60 000 Kč v USDC, „Ne“ a kalkulačka mu
 * řekla, že přiznání řešit nemusí — přitom má 60 000 Kč zdanitelného příjmu
 * a jako zaměstnanec je 20 000 Kč hranice dávno pryč (nález E-3-03).
 * Výjimka stablecoinů proto stojí ve VIDITELNÉ nápovědě (`hint`), ne až ve
 * vysvětlivce — ta se vykreslí teprve po otevření; `info` k ní dodává důvod.
 * Export kvůli testu znění.
 */
export const CRYPTO_QUESTION = {
  question: 'Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?',
  hint: 'Stablecoiny (USDT, USDC…) nepočítej — patří až k ostatním zdanitelným příjmům. Nemáš krypto? Dej Ne.',
  info: {
    label: 'Krypto a stablecoiny',
    body: [
      'Kryptoaktiva mají vlastní limit 100 000 Kč, nezávislý na akciích.',
      'Stablecoiny (USDT, USDC a další tokeny navázané na měnu) se do něj nepočítají — ty se daní vždy, takže je zahrň až do otázky na ostatní zdanitelné příjmy.',
    ],
  },
} as const;

/**
 * Vysvětlivky k otázkám na prodeje a držení. Jen to, co už říkají pravidla
 * pod kalkulačkou a metodika (/jak-pocitame) — žádné nové tvrzení.
 */
const SALES_INFO: QuestionInfo = {
  label: 'Co se počítá do 100 000 Kč',
  body: [
    'Sečti, kolik ti letos přišlo z prodejů akcií a ETF u všech brokerů dohromady. Na zisku ani ztrátě nezáleží.',
    'Krypto má vlastní limit, přijde na řadu za chvíli.',
  ],
};
const HOLDING_INFO: QuestionInfo = {
  label: 'Tříletý časový test',
  body: [
    'Cenné papíry držené déle než 3 roky se při prodeji nedaní. Rozhoduje datum nákupu a prodeje konkrétních kusů.',
  ],
};
const CRYPTO_HOLDING_INFO: QuestionInfo = {
  label: 'Tříletý test u krypta',
  body: [
    'Od 15. 2. 2025 má i krypto tříletý test — počítá se i držení před tímto datem.',
    'U stablecoinů (USDT, USDC…) je test sporný — počítáme bezpečně, jako by neplatil.',
  ],
};

/**
 * Oznámení osvobozeného příjmu (§ 38v ZDP, R-09d). Patří k verdiktu
 * „přiznání řešit nemusíš“: kdo prodal za 6 milionů akcie držené pět let,
 * přiznání opravdu nepodává — ale oznámení podat musí a pokuta je 0,1–15 %
 * z částky (§ 38w). Zamlčet to je horší než zamlčet daň.
 *
 * K7a-03: do 23. 8. 2026 tu stálo „lhůta je ale stejná“ — pro toho, komu tenhle
 * text patří (tedy pro NEPODÁVAJÍCÍHO), to byla nepravda. Prodloužení lhůty na
 * čtyři měsíce je podle § 136 odst. 2 písm. a) daňového řádu podmíněné tím, že
 * „následně bylo daňové přiznání podáno elektronicky“, takže kdo přiznání
 * nepodává, žádné prodloužení nezíská a platí základní tříměsíční lhůta
 * (pokyn GFŘ D-59 ke § 38v). Rozdíl je až měsíc a sankce 0,1–15 % se počítá
 * z NEOZNÁMENÉHO PŘÍJMU, ne z daně.
 */
export const OZNAMENI_5M =
  'Pozor na jednu výjimku: jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu přesto oznamuje (§ 38v zákona o daních z příjmů). Přiznání to není, a proto máš kratší lhůtu — tři měsíce po konci roku: měsíc navíc, který patří k elektronickému přiznání, dostane jen ten, kdo přiznání opravdu podá.';

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

/** Zdůvodnění verdiktu „přiznání“ — jmenuje tentýž limit jako otázka (`incomeQuestions`). */
function incomeReasons({ employee, general }: FilingLimitTexts): Record<Situation, string> {
  return {
    pausal:
      'Jiné zdanitelné příjmy nad 50 000 Kč znamenají, že daň za ten rok není rovna paušální dani — podáš přiznání a přehledy, v paušálním režimu ale zůstáváš.',
    zamestnanec: `Vedlejší zdanitelné příjmy nad ${employee} vedle zaměstnání znamenají přiznání — i bez jediného prodeje.`,
    jine: `Zdanitelné příjmy nad ${general} za rok znamenají povinnost podat přiznání.`,
  };
}

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
 * `limits` říkají, kterými částkami § 38g se zdůvodnění řídí — limity běžného
 * roku, které stránka připravila na serveru.
 */
export function evaluateCalculator(
  {
    situation,
    salesOver100k,
    allHeldThreeYears,
    kryptoNad100k,
    kryptoDrzeno3Roky,
    prijmy,
  }: CalculatorAnswers,
  limits: FilingLimitTexts,
): CalculatorOutcome {
  // prodeje CP jsou osvobozené limitem 100k, nebo splněným časovým testem;
  // null = na verdict zatím chybí odpověď
  const salesExempt = salesOver100k === null ? null : !salesOver100k ? true : allHeldThreeYears;
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
    reason = incomeReasons(limits)[situation];
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
      ? [{ label: incomeQuestions(limits)[situation].question, answered: prijmy !== null }]
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

/**
 * Jak se verdikt ukáže: slovní stav (s barvou), věta verdiktu a jedna věta,
 * co s tím umí Danero. Barva stavu není modrá — ta patří ovládání.
 */
const VERDICTS: Record<
  NonNullable<CalculatorOutcome['verdict']>,
  { tone: Tone; status: string; title: string; next: string }
> = {
  osvobozeno: {
    tone: 'success',
    status: 'Bez přiznání',
    title: 'Vypadá to, že přiznání kvůli investicím řešit nemusíš.',
    next: 'Limity se počítají každý rok znovu — Danero je pohlídá za tebe.',
  },
  priznani: {
    tone: 'caution',
    status: 'Přiznání',
    title: 'Nejspíš podáš přiznání.',
    next: 'Danero spočítá přesnou daň a připraví podklady i XML pro podatelnu.',
  },
  nejasne: {
    tone: 'neutral',
    status: 'Nedá se určit',
    title: 'Tohle bez dat s jistotou říct nejde.',
    next: 'Napoj brokera nebo nahraj výpis — na nic dalšího se ptát nebudeme.',
  },
};

export function KalkulackaPriznani({
  filingLimits,
  previousFilingLimits,
  children,
}: {
  filingLimits: FilingLimitTexts;
  previousFilingLimits: FilingLimitTexts;
  /** Obsah pod otázkami (pravidla): na širokém okně vedle něj verdikt dál drží na očích. */
  children?: React.ReactNode;
}) {
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

  const { verdict, reason, skippedQuestion } = evaluateCalculator(
    { situation, salesOver100k, allHeldThreeYears, kryptoNad100k, kryptoDrzeno3Roky, prijmy },
    filingLimits,
  );
  // otázka i verdikt jmenují limit běžného roku; loňský jde jen do nápovědy
  const incomeQuestion =
    situation === null ? null : incomeQuestions(filingLimits, previousFilingLimits)[situation];
  const shown = verdict ? VERDICTS[verdict] : null;

  const startOver = () => {
    setSituace(null);
    setProdejeNad100k(null);
    setVseDrzeno3Roky(null);
    setKryptoNad100k(null);
    setKryptoDrzeno3Roky(null);
    setPrijmy(null);
  };

  return (
    // Tři části: otázky, verdikt, pravidla. Na úzkém okně jdou pod sebou v tomhle
    // pořadí; na širokém stojí verdikt ve vlastním sloupci přes obě řady a drží
    // se u horního okraje, dokud se roluje otázkami a pravidly.
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,38rem)_minmax(0,24rem)] lg:justify-between">
      <div className="lg:col-start-1 lg:row-start-1">
        <div className="divide-y divide-line/70">
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
              hint="Počítá se, za kolik jsi prodal — ne zisk."
              info={SALES_INFO}
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
              info={HOLDING_INFO}
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
              info={CRYPTO_QUESTION.info}
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
              hint="Počítá se i držení před 15. 2. 2025."
              info={CRYPTO_HOLDING_INFO}
              options={[
                { value: true, label: 'Ano, všechno' },
                { value: false, label: 'Ne' },
              ]}
              value={kryptoDrzeno3Roky}
              onChange={setKryptoDrzeno3Roky}
            />
          )}
          {incomeQuestion !== null && kryptoOsvobozene !== null && (
            // Nápověda zůstává celá na očích: vyjmenovává, co do limitu patří
            // (deriváty, stablecoiny) — bez ní se na otázku odpovídá špatně.
            <Question<IncomeAnswer>
              question={incomeQuestion.question}
              hint={incomeQuestion.hint}
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
        {situation !== null && (
          <Button variant="ghost" size="sm" onClick={startOver} className="-ml-3 mt-6">
            Začít znovu
          </Button>
        )}
      </div>

      {/* Panel verdiktu je živá oblast: čtečka ohlásí verdikt i to, že na něj
          ještě chybí odpověď (H-24 — dřív kalkulačka v tu chvíli jen mlčela). */}
      <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div
          role="status"
          className="rounded-2xl bg-canvas p-6 sm:p-8 lg:sticky lg:top-[calc(var(--nav-height)+2rem)]"
        >
          {shown ? (
            <>
              <StatusLabel tone={shown.tone}>{shown.status}</StatusLabel>
              <h2 className="type-title-1 mt-3 text-balance">{shown.title}</h2>
              <p className="type-body mt-3 text-pretty text-ink-muted">{reason}</p>
              <ul className="type-footnote mt-5 space-y-2 text-pretty text-ink-muted">
                {verdict !== 'nejasne' && (
                  <li>Orientačně — přesně to spočítá aplikace z tvých dat.</li>
                )}
                {/* R-09d: osvobozeno ≠ bez povinností — oznámení nad 5 mil. Kč má
                  vlastní pokutu 0,1–15 % (§ 38w), takže se o něm musí dozvědět
                  i ten, komu kalkulačka řekla „nemusíš“. Výjimka i lhůta jsou
                  vidět, paragraf a důvod kratší lhůty jsou ve vysvětlivce. */}
                {verdict === 'osvobozeno' && (
                  <li>
                    Výjimka: jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu
                    oznamuje — do tří měsíců po konci roku.{' '}
                    <InfoPopover label="Oznámení osvobozeného příjmu" align="end" className="-my-1">
                      <p>{OZNAMENI_5M}</p>
                    </InfoPopover>
                  </li>
                )}
              </ul>
              <div className="mt-6 border-t border-line/70 pt-5">
                <p className="type-callout text-pretty">{shown.next}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <Link href="/demo/prehled" className={buttonVariants({ variant: 'tinted' })}>
                    Vyzkoušet demo
                  </Link>
                  <TextLink href="/registrace" chevron>
                    Založit účet
                  </TextLink>
                </div>
              </div>
            </>
          ) : skippedQuestion ? (
            <>
              <h2 className="type-title-3">Ještě jedna odpověď a verdikt je hotový</h2>
              <p className="type-callout mt-2 text-pretty text-ink-muted">
                Chybí odpověď na otázku „{skippedQuestion}“.
              </p>
            </>
          ) : (
            <>
              <h2 className="type-title-3">Verdikt</h2>
              <p className="type-callout mt-2 text-pretty text-ink-muted">
                Ukáže se tady, jakmile odpovíš na všechny otázky.
              </p>
            </>
          )}
        </div>
      </div>
      {children && <div className="lg:col-start-1 lg:row-start-2">{children}</div>}
    </div>
  );
}
