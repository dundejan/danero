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
import { tidy } from '@/lib/typography';

/**
 * Mini kalkulačka „Musím podat přiznání?“: pár segmentovaných otázek →
 * okamžitý orientační verdikt. Čistý klientský stav (useState), žádný
 * formulář ani submit — přesný výpočet dělá až aplikace z dat.
 *
 * Rozvržení: otázky ve čtecím sloupci, verdikt v panelu vedle nich (na úzkém
 * okně pod nimi). Panel je na stránce od začátku, takže je vidět, kde se
 * odpověď objeví, a na širokém okně zůstává při odpovídání na očích.
 * U otázky je vidět jen to, bez čeho se na ni nedá správně odpovědět
 * (co se počítá a co ne); „proč“ je ve vysvětlivce.
 *
 * **Otázky jdou přísně za sebou** (`evaluateCalculator` vrací `steps`): další
 * se ukáže, až je zodpovězená ta před ní, a jakmile je verdikt jistý, kalkulačka
 * se dál neptá. Přeskočit otázku tak nejde — dřív šlo a kalkulačka pak mlčela,
 * aniž by řekla, co jí chybí (H-24).
 *
 * Kdo se ptá (`Situation`), rozhodují první dvě otázky: zaměstnanec, OSVČ
 * (a u ní paušální režim ano/ne), nebo ani jedno. Do 13. 10. 2026 tu byla
 * jediná volba „Zaměstnanec / OSVČ v paušálu / Jiné“ — a pod „Jiné“ spadla
 * i OSVČ mimo paušál, která se pak dočetla, že přiznání řešit nemusí, přestože
 * ho kvůli podnikání podává tak jako tak (R-09f).
 *
 * Logika je záměrně zjednodušená (bez detailů § 38g — jsme orientační; souhrn
 * v docs/02 R-09g):
 * – tržby z prodejů CP do 100 000 Kč za rok → prodeje osvobozené (R-02),
 * – kusy držené přes 3 roky → jejich prodej osvobozený (R-01); když tak uživatel
 *   držel jen ČÁST, je zbytek zdanitelný v plné výši tržby (R-02c, bezpečný
 *   výklad: stovku už vyčerpaly všechny prodeje dohromady) — kolik to je,
 *   nevíme, takže se zbytek přičítá až v otázce na ostatní příjmy,
 * – krypto má VLASTNÍ limit 100 000 Kč a od 15. 2. 2025 i vlastní tříletý test
 *   (R-10; test neplatí pro stablecoiny — hlídá nápověda),
 * – prodeje nad 100 000 Kč, ze kterých tři roky nevydrželo NIC, jsou zdanitelný
 *   příjem nad 100 000 Kč → překročí každý z limitů níž, verdikt je hned,
 * – paušál + zdanitelné příjmy mimo podnikání nad 50 000 Kč → přiznání (R-08),
 * – zaměstnanec + vedlejší zdanitelné příjmy nad limit § 38g/2 → přiznání
 *   (R-09b: do ZO 2026 20 000 Kč, od ZO 2027 40 000 Kč),
 * – ani jedno + zdanitelné příjmy nad limit § 38g/1 celkem → přiznání
 *   (R-09a: do ZO 2026 50 000 Kč, od ZO 2027 100 000 Kč),
 * – OSVČ mimo paušál podává přiznání kvůli podnikání (R-09f) a limit nemá:
 *   jakýkoli zdanitelný příjem z investic do něj patří,
 * – částky obou limitů § 38g připraví server z konfigurace roku
 *   (`lib/filing-limits.ts`) pro běžný rok — a s nimi i limity roku
 *   předchozího, aby nápověda v roce změny řekla obě částky (`limitYearNote`),
 * – do limitů patří i kladná plnění z derivátů (R-08d/R-10f) — nápověda je
 *   musí jmenovat, jinak na ně tazatel odpoví „Ne“,
 * – české dividendy a úroky zdaněné srážkou do limitů nepatří (R-07a, R-07g),
 * – „Nevím“ → poctivé „bez dat to nejde říct“ (neptáme se na nic, co aplikace
 *   zjistí sama — sem patří CTA na napojení dat).
 */

/** Odpověď na první otázku. */
type Work = 'employee' | 'selfEmployed' | 'neither';
/** Kdo se ptá — podle toho se vybírá limit i znění verdiktu. */
export type Situation = 'employee' | 'flatTax' | 'selfEmployed' | 'other';
/** Kolik z prodaného vydrželo déle než tři roky. */
type Held = 'all' | 'some' | 'none';
type IncomeAnswer = 'no' | 'yes' | 'unknown';

/** Odpovědi kalkulačky; `null` = uživatel na otázku zatím neodpověděl. */
export interface CalculatorAnswers {
  work: Work | null;
  /** Jen u OSVČ: je v paušálním režimu? */
  flatTax: boolean | null;
  salesOver100k: boolean | null;
  salesHeld: Held | null;
  cryptoOver100k: boolean | null;
  cryptoHeld: Held | null;
  income: IncomeAnswer | null;
}

