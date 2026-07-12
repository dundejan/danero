import type { Metadata } from 'next';
import Link from 'next/link';
import { KalkulackaCasovehoTestu } from '@/components/kalkulacka-casoveho-testu';
import { MarketingCta, MarketingPage, PageHero } from '@/components/marketing-page';

export const metadata: Metadata = {
  title: 'Časový test 3 roky: kdy můžu prodat akcie bez daně? Kalkulačka — Danero',
  description:
    'Zadej datum nákupu a zjisti, od kterého dne je prodej akcií či ETF osvobozený tříletým časovým testem. Zdarma, bez registrace, s připomínkou do kalendáře.',
};

const OTAZKY: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Co je časový test?',
    body: (
      <>
        Držíš-li cenný papír (akcii, ETF, podílový list) déle než 3 roky, je jeho
        prodej osvobozený od daně z příjmů — bez ohledu na výši zisku. Lhůta se
        počítá ode dne nabytí do dne prodeje a musí uplynout celá: prodej přesně
        na třetí výročí ještě osvobozený není, den po něm už ano.
      </>
    ),
  },
  {
    title: 'Přikupoval jsem — jak se to počítá?',
    body: (
      <>
        Každý nákup má vlastní lhůtu. Když jsi stejné ETF koupil v lednu 2023
        a pak přikoupil v červnu 2024, první kusy máš osvobozené dřív než ty
        druhé. Při prodeji se navíc řeší, které kusy prodáváš (obvykle metodou
        FIFO — nejstarší první). Přesně tohle je práce pro aplikaci, ne pro hlavu.
      </>
    ),
  },
  {
    title: 'Od kterého dne se lhůta počítá?',
    body: (
      <>
        Ode dne nabytí — u obchodů přes brokera se za něj zpravidla bere den
        vypořádání obchodu (T+1 až T+2 po zadání pokynu), ne den kliknutí na
        „koupit". U pár dní starých nákupů na tom nesejde, u prodeje těsně kolem
        výročí ano. Danero v aplikaci počítá s datem vypořádání automaticky.
      </>
    ),
  },
  {
    title: 'A co když prodám dřív?',
    body: (
      <>
        Pak se prodej daní — ledaže ti pomůže druhé osvobození: jsou-li tvoje
        celkové tržby z prodejů cenných papírů za rok do 100 000 Kč, neřeší se
        daň vůbec. Jestli se tě týká, zjistíš za minutu v{' '}
        <Link
          href="/kalkulacka"
          className="font-medium text-ruzova-text underline underline-offset-2"
        >
          kalkulačce přiznání
        </Link>
        .
      </>
    ),
  },
];

export default function CasovyTestPage() {
  return (
    <MarketingPage>
      <PageHero
        eyebrow="Kalkulačka"
        title="Kdy můžu prodat bez daně?"
        lede="Zadej datum nákupu a zjisti, od kterého dne je prodej osvobozený tříletým časovým testem. Nic se neukládá."
      />

      <div className="mt-12">
        <KalkulackaCasovehoTestu />
      </div>

      <section aria-labelledby="ct-vysvetleni" className="mt-24 lg:mt-32">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-ruzova-text">
          Jak to funguje
        </p>
        <h2
          id="ct-vysvetleni"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Časový test bez záludností
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {OTAZKY.map((otazka) => (
            <div key={otazka.title} className="rounded-lg border border-linka bg-plocha p-6">
              <h3 className="font-semibold">{otazka.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-inkoust-tlumeny">{otazka.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-3xl text-xs text-inkoust-tlumeny">
          Kalkulačka je orientační a platí pro cenné papíry. Kryptoaktiva mají vlastní
          pravidla — v aplikaci je hlídáme zvlášť. Rozhodné je vždy skutečné datum
          nabytí konkrétních kusů.
        </p>
        <p className="mt-3 max-w-3xl text-sm text-inkoust-tlumeny">
          Ať ti neuteče ani úřední termín:{' '}
          <a
            href="/api/kalendar"
            className="font-medium text-ruzova-text underline underline-offset-2"
          >
            stáhni si daňový kalendář investora (.ics)
          </a>{' '}
          — přiznání, paušál i konec roku, každý rok znovu.
        </p>
      </section>

      <MarketingCta
        title="Danero hlídá všechny tvoje lhůty najednou"
        lede="Napoj brokera nebo nahraj výpis — každý nákup dostane vlastní datum osvobození na časové ose a e-mail přijde 30 a 7 dní předem."
        primary="registrace"
      />
    </MarketingPage>
  );
}
