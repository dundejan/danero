import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-linka bg-plocha p-5', className)}
      {...props}
    />
  );
}

/**
 * Symbol měny se neverzálkuje — titulek je CSS uppercase, ale „Kč“ v něm musí
 * zůstat „Kč“ (ne „KČ“). U textových titulků to řešíme centrálně tady.
 */
export function keepCurrencyCase(children: React.ReactNode): React.ReactNode {
  if (typeof children !== 'string' || !children.includes('Kč')) return children;
  return children.split('Kč').flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <span key={`kc-${index}`} className="normal-case">
            Kč
          </span>,
          part,
        ],
  );
}

export function CardTitle({
  className,
  children,
  as: Tag = 'h2',
  ...props
}: React.ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'p' }) {
  return (
    <Tag
      className={cn('text-sm font-semibold uppercase tracking-wide text-inkoust-tlumeny', className)}
      {...props}
    >
      {keepCurrencyCase(children)}
    </Tag>
  );
}