export const NOTHING_ANSWERED: CalculatorAnswers = {
  work: null,
  flatTax: null,
  salesOver100k: null,
  salesHeld: null,
  cryptoOver100k: null,
  cryptoHeld: null,
  income: null,
};

/** Otázky v pořadí, ve kterém se ukazují. */
export type Step = 'work' | 'flatTax' | 'sales' | 'salesHeld' | 'crypto' | 'cryptoHeld' | 'income';

const GOLDEN_RULE = 'Do 100 000 Kč tržeb z prodejů se daň z prodejů neřeší — vůbec.';

/** Vysvětlivka k otázce: čeho se týká a pár krátkých odstavců. */
interface QuestionInfo {
  label: string;
  body: readonly string[];
}

/**
 * Jedna otázka: znění, nejvýš pár vět toho, co se počítá, a segmentový
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
        <p className="type-title-3 text-pretty">{tidy(question)}</p>
        {info && (
          <InfoPopover label={info.label} align="start">
            {info.body.map((paragraph) => (
              <p key={paragraph}>{tidy(paragraph)}</p>
            ))}
          </InfoPopover>
        )}
      </div>
      {hint && (
        <p className="type-footnote mt-1.5 text-pretty text-ink-muted">{tidy(hint)}</p>
      )}
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
        // tři různě dlouhé odpovědi by se ve stejné šířce na telefon nevešly
        fit={options.length > 2 ? 'content' : 'equal'}
        className={cn('mt-4 w-full', options.length > 2 ? 'max-w-md' : 'max-w-60')}
      />
    </div>
  );
}

/**
 * Znění otázek, které se podle odpovědí nemění. Otázka na ostatní příjmy je
 * zvlášť (`incomeQuestion`) — mění se se situací i s limity roku.
 */
export const QUESTIONS = {
  work: {
    question: 'Jsi zaměstnanec, nebo OSVČ?',
    hint: 'Ani jedno je třeba student, důchodce nebo rodič na rodičovské. Když jsi zaměstnaný a zároveň podnikáš, vyber OSVČ.',
  },
  flatTax: {
    question: 'Jsi v paušálním režimu?',
    hint: 'Tedy platíš jednu měsíční paušální zálohu místo daně a pojistného zvlášť.',
    info: {
      label: 'Proč na tom záleží',
      body: [
        'V paušálním režimu přiznání nepodáváš, dokud tvoje zdanitelné příjmy mimo podnikání nepřesáhnou 50 000 Kč za rok.',
        'Mimo paušál podáváš přiznání kvůli podnikání tak jako tak — kalkulačka ti pak řekne, jestli do něj patří i investice.',
      ],
    },
  },
  sales: {
    question: 'Prodal jsi letos akcie nebo ETF za víc než 100 000 Kč celkem?',
    hint: 'Počítá se, za kolik jsi prodal — ne zisk.',
    info: {
      label: 'Co se počítá do 100 000 Kč',
      body: [
        'Sečti, kolik ti letos přišlo z prodejů akcií a ETF u všech brokerů dohromady. Na zisku ani ztrátě nezáleží.',
        'Krypto má vlastní limit, přijde na řadu za chvíli.',
      ],
    },
  },
  salesHeld: {
    question: 'Držel jsi všechny prodané kusy déle než 3 roky?',
    info: {
      label: 'Tříletý časový test',
      body: [
        'Cenné papíry držené déle než 3 roky se při prodeji nedaní. Rozhoduje datum nákupu a prodeje konkrétních kusů.',
        'Když tak dlouho vydržela jen část, osvobozená je jen ona — zbytek je zdanitelný příjem.',
      ],
    },
  },
  /**
   * Otázka na krypto. Nápověda **musí** vyjmenovat stablecoiny: § 4 odst. 1
   * písm. zj) elektronické peněžní tokeny z osvobození výslovně vylučuje (R-10a),
   * takže jejich prodej i směna se daní vždy a do stovky se nepočítají. Bez téhle
   * věty odpověděl člověk, který směnil 60 000 Kč v USDC, „Ne“ a kalkulačka mu
   * řekla, že přiznání řešit nemusí — přitom má 60 000 Kč zdanitelného příjmu
   * a jako zaměstnanec je 20 000 Kč hranice dávno pryč (nález E-3-03).
   * Výjimka stablecoinů proto stojí ve VIDITELNÉ nápovědě (`hint`), ne až ve
   * vysvětlivce — ta se vykreslí teprve po otevření; `info` k ní dodává důvod.
   */
  crypto: {
    question: 'Prodal jsi nebo směnil letos kryptoměny za víc než 100 000 Kč?',
    hint: 'Stablecoiny (USDT, USDC…) nepočítej — patří až k ostatním zdanitelným příjmům. Nemáš krypto? Dej Ne.',
    info: {
      label: 'Krypto a stablecoiny',
      body: [
        'Kryptoaktiva mají vlastní limit 100 000 Kč, nezávislý na akciích.',
        'Stablecoiny (USDT, USDC a další tokeny navázané na měnu) se do něj nepočítají — ty se daní vždy, takže je zahrň až do otázky na ostatní zdanitelné příjmy.',
      ],
    },
  },
  cryptoHeld: {
    question: 'Držel jsi všechno prodané krypto déle než 3 roky?',
    hint: 'Počítá se i držení před 15. 2. 2025.',
    info: {
      label: 'Tříletý test u krypta',
      body: [
        'Od 15. 2. 2025 má i krypto tříletý test — počítá se i držení před tímto datem. Osvobodí nejvýš 40 milionů Kč za rok.',
        'U stablecoinů (USDT, USDC…) je test sporný — počítáme bezpečně, jako by neplatil.',
      ],
    },
  },
} as const;

