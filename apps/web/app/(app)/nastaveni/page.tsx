import { and, eq } from 'drizzle-orm';
import { Card, CardTitle } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label, Select } from '@/components/ui/field';
import { getDb } from '@/db';
import { brokerAccounts } from '@/db/schema';
import { getProfile } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { disconnectTrading212Action, saveProfileAction, saveTrading212KeyAction } from './actions';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  const t212Accounts = await db
    .select()
    .from(brokerAccounts)
    .where(and(eq(brokerAccounts.userId, user.id), eq(brokerAccounts.broker, 'trading212')));
  const t212 = t212Accounts[0];
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
              name="w8benFiled"
              defaultChecked={profile?.w8benFiled ?? true}
              className="h-4 w-4 accent-[var(--ruzova)]"
            />
            Mám u brokera podaný W-8BEN (US dividendy se sráží 15 %)
          </label>
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
              <Label htmlFor="limit100kStrict">Úhrn pro limit 100k (R-02c)</Label>
              <Select
                id="limit100kStrict"
                name="limit100kStrict"
                defaultValue={(profile?.limit100kStrict ?? true) ? 'strict' : 'lenient'}
              >
                <option value="strict">Striktní — počítají se i prodeje po časovém testu</option>
                <option value="lenient">Mírnější — jen prodeje bez časového testu</option>
              </Select>
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

      <Card className="space-y-4" id="trading212">
        <CardTitle>Trading212 — automatická synchronizace</CardTitle>
        {t212 ? (
          <>
            <p className="text-sm">
              <span className="font-semibold text-zelena">Připojeno.</span>{' '}
              <span className="text-inkoust-tlumeny">
                Poslední synchronizace:{' '}
                {t212.lastSyncedAt
                  ? `${t212.lastSyncedAt.toLocaleString('cs-CZ')} (${t212.lastSyncStatus})`
                  : 'zatím žádná — spusť ji na stránce Import'}
                . Klíč je uložen šifrovaně (AES-256-GCM) a nikdy se nezobrazuje.
              </span>
            </p>
            <form action={disconnectTrading212Action}>
              <SubmitButton variant="danger" size="sm" pendingLabel="Odpojuji…">
                Odpojit Trading212
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-inkoust-tlumeny">
              V Trading212 otevři Settings → API (Beta) a vygeneruj klíč jen s právy pro
              čtení. Danero pak samo stahuje novou historii a hlídá, že pozice sedí.
            </p>
            {chyba === 'api-klic' && (
              <p className="text-sm text-cervena">Vlož platný API klíč (aspoň 10 znaků).</p>
            )}
            <form action={saveTrading212KeyAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="apiKey">API klíč (read-only)</Label>
                <Input id="apiKey" name="apiKey" type="password" required autoComplete="off" />
              </div>
              <SubmitButton pendingLabel="Ukládám…">Připojit</SubmitButton>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}
