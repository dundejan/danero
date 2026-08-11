import { headers } from 'next/headers';
import { ThemeToggle } from '@/components/theme-toggle';
import { TwoFactorSection } from '@/components/two-factor-section';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { humanizeUserAgent } from '@/lib/ua';
import { czDateTime } from '@/lib/format';
import { firstParam } from '@/lib/utils';
import { SettingsNav } from '../settings-nav';
import { SettingsSection } from '../settings-section';
import { SettingsToast } from '../settings-toast';
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
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
            Přihlašovací údaje, druhý faktor a přehled zařízení, ze kterých jsi přihlášený.
          </p>
        </div>
        <SettingsNav active="account" />
      </header>

      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      <Card className="space-y-5" id="ucet">
        <CardTitle>Účet</CardTitle>

        <SettingsSection title="Přihlášený účet">
          <p className="break-all text-sm font-medium">{user.email}</p>
        </SettingsSection>

        <SettingsSection title="Změna hesla">
          <form action={changePasswordAction} className="space-y-3">
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
            <SubmitButton pendingLabel="Měním…">Změnit heslo</SubmitButton>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Změna e-mailu"
          description="Na novou adresu pošleme ověřovací odkaz — dokud ho nepotvrdíš, nepřihlásíš se."
        >
          <form action={changeEmailAction} className="space-y-3">
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
            <SubmitButton pendingLabel="Měním…">Změnit e-mail</SubmitButton>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Export dat"
          description="Kompletní JSON se všemi transakcemi, profilem a nastavením (broker API klíče se z bezpečnostních důvodů neexportují)."
        >
          <a href="/api/export" download className={buttonVariants({ variant: 'secondary' })}>
            Stáhnout export (JSON)
          </a>
        </SettingsSection>

        <SettingsSection
          title="Smazání účtu"
          description="Nevratně smaže účet i všechna data — transakce, profil, šifrované broker klíče, upozornění i historii importů. Nejdřív si případně stáhni export."
        >
          <form action={deleteAccountAction} className="space-y-3">
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
            <SubmitButton variant="danger" pendingLabel="Mažu…">
              Nevratně smazat účet
            </SubmitButton>
          </form>
        </SettingsSection>
      </Card>

      <Card className="space-y-4" id="2fa">
        <CardTitle>Dvoufaktorové ověření (2FA)</CardTitle>
        <TwoFactorSection enabled={user.twoFactorEnabled} />
      </Card>

      <Card className="space-y-5" id="aktivita">
        <CardTitle>Přihlášená zařízení a aktivita</CardTitle>

        <SettingsSection title={`Aktivní přihlášení (${sessions.length})`}>
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
              <SubmitButton variant="danger" pendingLabel="Odhlašuji…">
                Odhlásit všechna ostatní zařízení
              </SubmitButton>
            </form>
          )}
        </SettingsSection>

        <SettingsSection title="Poslední aktivita">
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
        </SettingsSection>
      </Card>

      <Card className="space-y-3" id="vzhled">
        <CardTitle>Vzhled</CardTitle>
        <ThemeToggle withLabels />
        <p className="text-sm text-inkoust-tlumeny">
          Volba se ukládá v tomhle prohlížeči — na jiném zařízení se nastavuje zvlášť.
        </p>
      </Card>
    </div>
  );
}