const YES_NO = [
  { value: false, label: 'Ne' },
  { value: true, label: 'Ano' },
] as const;

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

/** Co z prodejů zůstalo zdanitelné: nic, část neznámé výše, nebo všechno (> 100 000 Kč). */
type Taxable = 'nothing' | 'part' | 'everything';

function taxableShare(over100k: boolean | null, held: Held | null): Taxable | null {
  if (over100k === null) return null;
  if (!over100k) return 'nothing';
  if (held === null) return null;
  return held === 'all' ? 'nothing' : held === 'some' ? 'part' : 'everything';
}

function situationOf({ work, flatTax }: CalculatorAnswers): Situation | null {
  if (work === null) return null;
  if (work === 'employee') return 'employee';
  if (work === 'neither') return 'other';
  if (flatTax === null) return null;
  return flatTax ? 'flatTax' : 'selfEmployed';
}

/** Které prodeje vstupují do otázky na ostatní příjmy, protože z nich tři roky vydržela jen část. */
interface PartlyTaxable {
  sales: boolean;
  crypto: boolean;
}

function partlyTaxable(answers: CalculatorAnswers): PartlyTaxable {
  return {
    sales: taxableShare(answers.salesOver100k, answers.salesHeld) === 'part',
    crypto: taxableShare(answers.cryptoOver100k, answers.cryptoHeld) === 'part',
  };
}

/**
 * Otázka na ostatní zdanitelné příjmy podle situace: limit paušální daně /
 * vedlejších příjmů zaměstnance / obecný; OSVČ mimo paušál limit nemá, u ní
 * rozhoduje jakákoli částka. Limit 50 000 Kč paušální daně (§ 7a) se rokem
 * nemění, limity § 38g přicházejí v `limits`; s limity roku předchozího
 * (`previous`) nápověda řekne, kterého roku se částka týká (`limitYearNote`)
 * — na znění otázky se tím nic nemění.
 *
 * Nápověda říká, co se počítá a co ne, a zůstává celá na očích — bez ní se na
 * otázku odpovídá špatně:
 * – **deriváty**: do limitů vstupují kladná plnění z opcí, futures a CFD
 *   (R-08d/R-10f, `limits.ts` je sčítá jako `derivatives.taxableIncomeCzk`).
 *   Bez nich odpověděl obchodník s CFD „Ne“ a kalkulačka mu řekla, že přiznání
 *   řešit nemusí, i když limit prolomil (E-33);
 * – **české úroky a dividendy se srážkou** se nepočítají (R-07a, R-07g). Do
 *   13. 10. 2026 nápověda jmenovala jen „úroky“ a kdo měl 60 000 Kč úroků ze
 *   spořicího účtu, odpověděl „Ano“ a četl, že podává přiznání;
 * – **prodeje, ze kterých tři roky vydržela jen část** (`partly`): zdanitelná
 *   je celá tržba za zbytek, a tu známe jen od uživatele.
 */
export function incomeQuestion(
  situation: Situation,
  limits: FilingLimitTexts,
  previous: FilingLimitTexts = limits,
  partly: PartlyTaxable = { sales: false, crypto: false },
): { question: string; hint: string } {
  const { employee, general } = limits;
  const excluded =
    'Nepočítej osvobozené prodeje ani české dividendy a úroky z banky, které už zdanila srážka.';
  if (situation === 'selfEmployed') {
    return {
      question: 'Máš letos z investic nějaký zdanitelný příjem?',
      hint: `Stačí jakákoli částka: zahraniční dividendy a úroky, kladná plnění z derivátů (CFD, opce, futures) nebo prodeje a směny stablecoinů. ${excluded}`,
    };
  }
  const unheld =
    partly.sales && partly.crypto
      ? 'akcie, ETF i krypto'
      : partly.sales
        ? 'akcie a ETF'
        : partly.crypto
          ? 'krypto'
          : null;
  const partlyNote = unheld
    ? `Započítej celou tržbu (ne zisk) za ${unheld}, které jsi nedržel déle než 3 roky. `
    : '';
  const counted = `${partlyNote}Počítej ${unheld ? 'i ' : ''}zahraniční dividendy a úroky před srážkou, nájem, kladná plnění z derivátů (CFD, opce, futures) a prodeje i směny stablecoinů.`;
  switch (situation) {
    case 'flatTax':
      return {
        question: 'Máš letos mimo podnikání zdanitelné příjmy nad 50 000 Kč?',
        hint: `${counted} ${excluded}`,
      };
    case 'employee':
      return {
        question: `Máš letos vedle zaměstnání zdanitelné příjmy nad ${employee}?`,
        hint: `${limitYearNote(limits.year, employee, previous.year, previous.employee)}${counted} ${excluded}`,
      };
    case 'other':
      return {
        question: `Máš letos zdanitelné příjmy nad ${general} celkem?`,
        hint: `${limitYearNote(limits.year, general, previous.year, previous.general)}${counted} ${excluded}`,
      };
  }
}

