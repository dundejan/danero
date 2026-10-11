import Link from 'next/link';
import { Logo } from '@/components/logo';
import { typeset } from '@/components/typeset';
import { cn } from '@/lib/utils';

/**
 * Skořápka stránky s jediným formulářem mimo aplikaci (přihlášení, registrace,
 * zapomenuté heslo, ověření e-mailu): úzký sloupec uprostřed okna, nahoře
 * logo (cesta zpět na úvod), titulek, formulář a pod ním tiché odkazy.
 *
 * Žádný panel kolem formuláře — pole stojí přímo na ploše stránky. Titulek je
 * jediný nadpis první úrovně; `lede` je nejvýš jedna věta (typicky odkaz na
 * druhou cestu: „Nemáš účet? Zaregistruj se“). `footer` jsou odkazy pod
 * formulářem.
 */
export function FormPage({
  title,
  lede,
  footer,
  className,
  children,
}: {
  title: string;
  lede?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex min-h-svh w-full max-w-[24rem] flex-col justify-center px-5 py-12',
        className,
      )}
    >
      <Link
        href="/"
        className="-my-2 mb-8 inline-flex min-h-11 items-center self-start"
        aria-label="Danero — na úvodní stránku"
      >
        <Logo className="text-[1.0625rem]" />
      </Link>
      <h1 className="type-title-1 text-balance">{typeset(title)}</h1>
      {/* Odkaz ve větě si na dotyku bere neviditelnou plochu 44 px (řádek textu
          se nehýbe); samostatný odkaz pod formulářem je 44 px vysoký celý —
          bez toho měl cíl 16 px (R1A-16). Odkazy ve větě v patičce (souhlas
          s podmínkami při registraci) zůstávají řádkové. */}
      {lede && (
        <p className="type-callout mt-2 text-ink-muted pointer-coarse:[&_a]:hit-area">
          {typeset(lede)}
        </p>
      )}
      <div className="mt-8">{children}</div>
      {footer && (
        <div className="type-callout mt-6 text-ink-muted pointer-coarse:[&>a]:inline-flex pointer-coarse:[&>a]:min-h-11 pointer-coarse:[&>a]:items-center">
          {footer}
        </div>
      )}
    </main>
  );
}
