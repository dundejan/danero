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
        <div style={{ marginLeft: 24, fontSize: 56, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {SITE_NAME}
        </div>
      </div>

      {/* tytéž dvě věty jako titulek úvodní stránky, druhá tišší — obrázek
          nemá říkat nic, co web neříká (do 10. 10. 2026 nesl starý slogan) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: 70,
          lineHeight: 1.15,
          // bez záporného prostrkání: satori ho nerozloží rovnoměrně a mezery
          // mezi slovy pak vyjdou každá jinak
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
    size,
  );
}
