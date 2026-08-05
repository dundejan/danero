import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

/**
 * Zamčená placená funkce (docs/19). Pravidlo pro texty: řekni, co funkce dělá
 * a co stojí — žádné „upgradujte nyní" a žádná šedá zamčená obrazovka.
 */
export function PaywallCard({
  title,
  body,
  price,
  cta = 'Zobrazit ceník',
}: {
  title: string;
  body: React.ReactNode;
  price: string;
  cta?: string;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-linka bg-plocha p-8 text-center">
      <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-inkoust-tlumeny">{body}</p>
      <p className="mt-4 font-display text-lg font-semibold">{price}</p>
      <Link href="/cenik" className={`${buttonVariants({ variant: 'primary' })} mt-5`}>
        {cta}
      </Link>
      <p className="mt-4 text-xs text-inkoust-tlumeny">
        Import výpisů i přehled limitů a časových testů máš zdarma dál — placené je
        jen tohle.
      </p>
    </div>
  );
}
