import { cn } from '@/lib/utils';

/**
 * Ikony sekcí aplikace — jen v navigaci (postranní panel, spodní lišta), kde
 * slouží orientaci. Nadpisy a obsah ikony nemají.
 *
 * Jednotná kresba: mřížka 24 × 24, tah 1,6 (aktivní položka spodní lišty
 * ho zesiluje — stav tak nenese jen barva), zaoblené konce, žádné výplně.
 */
export type NavIconName =
  | 'overview'
  | 'portfolio'
  | 'simulator'
  | 'report'
  | 'sources'
  | 'settings'
  | 'more';

const PATHS: Record<NavIconName, React.ReactNode> = {
  // okno s lištou a dvěma sloupci — pracovní plocha přehledu
  overview: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 9.5h17M10 9.5v10" />
    </>
  ),
  // koláč s vyříznutou výsečí — složení portfolia
  portfolio: (
    <>
      <path d="M11 4.6a8 8 0 1 0 8.4 8.4H11V4.6Z" />
      <path d="M14 3.6a6.6 6.6 0 0 1 6.4 6.4H14V3.6Z" />
    </>
  ),
  // tři táhla — „co kdyby“
  simulator: (
    <>
      <path d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h9M17 17h3" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  // list s řádky — podklady k přiznání
  report: (
    <>
      <path d="M7 3.5h6.5L18.5 8.5V18a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 18V6A2.5 2.5 0 0 1 7 3.5Z" />
      <path d="M13.5 3.5v5h5M8.5 13h6.5M8.5 16.5h4.5" />
    </>
  ),
  // šipka do přihrádky — odkud přicházejí data
  sources: (
    <>
      <path d="M12 3.5v9M8.5 9.5 12 13l3.5-3.5" />
      <path d="M4 13.5 6 7h1.5M20 13.5 18 7h-1.5M4 13.5V17a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 17v-3.5h-4.5a3.5 3.5 0 0 1-7 0H4Z" />
    </>
  ),
  // ozubené kolo (kresba Feather, licence MIT), zmenšené do společné mřížky
  settings: (
    <g transform="translate(12 12) scale(0.84) translate(-12 -12)">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </g>
  ),
  // tři tečky v kruhu — další sekce
  more: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.4" />
    </>
  ),
};

export function NavIcon({
  name,
  strong = false,
  className,
}: {
  name: NavIconName;
  /** Silnější tah pro aktivní položku. */
  strong?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strong ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-5 w-5 shrink-0', className)}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
