'use client';

import { useEffect, useState } from 'react';
import { IMPORT_FEEDBACK_PARAMS } from '@/lib/import-feedback';
import { cn } from '@/lib/utils';

/**
 * Parametry, které nesou hlášku: kód výsledku a u /import i údaje k němu
 * (počty, id dávky…). Mažou se všechny naráz — samotný kód nestačí, zbytek by
 * v adrese zůstal viset.
 */
const FEEDBACK_PARAMS = ['ok', 'chyba', 'ulozeno', ...IMPORT_FEEDBACK_PARAMS];

/**
 * Adresa bez parametrů hlášky; `null`, když v ní žádný není (pak se historie
 * prohlížeče nepřepisuje vůbec). Kotva a ostatní parametry zůstávají.
 */
export function urlWithoutFeedback(href: string): string | null {
  const url = new URL(href);
  if (!FEEDBACK_PARAMS.some((name) => url.searchParams.has(name))) return null;
  for (const name of FEEDBACK_PARAMS) url.searchParams.delete(name);
  return url.toString();
}

/**
 * Toast po akcích (G9b): vykresluje hlášku z query parametrů (?ok= / ?chyba=),
 * po 6 s se sám schová (chybový po 15 s). Server actions dál fungují bez JS —
 * hláška se vykreslí už na serveru, JavaScript ji jen uklidí.
 *
 * Proto to není knihovní toast volaný z klienta: výsledek akce přichází
 * přesměrováním, ne událostí v prohlížeči.
 *
 * Stav nese barevná tečka a role (`status` / `alert`), text je běžným
 * inkoustem — dlouhá chybová hláška se má dát přečíst. Plovoucí varianta je
 * neprůsvitná plocha se stínem (jedna z mála věcí, které se opravdu vznášejí),
 * řádková varianta tichý panel v toku stránky.
 */
export function Toast({
  kind,
  text,
  floating = false,
}: {
  kind: 'ok' | 'chyba';
  text: string;
  /** Plovoucí varianta (pravý dolní roh) — vidět i po skoku na kotvu sekce. */
  floating?: boolean;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    // hláška patří k právě provedené akci — z URL ji smaž, ať ji reload
    // ani tlačítko zpět neukáže znovu (bez RSC refetche)
    const cleaned = urlWithoutFeedback(window.location.href);
    if (cleaned !== null) window.history.replaceState(null, '', cleaned);
    // H-3-06: chybový toast se dřív sám nikdy neschoval — jediná cesta ven byl
    // křížek o velikosti 8 × 20 px, který navíc na mobilu ležel přes tab bar.
    // Chyba má být vidět déle než potvrzení, ale ne napořád.
    const timer = setTimeout(() => setVisible(false), kind === 'ok' ? 6000 : 15000);
    return () => clearTimeout(timer);
  }, [kind]);
  if (!visible) return null;
  return (
    <div
      role={kind === 'chyba' ? 'alert' : 'status'}
      className={cn(
        'type-callout flex items-start gap-2.5 rounded-xl py-3 pl-4 pr-2 text-ink',
        floating
          ? // H-3-06: nad mobilním tab barem (lišta + bezpečná zóna gesta), ne přes
            // něj — plovoucí toast dřív zakrýval 24 ze 40 px navigace včetně popisků
            'toast-enter fixed inset-x-4 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom,0px)+0.75rem)] z-50 bg-surface shadow-floating sm:inset-x-auto sm:right-4 sm:max-w-sm md:bottom-4 dark:bg-control'
          : 'bg-canvas',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-[0.45em] size-2 shrink-0 rounded-full',
          kind === 'ok' ? 'bg-success' : 'bg-danger',
        )}
      />
      <p className="min-w-0 flex-1 text-pretty">{text}</p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        // SC 2.5.8: cíl aspoň 24 × 24 px — křížek měl 8 × 20 px a u chybového
        // toastu to byla jediná cesta ven (H-3-22); na dotyku 44 px
        className="-my-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-(--highlight) hover:text-ink active:bg-(--highlight-pressed) pointer-coarse:hit-area"
        aria-label="Zavřít"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className="size-3 fill-none stroke-current"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}

