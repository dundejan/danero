import { NavRail, NavTabBar } from '@/components/nav-rail';
import { SOURCE_URL } from '@/lib/legal';
import { requireUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-dvh">
      {/* a11y: skip-link — první fokusovatelný prvek, viditelný jen s fokusem */}
      <a
        href="#obsah"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-plocha focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-inkoust focus:shadow-sm"
      >
        Přeskočit na obsah
      </a>
      <NavRail userEmail={user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="obsah" className="min-w-0 flex-1 px-4 pt-8 md:px-6 lg:px-10">
          {children}
        </main>
        {/*
          § 13 AGPL-3.0: kdo aplikaci nabízí po síti, musí jejím uživatelům
          „prominently offer" odpovídající zdrojový kód. Odkaz byl jen na
          veřejných stránkách, které přihlášený uživatel běžně nevidí (E-45).
          Pro vlastní instance je adresa přepínatelná — self-hoster sem patří
          se svým forkem, ne s upstreamem.
        */}
        <footer className="px-4 pb-24 pt-10 text-xs text-inkoust-tlumeny md:px-6 md:pb-8 lg:px-10">
          Danero je otevřený software pod licencí{' '}
          <a
            href="https://www.gnu.org/licenses/agpl-3.0.html"
            className="font-medium hover:text-inkoust"
            target="_blank"
            rel="noreferrer"
          >
            AGPL-3.0
          </a>{' '}
          — zdrojový kód téhle aplikace je na{' '}
          <a
            href={SOURCE_URL}
            className="font-medium hover:text-inkoust"
            target="_blank"
            rel="noreferrer"
          >
            {SOURCE_URL.replace(/^https?:\/\//, '')}
          </a>
          .
        </footer>
      </div>
      <NavTabBar />
    </div>
  );
}
