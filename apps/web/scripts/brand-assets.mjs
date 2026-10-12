/**
 * Rastrové podoby značky pro místa, kam SVG nesmí: `app/favicon.ico` (starší
 * prohlížeče a záložky) a PNG v `public/znacka` (strukturovaná data pro
 * vyhledávače, podklady pro třetí strany).
 *
 * Geometrie je JEDNA a stejná jako `apps/web/components/logo.tsx` a
 * `apps/web/app/icon.svg`: kruh = nakoupený kus za časovým testem, svislice
 * = dnešek. Barvy jsou světlé tokeny z `app/globals.css` (`--accent`, `--ink`,
 * `--surface`) — v obrázku musí být natvrdo, proměnné tam neplatí. Kdyby se
 * značka měnila, mění se na těch třech místech a tenhle skript se pustí
 * znovu — proto tu jsou obrázky generované, ne nakreslené.
 *
 * Renderuje headless Chromium z Playwrightu (v `apps/web` už je kvůli E2E),
 * takže nepřibývá žádná závislost — proto skript bydlí tady, a ne v kořenovém
 * `scripts/`, odkud by se `@playwright/test` v pnpm workspace nenašel.
 *
 * Slovo „Danero“ se sází systémovým písmem, stejně jako v aplikaci (žádné
 * webové písmo se nestahuje, skript proto nepotřebuje síť). Výsledek tedy
 * závisí na stroji, kde skript běží: pouštěj ho tam, kde je k dispozici
 * San Francisco nebo Segoe UI, jinak dostane logotyp náhradní řez.
 *
 *   node apps/web/scripts/brand-assets.mjs            # zapíše do apps/web/public/znacka a app/favicon.ico
 *   node apps/web/scripts/brand-assets.mjs <adresář>  # všechno do zadaného adresáře
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = '#0071e3';
const INK = '#1d1d1f';
const SURFACE = '#ffffff';

/** Zásobník `--font-display` z `globals.css`. */
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI Variable Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, system-ui, sans-serif";

const markSvg = (background) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
    ${background ? `<rect width="24" height="24" rx="5" fill="${background}"/>` : ''}
    <circle cx="10.6" cy="15.4" r="5.6" fill="${ACCENT}"/>
    <rect x="15.8" y="3" width="3.2" height="18" rx="1.6" fill="${INK}"/>
  </svg>`;

/** Favicon: stejný výřez jako `app/icon.svg` (značka až k okrajům). */
const faviconSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="2 2 20 20" width="100%" height="100%">
    <circle cx="10.6" cy="15.4" r="5.6" fill="${ACCENT}"/>
    <rect x="15.8" y="3" width="3.2" height="18" rx="1.6" fill="${INK}"/>
  </svg>`;

const page = (body, background) =>
  `<html><body style="margin:0;background:${background ?? 'transparent'}">${body}</body></html>`;

const iconPage = (size, background) =>
  page(`<div style="width:${size}px;height:${size}px">${markSvg(background)}</div>`, background);

const logoPage = (width, height, background) =>
  page(
    `<div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;gap:${height * 0.08}px">
       <div style="width:${height * 0.8}px;height:${height * 0.8}px">${markSvg(null)}</div>
       <span style="font-family:${FONT_STACK};font-weight:600;font-size:${height * 0.6}px;letter-spacing:-0.02em;color:${INK}">Danero</span>
     </div>`,
    background,
  );

/**
 * Soubor ICO s jediným obrázkem PNG (formát to dovoluje od Windows Vista
 * a prohlížeče ho čtou): šestibajtová hlavička, jeden šestnáctibajtový záznam
 * adresáře a za ním PNG beze změny.
 */
function icoFromPng(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // rezervováno
  header.writeUInt16LE(1, 2); // typ: ikona
  header.writeUInt16LE(1, 4); // počet obrázků
  header.writeUInt8(size, 6); // šířka
  header.writeUInt8(size, 7); // výška
  header.writeUInt8(0, 8); // paleta
  header.writeUInt8(0, 9); // rezervováno
  header.writeUInt16LE(1, 10); // barevné roviny
  header.writeUInt16LE(32, 12); // bitů na pixel
  header.writeUInt32LE(png.length, 14); // velikost dat
  header.writeUInt32LE(22, 18); // odkud data začínají
  return Buffer.concat([header, png]);
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, '../public/znacka'));
const faviconPath = process.argv[2] ? `${out}/favicon.ico` : resolve(here, '../app/favicon.ico');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const tab = await browser.newPage({ deviceScaleFactor: 1 });

const shoot = async (path, html, width, height, transparent) => {
  await tab.setViewportSize({ width, height });
  await tab.setContent(html, { waitUntil: 'load' });
  await tab.screenshot({ path, omitBackground: transparent });
};

// ikona na ploše i průhledná (pro tmavé podklady)
await shoot(`${out}/danero-icon-512.png`, iconPage(512, SURFACE), 512, 512, false);
await shoot(`${out}/danero-icon-512-transparent.png`, iconPage(512, null), 512, 512, true);
// logotyp
await shoot(`${out}/danero-logo-1024x256.png`, logoPage(1024, 256, SURFACE), 1024, 256, false);
await shoot(
  `${out}/danero-logo-1024x256-transparent.png`,
  logoPage(1024, 256, null),
  1024,
  256,
  true,
);
// favicon.ico (32 × 32, průhledné pozadí)
const faviconPng = `${out}/.favicon-32.png`;
await shoot(
  faviconPng,
  page(`<div style="width:32px;height:32px">${faviconSvg}</div>`, null),
  32,
  32,
  true,
);
writeFileSync(faviconPath, icoFromPng(readFileSync(faviconPng), 32));
rmSync(faviconPng);

await browser.close();
console.log(`Podklady značky: ${out}\nFavicon: ${faviconPath}`);
