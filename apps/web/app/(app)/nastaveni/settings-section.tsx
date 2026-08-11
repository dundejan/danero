import { cn } from '@/lib/utils';

/**
 * Podsekce uvnitř karty nastavení — nadpis, volitelný popis a obsah.
 *
 * Vzniklo z nesourodosti: každá sekce na stránce účtu měla vlastní ručně psaný
 * nadpis (`<p class="text-sm font-semibold">`), jiné odsazení a jednou i jinou
 * barvu („Smazání účtu“ červeně). Nebezpečné akce teď pozná uživatel podle
 * tlačítka (`variant="danger"`), ne podle barvy nadpisu — červený nadpis
 * v seznamu jinak stejných sekcí vypadal jako chyba, ne jako varování.
 *
 * Linka nahoře je vždycky: první sekce ji má pod titulkem karty (dělá mu
 * hlavičku), další oddělují sekce mezi sebou.
 */
export function SettingsSection({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('space-y-3 border-t border-linka pt-5', className)}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-inkoust">{title}</h3>
        {description && <p className="text-sm text-inkoust-tlumeny">{description}</p>}
      </div>
      {children}
    </section>
  );
}
