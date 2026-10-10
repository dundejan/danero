import Link from 'next/link';
import { EngineError } from '@danero/engine';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { TextLink } from '@/components/ui/link';
import { OPERATOR } from '@/lib/contact';

/**
 * Selhání výpočtu, které umíme uživateli vysvětlit: EngineError (typicky
 * FX_RATE_MISSING — chybí jednotný i denní kurz pro měnu/rok). Stránky ho
 * chytají a místo pádu do error boundary ukážou stav s vysvětlením;
 * cokoli jiného (bug) se vyhazuje dál.
 */
export function engineErrorMessage(error: unknown): string | null {
  return error instanceof EngineError ? error.message : null;
}

/**
 * Stav místo spadlé stránky: co se stalo a jak z toho ven. Stránka v něm nemá
 * nástrojovou lištu, takže nadpis první úrovně nese on. Vidět je cesta ven
 * (nejčastější příčina a její řešení); přesné znění chyby z enginu je na
 * požádání — je to údaj pro podporu, ne pro rozhodnutí.
 */
export function EngineErrorCard({ message }: { message: string }) {
  return (
    <EmptyState
      headingAs="h1"
      title="Výpočet teď nejde dokončit"
      action={
        <>
          <Link href="/nastaveni" className={buttonVariants()}>
            Otevřít nastavení
          </Link>
          <TextLink href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</TextLink>
        </>
      }
      note={
        <Disclosure summary="Co přesně se stalo" className="text-left">
          <span className="block max-w-[28rem] text-pretty">{message}</span>
        </Disclosure>
      }
    >
      <p>
        Nejčastěji chybí jednotný kurz některé měny — finanční správa ho vyhlašuje jen pro
        hlavní měny. V Nastavení přepni přepočet na denní kurzy ČNB, stáhnou se samy.
      </p>
      <p>Když to nepomůže, napiš nám.</p>
    </EmptyState>
  );
}
