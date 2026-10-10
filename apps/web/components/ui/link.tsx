import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Textový odkaz v akcentní barvě — „Jak Danero počítá ›“. Šipka říká, že
 * odkaz někam vede (na jinou stránku), a je jen ozdoba (`aria-hidden`).
 * Na dotyku má řádek 44 px na výšku, s myší je to běžný řádek textu.
 *
 * Vnější adresa (`http…`, `mailto:`) se otevře obyčejným `<a>`; `external`
 * přidá nové okno.
 */
export function TextLink({
  href,
  children,
  chevron = false,
  external = false,
  className,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & {
  href: string;
  /** Šipka „›“ za textem — pro odkaz, který stojí sám (ne uprostřed věty). */
  chevron?: boolean;
  /** Otevřít v novém okně (cizí web). */
  external?: boolean;
}) {
  const classes = cn(
    'font-medium text-accent-text active:opacity-60',
    // Odkaz uprostřed věty musí být poznat i bez barvy (WCAG 1.4.1) — je
    // podtržený. Samostatný odkaz se šipkou podtržení dostane až pod myší.
    chevron
      ? 'inline-flex min-h-11 items-center hover:underline md:min-h-0'
      : 'underline underline-offset-2',
    className,
  );
  const content = (
    <>
      {children}
      {chevron && (
        <span aria-hidden className="ml-1">
          ›
        </span>
      )}
    </>
  );
  if (external || /^(https?:|mailto:)/.test(href)) {
    return (
      <a
        href={href}
        className={classes}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        {...props}
      >
        {content}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...props}>
      {content}
    </Link>
  );
}
