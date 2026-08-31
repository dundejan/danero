import { ImageResponse } from 'next/og';
import { SITE_NAME, SITE_URL } from '@/lib/site';

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

export const alt = 'Danero — daně z investic pohlídané celý rok';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Světlé tokeny z `app/globals.css`: `--pozadi`, `--inkoust`, `--inkoust-tlumeny`, `--ruzova`. */
const BACKGROUND = '#f6f5f1';
const INK = '#171930';
const INK_MUTED = '#5a5d78';
const PINK = '#d6336c';

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
      }}
    >
      {/* značka: růžová tečka (nákup) + linie dneška = „d“, stejná geometrie jako components/logo.tsx */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 76 }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: PINK }} />
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
        <div style={{ marginLeft: 24, fontSize: 56, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {SITE_NAME}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 78, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
          Daně z investic hlídáme za tebe.
        </div>
        <div style={{ marginTop: 28, fontSize: 34, color: INK_MUTED }}>
          Limit 100 000 Kč, tříleté časové testy i paušální daň — a v březnu podklady k přiznání.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', fontSize: 30, color: INK_MUTED }}>
        <div style={{ width: 72, height: 6, borderRadius: 3, backgroundColor: PINK }} />
        <div style={{ marginLeft: 20 }}>{new URL(SITE_URL).host}</div>
      </div>
    </div>,
    size,
  );
}
