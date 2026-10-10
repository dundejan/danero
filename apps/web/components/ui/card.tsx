import { cn } from '@/lib/utils';

/**
 * Skupina obsahu. Bez rámečku a bez stínu — od okolí ji odlišuje jen tichá
 * výplň (`canvas`), stejně jako seskupené sekce v Nastavení systému.
 * Na přehledu se nepoužívá vůbec; slouží stránkám, kde obsah tvoří formuláře.
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

/** Titulek skupiny: běžná věta, váha místo verzálek. */
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
