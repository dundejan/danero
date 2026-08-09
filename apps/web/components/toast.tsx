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
    // H-3-06: chybový toast se dřív sám nikdy neschoval — jediná cesta ven byl
    // křížek o velikosti 8 × 20 px, který navíc na mobilu ležel přes tab bar.
    // Chyba má být vidět déle než potvrzení, ale ne napořád.
    const timer = setTimeout(() => setVisible(false), kind === 'ok' ? 6000 : 15000);
    return () => clearTimeout(timer);
  }, [kind]);
  if (!visible) return null;
  return (
    <p
      role={kind === 'chyba' ? 'alert' : 'status'}
      className={`rounded-md border px-4 py-3 text-sm ${
        kind === 'ok' ? 'border-zelena text-zelena-text' : 'border-cervena text-cervena'
      }${
        floating
          ? // H-3-06: nad mobilním tab barem (40 px + bezpečná zóna gesta), ne přes
            // něj — plovoucí toast dřív zakrýval 24 ze 40 px navigace včetně popisků
            ' fixed inset-x-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 max-w-sm' +
            ' bg-plocha shadow-lg sm:inset-x-auto sm:right-4 md:bottom-4'
          : ''
      }`}
    >
      {text}
      <button
        type="button"
        onClick={() => setVisible(false)}
        // bez opacity: průhlednost srazí kontrast pod AA (text-cervena/60 dá na
        // --plocha jen 2,8:1) a tohle je ovládací prvek, ne dekorace
        // SC 2.5.8: cíl aspoň 24 × 24 px — křížek měl 8 × 20 px a u chybového
        // toastu to byla jediná cesta ven (H-3-22)
        className="float-right -mr-1 -mt-1 ml-3 inline-flex h-6 w-6 items-center justify-center font-bold"
        aria-label="Zavřít"
      >
        ×
      </button>
    </p>
  );
}