/**
 * Co prolomení limitu znamená pro paušalistu (R-08a, R-08e): přiznání, přehledy
 * a pojistné ze skutečných příjmů — a režim přitom nekončí. Patří ke KAŽDÉMU
 * verdiktu „přiznání“ v paušálu, ať limit prolomily dividendy, nebo prodej.
 */
const FLAT_TAX_BROKEN =
  'Podáš přiznání i přehledy pro sociální správu a zdravotní pojišťovnu a pojistné se dopočítá ze skutečných příjmů; v paušálním režimu ale zůstáváš.';

const SELF_EMPLOYED_FILES =
  'Zdanitelný příjem z investic patří do přiznání, které podáváš kvůli podnikání — bez ohledu na částku.';

/** Zdůvodnění verdiktu „přiznání“ po odpovědi „Ano“ — jmenuje tentýž limit jako otázka. */
function incomeReason(situation: Situation, { employee, general }: FilingLimitTexts): string {
  switch (situation) {
    case 'flatTax':
      return `Se zdanitelnými příjmy mimo podnikání nad 50 000 Kč ti za ten rok paušální daň nestačí. ${FLAT_TAX_BROKEN}`;
    case 'employee':
      return `Zdanitelné příjmy nad ${employee} vedle zaměstnání znamenají povinnost podat přiznání.`;
    case 'other':
      return `Zdanitelné příjmy nad ${general} za rok znamenají povinnost podat přiznání.`;
    case 'selfEmployed':
      return SELF_EMPLOYED_FILES;
  }
}

/**
 * Zdůvodnění verdiktu „přiznání“, který padl už u prodejů: co je zdanitelné
 * a který limit to překračuje. U limitů rozhoduje tržba, ne zisk (R-08d) —
 * věta to říká, protože „prodal jsem se ztrátou“ je nejčastější omyl.
 */
function salesReason(
  situation: Situation,
  asset: 'securities' | 'crypto',
  share: 'part' | 'everything',
  { employee, general }: FilingLimitTexts,
): string {
  if (share === 'part') {
    // jen OSVČ mimo paušál: bez limitu stačí, že je zdanitelná jakákoli část
    const what =
      asset === 'securities'
        ? 'Část prodaných akcií nebo ETF jsi nedržel déle než 3 roky, takže jejich prodej osvobozený není.'
        : 'Část prodaného krypta jsi nedržel déle než 3 roky, takže jeho prodej osvobozený není.';
    return `${what} ${SELF_EMPLOYED_FILES}`;
  }
  const what =
    asset === 'securities'
      ? 'Akcie nebo ETF jsi prodal za víc než 100 000 Kč a nic z toho jsi nedržel déle než 3 roky, takže osvobozené není nic.'
      : 'Krypto jsi prodal nebo směnil za víc než 100 000 Kč a nic z toho jsi nedržel déle než 3 roky, takže osvobozené není nic.';
  const overLimit = (limit: string) =>
    `Do limitu ${limit} se počítá celá tržba, ne jen zisk — a tím ho překračuješ.`;
  switch (situation) {
    case 'flatTax':
      return `${what} ${overLimit('50 000 Kč pro paušální daň')} ${FLAT_TAX_BROKEN}`;
    case 'employee':
      return `${what} ${overLimit(`${employee} pro příjmy vedle zaměstnání`)}`;
    case 'other':
      return `${what} ${overLimit(`${general} pro podání přiznání`)}`;
    case 'selfEmployed':
      return `${what} ${SELF_EMPLOYED_FILES}`;
  }
}

/**
 * Zdůvodnění verdiktu „bez přiznání“: čím jsou prodeje osvobozené a který limit
 * zbytek nepřekročil. V roce, kdy se limit § 38g změnil, k němu patří i rok
 * (`limitYearNote`) — verdikt jinak čte i ten, kdo řeší přiznání za rok
 * předchozí s limitem polovičním (A20-R1-02).
 */
