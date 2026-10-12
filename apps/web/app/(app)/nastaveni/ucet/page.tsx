import { headers } from 'next/headers';
import { ThemeToggle } from '@/components/theme-toggle';
import { TwoFactorSection } from '@/components/two-factor-section';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { SubmitButton } from '@/components/ui/submit-button';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import type { ActionResult } from '@/lib/action-result';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { humanizeUserAgent } from '@/lib/ua';
import { czDateTime } from '@/lib/format';
import { firstParam } from '@/lib/utils';
import { ClearFeedbackUrl } from '@/components/clear-feedback-url';
import { SettingsToolbar } from '../settings-nav';
import { SettingsToast } from '../settings-toast';
import { revokeOtherSessionsAction } from '../actions';
import { CredentialRows, DeleteAccountDialog } from './account-forms';
import { isInlineAccountError } from './inline-errors';

export const metadata = { title: 'Účet a zabezpečení — Danero' };

const API_CLIENT_LABEL = 'API klient (curl)';

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

  const errorCode = firstParam(params.chyba);
  const okCode = firstParam(params.ok);
  const shownInline = errorCode !== undefined && isInlineAccountError(errorCode);
  // Výsledek akce pro formuláře, které ho ukazují u pole. Vzniká jen tehdy,
  // když ho adresa nese: obyčejné obnovení stránky (adresa se po zobrazení
  // uklízí) pošle `null` a formuláře si drží ten, který už mají — dřív se při
  // něm zavřely i s chybou a rozepsaným textem (`lib/action-result.ts`).
  const result: ActionResult | null =
    errorCode !== undefined || okCode !== undefined
      ? { id: crypto.randomUUID(), error: errorCode ?? null }
      : null;

  return (
    <>
      <SettingsToolbar active="account" />
      <SettingsToast ok={okCode} chyba={errorCode} inline={shownInline} />
      {shownInline && <ClearFeedbackUrl />}

      <div className="@container max-w-[44rem] space-y-14 pt-2 md:pt-4">
        <Section title="Přihlášení a zabezpečení" id="ucet">
          <Group variant="inset">
            <CredentialRows email={user.email} result={result} />

            <DisclosureRow
              id="2fa"
              title="Dvoufaktorové ověření"
              meta={
                user.twoFactorEnabled ? (
                  <span className="text-success-text">Zapnuto</span>
                ) : (
                  'Vypnuto'
                )
              }
            >
              <div className="pt-1">
                <TwoFactorSection enabled={user.twoFactorEnabled} />
              </div>
            </DisclosureRow>
          </Group>
        </Section>

        <Section
          id="aktivita"
          title="Aktivní přihlášení"
          count={sessions.length}
          actions={
            sessions.length > 1 && (
              <form action={revokeOtherSessionsAction}>
                <SubmitButton variant="secondary" size="sm" pendingLabel="Odhlašuji…">
                  Odhlásit ostatní zařízení
                </SubmitButton>
              </form>
            )
          }
        >
          <Group>
            {deviceGroups.map((group) => (
              <Row
                key={group.label}
                label={group.label}
                hint={
                  group.count > 1
                    ? `${group.count}× přihlášeno · naposledy ${czDateTime(group.lastAt)}`
                    : `Naposledy ${czDateTime(group.lastAt)}`
                }
                info={
                  group.label === API_CLIENT_LABEL ? (
                    <InfoPopover label={group.label}>
                      <p>
                        Přístup z příkazové řádky (např. skript). Pokud ho nepoznáváš, odhlas
                        ostatní zařízení.
                      </p>
                    </InfoPopover>
                  ) : undefined
                }
                value={
                  group.isCurrent ? (
                    <span className="type-footnote text-ink-muted">toto zařízení</span>
                  ) : undefined
                }
              />
            ))}
          </Group>
          {auditEvents.length > 0 && (
            <Disclosure summary={`Poslední aktivita (${auditEvents.length})`} className="mt-2">
              <Group>
                {auditEvents.map((event) => (
                  <Row
                    key={event.id}
                    label={
                      <span className="text-ink">
                        {AUDIT_LABELS[event.type as AuditType] ?? event.type}
                      </span>
                    }
                    hint={event.detail ?? undefined}
                    value={
                      <span className="type-caption text-ink-muted">
                        {czDateTime(event.createdAt)}
                      </span>
                    }
                  />
                ))}
              </Group>
            </Disclosure>
          )}
          {/* „Odhlásit se“ tady není: v každé šířce okna je právě jedno, u účtu
              ve skořápce — v patičce postranního panelu, na telefonu v sheetu
              „Více“ (`components/nav-rail.tsx`). */}
        </Section>

        <Section
          id="vzhled"
          title="Vzhled"
          info={
            <InfoPopover label="Vzhled">
              <p>
                Volba se ukládá v tomhle prohlížeči — na jiném zařízení se nastavuje zvlášť.
              </p>
            </InfoPopover>
          }
        >
          <ThemeToggle />
        </Section>

        <Section title="Tvoje data">
          <Group variant="inset">
            <Row
              label="Export dat"
              info={
                <InfoPopover label="Export dat">
                  <p>
                    Kompletní JSON se všemi transakcemi, profilem a nastavením. Klíče k brokerům
                    se z bezpečnostních důvodů neexportují.
                  </p>
                </InfoPopover>
              }
            >
              <a
                href="/api/export"
                download
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Stáhnout moje data
              </a>
            </Row>
            <Row label="Smazání účtu" hint="Nevratné — smaže účet i všechna data.">
              <DeleteAccountDialog result={result} />
            </Row>
          </Group>
        </Section>
      </div>
    </>
  );
}
