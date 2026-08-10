import Link from 'next/link';
import { OPERATOR } from '@/lib/contact';

/**
 * Povinná patička nabídky i objednávky — kdo prodává, že cena je konečná
 * a kam se kouknout na odstoupení.
 *
 * Je to komponenta, ne text opsaný na třech místech: § 1820 odst. 1 OZ chce
 * tyhle údaje PŘED uzavřením smlouvy, takže je nese přehled tarifů i obě
 * objednávkové stránky — a tři kopie jednoho právního odstavce se rozejdou
 * stejně spolehlivě jako tři kopie ceníku (viz `lib/plans.ts`).
 *
 * Telefon a adresa se sem nevypisují: preferovaný kanál je psaní a plné znění
 * má jediné místo (`/podminky#kontakt`), kam vede přímý odkaz.
 */
export function PurchaseLegalNote() {
  return (
    <p className="text-xs leading-relaxed text-inkoust-tlumeny">
      Ceny jsou konečné. Prodávající: {OPERATOR.name}, IČO {OPERATOR.ico} — není plátcem DPH.{' '}
      <Link
        href="/podminky#kontakt"
        className="font-medium text-ruzova-text underline underline-offset-2"
      >
        Adresa a telefon prodávajícího
      </Link>
      . Podrobnosti o odstoupení od smlouvy najdeš v{' '}
      <Link href="/odstoupeni" className="font-medium text-ruzova-text underline underline-offset-2">
        poučení o odstoupení
      </Link>{' '}
      a v{' '}
      <Link href="/podminky" className="font-medium text-ruzova-text underline underline-offset-2">
        podmínkách užití
      </Link>
      .
    </p>
  );
}