function exemptReason(
  situation: Situation,
  sold: { partly: PartlyTaxable; timeTested: boolean },
  limits: FilingLimitTexts,
  previous: FilingLimitTexts,
): string {
  const { employee, general } = limits;
  if (situation === 'selfEmployed') {
    return sold.timeTested
      ? 'Po třech letech držení jsou prodeje osvobozené a do přiznání, které podáváš kvůli podnikání, se neuvádějí.'
      : 'Prodeje do 100 000 Kč za rok jsou osvobozené a do přiznání, které podáváš kvůli podnikání, se neuvádějí.';
  }
  const exemption =
    sold.partly.sales || sold.partly.crypto
      ? 'Co jsi držel déle než 3 roky, je osvobozené; zbytek patří mezi zdanitelné příjmy.'
      : sold.timeTested
        ? 'Po třech letech držení jsou prodeje osvobozené — a osvobozené příjmy do přiznání nepatří.'
        : GOLDEN_RULE;
  const underLimit =
    situation === 'flatTax'
      ? 'Zdanitelné příjmy mimo podnikání do 50 000 Kč na paušální dani nic nemění.'
      : situation === 'employee'
        ? `Zdanitelné příjmy do ${employee} vedle zaměstnání přiznání nevyžadují. ${limitYearNote(limits.year, employee, previous.year, previous.employee)}`
        : `Zdanitelné příjmy do ${general} za rok přiznání nevyžadují. ${limitYearNote(limits.year, general, previous.year, previous.general)}`;
  return `${exemption} ${underLimit}`.trim();
}

export type Verdict = 'noFiling' | 'filing' | 'unclear';

export interface CalculatorOutcome {
  /** Otázky, které jsou vidět — poslední smí být nezodpovězená. */
  steps: readonly Step[];
  situation: Situation | null;
  /** Znění otázky na ostatní příjmy, jakmile na ni přijde řada. */
  incomeQuestion: { question: string; hint: string } | null;
  verdict: Verdict | null;
  reason: string | null;
  /**
   * Oznámení osvobozeného příjmu nad 5 milionů Kč (§ 38v, R-09d) a jeho lhůta:
   * `threeMonths` pro toho, kdo přiznání nepodává, `withReturn` pro toho, kdo
   * ano, `eitherWay`, když to verdikt neví. `null`, když uživatel nic
   * osvobozeného tříletým testem neprodal — prodeje do 100 000 Kč za rok pěti
   * milionů dosáhnout nemůžou.
   *
   * Řídí se jen otázkami, které jsou VIDĚT: odpověď schovaná za dřívějším
   * verdiktem by jinak u týchž viditelných odpovědí jednou oznámení ukázala
   * a jindy ne. Cena: kdo dostal verdikt už u akcií, na krypto dotázán nebyl
   * a o oznámení za něj se tu nedočte — hlídá ho až aplikace z dat
   * (`REPORTING_38V`).
   */
  exemptSaleNotice: keyof typeof EXEMPT_SALE_NOTICES | null;
  /**
   * Verdikt stojí na přísnějším výkladu limitu 100 000 Kč (R-02c) a mírnější
   * by ho mohl změnit: tři roky vydržela jen část prodaného a zbytek se
   * počítá mezi zdanitelné příjmy. Sporný výklad se neschovává (pravidlo 2).
   */
  disputedLimit: boolean;
}

/**
 * Verdikt kalkulačky z odpovědí. Čistá funkce bez JSX — export kvůli testům.
 * `limits` říkají, kterými částkami § 38g se otázka i zdůvodnění řídí (limity
 * běžného roku, které stránka připravila na serveru), `previous` jsou limity
 * roku předchozího pro nápovědu.
 */
export function evaluateCalculator(
  answers: CalculatorAnswers,
  limits: FilingLimitTexts,
  previous: FilingLimitTexts = limits,
): CalculatorOutcome {
  const steps: Step[] = ['work'];
  const situation = situationOf(answers);
  // co z prodejů zůstalo zdanitelné — vyplní se, až je otázka vidět a zodpovězená
  let sales: Taxable | null = null;
  let crypto: Taxable | null = null;
  const partly = (): PartlyTaxable => ({ sales: sales === 'part', crypto: crypto === 'part' });
  const timeTested = () =>
    (sales !== null && answers.salesOver100k === true && answers.salesHeld !== 'none') ||
    (crypto !== null && answers.cryptoOver100k === true && answers.cryptoHeld !== 'none');

  const pending = (): CalculatorOutcome => ({
    steps,
    situation,
    incomeQuestion:
      situation && steps.includes('income')
        ? incomeQuestion(situation, limits, previous, partly())
        : null,
    verdict: null,
    reason: null,
    exemptSaleNotice: null,
    disputedLimit: false,
  });
  const decided = (verdict: Verdict, reason: string): CalculatorOutcome => ({
    ...pending(),
    verdict,
    reason,
    exemptSaleNotice: !timeTested()
      ? null
      : verdict === 'filing' || situation === 'selfEmployed'
        ? 'withReturn'
        : verdict === 'unclear'
          ? 'eitherWay'
          : 'threeMonths',
    // pod limitem zůstává verdikt stejný i při mírnějším výkladu
    disputedLimit: verdict !== 'noFiling' && (sales === 'part' || crypto === 'part'),
  });

  if (answers.work === 'selfEmployed') steps.push('flatTax');
  if (situation === null) return pending();
  // OSVČ mimo paušál limit nemá: stačí, že je zdanitelná jakákoli část prodejů
  const settled = (share: Taxable): 'part' | 'everything' | null =>
    share === 'everything' || (share === 'part' && situation === 'selfEmployed') ? share : null;

  steps.push('sales');
  if (answers.salesOver100k === true) steps.push('salesHeld');
  sales = taxableShare(answers.salesOver100k, answers.salesHeld);
  if (sales === null) return pending();
  const settledSales = settled(sales);
  if (settledSales) {
    return decided('filing', salesReason(situation, 'securities', settledSales, limits));
  }

  steps.push('crypto');
  if (answers.cryptoOver100k === true) steps.push('cryptoHeld');
  crypto = taxableShare(answers.cryptoOver100k, answers.cryptoHeld);
  if (crypto === null) return pending();
  const settledCrypto = settled(crypto);
  if (settledCrypto) {
    return decided('filing', salesReason(situation, 'crypto', settledCrypto, limits));
  }

  steps.push('income');
  if (answers.income === null) return pending();
  if (answers.income === 'yes') return decided('filing', incomeReason(situation, limits));
  if (answers.income === 'unknown') {
    return decided(
      'unclear',
      situation === 'selfEmployed'
        ? 'Jestli máš z investic zdanitelný příjem, zjistí Danero přesně z napojeného účtu nebo výpisu.'
        : 'Jestli tvoje zdanitelné příjmy limit přesáhly, zjistí Danero přesně z napojeného účtu nebo výpisu.',
    );
  }
  return decided(
    'noFiling',
    exemptReason(situation, { partly: partly(), timeTested: timeTested() }, limits, previous),
  );
}

