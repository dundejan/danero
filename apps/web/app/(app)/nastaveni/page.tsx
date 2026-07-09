import { and, eq } from 'drizzle-orm';
import { Toast } from '@/components/toast';
import { TwoFactorSection } from '@/components/two-factor-section';
import { syncStatusLabel } from '@/lib/broker-sync';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label, Select } from '@/components/ui/field';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { getProfile } from '@/lib/portfolio';
import { activePortfolio, listPortfolios } from '@/lib/portfolio-context';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { headers } from 'next/headers';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { getNotificationPrefs } from '@/lib/notifications';
import {
  changeEmailAction,
  createPortfolioAction,
  deletePortfolioAction,
  renamePortfolioAction,
  changePasswordAction,
  deleteAccountAction,
  disconnectBrokerAction,
  revokeOtherSessionsAction,
  saveIbkrKeyAction,
  saveNotificationPrefsAction,
  saveProfileAction,
  saveTrading212KeyAction,
} from './actions';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string; ok?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const portfolio = await activePortfolio(db, user.id);
  const allPortfolios = await listPortfolios(db, user.id);
  const profile = await getProfile(db, user.id, portfolio.id);
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.portfolioId, portfolio.id)));
  const t212 = accounts.find((account) => account.broker === 'trading212');
  const ibkr = accounts.find((account) => account.broker === 'ibkr');
  const { chyba, ok } = await searchParams;
  const requestHeaders = await headers();
  const auth = await getAuth();
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const currentSession = await auth.api.getSession({ headers: requestHeaders });
  const auditEvents = await recentAuditEvents(db, user.id);
  const prefs = await getNotificationPrefs(db, user.id);
  const OK_LABELS: Record<string, string> = {
    heslo: 'Heslo změněno. Ostatní zařízení byla odhlášena.',
    email: 'E-mail změněn.',
    odhlaseno: 'Ostatní zařízení byla odhlášena.',
    portfolio: 'Portfolio vytvořeno a přepnuto — nastav mu daňový profil níže.',
    'portfolio-smazano': 'Portfolio smazáno včetně všech jeho dat.',
    notifikace: 'Notifikační preference uloženy.',
  };
  const CHYBA_LABELS: Record<string, string> = {
    heslo: 'Nové heslo musí mít aspoň 10 znaků.',
    'heslo-spatne': 'Současné heslo nesedí — heslo se nezměnilo.',
    email: 'Zadej platný e-mail.',
    'email-obsazeny': 'E-mail se nepodařilo změnit (nejspíš už ho používá jiný účet).',
    'email-heslo': 'Heslo nesedí — e-mail se nezměnil.',
    smazani: 'Pro smazání účtu napiš do potvrzení přesně SMAZAT.',
    'smazani-heslo': 'Heslo nesedí — účet se nesmazal.',
    'portfolio-nazev': 'Zadej název portfolia (1–60 znaků).',
    'portfolio-limit': 'Maximum je 10 portfolií na účet.',
    'portfolio-posledni': 'Poslední portfolio smazat nejde.',
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">
          {profile ? 'Nastavení' : 'Nastav svůj daňový profil'}
        </h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Profil určuje, které limity Danero hlídá a jak počítá. Vše jde kdykoli změnit —
          výpočty se přepočítají od nuly.
          {allPortfolios.length > 1 && (
            <> Nastavuješ portfolio <strong className="text-inkoust">{portfolio.name}</strong>.</>
          )}
        </p>
      </header>

      {chyba && (
        <Toast
          kind="chyba"
          text={CHYBA_LABELS[chyba] ?? 'Formulář se nepodařilo uložit. Zkontroluj vyplněné hodnoty.'}
        />
      )}
      {ok && OK_LABELS[ok] && <Toast kind="ok" text={OK_LABELS[ok]} />}

      <form action={saveProfileAction} className="space-y-6">
        <input type="hidden" name="portfolioId" value={portfolio.id} />
        <Card className="space-y-4">
          <CardTitle>Kdo jsi vůči dani</CardTitle>
          <div>
            <Label htmlFor="regime">Daňový režim</Label>
            <Select id="regime" name="regime" defaultValue={profile?.regime ?? 'PAUSAL'}>
              <option value="PAUSAL">OSVČ v paušálním režimu (hlídá se limit 50 000 Kč)</option>
              <option value="ZAMESTNANEC">Zaměstnanec (hlídá se limit 20 000 Kč)</option>
              <option value="OSVC">OSVČ mimo paušál (přiznání podávám tak jako tak)</option>
              <option value="JINE">Jiné (hlídá se obecný limit 50 000 Kč)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="otherIncomeCzk">
              Další zdanitelné příjmy § 8–10 mimo investice (nájem apod.), Kč/rok
            </Label>
            <Input
              id="otherIncomeCzk"
              name="otherIncomeCzk"
              inputMode="decimal"
              defaultValue={profile?.otherIncomeCzk ?? '0'}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="hasBusinessAssets"
              defaultChecked={profile?.hasBusinessAssets ?? false}
              className="h-4 w-4 accent-[var(--ruzova)]"
            />
            Cenné papíry mám v obchodním majetku (ruší osvobození — netypické)
          </label>
        </Card>

        <Card className="space-y-4">
          <CardTitle>Metody výpočtu</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="matchingMethod">Párování prodejů (R-05c)</Label>
              <Select
                id="matchingMethod"
                name="matchingMethod"
                defaultValue={profile?.matchingMethod ?? 'FIFO'}
              >
                <option value="FIFO">FIFO — nejstarší kusy první (doporučeno)</option>
                <option value="LIFO">LIFO — nejnovější kusy první</option>
                <option value="MAX_PROFIT">Max. zisk — nejlevnější kusy první</option>
                <option value="MAX_LOSS">Max. ztráta — nejdražší kusy první</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="fxMethod">Měnové kurzy (R-06)</Label>
              <Select id="fxMethod" name="fxMethod" defaultValue={profile?.fxMethod ?? 'UNIFIED'}>
                <option value="UNIFIED">Jednotný kurz GFŘ</option>
                <option value="CNB_DAILY">Denní kurzy ČNB</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="limit100kStrict">Co se počítá do limitu 100k</Label>
              <Select
                id="limit100kStrict"
                name="limit100kStrict"
                defaultValue={(profile?.limit100kStrict ?? true) ? 'strict' : 'lenient'}
              >
                <option value="strict">Bezpečný výklad — všechny prodeje (doporučeno)</option>
                <option value="lenient">Mírnější výklad — jen prodeje bez časového testu (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Zákon jednoznačný není; finanční správa se kloní k přísnějšímu čtení.
                Mírnější výklad ti může osvobodit víc, ale neseš riziko doměrku.
              </p>
            </div>
            <div>
              <Label htmlFor="timeTestBasis">Báze časového testu (R-01a)</Label>
              <Select
                id="timeTestBasis"
                name="timeTestBasis"
                defaultValue={profile?.timeTestBasis ?? 'settlement'}
              >
                <option value="settlement">Datum vypořádání (dle pokynu D-59)</option>
                <option value="trade">Datum obchodu</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="derivativesExpensesPerDruh">
                Prémie bezcenně expirovaných opcí (R-12i)
              </Label>
              <Select
                id="derivativesExpensesPerDruh"
                name="derivativesExpensesPerDruh"
                defaultValue={(profile?.derivativesExpensesPerDruh ?? false) ? 'perDruh' : 'restrictive'}
              >
                <option value="restrictive">Opatrný výklad — neuplatnit jako výdaj (doporučeno)</option>
                <option value="perDruh">Mírnější výklad — výdaj celého druhu deriváty (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Když koupená opce vyprší bezcenná, oficiální výklad chybí. Mírnější čtení
                (výdaje se posuzují za celý druh příjmů) prémii uplatní proti ostatním
                derivátovým ziskům roku — sníží daň, ale neseš riziko doměrku.
              </p>
            </div>
          </div>
          <p className="text-xs text-inkoust-tlumeny">
            Přednastavené hodnoty jsou konzervativní a průkazné. Zvolená konfigurace se
            tiskne do každého reportu.
          </p>
        </Card>

        <SubmitButton pendingLabel="Ukládám…">Uložit profil</SubmitButton>
      </form>

      <Card className="space-y-4" id="2fa">
        <CardTitle>Dvoufaktorové ověření (2FA)</CardTitle>
        <TwoFactorSection enabled={user.twoFactorEnabled} />
      </Card>

      <Card className="space-y-4" id="portfolia">
        <CardTitle>Portfolia</CardTitle>
        <p className="text-sm text-inkoust-tlumeny">
          Oddělená portfolia pro další osoby (manžel/ka, děti) — každé má vlastní
          transakce, daňový profil, brokery i limity. Aktivní portfolio přepíná
          lišta nahoře.
        </p>
        <ul className="space-y-2">
          {allPortfolios.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <form action={renamePortfolioAction} className="flex items-center gap-2">
                <input type="hidden" name="portfolioId" value={p.id} />
                <Input
                  name="nazev"
                  defaultValue={p.name}
                  className="w-48"
                  aria-label={`Název portfolia ${p.name}`}
                />
                <SubmitButton size="sm" variant="secondary" pendingLabel="Ukládám…">
                  Přejmenovat
                </SubmitButton>
              </form>
              {p.id === portfolio.id && (
                <span className="rounded bg-zelena/10 px-1.5 py-0.5 text-xs font-medium text-zelena">
                  aktivní
                </span>
              )}
              {allPortfolios.length > 1 && (
                <form action={deletePortfolioAction} className="flex items-center gap-2">
                  <input type="hidden" name="portfolioId" value={p.id} />
                  <Input
                    name="potvrzeni"
                    placeholder="SMAZAT"
                    className="w-28"
                    aria-label={`Potvrzení smazání portfolia ${p.name}`}
                  />
                  <SubmitButton size="sm" variant="danger" pendingLabel="Mažu…">
                    Smazat
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
        <form action={createPortfolioAction} className="flex items-end gap-2 border-t border-linka pt-4">
          <div>
            <Label htmlFor="novePortfolio">Nové portfolio</Label>
            <Input id="novePortfolio" name="nazev" placeholder="např. Manželka" required maxLength={60} />
          </div>
          <SubmitButton size="sm" pendingLabel="Vytvářím…">Vytvořit</SubmitButton>
        </form>
      </Card>

      <Card className="space-y-5" id="ucet">
        <CardTitle>Účet</CardTitle>
        <p className="text-sm text-inkoust-tlumeny">
          Přihlášen jako <span className="font-medium text-inkoust">{user.email}</span>
        </p>

        <form action={changePasswordAction} className="space-y-3">
          <p className="text-sm font-semibold">Změna hesla</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="currentPassword">Současné heslo</Label>
              <Input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
            </div>
            <div>
              <Label htmlFor="newPassword">Nové heslo (min. 10 znaků)</Label>
              <Input id="newPassword" name="newPassword" type="password" required minLength={10} autoComplete="new-password" />
            </div>
          </div>
          <SubmitButton size="sm" pendingLabel="Měním…">Změnit heslo</SubmitButton>
        </form>

        <form action={changeEmailAction} className="space-y-3 border-t border-linka pt-4">
          <p className="text-sm font-semibold">Změna e-mailu</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="newEmail">Nový e-mail</Label>
              <Input id="newEmail" name="newEmail" type="email" required autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="emailPassword">Heslo (potvrzení)</Label>
              <Input
                id="emailPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
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
            className="inline-block rounded-md border border-linka px-3 py-1.5 text-sm font-medium hover:border-ruzova hover:text-ruzova"
          >
            Stáhnout export (JSON)
          </a>
        </div>

        <form action={deleteAccountAction} className="space-y-3 border-t border-linka pt-4">
          <p className="text-sm font-semibold text-cervena">Smazání účtu</p>
          <p className="text-sm text-inkoust-tlumeny">
            Nevratně smaže účet i všechna data — transakce, profil, šifrované broker
            klíče, notifikace i historii importů. Nejdřív si případně stáhni export.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="deletePassword">Heslo</Label>
              <Input id="deletePassword" name="password" type="password" required autoComplete="current-password" />
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

      <Card className="space-y-4" id="notifikace">
        <CardTitle>Notifikace</CardTitle>
        <form action={saveNotificationPrefsAction} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailEnabled" defaultChecked={prefs.emailEnabled} />
            Posílat upozornění e-mailem (denní souhrn)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="timeTestEvents" defaultChecked={prefs.timeTestEvents} />
            Časové testy — blížící se a dosažená osvobození pozic
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="limitEvents" defaultChecked={prefs.limitEvents} />
            Limity — vstup do kritického pásma a překročení (50k, 100k…)
          </label>
          <p className="text-xs text-inkoust-tlumeny">
            Vypnuté typy se nezakládají ani v aplikaci a při vypnutém e-mailu se nahromaděná
            upozornění NEposílají zpětně. Každý e-mail má odhlašovací odkaz.
          </p>
          <SubmitButton size="sm" pendingLabel="Ukládám…">Uložit notifikace</SubmitButton>
        </form>
      </Card>

      <Card className="space-y-4" id="aktivita">
        <CardTitle>Přihlášená zařízení a aktivita</CardTitle>
        <div className="space-y-2">
          <p className="text-sm font-semibold">
            Aktivní přihlášení ({sessions.length})
          </p>
          <ul className="space-y-1 text-sm text-inkoust-tlumeny">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs">
                  {s.createdAt.toLocaleString('cs-CZ')}
                </span>
                <span className="truncate">{s.userAgent ?? 'neznámé zařízení'}</span>
                {currentSession?.session.id === s.id && (
                  <span className="rounded bg-zelena/10 px-1.5 py-0.5 text-xs font-medium text-zelena">
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
                    {event.createdAt.toLocaleString('cs-CZ')}
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

      <Card className="space-y-4" id="trading212">
        <CardTitle>Trading212 — automatická synchronizace</CardTitle>
        {t212 ? (
          <>
            <p className="text-sm">
              <span className="font-semibold text-zelena">Připojeno.</span>{' '}
              <span className="text-inkoust-tlumeny">
                Poslední synchronizace:{' '}
                {t212.lastSyncedAt
                  ? `${t212.lastSyncedAt.toLocaleString('cs-CZ')} (${syncStatusLabel(t212.lastSyncStatus)})`
                  : 'zatím žádná — spusť ji na stránce Import'}
                . Klíč je uložen šifrovaně (AES-256-GCM) a nikdy se nezobrazuje.
              </span>
            </p>
            <form action={disconnectBrokerAction}>
              <input type="hidden" name="accountId" value={t212.id} />
              <SubmitButton variant="danger" size="sm" pendingLabel="Odpojuji…">
                Odpojit Trading212
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <div className="space-y-2 text-sm text-inkoust-tlumeny">
              <p>
                V Trading212 otevři <strong>Settings → API (Beta) → Generate key</strong> a
                nastav:
              </p>
              <ul className="space-y-1">
                <li>
                  <strong className="text-inkoust">Name:</strong> třeba „Danero" (jen popisek pro
                  tebe)
                </li>
                <li>
                  <strong className="text-inkoust">IP restrictions:</strong> Neomezené — Danero
                  volá API ze svého serveru a adresy se mění
                </li>
                <li>
                  <strong className="text-inkoust">Permissions — zaškrtni jen tyto (vše jen
                  čtení):</strong>{' '}
                  <span className="font-mono text-xs">
                    Account data · History (+ dividends, orders, transactions) · Metadata ·
                    Portfolio
                  </span>
                </li>
                <li className="text-cervena">
                  <strong>Nezaškrtávej:</strong>{' '}
                  <span className="font-mono text-xs">Orders (execute i read) · Pies</span> —
                  Danero nikdy nepotřebuje právo obchodovat ani cokoli měnit na tvém účtu.
                </li>
              </ul>
              <p>
                K čemu která práva jsou: History = stažení historie obchodů, dividend a úroků;
                Portfolio + Metadata = kontrola, že vypočtené pozice sedí s brokerem; Account
                data = ověření, že klíč funguje.
              </p>
            </div>
            {chyba === 'api-klic' && (
              <p className="text-sm text-cervena">Vlož platný tajný klíč (aspoň 10 znaků).</p>
            )}
            <p className="text-sm text-inkoust-tlumeny">
              Po vygenerování ti Trading212 ukáže <strong>dvě hodnoty</strong> — zkopíruj
              sem obě. Pozor: <strong>Tajný klíč se zobrazuje jen jednou</strong>; kdyby
              zmizel, prostě vygeneruj nový.
            </p>
            <form action={saveTrading212KeyAction} className="space-y-3">
              <input type="hidden" name="portfolioId" value={portfolio.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="keyId">ID klíče API</Label>
                  <Input id="keyId" name="keyId" autoComplete="off" spellCheck={false} />
                </div>
                <div>
                  <Label htmlFor="secret">Tajný klíč</Label>
                  <Input id="secret" name="secret" type="password" required autoComplete="off" />
                </div>
              </div>
              <SubmitButton pendingLabel="Ukládám…">Připojit</SubmitButton>
            </form>
          </>
        )}
      </Card>

      <Card className="space-y-4" id="ibkr">
        <CardTitle>Interactive Brokers — automatická synchronizace</CardTitle>
        {ibkr ? (
          <>
            <p className="text-sm">
              <span className="font-semibold text-zelena">Připojeno.</span>{' '}
              <span className="text-inkoust-tlumeny">
                Poslední synchronizace:{' '}
                {ibkr.lastSyncedAt
                  ? `${ibkr.lastSyncedAt.toLocaleString('cs-CZ')} (${syncStatusLabel(ibkr.lastSyncStatus)})`
                  : 'zatím žádná — spusť ji na stránce Import'}
                . Token je uložen šifrovaně (AES-256-GCM) a nikdy se nezobrazuje.
              </span>
            </p>
            <form action={disconnectBrokerAction}>
              <input type="hidden" name="accountId" value={ibkr.id} />
              <SubmitButton variant="danger" size="sm" pendingLabel="Odpojuji…">
                Odpojit Interactive Brokers
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <div className="space-y-2 text-sm text-inkoust-tlumeny">
              <p>
                Potřebuješ dvě věci: <strong>Flex Query</strong> (říká, co se stahuje) a{' '}
                <strong>token</strong> (přístup jen ke čtení výpisů). V IBKR Client Portal:
              </p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>
                  <strong className="text-inkoust">Performance &amp; Reports → Flex Queries →
                  „+" u Activity Flex Query.</strong>{' '}
                  Pojmenuj ji třeba „Danero".
                </li>
                <li>
                  Zapni sekce a úrovně přesně takto:{' '}
                  <span className="font-mono text-xs">
                    Trades = Executions · Cash Transactions = Detail · Corporate Actions =
                    Detail · Transfers = Detail · Open Positions = Summary
                  </span>{' '}
                  a v každé sekci zvol <strong className="text-inkoust">Select All</strong>{' '}
                  sloupce (musí obsahovat ISIN).
                </li>
                <li>
                  V Delivery Configuration nastav{' '}
                  <strong className="text-inkoust">Format XML</strong> a{' '}
                  <strong className="text-inkoust">Period „Last 365 Calendar Days"</strong>.
                  Ulož a poznamenej si <strong className="text-inkoust">Query ID</strong>{' '}
                  (číslo u názvu query).
                </li>
                <li>
                  <strong className="text-inkoust">Settings → Account Settings → Flex Web
                  Service</strong>{' '}
                  → aktivuj a zkopíruj <strong className="text-inkoust">token</strong>.
                </li>
              </ol>
              <p>
                Máš u IBKR historii starší než rok? Vytvoř si tutéž query ještě jednou
                s obdobím po letech (Custom Date Range), stáhni XML ručně a nahraj je na
                stránce Import — jednorázově, dál už vše řeší synchronizace.
              </p>
            </div>
            {chyba === 'ibkr' && (
              <p className="text-sm text-cervena">
                Vlož platný token (aspoň 10 znaků) a číselné Query ID.
              </p>
            )}
            <form action={saveIbkrKeyAction} className="space-y-3">
              <input type="hidden" name="portfolioId" value={portfolio.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="token">Token Flex Web Service</Label>
                  <Input id="token" name="token" type="password" required autoComplete="off" />
                </div>
                <div>
                  <Label htmlFor="queryId">Query ID</Label>
                  <Input
                    id="queryId"
                    name="queryId"
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <SubmitButton pendingLabel="Ukládám…">Připojit</SubmitButton>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
