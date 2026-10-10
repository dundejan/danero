import { cn } from '@/lib/utils';

/**
 * Odkaz na kotvu na téže stránce. Vypadá jako `TextLink`, ale je to obyčejné
 * `<a>`: `TextLink` jde přes směrovač Nextu a ten při změně samotné kotvy
 * nevyvolá `hashchange` — `OpenOnHash` by se pak nedozvěděl, že má cílový
 * rozbalovací řádek otevřít.
 */
export function AnchorLink({
  href,
  chevron = false,
  className,
  children,
}: {
  href: `#${string}`;
  /** Šipka „›“ za textem — pro odkaz, který stojí sám (ne uprostřed věty). */
  chevron?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={cn(
        'font-medium text-accent-text active:opacity-60',
        chevron
          ? 'inline-flex min-h-11 items-center hover:underline md:min-h-0'
          : 'underline underline-offset-2',
        className,
      )}
    >
      {children}
      {chevron && (
        <span aria-hidden className="ml-1">
          ›
        </span>
      )}
    </a>
  );
}