/**
 * Nová odpověď do stavu kalkulačky. S odpovědí se zahodí ty, které na ní
 * stály: podotázka patří jen k jedné odpovědi rodiče a otázka na ostatní
 * příjmy mění se situací limit a s částečně drženými prodeji i to, co se do
 * ní počítá — stará odpověď by patřila jiné otázce.
 */
export function applyAnswer(
  previous: CalculatorAnswers,
  patch: Partial<CalculatorAnswers>,
): CalculatorAnswers {
  const next = { ...previous, ...patch };
  if (next.work !== previous.work) next.flatTax = patch.flatTax ?? null;
  if (next.salesOver100k !== previous.salesOver100k) next.salesHeld = patch.salesHeld ?? null;
  if (next.cryptoOver100k !== previous.cryptoOver100k) next.cryptoHeld = patch.cryptoHeld ?? null;
  const asked = (answers: CalculatorAnswers) => {
    const partly = partlyTaxable(answers);
    return `${situationOf(answers)}|${partly.sales}|${partly.crypto}`;
  };
  if (asked(next) !== asked(previous)) next.income = patch.income ?? null;
  return next;
}

/**
 * Jak se verdikt ukáže: slovní stav (s barvou), věta verdiktu a jedna věta,
 * co s tím umí Danero. Barva stavu není modrá — ta patří ovládání.
 * OSVČ mimo paušál má vlastní znění: přiznání podává tak jako tak, takže
 * odpověď není „podáš / nepodáš“, ale „patří do něj investice?“.
 */
export function verdictCopy(
  verdict: Verdict,
  situation: Situation,
): { tone: Tone; status: string; title: string; next: string } {
  const selfEmployed = situation === 'selfEmployed';
  switch (verdict) {
    case 'noFiling':
      return selfEmployed
        ? {
            tone: 'success',
            status: 'Nic navíc',
            title: 'Vypadá to, že investice ti do přiznání nic nepřidají.',
            next: 'Osvobození se posuzuje každý rok znovu — Danero ho pohlídá za tebe.',
          }
        : {
            tone: 'success',
            status: 'Bez přiznání',
            title: 'Vypadá to, že přiznání kvůli investicím řešit nemusíš.',
            next: 'Limity se počítají každý rok znovu — Danero je pohlídá za tebe.',
          };
    case 'filing':
      return {
        tone: 'caution',
        status: selfEmployed ? 'Do přiznání' : 'Přiznání',
        title: selfEmployed
          ? 'Investice nejspíš patří do tvého přiznání.'
          : 'Nejspíš podáš přiznání.',
        next: 'Danero spočítá přesnou daň a připraví podklady i XML pro podatelnu.',
      };
    case 'unclear':
      return {
        tone: 'neutral',
        status: 'Nedá se určit',
        title: 'Tohle bez dat s jistotou říct nejde.',
        next: 'Napoj brokera nebo nahraj výpis — na nic dalšího se ptát nebudeme.',
      };
  }
}

