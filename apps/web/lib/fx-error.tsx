import { OPERATOR } from '@/lib/contact';
import Link from 'next/link';
import { EngineError } from '@danero/engine';

/**
 * Selhání výpočtu, které umíme uživateli vysvětlit: EngineError (typicky
 * FX_RATE_MISSING — chybí jednotný i denní kurz pro měnu/rok). Stránky ho
 * chytají a místo pádu do error boundary ukážou kartu s vysvětlením;
 * cokoli jiného (bug) se vyhazuje dál.
 */
export function engineErrorMessage(error: unknown): string | null {
  return error instanceof EngineError ? error.message : null;
}

/** Karta místo spadlé stránky: co se stalo (z chyby enginu) a co s tím jde dělat. */
export function EngineErrorCard({ message }: { message: string }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 pt-24">
      <h1 className="font-display text-3xl font-bold">Výpočet teď nejde dokončit</h1>
      <p className="text-sm text-inkoust-tlumeny">{message}</p>
      <p className="text-sm text-inkoust-tlumeny">
        Nejčastější příčina: pro některou měnu nemáme jednotný kurz (tabulku vyhlašuje finanční
        správa jen pro hlavní měny). Pomůže přepnout přepočet na denní kurzy ČNB v{' '}
        <Link href="/nastaveni" className="font-medium text-ruzova">
          Nastavení
        </Link>{' '}
        — stáhnou se automaticky. Pokud potíž trvá, napiš nám na{' '}
        <a href={`mailto:${OPERATOR.email}`} className="font-medium text-ruzova">
          {OPERATOR.email}
        </a>
        .
      </p>
    </div>
  );
}
