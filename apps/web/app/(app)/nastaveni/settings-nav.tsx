import { AppToolbar } from '@/components/app-toolbar';
import { SegmentedControl } from '@/components/ui/segmented-control';

/**
 * Nastavení má tři stránky: jak Danero počítá, co posílá e-mailem a účet.
 * Lišta nese jediný nadpis („Nastavení“) a segmentový přepínač mezi nimi —
 * stejné místo, kde má přehled přepínač roku, takže se v okně nic neposouvá.
 * Aktivní stránku čtečce říká doplněk titulku i `aria-current` segmentu.
 */
const SECTIONS = [
  { key: 'tax', href: '/nastaveni', label: 'Daň a výpočet' },
  { key: 'notifications', href: '/nastaveni/upozorneni', label: 'Upozornění' },
  { key: 'account', href: '/nastaveni/ucet', label: 'Účet' },
] as const;

export type SettingsSection = (typeof SECTIONS)[number]['key'];

export function SettingsToolbar({ active }: { active: SettingsSection }) {
  const current = SECTIONS.find((section) => section.key === active);
  return (
    <AppToolbar title="Nastavení" titleContext={current?.label}>
      <SegmentedControl
        kind="nav"
        ariaLabel="Sekce nastavení"
        value={active}
        segments={SECTIONS.map((section) => ({
          key: section.key,
          label: section.label,
          href: section.href,
        }))}
        // Popisky jsou různě dlouhé: stejně široké segmenty (výchozí chování
        // přepínače, šité na roky) by nejdelší ořízly. Mřížka dá každému
        // šířku podle textu; na telefonu se přepínač roztáhne přes celý řádek.
        className="grid w-full auto-cols-auto grid-flow-col md:w-auto"
      />
    </AppToolbar>
  );
}
