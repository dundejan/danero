import { d } from '@danero/shared';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toast } from '@/components/toast';
import { TwoFactorSection } from '@/components/two-factor-section';
import { Card, CardTitle } from '@/components/ui/card';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { getDb } from '@/db';
import { getProfile, listPinnedTaxYears } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { getAuth } from '@/lib/auth';
import { headers } from 'next/headers';
import { AUDIT_LABELS, recentAuditEvents, type AuditType } from '@/lib/audit';
import { getNotificationPrefs } from '@/lib/notifications';
import { humanizeUserAgent } from '@/lib/ua';
import { czDateTime, METHOD_LABEL } from '@/lib/format';
import { firstParam } from '@/lib/utils';
import {
  changeEmailAction,
  changePasswordAction,
  deleteAccountAction,
  revokeOtherSessionsAction,
  saveNotificationPrefsAction,
  saveProfileAction,
  unpinMatchingMethodAction,
} from './actions';

export const metadata = { title: 'Nastavení — Danero' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string | string[]; ok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  const params = await searchParams;
  const chyba = firstParam(params.chyba);
  const ok = firstParam(params.ok);
  const requestHeaders = await headers();
  const auth = await getAuth();
  const sessions = await auth.api.listSessions({ headers: requestHeaders });
  const currentSession = await auth.api.getSession({ headers: requestHeaders });
  const auditEvents = await recentAuditEvents(db, user.id);
  const prefs = await getNotificationPrefs(db, user.id);
  // R-05c: roky, které si drží metodu párování z doby, kdy se za ně generovaly podklady
  const pinnedYears = await listPinnedTaxYears(db, user.id);

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
  const OK_LABELS: Record<string, string> = {
    heslo: 'Heslo změněno. Ostatní zařízení byla odhlášena.',
    email: 'E-mail změněn. Poslali jsme na novou adresu ověřovací odkaz — potvrď ho, jinak se příště nepřihlásíš.',
    odhlaseno: 'Ostatní zařízení byla odhlášena.',
    profil: 'Uloženo. Výpočty se přepočítají podle nového profilu.',
    notifikace: 'Uloženo. E-maily se řídí novým nastavením.',
    fixace: 'Fixace zrušená. Rok se zase počítá metodou vybranou v profilu.',
  };
  const CHYBA_LABELS: Record<string, string> = {
    heslo: 'Nové heslo musí mít aspoň 10 znaků.',
    'heslo-spatne': 'Současné heslo nesedí — heslo se nezměnilo.',
    email: 'Zadej platný e-mail.',
    'email-obsazeny': 'E-mail se nepodařilo změnit (nejspíš už ho používá jiný účet).',
    'email-ulozeni': 'E-mail se teď nepodařilo změnit — zkus to prosím za chvíli.',
    'email-heslo': 'Heslo nesedí — e-mail se nezměnil.',
    smazani: 'Pro smazání účtu napiš do potvrzení přesně SMAZAT.',
    'smazani-heslo': 'Heslo nesedí — účet se nesmazal.',
    // ochrana účtu (D-2/D-3): po několika pokusech se operace na pár minut zamkne
    'heslo-limit': 'Moc pokusů o změnu hesla po sobě — zkus to prosím za pět minut.',
    'email-limit': 'Moc pokusů o změnu e-mailu po sobě — zkus to prosím za pět minut.',
    'smazani-limit': 'Moc pokusů o smazání účtu po sobě — zkus to prosím za pět minut.',
    fixace: 'Fixaci se nepodařilo zrušit — zkus to prosím znovu.',
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">
          {profile ? 'Nastavení' : 'Nastav svůj daňový profil'}
        </h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Profil určuje, které limity Danero hlídá a jak počítá. Vše jde kdykoli změnit —
          výpočty se přepočítají od nuly.
          {profile && ' Změny se ukládají automaticky.'}
        </p>
      </header>

      {/* plovoucí toast: po auto-save s kotvou (#dan, #notifikace) musí být
          potvrzení vidět bez ohledu na pozici scrollu */}
      {chyba && (
        <Toast
          // klíč per render: po dalším uložení se toast musí remountnout,
          // jinak by visible=false z minula potvrzení skrylo
          key={crypto.randomUUID()}
          kind="chyba"
          floating
          text={CHYBA_LABELS[chyba] ?? 'Formulář se nepodařilo uložit. Zkontroluj vyplněné hodnoty.'}
        />
      )}
      {ok && OK_LABELS[ok] && <Toast key={crypto.randomUUID()} kind="ok" floating text={OK_LABELS[ok]} />}

      {/* dva sloupce na širokém displeji: vlevo daňový profil,
          vpravo účet a zabezpečení — na mobilu jeden logický sloupec */}
      <div className="grid items-start gap-8 xl:grid-cols-2">
        <div className="space-y-8">
          <form action={saveProfileAction} className="space-y-6" id="dan">
            <Card className="space-y-4">
              <CardTitle>Kdo jsi vůči dani</CardTitle>
              <div>
                <Label htmlFor="rezim">Daňový režim</Label>
                <Select id="rezim" name="rezim" defaultValue={profile?.regime ?? 'PAUSAL'}>
                  <option value="PAUSAL">OSVČ v paušálním režimu (hlídá se limit 50 000 Kč)</option>
                  <option value="ZAMESTNANEC">Zaměstnanec (hlídá se limit 20 000 Kč)</option>
                  <option value="OSVC">OSVČ mimo paušál (přiznání podávám tak jako tak)</option>
                  <option value="JINE">Jiné (hlídá se obecný limit 50 000 Kč)</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="ostatni-prijmy">
                  Další zdanitelné příjmy § 8–10 mimo investice (nájem apod.), Kč/rok
                </Label>
                <Input
                  id="ostatni-prijmy"
                  name="ostatni-prijmy"
                  inputMode="decimal"
                  // DB numeric vrací „0.00“ — do pole patří lidské „0“ (uložení/parsování beze změny)
                  defaultValue={d(profile?.otherIncomeCzk ?? '0').toString()}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="obchodni-majetek"
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
                  <Label htmlFor="parovani" title="Pravidlo R-05c v metodice Danero">
                    Párování prodejů
                  </Label>
                  <Select
                    id="parovani"
                    name="parovani"
                    defaultValue={profile?.matchingMethod ?? 'FIFO'}
                  >
                    <option value="FIFO">FIFO — nejstarší kusy první (doporučeno)</option>
                    <option value="LIFO">LIFO — nejnovější kusy první</option>
                    <option value="MAX_PROFIT">Max. zisk — nejlevnější kusy první</option>
                    <option value="MAX_LOSS">Max. ztráta — nejdražší kusy první</option>
                  </Select>
                  <p className="mt-1 text-xs text-inkoust-tlumeny">
                    Změna platí pro roky, za které sis ještě nevygeneroval podklady k přiznání
                    — ty už podané si drží metodu, se kterou byly spočítané (zákon u párování
                    prodejů žádá konzistenci).{profile && ' Seznam je pod formulářem.'}
                  </p>
                </div>
                <div>
                  <Label htmlFor="kurzy" title="Pravidlo R-06 v metodice Danero">
                    Měnové kurzy
                  </Label>
                  <Select id="kurzy" name="kurzy" defaultValue={profile?.fxMethod ?? 'UNIFIED'}>
                    <option value="UNIFIED">Jednotný kurz GFŘ</option>
                    <option value="CNB_DAILY">Denní kurzy ČNB</option>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="limit-100k">Co se počítá do limitu 100k</Label>
                  <Select
                    id="limit-100k"
                    name="limit-100k"
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
                  <Label htmlFor="zaklad-casoveho-testu" title="Pravidlo R-01a v metodice Danero">
                    Báze časového testu
                  </Label>
                  <Select
                    id="zaklad-casoveho-testu"
                    name="zaklad-casoveho-testu"
                    defaultValue={profile?.timeTestBasis ?? 'settlement'}
                  >
                    <option value="settlement">Datum vypořádání (dle pokynu D-59)</option>
                    <option value="trade">Datum obchodu</option>
                  </Select>
                  <p className="mt-1 text-xs text-inkoust-tlumeny">
                    Od kterého data se počítají 3 roky držení.
                  </p>
                </div>
                <div>
                  <Label htmlFor="derivaty-vydaje" title="Pravidlo R-12i v metodice Danero">
                    Prémie bezcenně expirovaných opcí
                  </Label>
                  <Select
                    id="derivaty-vydaje"
                    name="derivaty-vydaje"
                    defaultValue={(profile?.derivativesExpensesPerType ?? false) ? 'perType' : 'restrictive'}
                  >
                    <option value="restrictive">Opatrný výklad — neuplatnit jako výdaj (doporučeno)</option>
                    <option value="perType">Mírnější výklad — výdaj celého druhu deriváty (sporné)</option>
                  </Select>
                  <p className="mt-1 text-xs text-inkoust-tlumeny">
                    Když koupená opce vyprší bezcenná, oficiální výklad chybí. Mírnější čtení
                    (výdaje se posuzují za celý druh příjmů) prémii uplatní proti ostatním
                    derivátovým ziskům roku — sníží daň, ale neseš riziko doměrku.
                  </p>
                </div>
                <div>
                  <Label htmlFor="emt-casovy-test" title="Pravidlo R-10g v metodice Danero">
                    Stablecoiny a časový test
                  </Label>
                  <Select
                    id="emt-casovy-test"
                    name="emt-casovy-test"
                    defaultValue={(profile?.emtTimeTestExempt ?? false) ? 'lenient' : 'safe'}
                  >
                    <option value="safe">Opatrný výklad — stablecoiny se daní i po 3 letech (doporučeno)</option>
                    <option value="lenient">Mírnější výklad — po 3 letech držení bez daně i stablecoiny (sporné)</option>
                  </Select>
                  <p className="mt-1 text-xs text-inkoust-tlumeny">
                    Stablecoiny (USDT, USDC…) zákon vylučuje z osvobození do 100 000 Kč — jejich
                    prodej se daní vždy. Zda pro ně platí aspoň tříleté osvobození, jasné není;
                    mírnější čtení má oporu v textu zákona, ale neseš riziko doměrku.
                  </p>
                </div>
              </div>
              <p className="text-xs text-inkoust-tlumeny">
                Přednastavené hodnoty jsou konzervativní a průkazné. Zvolená konfigurace se
                tiskne do každého reportu.
              </p>
            </Card>

            {/* auto-save: každá změna se uloží sama; bez profilu je potřeba
                první uložení potvrdit tlačítkem (auto-save by nováčka po první
                změně přesměroval na /prehled uprostřed vyplňování) */}
            {profile && <AutoSubmit />}
            {!profile && <SubmitButton pendingLabel="Ukládám…">Uložit profil</SubmitButton>}
          </form>

          {/* R-05c — mimo formulář profilu: vnořené <form> HTML nedovoluje
              (a auto-save nahoře by se se zrušením fixace pral) */}
          {profile && (
            <Card className="space-y-3" id="fixace">
              <CardTitle>Roky se zafixovaným párováním</CardTitle>
              {pinnedYears.length === 0 ? (
                <p className="text-sm text-inkoust-tlumeny">
                  Zatím žádný. Jakmile si za skončený rok vygeneruješ podklady k přiznání,
                  metodu párování pro ten rok zafixujeme — pozdější změna nastavení už ho
                  nepřepočítá, aby čísla v odeslaném přiznání zůstala platná.
                </p>
              ) : (
                <>
                  <p className="text-sm text-inkoust-tlumeny">
                    Za tyhle roky sis už vygeneroval podklady, takže se počítají pořád
                    stejnou metodou — i když nahoře vybereš jinou.
                  </p>
                  <ul className="space-y-3">
                    {pinnedYears.map((pinned) => (
                      <li key={pinned.taxYear} className="border-t border-linka pt-3 first:border-0 first:pt-0">
                        <p className="text-sm">
                          <span className="font-semibold">{pinned.taxYear}</span> —{' '}
                          {METHOD_LABEL[pinned.matchingMethod] ?? pinned.matchingMethod}{' '}
                          <span className="text-inkoust-tlumeny">
                            (zafixováno {czDateTime(pinned.pinnedAt)})
                          </span>
                        </p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-sm text-inkoust-tlumeny hover:text-inkoust">
                            Zrušit fixaci roku {pinned.taxYear}
                          </summary>
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-inkoust-tlumeny">
                              Rok {pinned.taxYear} se pak přepočítá metodou z nastavení výš (
                              {METHOD_LABEL[profile.matchingMethod] ?? profile.matchingMethod}) a
                              čísla se můžou lišit od těch, které jsi už poslal na finanční úřad.
                              Dělej to jen tehdy, když za ten rok budeš podávat dodatečné přiznání.
                            </p>
                            <form action={unpinMatchingMethodAction}>
                              <input type="hidden" name="rok" value={pinned.taxYear} />
                              <SubmitButton variant="danger" size="sm" pendingLabel="Ruším…">
                                Ano, zrušit fixaci roku {pinned.taxYear}
                              </SubmitButton>
                            </form>
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
        </div>

        {/* pravý sloupec: účet a zabezpečení */}
        <div className="space-y-8">
          <Card className="space-y-5" id="ucet">
            <CardTitle>Účet</CardTitle>
            <p className="text-sm text-inkoust-tlumeny">
              Přihlášený účet: <span className="font-medium text-inkoust">{user.email}</span>
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
                className="inline-block rounded-md border border-linka px-3 py-1.5 text-sm font-medium hover:border-inkoust-tlumeny"
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
      </div>
    </div>
  );
}
