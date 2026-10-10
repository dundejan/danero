import { cn } from '@/lib/utils';

/**
 * Tabulka dat po vzoru Numbers a Akcií: žádné svislé čáry, žádná zebra,
 * řádky dělí jen vlásová linka. Záhlaví je tiché (malé, šedé, bez verzálek),
 * čísla jsou tabulková a zarovnaná vpravo, text vlevo — sloupce drží
 * zarovnání, ne rámečky.
 */
export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <table
      className={cn('w-full text-sm tabular-nums', className)}
      {...props}
    />
  );
}

type Align = 'left' | 'right';

export function Th({
  align = 'left',
  className,
  ...props
}: React.ComponentProps<'th'> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        'type-caption whitespace-nowrap pb-2 pr-6 font-medium text-ink-muted last:pr-0',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    />
  );
}

/** Řádek těla: vlásová linka nad řádkem (první zároveň podtrhává záhlaví). */
export function Tr({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr className={cn('border-t border-line/70', className)} {...props} />;
}

export function Td({
  align = 'left',
  className,
  ...props
}: React.ComponentProps<'td'> & { align?: Align }) {
  return (
    <td
      className={cn(
        'py-2.5 pr-6 align-baseline last:pr-0',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  );
}
