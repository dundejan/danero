import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Card, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { getProfile, loadTransactions } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Vítej — Danero' };

/**
 * Onboarding po registraci (G9a) — žádný wizard state: kroky se odvozují
 * z dat (profil? broker/transakce?), takže průvodce jde kdykoli opustit
 * a vrátit se. Hotový uživatel je přesměrován na přehled.
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

  const steps = [
    { done: true, label: 'Účet vytvořen' },
    { done: hasProfile, label: 'Daňový profil' },
    { done: hasData || hasBroker, label: 'První data' },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Vítej v Daneru 👋</h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Zbývají dva kroky a hlídáme ti daně. Kdykoli můžeš odejít a vrátit se — průvodce si
          pamatuje, kde jsi.
        </p>
      </header>

      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                step.done ? 'bg-zelena text-white' : 'border border-linka text-inkoust-tlumeny'
              }`}
            >
              {step.done ? '✓' : i + 1}
            </span>
            <span className={step.done ? 'text-inkoust' : 'text-inkoust-tlumeny'}>
              {step.label}
            </span>
            {i < steps.length - 1 && <span className="text-linka">→</span>}
          </li>
        ))}
      </ol>

      {!hasProfile ? (
        <Card className="space-y-3">
          <CardTitle>Krok 1: Řekni nám, kdo jsi vůči dani</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Od toho se odvíjí, které limity hlídáme (paušální daň 50 000 Kč, vedlejší
            příjmy 20 000 Kč…). Vše jde kdykoli změnit, výpočty se přepočítají od nuly.
          </p>
          <Link
            href="/nastaveni"
            className="inline-block rounded-md bg-ruzova-syta px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Vyplnit daňový profil
          </Link>
        </Card>
      ) : (
        <Card className="space-y-4">
          <CardTitle>Krok 2: Nahraj svoje obchody</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Potřebujeme kompletní historii od prvního nákupu — kvůli časovým testům
            a nabývacím cenám. Vyber cestu:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href="/import#trading212"
              className="rounded-md border border-linka p-3 text-sm hover:border-ruzova"
            >
              <span className="block font-semibold">Trading 212 / IBKR API</span>
              <span className="text-inkoust-tlumeny">
                Připoj klíč jen pro čtení — synchronizace pak běží sama každý den.
              </span>
            </Link>
            <Link
              href="/import"
              className="rounded-md border border-linka p-3 text-sm hover:border-ruzova"
            >
              <span className="block font-semibold">Nahrát výpisy (CSV/XML/XLSX/HTML)</span>
              <span className="text-inkoust-tlumeny">
                Výpisy ze 17 platforem čteme automaticky — XTB, Degiro, eToro, Schwab,
                Portu, Coinbase i další; u devíti dalších tě provedeme univerzální šablonou.
              </span>
            </Link>
          </div>
          {hasBroker && (
            <p className="text-sm text-zelena">
              Broker připojen — první synchronizace běží na stránce{' '}
              <Link href="/import" className="font-medium underline">
                Zdroje dat
              </Link>
              , průběh uvidíš tam.
            </p>
          )}
        </Card>
      )}

      <p className="text-xs text-inkoust-tlumeny">
        Chceš se nejdřív jen rozkoukat?{' '}
        <Link href="/demo" className="font-medium text-ruzova">
          Mrkni na demo s ukázkovými daty
        </Link>
        .
      </p>
    </div>
  );
}
