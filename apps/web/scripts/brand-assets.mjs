/**
 * Rastrové podoby značky pro místa, kam SVG nesmí — Stripe Checkout, doklady
 * a zákaznický portál chtějí PNG nebo JPG.
 *
 * Geometrie je JEDNA a stejná jako `apps/web/components/logo.tsx` a
 * `apps/web/app/icon.svg`: kruh = nakoupený kus za časovým testem, svislice
 * = dnešek. Kdyby se značka měnila, mění se na těch třech místech a tenhle
 * skript se pustí znovu — proto tu jsou obrázky generované, ne nakreslené.
 *
 * Renderuje headless Chromium z Playwrightu (v `apps/web` už je kvůli E2E),
 * takže nepřibývá žádná závislost — proto skript bydlí tady, a ne v kořenovém
 * `scripts/`, odkud by se `@playwright/test` v pnpm workspace nenašel.
 *
 *   node apps/web/scripts/brand-assets.mjs            # zapíše do apps/web/public/znacka
 *   node apps/web/scripts/brand-assets.mjs <adresář>
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Barvy z `globals.css` — v obrázku musí být natvrdo, proměnné tam neplatí. */
const PINK = '#d6336c';
const INK = '#171930';
const SURFACE = '#ffffff';

const markSvg = (background) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
    ${background ? `<rect width="24" height="24" rx="5" fill="${background}"/>` : ''}
    <circle cx="10.6" cy="15.4" r="5.6" fill="${PINK}"/>
    <rect x="15.8" y="3" width="3.2" height="18" rx="1.6" fill="${INK}"/>
  </svg>`;

const page = (body, background) =>
  `<html><body style="margin:0;background:${background ?? 'transparent'}">${body}</body></html>`;

/** Čtvercová značka — Stripe ji chce nejmíň 128 px, dáváme 512. */
const iconPage = (size, background) =>
  page(`<div style="width:${size}px;height:${size}px">${markSvg(background)}</div>`, background);

/**
 * Logotyp = značka + slovo, ve skutečném písmu značky. Bricolage Grotesque si
 * aplikace tahá přes `next/font` z Google Fonts, takže si ho tady stáhneme taky
 * — systémový bezpatkový řez vypadá jako cizí logo, a o rozpoznání značky tu jde.
 * Bez sítě skript raději spadne, než aby tiše vyrobil podklad jiným písmem.
 */
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&display=block';

const logoPage = (width, height, background) =>
  page(
    `<link rel="stylesheet" href="${FONT_CSS}">
     <div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;gap:${height * 0.08}px">
       <div style="width:${height * 0.8}px;height:${height * 0.8}px">${markSvg(null)}</div>
       <span style="font-family:'Bricolage Grotesque',sans-serif;font-weight:700;font-size:${height * 0.6}px;letter-spacing:-0.02em;color:${INK}">Danero</span>
     </div>`,
    background,
  );

const out = resolve(
  process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../public/znacka'),
);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const tab = await browser.newPage({ deviceScaleFactor: 1 });

const shoot = async (name, html, width, height, transparent) => {
  await tab.setViewportSize({ width, height });
  await tab.setContent(html, { waitUntil: 'networkidle' });
  // písmo značky musí být opravdu načtené — jinak se vykreslí náhradní řez
  // a rozdíl je vidět až na hotovém dokladu u zákazníka
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: `${out}/${name}`, omitBackground: transparent });
};

// ikona pro Checkout a portál (na ploše) i pro tmavé podklady (průhledná)
await shoot('danero-icon-512.png', iconPage(512, SURFACE), 512, 512, false);
await shoot('danero-icon-512-transparent.png', iconPage(512, null), 512, 512, true);
// logotyp na doklady a do hlavičky
await shoot('danero-logo-1024x256.png', logoPage(1024, 256, SURFACE), 1024, 256, false);
await shoot('danero-logo-1024x256-transparent.png', logoPage(1024, 256, null), 1024, 256, true);

await browser.close();
console.log(`Podklady značky: ${out}`);
