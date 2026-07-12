'use client';

import Link from 'next/link';
import { useState } from 'react';

/**
 * Mikro-nástroj (docs/12): datum nákupu → den, od kterého je prodej osvobozený
 * časovým testem (§ 4 odst. 1 písm. t) — „déle než 3 roky", tedy první bezpečný
 * den je den PO třetím výročí nabytí. Čistě klientské, nic se neukládá;
 * „Přidat do kalendáře" generuje ICS soubor v prohlížeči.
 */

/** ISO datum + celé roky/dny; přestupné 29. 2. řeší Date přetečením (→ 1. 3.). */
function addYears(iso: string, years: number): Date {
  // volající hlídá tvar regexem — defaulty jen pro typovou úplnost
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const CZ_DATE = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function icsDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Obsah .ics souboru s celodenní událostí „prodej bez daně". */
function buildIcs(freedom: Date, label: string): string {
  const title = label ? `${label}: prodej bez daně (časový test splněn)` : 'Prodej bez daně (časový test splněn)';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Danero//kalkulacka-casoveho-testu//CS',
    'BEGIN:VEVENT',
    `UID:${icsDate(freedom)}-${label.replaceAll(/[^A-Za-z0-9]/g, '') || 'danero'}@danero.cz`,
    `DTSTAMP:${icsDate(freedom)}T000000Z`,
    `DTSTART;VALUE=DATE:${icsDate(freedom)}`,
    `SUMMARY:${title}`,
    'DESCRIPTION:Od tohoto dne je prodej osvobozený tříletým časovým testem (počítáno ode dne nabytí). Orientační výpočet z kalkulačky danero.cz — rozhodné je skutečné datum nabytí (zpravidla vypořádání obchodu).',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function KalkulackaCasovehoTestu() {
  const [nakup, setNakup] = useState('');
  const [label, setLabel] = useState('');

  const dnes = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const platny = /^\d{4}-\d{2}-\d{2}$/.test(nakup) && nakup <= dnes.toISOString().slice(0, 10);
  const vyroci = platny ? addYears(nakup, 3) : null;
  // „déle než 3 roky“ — přesně na výročí ještě ne, první bezpečný den je den po něm
  const svoboda = vyroci ? addDays(vyroci, 1) : null;
  const zbyvaDni = svoboda
    ? Math.ceil((svoboda.getTime() - dnes.getTime()) / 86_400_000)
    : null;

  const stahnoutIcs = () => {
    if (!svoboda) return;
    const blob = new Blob([buildIcs(svoboda, label.trim())], {
      type: 'text/calendar;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prodej-bez-dane.ics';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-3xl rounded-lg border border-linka bg-plocha p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ct-nakup" className="text-sm font-medium">
            Kdy jsi kupoval?
          </label>
          <p className="mt-0.5 text-xs text-inkoust-tlumeny">
            Den nabytí — zpravidla den vypořádání obchodu.
          </p>
          <input
            id="ct-nakup"
            type="date"
            value={nakup}
            max={dnes.toISOString().slice(0, 10)}
            onChange={(event) => setNakup(event.target.value)}
            className="mt-2 w-full rounded-md border border-inkoust/25 bg-plocha px-3 py-2.5 text-sm shadow-sm outline-none focus:border-ruzova"
          />
        </div>
        <div>
          <label htmlFor="ct-label" className="text-sm font-medium">
            Co to je? <span className="font-normal text-inkoust-tlumeny">(nepovinné)</span>
          </label>
          <p className="mt-0.5 text-xs text-inkoust-tlumeny">
            Třeba „NVDA" nebo „ETF na S&amp;P 500" — objeví se v kalendáři.
          </p>
          <input
            id="ct-label"
            type="text"
            value={label}
            maxLength={60}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="NVDA"
            className="mt-2 w-full rounded-md border border-inkoust/25 bg-plocha px-3 py-2.5 text-sm shadow-sm outline-none focus:border-ruzova"
          />
        </div>
      </div>

      {svoboda && (
        <div role="status" className="mt-6 rounded-md border border-zelena/40 bg-zelena/5 p-4">
          <p className="font-semibold tabular-nums">
            Bez daně můžeš prodat od {CZ_DATE.format(svoboda)}.
          </p>
          <p className="mt-1 text-sm text-inkoust-tlumeny tabular-nums">
            {zbyvaDni !== null && zbyvaDni > 0
              ? `Zbývá ${zbyvaDni} ${zbyvaDni === 1 ? 'den' : zbyvaDni < 5 ? 'dny' : 'dní'}. Tříletá lhůta běží ode dne nabytí a musí uplynout celá — přesně na výročí to ještě není.`
              : 'Tříletá lhůta už uplynula — prodej je osvobozený časovým testem a do přiznání nepatří.'}
          </p>
          {zbyvaDni !== null && zbyvaDni > 0 && (
            <button
              type="button"
              onClick={stahnoutIcs}
              className="mt-3 rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Přidat do kalendáře (.ics)
            </button>
          )}
          <p className="mt-3 text-xs text-inkoust-tlumeny">
            Orientačně pro cenné papíry (akcie, ETF). Přikupoval jsi? Každý nákup má
            vlastní lhůtu — všechny najednou ti pohlídá{' '}
            <Link
              href="/demo/prehled"
              className="font-medium text-ruzova-text underline underline-offset-2"
            >
              Danero
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
