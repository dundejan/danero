import { headers } from 'next/headers';
import { ThemeToggle } from '@/components/theme-toggle';
import { TwoFactorSection } from '@/components/two-factor-section';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { describedByError, Field, FieldError, Input } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { SubmitButton } from '@/components/ui/submit-button';
import { getDb } from '@/db';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { humanizeUserAgent } from '@/lib/ua';
import { czDateTime } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { firstParam } from '@/lib/utils';
import { ClearFeedbackUrl } from '../feedback-url';
import { SettingsToolbar } from '../settings-nav';
import { SettingsToast, settingsErrorText } from '../settings-toast';
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
} from '../actions';

export const metadata = { title: 'Účet a zabezpečení — Danero' };

/**
 * Kódy chyb, které patří ke konkrétnímu formuláři stránky. Formulář se po
 * neúspěchu otevře znovu a hlášku ukáže u pole, kterého se týká — ne
 * v toastu nad zavřeným řádkem.
 */
const PASSWORD_ERRORS = ['heslo', 'heslo-bezne', 'heslo-spatne', 'heslo-limit', 'heslo-selhalo'];
const EMAIL_ERRORS = ['email', 'email-obsazeny', 'email-ulozeni', 'email-heslo', 'email-limit'];
const DELETE_ERRORS = ['smazani', 'smazani-heslo', 'smazani-limit', 'smazani-selhalo'];

const PASSWORD_ERROR_ID = 'zmena-hesla-error';
const EMAIL_ERROR_ID = 'zmena-emailu-error';
const DELETE_ERROR_ID = 'smazani-uctu-error';

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
  const errorFor = (codes: string[]): string | null =>
    errorCode !== undefined && codes.includes(errorCode) ? settingsErrorText(errorCode) : null;
  const passwordError = errorFor(PASSWORD_ERRORS);
  const emailError = errorFor(EMAIL_ERRORS);
  const deleteError = errorFor(DELETE_ERRORS);
  const shownInline = passwordError !== null || emailError !== null || deleteError !== null;
  // Po každém výsledku akce se formuláře vykreslí nanovo: úspěch řádek zavře
  // a pole vyprázdní, chyba ho otevře. Bez klíče by si React nechal starý
  // prvek i s tím, co v něm zůstalo napsané.
  const renderKey = crypto.randomUUID();

  return (
    <>
      <SettingsToolbar active="account" />
      <SettingsToast ok={firstParam(params.ok)} chyba={errorCode} inline={shownInline} />
      {shownInline && <ClearFeedbackUrl />}

      <div className="@container max-w-[44rem] space-y-14 pt-2 md:pt-4">
        <Section title="Přihlášení a zabezpečení" id="ucet">
          <Group variant="inset">
            <DisclosureRow
              key={`email-${renderKey}`}
              title="E-mail"
              // dlouhou adresu složí řádek sám (tichý údaj má nejvýš 40 % šířky)
              meta={user.email}
              open={emailError !== null}
            >
              <form action={changeEmailAction} className="max-w-[20rem] space-y-4 pt-1 text-ink">
                {/* V řádku je dlouhá adresa zkrácená a celou ukáže jen `title` —
                    ten se na dotyku neobjeví. Rozbalený řádek ji proto vypíše. */}
                <p className="type-footnote text-ink-muted">
                  Teď: <span className="break-all text-ink">{user.email}</span>
                </p>
                <Field
                  label="Nový e-mail"
                  htmlFor="novy-email"
                  hint="Pošleme na něj ověřovací odkaz. Dokud ho nepotvrdíš, nepřihlásíš se."
                >
                  {/* autoComplete NESMÍ být „email“ — password manager sem cpal
                      starou adresu; „off“ + rozbití páru s heslem níže */}
                  <Input
                    id="novy-email"
                    name="novy-email"
                    type="email"
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    {...describedByError(
                      errorCode === 'email' || errorCode === 'email-obsazeny',
                      EMAIL_ERROR_ID,
                    )}
                  />
                </Field>
                <Field label="Heslo (potvrzení)" htmlFor="emailPassword">
                  <Input
                    id="emailPassword"
                    name="stavajici-heslo"
                    type="password"
                    required
                    autoComplete="new-password"
                    {...describedByError(errorCode === 'email-heslo', EMAIL_ERROR_ID)}
                  />
                </Field>
                {emailError && <FieldError id={EMAIL_ERROR_ID}>{emailError}</FieldError>}
                <SubmitButton variant="tinted" pendingLabel="Měním…">
                  Změnit e-mail
                </SubmitButton>
              </form>
            </DisclosureRow>

            <DisclosureRow
              key={`heslo-${renderKey}`}
              title="Heslo"
              meta="Změnit"
              open={passwordError !== null}
            >
              <form action={changePasswordAction} className="max-w-[20rem] space-y-4 pt-1 text-ink">
                <Field label="Současné heslo" htmlFor="stavajici-heslo">
                  <Input
                    id="stavajici-heslo"
                    name="stavajici-heslo"
                    type="password"
                    required
                    autoComplete="current-password"
                    {...describedByError(errorCode === 'heslo-spatne', PASSWORD_ERROR_ID)}
                  />
                </Field>
                <Field
                  label="Nové heslo"
                  htmlFor="nove-heslo"
                  hint="Aspoň 10 znaků. Ostatní zařízení odhlásíme."
                >
                  <Input
                    id="nove-heslo"
                    name="nove-heslo"
                    type="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                    {...describedByError(
                      errorCode === 'heslo' || errorCode === 'heslo-bezne',
                      PASSWORD_ERROR_ID,
                    )}
                  />
                </Field>
                {passwordError && <FieldError id={PASSWORD_ERROR_ID}>{passwordError}</FieldError>}
                <SubmitButton variant="tinted" pendingLabel="Měním…">
                  Změnit heslo
                </SubmitButton>
              </form>
            </DisclosureRow>

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
              <ConfirmDialog
                trigger={
                  <Button variant="danger" size="sm">
                    Smazat účet…
                  </Button>
                }
                title="Smazat účet?"
                description={tidy(
                  'Smažeme účet i všechna data — transakce, profil, šifrované klíče k brokerům, upozornění i historii importů. Tohle nejde vrátit.',
                )}
                confirmLabel="Smazat účet"
                pendingLabel="Mažu…"
                action={deleteAccountAction}
                defaultOpen={deleteError !== null}
              >
                <Field label="Heslo" htmlFor="deletePassword">
                  <Input
                    id="deletePassword"
                    name="heslo"
                    type="password"
                    required
                    autoComplete="current-password"
                    {...describedByError(errorCode === 'smazani-heslo', DELETE_ERROR_ID)}
                  />
                </Field>
                <Field label="Pro potvrzení napiš SMAZAT" htmlFor="potvrzeni">
                  {/* L7-06: bez autoCapitalize napíše iOS „Smazat“ */}
                  <Input
                    id="potvrzeni"
                    name="potvrzeni"
                    required
                    autoComplete="off"
                    autoCapitalize="characters"
                    {...describedByError(errorCode === 'smazani', DELETE_ERROR_ID)}
                  />
                </Field>
                {deleteError && <FieldError id={DELETE_ERROR_ID}>{deleteError}</FieldError>}
              </ConfirmDialog>
            </Row>
          </Group>
        </Section>
      </div>
    </>
  );
}
