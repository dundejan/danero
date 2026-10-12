import { cn } from '@/lib/utils';

/**
 * Panel: tichá zaoblená výplň (`canvas`) bez rámečku a bez stínu — stejná
 * plocha jako `Group variant="inset"`. Je to obal pro kus FORMULÁŘE nebo
 * nastavení, který potřebuje držet pohromadě (pole + nápověda + tlačítko).
 *
 * Na obsah ke čtení (čísla, seznamy, tabulky, texty) panel nepatří: ten leží
 * přímo na ploše stránky a člení ho `Section`, `Group` a vzduch. Sdělení
 * („něco chybí“) nese `Notice`, ne obarvený panel — barevný rámeček ani pruh
 * na boku tu nic neudělají.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-xl bg-canvas p-5', className)} {...props} />;
}

/**
 * Zůstává kvůli volajícím, kteří jím obalovali titulky psané verzálkami
 * („Kč“ se nesmělo změnit na „KČ“). Titulky už verzálkami nejsou, takže
 * text vrací beze změny.
 */
export function keepCurrencyCase(children: React.ReactNode): React.ReactNode {
  return children;
}

/** Titulek panelu: běžná věta, váha místo verzálek. */
export function CardTitle({
  className,
  children,
  as: Tag = 'h2',
  ...props
}: React.ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'p' }) {
  return (
    <Tag className={cn('type-title-3 text-ink', className)} {...props}>
      {children}
    </Tag>
  );
}
