import { eq } from 'drizzle-orm';
import { TwoFactorSection } from '@/components/two-factor-section';
import { syncStatusLabel } from '@/lib/broker-sync';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label, Select } from '@/components/ui/field';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { getProfile } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import {
  disconnectBrokerAction,
  saveIbkrKeyAction,
  saveProfileAction,
  saveTrading212KeyAction,
} from './actions';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  const accounts = await db
    .select()
    .from(brokerAccounts)
    .where(eq(brokerAccounts.userId, user.id));
  const t212 = accounts.find((account) => account.broker === 'trading212');
  const ibkr = accounts.find((account) => account.broker === 'ibkr');
  const { chyba } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">
          {profile ? 'Nastavení' : 'Nastav svůj daňový profil'}
        </h1>
        <p className="mt-1 text-sm text-inkoust-tlumeny">
          Profil určuje, které limity Danero hlídá a jak počítá. Vše jde kdykoli změnit —
          výpočty se přepočítají od nuly.
        </p>
      </header>

      {chyba && (
        <p className="rounded-md border border-cervena px-4 py-3 text-sm text-cervena">
          Formulář se nepodařilo uložit. Zkontroluj vyplněné hodnoty.
        </p>
      )}

      <form action={saveProfileAction} className="space-y-6">
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
