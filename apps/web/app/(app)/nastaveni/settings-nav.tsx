import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Nastavení má dvě stránky: daňová část (jak Danero počítá) a účet
 * (heslo, e-mail, 2FA, upozornění, zařízení). Dokud stály vedle sebe ve dvou
 * sloupcích, byl pravý sloupec dvakrát vyšší než levý a stránka působila
 * rozvrácená — a hlavně toho bylo na jednu obrazovku moc.
 */
const SECTIONS = [
  { key: 'tax', href: '/nastaveni', label: 'Daň a výpočet' },
  { key: 'account', href: '/nastaveni/ucet', label: 'Účet a zabezpečení' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['key'];

export function SettingsNav({ active }: { active: SettingsSection }) {
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Sekce nastavení">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={section.href}
          aria-current={section.key === active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm',
            section.key === active
              ? 'bg-ruzova-syta font-semibold text-white'
              : 'text-inkoust-tlumeny hover:text-inkoust',
          )}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
