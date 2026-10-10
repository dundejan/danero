import { NavRail, NavTabBar } from '@/components/nav-rail';
import { SOURCE_URL } from '@/lib/legal';
import { requireUser } from '@/lib/session';

/**
 * Skořápka aplikace: vlevo průsvitný postranní panel se sekcemi, vedle něj
 * obsahové okno. Stránka si nahoru do okna dává vlastní nástrojovou lištu
 * (`AppToolbar`). Na telefonu panel nahrazuje spodní lišta.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh bg-surface">
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
          Danero je otevřený software pod licencí{' '}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            className="text-accent-text hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            AGPL-3.0
          </a>{' '}
          — zdrojový kód téhle aplikace je na{' '}
          <a
            href={SOURCE_URL}
            className="text-accent-text hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {SOURCE_URL.replace(/^https?:\/\//, '')}
          </a>
          .
        </footer>
      </div>
      <NavTabBar userEmail={user.email} />
    </div>
  );
}
