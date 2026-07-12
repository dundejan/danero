'use client';

import { useEffect, useState } from 'react';

/**
 * Toast po akcích (G9b): vykresluje hlášku z query parametrů (?ok= / ?chyba=),
 * po 6 s se sám schová (chybové zůstávají). Server actions dál fungují bez JS —
 * toast je jen progressive enhancement nad stávajícími bannery.
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
    const url = new URL(window.location.href);
    if (url.searchParams.has('ok') || url.searchParams.has('chyba') || url.searchParams.has('ulozeno')) {
      url.searchParams.delete('ok');
      url.searchParams.delete('chyba');
      url.searchParams.delete('ulozeno');
      window.history.replaceState(null, '', url);
    }
    if (kind !== 'ok') return;
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [kind]);
  if (!visible) return null;
  return (
    <p
      role={kind === 'chyba' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${
        kind === 'ok' ? 'border-zelena text-zelena-text' : 'border-cervena text-cervena'
      }${floating ? ' fixed bottom-4 right-4 z-50 max-w-sm bg-plocha shadow-lg' : ''}`}
    >
      {text}
      <button
        type="button"
        onClick={() => setVisible(false)}
        className="float-right ml-3 font-bold opacity-60 hover:opacity-100"
        aria-label="Zavřít"
      >
        ×
      </button>
    </p>
  );
}
