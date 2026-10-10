import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Seskupený seznam: řádky pod sebou oddělené vlásovou linkou — základní
 * stavební kámen stránek aplikace místo „karet“. Dvě podoby:
 *
 * - `plain` (výchozí) — řádky leží přímo na ploše stránky; pro seznamy, které
 *   jsou hlavním obsahem (limity, kontroly, upozornění, rozpad výpočtu).
 * - `inset` — tichá zaoblená výplň (`canvas`) jako skupina v Nastavení
 *   systému; pro formuláře a nastavení, kde skupina drží pohromadě ovládací
 *   prvky, a pro obsah sheetu.
 *
 * `title` je popisek skupiny nad ní, `footer` tichá věta pod ní.
 */
export function Group({
  variant = 'plain',
  title,
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & {
  variant?: 'plain' | 'inset';
  title?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const list = (
    <div
      role="list"
      className={cn(
        'divide-y divide-line/70',
        // ve sheetu leží skupina na materiálu, ne na ploše stránky — o stupeň výš
        variant === 'inset' &&
          'rounded-xl bg-canvas px-4 dark:in-[.material-sheet]:bg-control',
        !title && !footer && className,
      )}
      {...props}
    >
      {children}
    </div>
  );
  if (!title && !footer) return list;
  return (
    <div className={className}>
      {title && (
        <p
          className={cn(
            'type-footnote pb-2 font-medium text-ink-muted',
            variant === 'inset' && 'px-4',
          )}
        >
          {title}
        </p>
      )}
      {list}
      {footer && (
        <p className={cn('type-caption pt-2 text-ink-muted', variant === 'inset' && 'px-4')}>
          {footer}
        </p>
      )}
    </div>
  );
}

/**
 * Řádek skupiny: popisek vlevo, hodnota (nebo ovládací prvek) vpravo.
 *
 * - `hint` je tichý druhý řádek pod popiskem (pár slov, ne odstavec),
 * - `info` je `InfoPopover` hned za popiskem,
 * - `href` udělá z celého řádku odkaz se šipkou (pak do něj nepatří `info`
 *   ani jiný ovládací prvek),
 * - `strong` zvýrazní součtový řádek,
 * - `children` jdou vpravo místo `value` (přepínač, tlačítko, select).
 */
export function Row({
  label,
  hint,
  info,
  value,
  href,
  strong = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  info?: React.ReactNode;
  value?: React.ReactNode;
  href?: string;
  strong?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn('inline-flex items-center gap-1', strong && 'font-semibold')}>
          {label}
          {info}
        </span>
        {hint && <span className="type-footnote block text-ink-muted">{hint}</span>}
      </span>
      {(value != null || children) && (
        <span
          className={cn(
            'shrink-0 text-right tabular-nums',
            strong ? 'font-semibold text-ink' : href ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {value}
          {children}
        </span>
      )}
      {href && (
        <span aria-hidden className="text-ink-muted">
          ›
        </span>
      )}
    </>
  );
  const classes = cn('flex min-h-11 items-center gap-4 py-2.5', className);
  if (href) {
    return (
      <div role="listitem">
        <Link href={href} className={cn(classes, 'row-pressable -mx-2 rounded-lg px-2 hover:bg-(--highlight)')}>
          {body}
        </Link>
      </div>
    );
  }
  return (
    <div role="listitem" className={classes}>
      {body}
    </div>
  );
}
