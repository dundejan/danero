/**
 * Snímek přehledu na úvodní stránce (`app/page.tsx`, rámeček prohlížeče pod
 * nadpisem) — světlý a tmavý, oba 2880 × 930 px.
 *
 * Snímek je fotka ŽIVÉ stránky `/demo/prehled`, ne kresba: když se přehled
 * změní, pustí se skript znovu proti instanci postavené z nového kódu a oba
 * soubory se přepíšou. Ručně focený snímek z července 2026 mezitím zastaral —
 * ukazoval lhůtu „elektronicky do 2. 5. 2027“ (neděle), papírové podání pro
 * OSVČ a interní značku pravidla „R-10a“, zatímco demo o klik dál už říkalo
 * něco jiného. Proto skript snímek s takovým obsahem vůbec neuloží (viz
 * `findTextDefects`).
 *
 * Renderuje headless Chromium z Playwrightu (v `apps/web` už je kvůli E2E) —
 * ze stejného důvodu jako `brand-assets.mjs` bydlí skript tady, a ne v kořenovém
 * `scripts/`.
 *
 *   node apps/web/scripts/hero-screenshot.mjs <adresa>             # zapíše do apps/web/public/marketing
 *   node apps/web/scripts/hero-screenshot.mjs <adresa> <adresář>   # na zkoušku jinam
 *
 * `<adresa>` je běžící instance, např. `http://localhost:3000`. „Dnešek“ dema
 * se odvíjí od skutečného data, takže počet transakcí a částky se mezi dvěma
 * běhy smí o něco lišit — to je vlastnost dema, ne chyba snímku.
 */
/* global document, window, NodeFilter -- funkce předávané do `evaluate` běží v prohlížeči */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rozměr souboru. `app/page.tsx` má `width={1440} height={465}` — stejný poměr. */
const IMAGE_WIDTH = 2880;
const IMAGE_HEIGHT = 930;

/**
 * Šířky okna, ve kterých se přehled zkouší vyfotit, od nejužší. Výška výřezu
 * je vždy šířka × 930 / 2880 a u všech těchhle šířek vychází na celé pixely.
 *
 * Proč víc šířek: rozměr obrázku je daný, ale přehled roste (v říjnu 2026
 * přibyl pod verdikt rozpad „daň − zálohy = doplatek“ a v okně 1440 px už se
 * do výřezu 465 px ukazatele limitů nevešly). Širší okno znamená vyšší výřez,
 * ale menší písmo na úvodní stránce — bere se proto NEJUŽŠÍ šířka, do které se
 * verdikt i ukazatele vejdou.
 */
const VIEWPORT_WIDTHS = [1440, 1536, 1632, 1728, 1824, 1920];

/** Kolik místa musí pod pruhy ukazatelů zbýt, aby neležely na hraně snímku. */
const MARGIN_BELOW_BARS = 24;

const THEMES = ['light', 'dark'];

const baseUrl = process.argv[2]?.replace(/\/+$/, '');
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  console.error(
    'Chybí adresa běžící instance.\n' +
      '  node apps/web/scripts/hero-screenshot.mjs http://localhost:3000 [adresář]',
  );
  process.exit(1);
}
const out = resolve(
  process.argv[3] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../public/marketing'),
);
mkdirSync(out, { recursive: true });

/**
 * Kde na stránce leží to, co má být na snímku vidět. Stojí na třech kotvách
 * ve struktuře přehledu (`components/views/overview-view.tsx`):
 *   - pruh „Prohlížíš demo“ je `<header>` přímo v obalu dema — snímek začíná
 *     pod ním, protože rámeček na úvodu se tváří jako `danero.cz/prehled`,
 *   - první `<section>` v `main#obsah` je mřížka ukazatelů limitů a karta
 *     před ní je verdikt,
 *   - v ukazateli je poslední odstavec vysvětlivka a prvek před ní pruh čerpání.
 * Když se struktura změní, vrátí se `null` a skript skončí chybou — tichý
 * posun výřezu by dal snímek bez ukazatelů a nikdo by si toho nevšiml.
 */
const measureLayout = () => {
  const banner = document.querySelector('body > div > header');
  const main = document.querySelector('main#obsah');
  const gauges = main?.querySelector('section');
  const verdict = gauges?.previousElementSibling;
  if (!banner || !gauges || !verdict || gauges.children.length === 0) return null;

  // jen první řada mřížky — pod ní je karta daně, která pruh nemá
  const cards = [...gauges.children];
  const firstRowTop = cards[0].getBoundingClientRect().top;
  const firstRow = cards.filter(
    (card) => Math.abs(card.getBoundingClientRect().top - firstRowTop) < 1,
  );
  const bars = firstRow.map((card) => card.lastElementChild?.previousElementSibling);
  if (bars.some((bar) => !bar)) return null;

  return {
    cropTop: banner.getBoundingClientRect().bottom + window.scrollY,
    barsBottom:
      Math.max(...bars.map((bar) => bar.getBoundingClientRect().bottom)) + window.scrollY,
    dark: document.documentElement.classList.contains('dark'),
  };
};

