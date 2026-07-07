import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-ruzova" aria-hidden />
          <span className="font-display text-lg font-bold tracking-tight">Danero</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/prihlaseni" className="font-medium text-inkoust-tlumeny hover:text-inkoust">
            Přihlásit se
          </Link>
          <Link
            href="/registrace"
            className="rounded-md bg-ruzova px-4 py-2 font-semibold text-white hover:opacity-90"
          >
            Vyzkoušet
          </Link>
        </nav>
      </header>

      <section className="space-y-6">
        <h1 className="font-display text-5xl font-bold leading-tight tracking-tight">
          Investuj. <span className="text-ruzova">Daně pohlídáme.</span>
        </h1>
        <p className="max-w-xl text-lg text-inkoust-tlumeny">
          Danero hlídá tříletý časový test, limit 100 000 Kč z prodejů i limit 50 000 Kč
          pro paušální daň — a před každým prodejem ti řekne, co udělá s tvými daněmi.
        </p>
      </section>

      {/* ochutnávka signatury: horizont osvobození */}
      <section aria-hidden className="relative h-16 overflow-hidden rounded-lg border border-linka bg-plocha">
        <div className="absolute inset-y-0 left-1/3 w-px bg-ruzova" />
        <span className="absolute left-1/3 top-1 -translate-x-1/2 font-mono text-[10px] text-ruzova">
          dnes
        </span>
        <div className="absolute inset-y-0 left-0 flex w-full items-center">
          <span className="absolute left-[12%] h-2.5 w-2.5 rounded-full bg-zelena" />
          <span className="absolute left-[22%] h-2 w-2 rounded-full bg-zelena" />
          <span className="absolute left-[48%] h-2 w-2 rounded-full bg-inkoust-tlumeny" />
          <span className="absolute left-[63%] h-3 w-3 rounded-full bg-inkoust-tlumeny" />
          <span className="absolute left-[81%] h-2 w-2 rounded-full bg-inkoust-tlumeny" />
        </div>
      </section>

      <footer className="text-sm text-inkoust-tlumeny">
        Aplikace je ve vývoji. Danero je výpočetní nástroj, nikoli daňové poradenství.
      </footer>
    </main>
  );
}
