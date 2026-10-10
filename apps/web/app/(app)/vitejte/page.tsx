import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { buttonVariants } from '@/components/ui/button';
import { InfoPopover } from '@/components/ui/info-popover';
import { TextLink } from '@/components/ui/link';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { PLATFORM_COUNTS } from '@/lib/brokers-catalog';
import { currentTaxYear } from '@/lib/clock';
import { filingLimitTexts } from '@/lib/filing-limits';
import { getProfile, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Vítej — Danero' };

interface NextStep {
  /** Kolikátý ze dvou kroků to je. */
  number: 1 | 2;
  title: string;
  lede: React.ReactNode;
  /** Vysvětlivka za perexem — proč to chceme. */
  info?: React.ReactNode;
  action: { href: string; label: string };
}

/**
 * První obrazovka po registraci (G9a): jeden další krok a možnost podívat se
 * do dema, nic víc. Žádný stav průvodce se neukládá — krok se odvozuje z dat
 * (profil? broker? transakce?), takže jde kdykoli odejít a vrátit se. Hotový
 * uživatel je přesměrován na přehled.
 */
export default async function WelcomePage() {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  const txs = profile ? await loadTransactions(db, user.id) : [];
  const accounts = profile
    ? await db
        .select({ id: brokerAccounts.id })
        .from(brokerAccounts)
        .where(eq(brokerAccounts.userId, user.id))
    : [];

  const hasProfile = profile !== null;
  const hasData = txs.length > 0;
  const hasBroker = accounts.length > 0;
  if (hasProfile && hasData) redirect('/prehled');

  // R-09b: limit vedlejších příjmů se rok od roku liší (do ZO 2026 20 000 Kč,
  // od ZO 2027 40 000 Kč) — průvodce rok nezná, jmenuje tedy limit běžného roku
  const employeeLimit = filingLimitTexts(currentTaxYear()).employee;

  const step: NextStep = !hasProfile
    ? {
        number: 1,
        title: 'Vítej v Daneru',
        lede: (
          <>
            Nejdřív nám řekni, jak daníš. Podle toho hlídáme správné limity (paušální daň
            50 000 Kč, vedlejší příjmy {employeeLimit}…).
          </>
        ),
        action: { href: '/nastaveni', label: 'Vyplnit daňový profil' },
      }
    : hasBroker
      ? {
          number: 2,
          title: 'Zbývá stáhnout historii',
          lede: 'Broker je připojený. Historii z něj stáhneš jedním tlačítkem ve Zdrojích dat.',
          action: { href: '/import', label: 'Otevřít Zdroje dat' },
        }
      : {
          number: 2,
          title: 'Přidej svoje obchody',
          lede: 'Nahraj výpis od brokera, nebo ho napoj klíčem jen pro čtení. Potřebujeme celou historii od prvního nákupu.',
          info: (
            <InfoPopover label="Přidání obchodů" title="Co budeš potřebovat">
              <p>
                Celou historii chceme kvůli časovým testům a nabývacím cenám — bez prvního nákupu
                nejde spočítat, co je osvobozené.
              </p>
              {/* počty z katalogu — natvrdo zapsané při přidání parseru zdriftují */}
              <p>
                Výpisy z {PLATFORM_COUNTS.file} platforem čteme sami, u {PLATFORM_COUNTS.template}{' '}
                dalších tě provede univerzální šablona. Trading 212 a Interactive Brokers jde
                napojit, pak se synchronizují každý den samy.
              </p>
            </InfoPopover>
          ),
          action: { href: '/import', label: 'Přidat data' },
        };

  return (
    <div className="mx-auto flex max-w-[30rem] flex-col items-center py-12 text-center md:py-24">
      <p className="type-footnote text-ink-muted">Krok {step.number} ze 2</p>
      <h1 className="type-title-1 mt-2 text-balance">{step.title}</h1>
      {/* `div`, ne `p`: vysvětlivka si na telefonu vykresluje sheet a ten do odstavce nesmí */}
      <div className="type-body mt-3 text-pretty text-ink-muted">
        {step.lede}
        {step.info && <> {step.info}</>}
      </div>
      <Link href={step.action.href} className={`${buttonVariants({ size: 'lg' })} mt-8`}>
        {step.action.label}
      </Link>
      <TextLink href="/demo" chevron className="mt-3">
        Podívat se do dema
      </TextLink>
    </div>
  );
}