/**
 * Oznámení osvobozeného příjmu (§ 38v ZDP, R-09d). Kdo prodal za 6 milionů
 * akcie držené pět let, daň neplatí — ale oznámení podat musí a pokuta je
 * 0,1–15 % z částky (§ 38w). Zamlčet to je horší než zamlčet daň.
 *
 * Lhůta se liší podle toho, jestli tazatel přiznání podává:
 * – **nepodává** (`threeMonths`): do 23. 8. 2026 tu stálo „lhůta je ale
 *   stejná“ — a to byla nepravda (K7a-03). Prodloužení lhůty na čtyři měsíce je
 *   podle § 136 odst. 2 písm. a) daňového řádu podmíněné tím, že „následně bylo
 *   daňové přiznání podáno elektronicky“, takže kdo přiznání nepodává, žádné
 *   prodloužení nezíská a platí základní tříměsíční lhůta (pokyn GFŘ D-59 ke
 *   § 38v). Rozdíl je až měsíc a sankce se počítá z NEOZNÁMENÉHO PŘÍJMU;
 * – **podává** (`withReturn`): obě lhůty jsou totožné. Do 13. 10. 2026 se
 *   o oznámení u verdiktu „přiznání“ mlčelo — jenže povinnost má i ten, kdo
 *   vedle osvobozeného prodeje za 6 milionů podává přiznání kvůli dividendám.
 */
export const EXEMPT_SALE_NOTICES = {
  threeMonths: {
    visible:
      'Výjimka: jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu oznamuje — do tří měsíců po konci roku.',
    detail:
      'Pozor na jednu výjimku: jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu přesto oznamuje (§ 38v zákona o daních z příjmů). Přiznání to není, a proto máš kratší lhůtu — tři měsíce po konci roku: měsíc navíc, který patří k elektronickému přiznání, dostane jen ten, kdo přiznání opravdu podá.',
  },
  withReturn: {
    visible:
      'Jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu oznamuje, i když se nedaní — ve lhůtě pro přiznání.',
    detail:
      'Osvobozený prodej nad 5 milionů Kč se oznamuje podle § 38v zákona o daních z příjmů. Kdo podává přiznání, má na oznámení stejnou lhůtu jako na ně. Za neoznámení hrozí pokuta 0,1 až 15 % z příjmu.',
  },
  // verdikt „nedá se určit“: jestli tazatel přiznání podává, nevíme — platí obě lhůty
  eitherWay: {
    visible:
      'Jednotlivý osvobozený prodej nad 5 milionů Kč se finančnímu úřadu oznamuje, i když se nedaní — bez přiznání do tří měsíců po konci roku.',
    detail:
      'Osvobozený prodej nad 5 milionů Kč se oznamuje podle § 38v zákona o daních z příjmů. Kdo podává přiznání, má na oznámení stejnou lhůtu jako na ně; kdo ho nepodává, jen tři měsíce po konci roku. Za neoznámení hrozí pokuta 0,1 až 15 % z příjmu.',
  },
} as const;

/**
 * Sporný výklad limitu 100 000 Kč (R-02c) — ukazuje se u verdiktu, který na
 * něm stojí. Znění drží krok s Nastavením, kde si ho uživatel aplikace volí.
 */
export const DISPUTED_LIMIT = {
  visible: 'Počítáme přísnějším výkladem limitu 100 000 Kč.',
  detail:
    'Jestli se do 100 000 Kč počítají i prodeje osvobozené po třech letech, zákon jednoznačně neříká; finanční správa se kloní k tomu, že ano, a tak počítáme. Podle mírnějšího výkladu by se počítal jen zbytek — a kdyby se do 100 000 Kč vešel, byl by osvobozený taky. Neseš ale riziko doměrku.',
} as const;