/** Viditelný text, který zasahuje do výřezu (souřadnice dokumentu). */
const readTextInCrop = ({ top, bottom }) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const parts = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const nodeTop = rect.top + window.scrollY;
    const nodeBottom = rect.bottom + window.scrollY;
    if (nodeBottom > top && nodeTop < bottom) parts.push(node.textContent);
  }
  return parts.join(' ').replace(/\s+/g, ' ');
};

/**
 * Co na marketingovém snímku být nesmí. Nejsou to estetické výhrady, ale
 * přesně ty tři věci, kvůli kterým se starý snímek musel vyměnit:
 *   - interní ID pravidla z docs/02 („R-10a“) — pravidlo 3: žádný žargon,
 *   - papírová lhůta — ukázková osoba je OSVČ a ta podává jen elektronicky
 *     (§ 72 odst. 6 daňového řádu),
 *   - lhůta na sobotu nebo neděli — § 33 odst. 4 daňového řádu ji posouvá na
 *     nejbližší pracovní den (docs/02, R-09e); svátky tahle kontrola nezná.
 */
const findTextDefects = (text) => {
  const defects = [];
  const ruleId = text.match(/\bR-\d{2}[a-z]?\b/);
  if (ruleId) defects.push(`interní ID pravidla „${ruleId[0]}“`);
  const paper = text.match(/(papírově|písemně) do/);
  if (paper) defects.push(`papírová lhůta („${paper[0]}“)`);
  for (const [, day, month, year] of text.matchAll(
    /(?:termín podání|\bdo)\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/g,
  )) {
    const weekday = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
    if (weekday === 0 || weekday === 6) {
      defects.push(`lhůta ${day}. ${month}. ${year} připadá na víkend`);
    }
  }
  return defects;
};

/** Šířka a výška z hlavičky PNG (IHDR) — ať rozměr nehlídá jen víra v prohlížeč. */
const readPngSize = (path) => {
  const header = readFileSync(path).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
};

const browser = await chromium.launch();
let failed = false;
let chosenWidth = null;

try {
  for (const theme of THEMES) {
    let saved = false;
    // tmavý snímek bere šířku, kterou vybral světlý — oba musí mít stejný výřez
    for (const width of chosenWidth ? [chosenWidth] : VIEWPORT_WIDTHS) {
      const cropHeight = (width * IMAGE_HEIGHT) / IMAGE_WIDTH;
      const context = await browser.newContext({
        viewport: { width, height: cropHeight },
        deviceScaleFactor: IMAGE_WIDTH / width,
        colorScheme: theme,
        reducedMotion: 'reduce',
        locale: 'cs-CZ',
      });
      const tab = await context.newPage();
      const response = await tab.goto(`${baseUrl}/demo/prehled`, { waitUntil: 'networkidle' });
      if (!response?.ok()) {
        throw new Error(`${baseUrl}/demo/prehled vrátilo stav ${response?.status() ?? 'žádný'}.`);
      }
      // písmo musí být opravdu načtené — náhradní řez má jiné šířky a zalomí jinak
      await tab.evaluate(() => document.fonts.ready);

      const layout = await tab.evaluate(measureLayout);
      if (!layout) {
        throw new Error(
          'Přehled má jinou strukturu, než skript čeká (pruh dema, verdikt, mřížka ukazatelů) — ' +
            'uprav kotvy v `measureLayout`.',
        );
      }
      if (layout.dark !== (theme === 'dark')) {
        throw new Error(`Stránka se nepřepnula do vzhledu „${theme}“.`);
      }

      const cropBottom = layout.cropTop + cropHeight;
      if (layout.barsBottom + MARGIN_BELOW_BARS > cropBottom) {
        await context.close();
        continue;
      }

      const defects = findTextDefects(
        await tab.evaluate(readTextInCrop, { top: layout.cropTop, bottom: cropBottom }),
      );
      if (defects.length > 0) {
        throw new Error(`Snímek by ukazoval: ${defects.join('; ')}. Neukládám.`);
      }

      const path = `${out}/hero-${theme}.png`;
      await tab.evaluate((top) => window.scrollTo(0, top), layout.cropTop);
      // `animations: 'disabled'` dotáhne růst pruhů ukazatelů do koncového stavu
      await tab.screenshot({ path, animations: 'disabled' });
      await context.close();

      const size = readPngSize(path);
      if (size.width !== IMAGE_WIDTH || size.height !== IMAGE_HEIGHT) {
        throw new Error(
          `${path} má ${size.width} × ${size.height} px, čeká se ${IMAGE_WIDTH} × ${IMAGE_HEIGHT}.`,
        );
      }
      console.log(`${path} — okno ${width} px, výřez ${cropHeight} px pod pruhem dema`);
      chosenWidth = width;
      saved = true;
      break;
    }
    if (!saved) {
      throw new Error(
        `Verdikt a ukazatele limitů se do výřezu nevejdou ani v okně ${VIEWPORT_WIDTHS.at(-1)} px ` +
          '(nebo se tmavý vzhled zalomil jinak než světlý). Přehled je na tenhle poměr stran ' +
          'moc vysoký — je čas změnit, co úvodní stránka ukazuje.',
      );
    }
  }
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
