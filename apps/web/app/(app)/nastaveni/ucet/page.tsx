import Link from 'next/link';
import { headers } from 'next/headers';
import { ThemeToggle } from '@/components/theme-toggle';
import { TwoFactorSection } from '@/components/two-factor-section';
import { Card, CardTitle } from '@/components/ui/card';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { SubmitButton } from '@/components/ui/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { getDb } from '@/db';
import { resolveEntitlements } from '@/lib/entitlements';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { getNotificationPrefs } from '@/lib/notifications';
import { humanizeUserAgent } from '@/lib/ua';
import { czDateTime } from '@/lib/format';
import { PRICE_SUBSCRIPTION_CZK, priceLabel } from '@/lib/pricing';
import { firstParam } from '@/lib/utils';
import { SettingsNav } from '../settings-nav';
import { SettingsToast } from '../settings-toast';
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
  saveNotificationPrefsAction,
} from '../actions';

export const metadata = { title: 'Účet a zabezpečení — Danero' };

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string | string[]; ok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const requestHeaders = await headers();
  const auth = await getAuth();
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const currentSession = await auth.api.getSession({ headers: requestHeaders });
  const auditEvents = await recentAuditEvents(db, user.id);
  const prefs = await getNotificationPrefs(db, user.id);
  // Hlídací e-maily rozesílá cron JEN platícím (api/cron/notify) — stránka to
  // musí říct rovnou, jinak si uživatel zdarma poctivě nastaví typy a frekvenci
  // a pak marně čeká na e-mail, který nikdy nepřijde.
  const entitlements = await resolveEntitlements(db, user.id);

  // E4: seznam přihlášení seskupený podle zařízení (prohlížeč · OS) — dvacet
  // identických řádků „Chrome · Linux“ nic neříká; jeden řádek s počtem ano
  interface DeviceGroup {
    label: string;
    count: number;
    lastAt: Date;
    isCurrent: boolean;
  }
  const deviceGroups = [...sessions
    .reduce((map, s) => {
      const label = humanizeUserAgent(s.userAgent);
      const group = map.get(label) ?? { label, count: 0, lastAt: s.createdAt, isCurrent: false };
      group.count += 1;
      if (s.createdAt > group.lastAt) group.lastAt = s.createdAt;
      if (currentSession?.session.id === s.id) group.isCurrent = true;
      return map.set(label, group);
    }, new Map<string, DeviceGroup>())
    .values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
  const API_CLIENT_HINT =
    'Přístup z příkazové řádky (např. skript). Pokud ho nepoznáváš, odhlas ostatní zařízení.';

  return (
    // jeden sloupec s šířkou pro formulář — viz komentář na daňové stránce
    <div className="max-w-4xl space-y-8">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Účet a zabezpečení</h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Přihlašovací údaje, druhý faktor, upozornění e-mailem a přehled zařízení,
            ze kterých jsi přihlášený.
          </p>
        </div>
        <SettingsNav active="account" />
      </header>

      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      <Card className="space-y-5" id="ucet">
        <CardTitle>Účet</CardTitle>
        <p className="text-sm text-inkoust-tlumeny">
          Přihlášený účet:{' '}
          <span className="break-all font-medium text-inkoust">{user.email}</span>
        </p>

        <form action={changePasswordAction} className="space-y-3">
          <p className="text-sm font-semibold">Změna hesla</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="stavajici-heslo">Současné heslo</Label>
              <Input id="stavajici-heslo" name="stavajici-heslo" type="password" required autoComplete="current-password" />
            </div>
            <div>
              <Label htmlFor="nove-heslo">Nové heslo (min. 10 znaků)</Label>
              <Input id="nove-heslo" name="nove-heslo" type="password" required minLength={10} autoComplete="new-password" />
            </div>
          </div>
          <SubmitButton size="sm" pendingLabel="Měním…">Změnit heslo</SubmitButton>
        </form>

        <form action={changeEmailAction} className="space-y-3 border-t border-linka pt-4">
          <p className="text-sm font-semibold">Změna e-mailu</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="novy-email">Nový e-mail</Label>
              {/* autoComplete NESMÍ být „email“ — password manager sem cpal
                  starou adresu; „off“ + rozbití páru s heslem níže */}
              <Input id="novy-email" name="novy-email" type="email" required autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="emailPassword">Heslo (potvrzení)</Label>
              <Input
                id="emailPassword"
                name="stavajici-heslo"
                type="password"
                required
                autoComplete="new-password"
              />
            </div>
          </div>
          <SubmitButton size="sm" pendingLabel="Měním…">Změnit e-mail</SubmitButton>
        </form>

        <div className="space-y-2 border-t border-linka pt-4">
          <p className="text-sm font-semibold">Export dat</p>
          <p className="text-sm text-inkoust-tlumeny">
            Stáhni si kompletní JSON se všemi transakcemi, profilem a nastavením
            (broker API klíče se z bezpečnostních důvodů neexportují).
          </p>
          <a
            href="/api/export"
            download
            className="inline-block rounded-md border border-linka-ovladaci px-3 py-1.5 text-sm font-medium hover:border-inkoust-tlumeny"
          >
            Stáhnout export (JSON)
          </a>
        </div>

        <form action={deleteAccountAction} className="space-y-3 border-t border-linka pt-4">
          <p className="text-sm font-semibold text-cervena">Smazání účtu</p>
          <p className="text-sm text-inkoust-tlumeny">
            Nevratně smaže účet i všechna data — transakce, profil, šifrované broker
            klíče, upozornění i historii importů. Nejdřív si případně stáhni export.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="deletePassword">Heslo</Label>
              <Input id="deletePassword" name="heslo" type="password" required autoComplete="current-password" />
            </div>
            <div>
              <Label htmlFor="potvrzeni">Napiš SMAZAT</Label>
              <Input id="potvrzeni" name="potvrzeni" required placeholder="SMAZAT" autoComplete="off" />
            </div>
          </div>
          <SubmitButton variant="danger" size="sm" pendingLabel="Mažu…">
            Nevratně smazat účet
          </SubmitButton>
        </form>
      </Card>

      <Card className="space-y-4" id="2fa">
        <CardTitle>Dvoufaktorové ověření (2FA)</CardTitle>
        <TwoFactorSection enabled={user.twoFactorEnabled} />
      </Card>

      <Card className="space-y-4" id="notifikace">
        <CardTitle>E-mailová upozornění</CardTitle>
        {!entitlements.notifications ? (
          /* Rozesílku dělá cron jen platícím — nabízet tu funkční přepínače
             by znamenalo slíbit e-maily, které nikdy nedorazí. */
          <div className="space-y-3">
            <p className="text-sm text-inkoust-tlumeny">
              Hlídáme za tebe časové testy, limity i termíny přiznání a dáme ti vědět
              e-mailem dřív, než bude pozdě — každý den, nebo v týdenním souhrnu.
            </p>
            <p className="text-sm font-semibold">
              Součást hlídání za {priceLabel(PRICE_SUBSCRIPTION_CZK)} ročně.
            </p>
            <Link href="/predplatne" className={buttonVariants({ variant: 'primary' })}>
              Objednat hlídání
            </Link>
            <p className="text-xs text-inkoust-tlumeny">
              Upozornění v aplikaci vidíš i bez předplatného — spočítáme je vždy, když
              si otevřeš přehled. Placené je jen to, že za tebou přijdou samy.
            </p>
          </div>
        ) : (
        <form action={saveNotificationPrefsAction} className="space-y-4">
          <Switch name="emaily-zapnute" defaultChecked={prefs.emailEnabled} label="Posílat e-maily" />

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Frekvence</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="frekvence-emailu"
                value="DAILY"
                defaultChecked={prefs.emailFrequency !== 'WEEKLY'}
                className="accent-[var(--ruzova)]"
              />
              denní souhrn
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="frekvence-emailu"
                value="WEEKLY"
                defaultChecked={prefs.emailFrequency === 'WEEKLY'}
                className="accent-[var(--ruzova)]"
              />
              týdenní souhrn
            </label>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">Typy upozornění</legend>
            <Switch
              name="upozorneni-casove-testy"
              defaultChecked={prefs.timeTestEvents}
              label="Časové testy (blížící se osvobození pozic)"
            />
            <Switch
              name="upozorneni-limity"
              defaultChecked={prefs.limitEvents}
              label="Limity (blížící se nebo prolomené limity)"
            />
            <Switch
              name="upozorneni-kalendar"
              defaultChecked={prefs.calendarEmails}
              label="Daňový kalendář (termíny přiznání, roční shrnutí)"
            />
          </fieldset>

          <p className="text-xs text-inkoust-tlumeny">
            Upozornění v aplikaci se zobrazují vždy — tady vypínáš jen e-maily. Vypnuté typy
            se po zapnutí nehromadí zpětně. Každý e-mail má odhlašovací odkaz. Změny se
            ukládají automaticky.
          </p>
          <AutoSubmit />
        </form>
        )}
      </Card>

      <Card className="space-y-4" id="aktivita">
        <CardTitle>Přihlášená zařízení a aktivita</CardTitle>
        <div className="space-y-2">
          <p className="text-sm font-semibold">
            Aktivní přihlášení ({sessions.length})
          </p>
          <ul className="space-y-1 text-sm text-inkoust-tlumeny">
            {deviceGroups.map((group) => (
              <li key={group.label} className="flex flex-wrap items-baseline gap-2">
                <span
                  className="font-medium text-inkoust"
                  title={group.label === 'API klient (curl)' ? API_CLIENT_HINT : undefined}
                >
                  {group.label}
                </span>
                <span>
                  — {group.count} přihlášení, naposledy{' '}
                  {czDateTime(group.lastAt)}
                </span>
                {group.isCurrent && (
                  <span className="rounded bg-zelena/10 px-1.5 py-0.5 text-xs font-medium text-zelena-text">
                    toto zařízení
                  </span>
                )}
              </li>
            ))}
          </ul>
          {sessions.length > 1 && (
            <form action={revokeOtherSessionsAction}>
              <SubmitButton variant="danger" size="sm" pendingLabel="Odhlašuji…">
                Odhlásit všechna ostatní zařízení
              </SubmitButton>
            </form>
          )}
        </div>
        <div className="space-y-2 border-t border-linka pt-4">
          <p className="text-sm font-semibold">Poslední aktivita</p>
          {auditEvents.length === 0 ? (
            <p className="text-sm text-inkoust-tlumeny">Zatím žádné události.</p>
          ) : (
            <ul className="space-y-1 text-sm text-inkoust-tlumeny">
              {auditEvents.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs">
                    {czDateTime(event.createdAt)}
                  </span>
                  <span className="font-medium text-inkoust">
                    {AUDIT_LABELS[event.type as AuditType] ?? event.type}
                  </span>
                  {event.detail && <span>{event.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="space-y-3" id="vzhled">
        <CardTitle>Vzhled</CardTitle>
        <ThemeToggle withLabels />
        <p className="text-xs text-inkoust-tlumeny">
          Volba se ukládá v tomhle prohlížeči — na jiném zařízení se nastavuje zvlášť.
        </p>
      </Card>
    </div>
  );
}
