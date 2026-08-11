import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Nastavení má tři stránky: jak Danero počítá, co posílá e-mailem a účet.
 * Dokud stálo všechno pod sebou ve dvou sloupcích, byl pravý sloupec dvakrát
 * vyšší než levý a na jednu obrazovku toho bylo tolik, že se v tom nedalo
 * vyznat.
 *
 * Vizuálně schválně NE pilulka: sytá pilulka je v aplikaci přepínač obsahu
 * (roky v přehledu, graf/tabulka), tohle je navigace mezi stránkami.
 */
const SECTIONS = [
  /** `short`: na úzkém displeji se všechny tři musí vejít do jednoho řádku. */
  { key: 'tax', href: '/nastaveni', label: 'Daň a výpočet', short: 'Daň' },
  { key: 'notifications', href: '/nastaveni/upozorneni', label: 'Upozornění', short: 'Upozornění' },
  { key: 'account', href: '/nastaveni/ucet', label: 'Účet a zabezpečení', short: 'Účet' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['key'];

export function SettingsNav({ active }: { active: SettingsSection }) {
  return (
    /*
     * Žádné `overflow-x-auto`: podle CSS se druhá osa dopočítá na `auto`, takže
     * lišta dostala i SVISLÝ posuvník — a stačilo k tomu jedno záporné `-mb-px`
     * u aktivní záložky. Na displeji s klasickými posuvníky z toho byly dvě
     * šipky vpravo nahoře. Do řádku se vejdou i na mobilu díky `short`.
     */
    <nav aria-label="Sekce nastavení" className="flex gap-1 border-b border-linka">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === active ? 'page' : undefined}
          className={cn(
            // -mb-px: podtržení aktivní záložky leží PŘESNĚ na lince navigace,
            // jinak jsou pod ní 2 px růžové a hned pod nimi 1 px šedé
            '-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors',
            section.key === active
              ? 'border-ruzova font-semibold text-ruzova-text'
              : 'border-transparent text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          <span className="sm:hidden">{section.short}</span>
          <span className="hidden sm:inline">{section.label}</span>
        </Link>
      ))}
    </nav>
  );
}
