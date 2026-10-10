import { PLATFORMS } from '@/lib/brokers-catalog';

const NAMES = new Map(PLATFORMS.map((platform) => [platform.id, platform.name]));

/**
 * Jméno platformy pro člověka. V databázi je u dávky i u symbolu číselníku kód
 * parseru (`trading212`, `xtb`) — do rozhraní patří název z katalogu. Kód,
 * který katalog nezná (nepoznaný soubor má místo něj rovnou český popis),
 * se vrací beze změny.
 */
export function platformName(broker: string): string {
  if (broker === 'universal') return 'Univerzální šablona';
  return NAMES.get(broker) ?? broker;
}
