import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_TAGLINE, SITE_TAGLINE_HOW, SITE_TITLE, SITE_URL } from '@/lib/site';

/**
 * Náhledový obrázek sdíleného odkazu (K8-04) — jeden pro celý web.
 *
 * Kreslí se, ne přikládá: hotové PNG by se rozešlo se značkou při první změně
 * a v repozitáři by leželo jako neupravitelný binární soubor. Barvy jsou proto
 * natvrdo (obrázek nevidí CSS proměnné z `globals.css`, stejně jako
 * `app/icon.svg`) a tvary jsou obyčejné divy — satori v `next/og` neumí
 * vykreslit celé SVG.
 *
 * Soubor platí pro všechny stránky, které si nepřepisují `openGraph`
 * (viz komentář u `SITE_METADATA` v `lib/site.ts`).
 */

export const alt = SITE_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Světlé tokeny z `app/globals.css`: `--canvas`, `--ink`, `--ink-muted`, `--accent`. */
const BACKGROUND = '#f5f5f7';
const INK = '#1d1d1f';
const INK_MUTED = '#6e6e73';
const ACCENT = '#0071e3';

/**
 * Písmo obrázku: Inter Display (SIL OFL 1.1, licence v `assets/og/OFL.txt`).
 *
 * Web sám žádné písmo nestahuje (je systémové) — tohle slouží JEN obrázku pro
 * sdílení, který se kreslí na serveru a systémové písmo nevidí. Písmo, které
 * má `next/og` v sobě, nemá českou diakritiku: „č“ a „ě“ se braly z náhradního
 * písma a mezery mezi slovy vycházely každá jinak (24–37 px, nález z revize
 * redesignu). Náhradní písmo si navíc knihovna stahovala za běhu ze sítě.
 *
 * Soubory jsou podmnožina (latinka + Latin-1 + Latin Extended-A, cca 38 kB
 * každý) statických řezů z vydání Inter 4.1, bez hintingu:
 *
 *   pyftsubset InterDisplay-SemiBold.ttf --no-hinting --desubroutinize \
 *     --unicodes="U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2015,U+2018-201E,U+2026,U+2030,U+2032,U+2033,U+2039,U+203A,U+20AC,U+2212" \
 *     --layout-features="kern,locl,ccmp,mark,mkmk"
 *
 * Musí to být statické TTF/OTF/WOFF: satori neumí WOFF2 ani variabilní písmo.
 * Čte se jednou při načtení modulu, ne při každém požadavku; cestu složenou
 * od `process.cwd()` umí trasování souborů Nextu dohledat a přibalit k funkci
 * i do samostatného buildu pro Docker. Formát, velikost, českou abecedu a to,
 * že vykreslení nesahá na síť, hlídá `test/seo-metadata.test.ts`.
 */
const FONT_FAMILY = 'Inter Display';
const FONT_DIR = join(process.cwd(), 'assets', 'og');
const FONTS = [
  {
    name: FONT_FAMILY,
    data: await readFile(join(FONT_DIR, 'InterDisplay-Regular.ttf')),
    weight: 400 as const,
    style: 'normal' as const,
  },
  {
    name: FONT_FAMILY,
    data: await readFile(join(FONT_DIR, 'InterDisplay-SemiBold.ttf')),
    weight: 600 as const,
    style: 'normal' as const,
  },
];

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: BACKGROUND,
        color: INK,
        padding: '72px 80px',
        fontFamily: FONT_FAMILY,
      }}
    >
      {/* značka: akcentní tečka (nákup) + linie dneška = „d“, stejná geometrie jako components/logo.tsx */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 76 }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: ACCENT }} />
          <div
            style={{
              width: 16,
              height: 76,
              borderRadius: 8,
              backgroundColor: INK,
              marginLeft: -9,
            }}
          />
        </div>
        <div style={{ marginLeft: 24, fontSize: 56, fontWeight: 600, letterSpacing: '-0.02em' }}>
          {SITE_NAME}
        </div>
      </div>

      {/* tytéž dvě věty jako titulek úvodní stránky, druhá tišší — obrázek
          nemá říkat nic, co web neříká (do 10. 10. 2026 nesl starý slogan) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 72,
          lineHeight: 1.12,
          fontWeight: 600,
          letterSpacing: '-0.025em',
        }}
      >
        <div>{SITE_TAGLINE}</div>
        <div style={{ color: INK_MUTED }}>{SITE_TAGLINE_HOW}</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', fontSize: 30, color: INK_MUTED }}>
        <div style={{ width: 72, height: 6, borderRadius: 3, backgroundColor: ACCENT }} />
        <div style={{ marginLeft: 20 }}>{new URL(SITE_URL).host}</div>
      </div>
    </div>,
    { ...size, fonts: FONTS },
  );
}
