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
 *
 * Děti jsou `Row`, `FieldRow`, `DisclosureRow` a `GroupItem` — každé nese roli
 * `listitem`, skupina je pro čtečku seznam.
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
 * - `wrap` dovolí hodnotě zalomit se — pro hodnotu, která je věta („daněna
 *   jako dividenda (bezpečný výklad)“); částky a krátké údaje ji nepotřebují,
 * - `children` jdou vpravo místo `value` (přepínač, tlačítko, select).
 *
 * Hodnotu, která se vedle popisku nevejde (dlouhý e-mail, název souboru,
 * částka při zvětšeném písmu), řádek složí pod popisek — nezkracuje ji ani
 * nenechá vytéct ze stránky. Místní `max-w-…` a `truncate` na hodnotě proto
 * nepiš.
 */
export function Row({
  label,
  hint,
  info,
  value,
  href,
  strong = false,
  wrap = false,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  info?: React.ReactNode;
  value?: React.ReactNode;
  href?: string;
  strong?: boolean;
  wrap?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  // Pojistky proti dlouhému obsahu (hodnota je e-mail o sto znacích, částka
  // při dvojnásobném písmu, popisek jedno nekonečné slovo):
  // - popisek si drží aspoň 30 % řádku a hodnota se mu nikdy nevykreslí přes
  //   text — když se vedle něj nevejde, spadne na vlastní řádek (zarovnaná
  //   vpravo) a nic se neusekne;
  // - co se nevejde ani tam, se zalomí kdekoli (`wrap-anywhere`), takže řádek
  //   nikdy neroztáhne stránku. Zkracování třemi tečkami tu schválně není:
  //   useknutou částku nebo adresu by na dotyku nešlo přečíst nikde.
  const body = (
    <>
      <span
        className={
          wrap ? 'max-w-[45%] min-w-0 shrink-0 wrap-anywhere' : 'min-w-[30%] flex-1 wrap-anywhere'
        }
      >
        <span className={cn('inline-flex items-center gap-1', strong && 'font-semibold')}>
          {label}
          {info}
        </span>
        {hint && <span className="type-footnote block text-ink-muted">{hint}</span>}
      </span>
      {(value != null || children || href) && (
        // hodnota a šipka odkazu drží pohromadě — šipka nesmí spadnout sama
        <span
          className={cn(
            'flex min-w-0 items-baseline gap-4',
            wrap ? 'flex-1' : 'ml-auto max-w-full',
          )}
        >
          {(value != null || children) && (
            <span
              className={cn(
                'min-w-0 flex-1 text-right tabular-nums wrap-anywhere',
                wrap && 'text-pretty',
                strong ? 'font-semibold text-ink' : href ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {value}
              {children}
            </span>
          )}
          {href && (
            <span aria-hidden className="shrink-0 text-ink-muted">
              ›
            </span>
          )}
        </span>
      )}
    </>
  );
  const classes = cn(
    'flex min-h-11 gap-x-4 gap-y-0.5 py-2.5',
    wrap ? 'items-baseline' : 'flex-wrap items-center',
    className,
  );
  if (href) {
    return (
      <div role="listitem">
        <Link href={href} className={cn(classes, 'row-hover row-pressable -mx-2 rounded-lg px-2')}>
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

/**
 * Položka skupiny s volným obsahem: něco, co není „popisek — hodnota“ ani
 * rozbalovací řádek (soubor s formulářem pod ním, limit s odměrkou). Drží jen
 * roli a svislý rytmus řádku; obsah si skládá volající.
 */
export function GroupItem({ className, ...props }: React.ComponentProps<'div'>) {
  return <div role="listitem" className={cn('py-3.5', className)} {...props} />;
}

/**
 * Řádek skupiny s polem nebo nabídkou: popisek vlevo, ovládací prvek vpravo —
 * a v úzkém okně pod sebou, protože pole s textem se vedle popisku na telefon
 * nevejde. (`Row` se neskládá, drží jeden řádek; pro přepínač, tlačítko
 * a krátkou hodnotu je dál správný on.)
 *
 * Šířku rozhoduje okno s obsahem — stránka kolem skupiny potřebuje
 * `@container`.
 *
 * - `htmlFor` páruje popisek s polem; bez něj je popisek obyčejný text
 *   (skupina zaškrtávátek si název bere přes `labelId` a `aria-labelledby`),
 * - `hint` je tichá věta pod popiskem, `hintId` ji naváže na pole přes
 *   `aria-describedby`,
 * - `info` je `InfoPopover` s celým výkladem,
 * - `fit` nechá ovládacímu prvku jeho vlastní šířku (řada přepínacích
 *   políček); výchozí je pevný sloupec, aby pole pod sebou lícovala.
 *
 * Řádek je skupina `group/field-row`: text nápovědy se tak může měnit podle
 * vybrané volby bez JavaScriptu (`group-has-[option:checked]/field-row:…`).
 */
export function FieldRow({
  label,
  htmlFor,
  labelId,
  info,
  hint,
  hintId,
  fit = false,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  labelId?: string;
  info?: React.ReactNode;
  hint?: React.ReactNode;
  hintId?: string;
  fit?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        'group/field-row flex flex-col gap-x-6 gap-y-2 py-3 text-ink @lg:min-h-11 @lg:flex-row @lg:items-center @lg:py-2.5',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1">
          {htmlFor ? (
            <label htmlFor={htmlFor} id={labelId}>
              {label}
            </label>
          ) : (
            <span id={labelId}>{label}</span>
          )}
          {info}
        </span>
        {hint && (
          <div id={hintId} className="type-footnote text-pretty text-ink-muted">
            {hint}
          </div>
        )}
      </div>
      {/* pevný sloupec se smí zúžit: v úzkém sloupci (dvě skupiny vedle sebe)
          by pole s plnou šířkou vyjelo ze skupiny */}
      <div className={cn('max-w-full min-w-0', fit ? 'shrink-0' : '@lg:w-64')}>{children}</div>
    </div>
  );
}
