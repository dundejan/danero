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
  { key: 'tax', href: '/nastaveni', label: 'Daň a výpočet' },
  { key: 'notifications', href: '/nastaveni/upozorneni', label: 'Upozornění' },
  { key: 'account', href: '/nastaveni/ucet', label: 'Účet a zabezpečení' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['key'];

export function SettingsNav({ active }: { active: SettingsSection }) {
  return (
    <nav aria-label="Sekce nastavení" className="flex gap-1 overflow-x-auto border-b border-linka">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === active ? 'page' : undefined}
          className={cn(
            // -mb-px: podtržení aktivní záložky leží PŘESNĚ na lince navigace,
            // jinak by se linka pod aktivní položkou zdvojila
            'whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors -mb-px',
            section.key === active
              ? 'border-ruzova font-semibold text-ruzova-text'
              : 'border-transparent text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
