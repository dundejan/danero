import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAQ } from '@/app/caste-otazky/faq';
import { configForYear } from '@/lib/tax-config';

/**
 * L3-01 (revize 5), R-09a a R-09b: zák. č. 180/2026 Sb. zvedl od zdaňovacího
 * období 2027 limity § 38g — odst. 1 z 50 000 na 100 000 Kč, odst. 2 z 20 000
 * na 40 000 Kč. Za rok 2026 (přiznání na jaře 2027) platí dosavadní částky.
 *
 * Veřejné stránky nejsou vázané na rok jako přehled v aplikaci, takže částku
 * bez roku čte v lednu 2027 člověk, pro kterého už neplatí. Strážce proto
 * chce, aby každá pasáž, která jmenuje limit zaměstnance, řekla obě částky
 * i oba roky. Částky bere z konfigurace roku, ne z opsaného čísla.
 *
 * Limit 50 000 Kč paušální daně (§ 7a) se nemění a strážce si ho nevšímá —
 * pasáž o § 38g pozná podle limitu zaměstnance, který si s ničím jiným
 * splést nejde.
 */
const LAST_YEAR_OLD_LIMITS = 2026;
const FIRST_YEAR_NEW_LIMITS = 2027;

/** `'100000'` → `'100 000 Kč'`, tak jak se částky píšou v textech stránek. */
const czk = (amount: string): string => `${amount.replace(/\B(?=(\d{3})+$)/g, ' ')} Kč`;

const before = configForYear(LAST_YEAR_OLD_LIMITS).limits;
const after = configForYear(FIRST_YEAR_NEW_LIMITS).limits;

/** Částka, před kterou nestojí další číslice — „120 000 Kč“ není „20 000 Kč“. */
const mentions = (text: string, amount: string): boolean =>
  new RegExp(`(?<!\\d)${amount}`).test(text);

/**
 * Odstavce stránky jako souvislý text (JSX zalamuje věty přes řádky). Komentáře
 * jdou pryč — rok zmíněný v komentáři čtenář nevidí a strážce by jím prošel.
 */
function pageParagraphs(relativePath: string): string[] {
  return readFileSync(join(import.meta.dirname, '..', relativePath), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replaceAll("{' '}", ' ')
    .split('</p>')
    .map((paragraph) => paragraph.replace(/\s+/g, ' '));
}

/**
 * Karty „Tři pravidla, která rozhodují“ pod kalkulačkou: text každé karty je
 * jeden řádek `body: '…'` v poli nad komponentou, ne odstavec v JSX. Čte se po
 * kartách — vcelku by rok ze sousední karty o časovém testu zakryl, že v kartě
 * o limitech žádný není (A20-R1-01: karta radila „20 000 Kč“ bez roku).
 */
function ruleCards(relativePath: string): string[] {
  return readFileSync(join(import.meta.dirname, '..', relativePath), 'utf8')
    .split('\n')
    .filter((line) => /^\s*body:/.test(line));
}

const faqAnswers = (): string[] =>
  FAQ.map((item) => (typeof item.a === 'string' ? item.a : (item.plain ?? '')));

/** Co pasáži o limitech § 38g chybí, aby platila před rokem 2027 i po něm. */
function missingIn(passage: string): string[] {
  const missing: string[] = [];
  if (!mentions(passage, czk(after.employeeSideIncome))) {
    missing.push(`limit zaměstnance od roku ${FIRST_YEAR_NEW_LIMITS}`);
  }
  if (
    mentions(passage, czk(before.generalFiling)) &&
    !mentions(passage, czk(after.generalFiling))
  ) {
    missing.push(`obecný limit od roku ${FIRST_YEAR_NEW_LIMITS}`);
  }
  for (const year of [LAST_YEAR_OLD_LIMITS, FIRST_YEAR_NEW_LIMITS]) {
    if (!passage.includes(String(year))) missing.push(`rok ${year}`);
  }
  return missing;
}

const SOURCES: Array<[string, () => string[]]> = [
  ['/jak-pocitame', () => pageParagraphs('app/jak-pocitame/page.tsx')],
  ['/pruvodce/limit-100-000-kc', () => pageParagraphs('app/pruvodce/limit-100-000-kc/page.tsx')],
  ['/caste-otazky', faqAnswers],
  ['/kalkulacka', () => ruleCards('app/kalkulacka/page.tsx')],
];

describe('veřejné texty: limity pro podání přiznání od roku 2027 (L3-01, R-09a, R-09b)', () => {
  it('konfigurace roku 2027 nese jiné limity § 38g než rok 2026', () => {
    // bez rozdílu by strážce níž neměl co hlídat a prošel by naprázdno
    expect(after.employeeSideIncome).not.toBe(before.employeeSideIncome);
    expect(after.generalFiling).not.toBe(before.generalFiling);
  });

  it.each(SOURCES)('%s: limit zaměstnance stojí vždy s rokem a s částkou od 2027', (_, read) => {
    const passages = read().filter((passage) => mentions(passage, czk(before.employeeSideIncome)));
    // stránka o limitu mluví; kdyby se pasáž nenašla, hlídalo by se prázdno
    expect(passages.length).toBeGreaterThan(0);
    const gaps = passages
      .map((passage) => ({ missing: missingIn(passage), passage: passage.trim().slice(-160) }))
      .filter((gap) => gap.missing.length > 0);
    expect(gaps).toEqual([]);
  });
});