export function FilingCalculator({
  filingLimits,
  previousFilingLimits,
  children,
}: {
  filingLimits: FilingLimitTexts;
  previousFilingLimits: FilingLimitTexts;
  /** Obsah pod otázkami (pravidla): na širokém okně vedle něj verdikt dál drží na očích. */
  children?: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<CalculatorAnswers>(NOTHING_ANSWERED);
  const answer = (patch: Partial<CalculatorAnswers>) =>
    setAnswers((previous) => applyAnswer(previous, patch));

  // otázka i verdikt jmenují limit běžného roku; loňský jde jen do nápovědy
  const {
    steps,
    situation,
    incomeQuestion: income,
    verdict,
    reason,
    exemptSaleNotice,
    disputedLimit,
  } = evaluateCalculator(answers, filingLimits, previousFilingLimits);
  const shown = verdict && situation ? verdictCopy(verdict, situation) : null;
  const notice = exemptSaleNotice ? EXEMPT_SALE_NOTICES[exemptSaleNotice] : null;

  const questions: Record<Step, React.ReactNode> = {
    work: (
      <Question<Work>
        key="work"
        {...QUESTIONS.work}
        options={[
          { value: 'employee', label: 'Zaměstnanec' },
          { value: 'selfEmployed', label: 'OSVČ' },
          { value: 'neither', label: 'Ani jedno' },
        ]}
        value={answers.work}
        onChange={(work) => answer({ work })}
      />
    ),
    flatTax: (
      <Question<boolean>
        key="flatTax"
        {...QUESTIONS.flatTax}
        options={YES_NO}
        value={answers.flatTax}
        onChange={(flatTax) => answer({ flatTax })}
      />
    ),
    sales: (
      <Question<boolean>
        key="sales"
        {...QUESTIONS.sales}
        options={YES_NO}
        value={answers.salesOver100k}
        onChange={(salesOver100k) => answer({ salesOver100k })}
      />
    ),
    salesHeld: (
      <Question<Held>
        key="salesHeld"
        {...QUESTIONS.salesHeld}
        options={[
          { value: 'all', label: 'Všechny' },
          { value: 'some', label: 'Jen část' },
          { value: 'none', label: 'Žádné' },
        ]}
        value={answers.salesHeld}
        onChange={(salesHeld) => answer({ salesHeld })}
      />
    ),
    crypto: (
      <Question<boolean>
        key="crypto"
        {...QUESTIONS.crypto}
        options={YES_NO}
        value={answers.cryptoOver100k}
        onChange={(cryptoOver100k) => answer({ cryptoOver100k })}
      />
    ),
    cryptoHeld: (
      <Question<Held>
        key="cryptoHeld"
        {...QUESTIONS.cryptoHeld}
        options={[
          { value: 'all', label: 'Všechno' },
          { value: 'some', label: 'Jen část' },
          { value: 'none', label: 'Nic' },
        ]}
        value={answers.cryptoHeld}
        onChange={(cryptoHeld) => answer({ cryptoHeld })}
      />
    ),
    income: income && (
      <Question<IncomeAnswer>
        key="income"
        question={income.question}
        hint={income.hint}
        options={[
          { value: 'no', label: 'Ne' },
          { value: 'yes', label: 'Ano' },
          { value: 'unknown', label: 'Nevím' },
        ]}
        value={answers.income}
        onChange={(value) => answer({ income: value })}
      />
    ),
  };

  return (
    // Tři části: otázky, verdikt, pravidla. Na úzkém okně jdou pod sebou v tomhle
    // pořadí; na širokém stojí verdikt ve vlastním sloupci přes obě řady a drží
    // se u horního okraje, dokud se roluje otázkami a pravidly.
    <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,38rem)_minmax(0,24rem)] lg:justify-between">
      <div className="lg:col-start-1 lg:row-start-1">
        <div className="divide-y divide-line/70">{steps.map((step) => questions[step])}</div>
        {answers.work !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAnswers(NOTHING_ANSWERED)}
            className="-ml-3 mt-6"
          >
            Začít znovu
          </Button>
        )}
      </div>

      {/* Panel verdiktu je živá oblast: čtečka ohlásí verdikt, jakmile padne.
          Na širokém okně stojí vedle otázek od začátku, takže je vidět, kde se
          odpověď objeví. Na úzkém by prázdná karta jen oddělila otázky od
          pravidel a nic neřekla — tam je do verdiktu vidět jen čtečce
          (oblast musí ve stránce zůstat, jinak by změnu neohlásila). */}
      <div className={cn('lg:col-start-2 lg:row-span-2 lg:row-start-1', !shown && 'max-lg:sr-only')}>
        <div
          role="status"
          className="rounded-2xl bg-canvas p-6 sm:p-8 lg:sticky lg:top-[calc(var(--nav-height)+2rem)]"
        >
          {shown ? (
            <>
              <StatusLabel tone={shown.tone}>{shown.status}</StatusLabel>
              <h2 className="type-title-1 mt-3 text-balance">{tidy(shown.title)}</h2>
              <p className="type-body mt-3 text-pretty text-ink-muted">
                {reason && tidy(reason)}
              </p>
              <ul className="type-footnote mt-5 space-y-2 text-pretty text-ink-muted">
                {verdict !== 'unclear' && (
                  <li>{tidy('Orientačně — přesně to spočítá aplikace z tvých dat.')}</li>
                )}
                {/* R-09f: verdikt pro OSVČ mimo paušál stojí na předpokladu,
                  který z odpovědí neznáme — ať je vidět */}
                {situation === 'selfEmployed' && (
                  <li>{tidy('Vycházíme z toho, že přiznání kvůli podnikání podáváš.')}</li>
                )}
                {/* R-02c: verdikt, který by mírnější výklad stovky mohl změnit,
                  to říká — výklad sám je ve vysvětlivce */}
                {disputedLimit && (
                  <li>
                    {tidy(DISPUTED_LIMIT.visible)}{' '}
                    <InfoPopover label="Sporný výklad limitu" align="end" className="-my-1">
                      <p>{tidy(DISPUTED_LIMIT.detail)}</p>
                    </InfoPopover>
                  </li>
                )}
                {/* R-09d: osvobozeno ≠ bez povinností — oznámení nad 5 mil. Kč má
                  vlastní pokutu 0,1–15 % (§ 38w). Výjimka i lhůta jsou vidět,
                  paragraf a důvod lhůty jsou ve vysvětlivce. */}
                {notice && (
                  <li>
                    {tidy(notice.visible)}{' '}
                    <InfoPopover label="Oznámení osvobozeného příjmu" align="end" className="-my-1">
                      <p>{tidy(notice.detail)}</p>
                    </InfoPopover>
                  </li>
                )}
              </ul>
              <div className="mt-6 border-t border-line/70 pt-5">
                <p className="type-callout text-pretty">{tidy(shown.next)}</p>
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
