import { AutoSaveFeedback } from '@/components/auto-save-feedback';
import { NavRail, NavTabBar } from '@/components/nav-rail';
import { RefreshOnRestore } from '@/components/refresh-on-restore';
import { NOT_TAX_ADVICE } from '@/components/shell-disclaimer';
import { TextLink } from '@/components/ui/link';
import { SOURCE_URL } from '@/lib/legal';
import { requireUser } from '@/lib/session';

/**
 * Skořápka aplikace: vlevo postranní panel se sekcemi, vedle něj
 * obsahové okno. Stránka si nahoru do okna dává vlastní nástrojovou lištu
 * (`AppToolbar`). Na telefonu panel nahrazuje spodní lišta.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh bg-surface">
      {/* Zpět/Vpřed umí ukázat stránku z paměti prohlížeče — pak se stav
          dotáhne ze serveru (nic nevykresluje). */}
      <RefreshOnRestore />
      {/* a11y: skip-link — první fokusovatelný prvek, viditelný jen s fokusem */}
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-floating"
      >
        Přeskočit na obsah
      </a>
      <NavRail userEmail={user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="obsah" className="min-w-0 flex-1 px-(--page-gutter) pt-(--page-top)">
          {children}
        </main>
        {/*
          § 13 AGPL-3.0: kdo aplikaci nabízí po síti, musí jejím uživatelům
          „prominently offer" odpovídající zdrojový kód. Odkaz byl jen na
          veřejných stránkách, které přihlášený uživatel běžně nevidí (E-45).
          Pro vlastní instance je adresa přepínatelná — self-hoster sem patří
          se svým forkem, ne s upstreamem.
          Spodní okraj na telefonu kryje spodní lištu i s bezpečnou zónou gesta.
        */}
        <footer className="type-caption px-(--page-gutter) pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom,0px)+1.5rem)] pt-12 text-ink-muted md:pb-8">
          {/* Výhrada „není daňové poradenství“ jen pár slovy a odkazem na
              podmínky, kde je závazné znění — stejně jako v demu a na webu.
              Přihlášený uživatel ji dřív neměl vůbec (jen v tisku reportu). */}
          <TextLink href={NOT_TAX_ADVICE.href}>{NOT_TAX_ADVICE.label}</TextLink>
          {' · '}
          Danero je otevřený software pod licencí{' '}
          {/* odkazy ve větě jsou podtržené — jen barvou by se od textu neodlišily
              (WCAG 1.4.1; axe to hlásil na každé stránce aplikace) */}
          <TextLink href="https://www.gnu.org/licenses/agpl-3.0.html" external>
            AGPL-3.0
          </TextLink>{' '}
          — zdrojový kód téhle aplikace je na{' '}
          <TextLink href={SOURCE_URL} external className="break-all">
            {SOURCE_URL.replace(/^https?:\/\//, '')}
          </TextLink>
          .
        </footer>
      </div>
      <NavTabBar userEmail={user.email} />
      {/* Potvrzení a chyby automatického ukládání. Až za obsahem: hláška plave,
          ale její křížek nesmí v pořadí fokusu předběhnout odkaz „Přeskočit
          na obsah“. */}
      <AutoSaveFeedback />
    </div>
  );
}
