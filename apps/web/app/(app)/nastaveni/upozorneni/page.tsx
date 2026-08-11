import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/card';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { buttonVariants } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { getDb } from '@/db';
import { resolveEntitlements } from '@/lib/entitlements';
import { requireUser } from '@/lib/session';
import { getNotificationPrefs } from '@/lib/notifications';
import {
  DEADLINE_LEAD_OPTIONS,
  LIMIT_THRESHOLD_OPTIONS,
  notificationRules,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';
import { plural } from '@/lib/format';
import { PRICE_SUBSCRIPTION_CZK, priceLabel } from '@/lib/pricing';
import { firstParam } from '@/lib/utils';
import { SettingsNav } from '../settings-nav';
import { SettingsSection } from '../settings-section';
import { SettingsToast } from '../settings-toast';
import { saveNotificationPrefsAction } from '../actions';

export const metadata = { title: 'Upozornění — Danero' };

/** Zaškrtávátko v mřížce voleb — stejný tvar pro lhůty i hranice. */
function CheckOption({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: number;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-[var(--ruzova)]"
      />
      {label}
    </label>
  );
}

export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string | string[]; ok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const params = await searchParams;
  const prefs = await getNotificationPrefs(db, user.id);
  const rules = notificationRules(prefs);
  // Rozesílku dělá cron jen platícím (api/cron/notify) — stránka to musí říct
  // rovnou, jinak si uživatel zdarma poctivě nastaví typy a frekvenci a pak
  // marně čeká na e-mail, který nikdy nepřijde.
  const entitlements = await resolveEntitlements(db, user.id);

  /** Věta „co ti teď chodí“ — ať uživatel nemusí nastavení zkoušet naostro. */
  const summaryLine = (): string => {
    if (!prefs.emailEnabled) return 'Teď ti nechodí žádné e-maily — upozornění najdeš jen v aplikaci.';
    const parts: string[] = [];
    if (prefs.timeTestEvents && rules.timeTestLeadDays.length > 0) {
      parts.push(
        `${rules.timeTestLeadDays.join(', ')} ${plural(rules.timeTestLeadDays.at(-1) ?? 0, 'den', 'dny', 'dní')} před osvobozením pozice`,
      );
    }
    if (prefs.limitEvents && rules.limitThresholdsPct.length > 0) {
      parts.push(`při ${rules.limitThresholdsPct.join(', ')} % čerpání limitu`);
    }
    if (prefs.calendarEmails) parts.push(`${rules.deadlineLeadDays} dní před termínem přiznání`);
    if (rules.summaryFrequency !== 'OFF') {
      parts.push(rules.summaryFrequency === 'MONTHLY' ? 'měsíční přehled' : 'čtvrtletní přehled');
    }
    if (parts.length === 0) return 'Zapnuté odesílání máš, ale nevybral sis žádnou událost — nic ti nepřijde.';
    return `Teď ti přijde e-mail: ${parts.join(' · ')}. Souhrn chodí ${
      prefs.emailFrequency === 'WEEKLY' ? 'jednou týdně' : 'nejvýš jednou denně'
    }.`;
  };

  return (
    <div className="max-w-4xl space-y-8">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Upozornění</h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Danero hlídá limity a časové testy každý den. Tady si řekneš, o čem ti má dát
            vědět e-mailem a jak často. V aplikaci upozornění uvidíš vždycky.
          </p>
        </div>
        <SettingsNav active="notifications" />
      </header>

      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      {!entitlements.notifications ? (
        /* Rozesílku dělá cron jen platícím — nabízet tu funkční přepínače by
           znamenalo slíbit e-maily, které nikdy nedorazí. */
        <Card className="space-y-4">
          <CardTitle>E-mailová upozornění</CardTitle>
          <p className="text-sm text-inkoust-tlumeny">
            Hlídáme za tebe časové testy, limity i termíny přiznání a dáme ti vědět
            e-mailem dřív, než bude pozdě — v den, kdy se to stane, nebo v týdenním
            souhrnu. Hranice i lhůty si nastavíš podle sebe.
          </p>
          <p className="text-sm font-semibold">
            Součást hlídání za {priceLabel(PRICE_SUBSCRIPTION_CZK)} ročně.
          </p>
          <div>
            <Link href="/predplatne" className={buttonVariants({ variant: 'primary' })}>
              Objednat hlídání
            </Link>
          </div>
          <p className="text-sm text-inkoust-tlumeny">
            Upozornění v aplikaci vidíš i bez předplatného — spočítáme je vždy, když si
            otevřeš přehled. Placené je jen to, že za tebou přijdou samy.
          </p>
        </Card>
      ) : (
        <form action={saveNotificationPrefsAction} className="space-y-8">
          <Card className="space-y-5">
            <CardTitle>Odesílání</CardTitle>

            <Switch
              name="emaily-zapnute"
              defaultChecked={prefs.emailEnabled}
              label="Posílat e-maily"
            />
            <p className="text-sm text-inkoust-tlumeny">
              Hlavní vypínač. Vypnuté typy se po zapnutí nehromadí zpětně a každý e-mail má
              odhlašovací odkaz.
            </p>

            <SettingsSection
              title="Jak často"
              description="Souhrn sbírá události od posledního e-mailu, takže z jednoho rušného dne nepřijde pět zpráv."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="frekvence-emailu">Frekvence souhrnu</Label>
                  <Select
                    id="frekvence-emailu"
                    name="frekvence-emailu"
                    defaultValue={prefs.emailFrequency === 'WEEKLY' ? 'WEEKLY' : 'DAILY'}
                  >
                    <option value="DAILY">Denně — nejvýš jeden e-mail za den</option>
                    <option value="WEEKLY">Týdně — jeden souhrn za týden</option>
                  </Select>
                </div>
              </div>
              <Switch
                name="nalehave-hned"
                defaultChecked={rules.urgentImmediately}
                label="Naléhavé posílat hned, i mimo týdenní souhrn"
              />
              <p className="text-xs text-inkoust-tlumeny">
                Naléhavé = prolomený limit, osvobození do sedmi dní a blížící se termín
                přiznání. Bez tohohle by v týdenním režimu dorazily klidně až šest dní po
                tom, co se staly.
              </p>
            </SettingsSection>
          </Card>

          <Card className="space-y-5">
            <CardTitle>Co hlídat</CardTitle>

            <SettingsSection
              title="Blížící se osvobození"
              description="Tříletý časový test u konkrétních kusů. Vyber, kolik dní předem chceš vědět, že se prodej stane osvobozeným."
            >
              <Switch
                name="upozorneni-casove-testy"
                defaultChecked={prefs.timeTestEvents}
                label="Hlídat časové testy"
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Kolik dní předem</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TIME_TEST_LEAD_OPTIONS.map((days) => (
                    <CheckOption
                      key={days}
                      name="lhuta-casoveho-testu"
                      value={days}
                      label={`${days} ${plural(days, 'den', 'dny', 'dní')} předem`}
                      defaultChecked={rules.timeTestLeadDays.includes(days)}
                    />
                  ))}
                </div>
              </fieldset>
              <Switch
                name="osvobozeno-hotovo"
                defaultChecked={rules.timeTestDone}
                label="Ozvat se i ve chvíli, kdy pozice test právě splnila"
              />
            </SettingsSection>

            <SettingsSection
              title="Limity"
              description="Roční limity, které Danero vede podle tvého režimu — osvobození prodejů i krypta a hranice pro podání přiznání. Ozveme se při každé zaškrtnuté hranici čerpání."
            >
              <Switch
                name="upozorneni-limity"
                defaultChecked={prefs.limitEvents}
                label="Hlídat limity"
              />
              <fieldset>
                <legend className="mb-2 text-sm font-medium">Při jakém čerpání</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {LIMIT_THRESHOLD_OPTIONS.map((percent) => (
                    <CheckOption
                      key={percent}
                      name="hranice-limitu"
                      value={percent}
                      label={percent === 100 ? '100 % — prolomení' : `${percent} % limitu`}
                      defaultChecked={rules.limitThresholdsPct.includes(percent)}
                    />
                  ))}
                </div>
              </fieldset>
            </SettingsSection>

            <SettingsSection
              title="Daňový kalendář"
              description="Lednové shrnutí uplynulého roku a připomínka termínu přiznání."
            >
              <Switch
                name="upozorneni-kalendar"
                defaultChecked={prefs.calendarEmails}
                label="Hlídat termíny přiznání"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="lhuta-terminu">Připomenout termín</Label>
                  <Select
                    id="lhuta-terminu"
                    name="lhuta-terminu"
                    defaultValue={String(rules.deadlineLeadDays)}
                  >
                    {DEADLINE_LEAD_OPTIONS.map((days) => (
                      <option key={days} value={days}>
                        {days} dní před termínem
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              title="Pravidelný přehled"
              description="Jediný e-mail, který přijde, i když se nic nestalo: čerpání limitů, nejbližší osvobození a orientační daň. Hodí se, když chceš mít jistotu, že hlídač běží."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="pravidelny-prehled">Jak často posílat</Label>
                  <Select
                    id="pravidelny-prehled"
                    name="pravidelny-prehled"
                    defaultValue={rules.summaryFrequency}
                  >
                    <option value="OFF">Neposílat</option>
                    <option value="MONTHLY">Jednou měsíčně</option>
                    <option value="QUARTERLY">Jednou za čtvrtletí</option>
                  </Select>
                </div>
              </div>
            </SettingsSection>
          </Card>

          <Card className="space-y-2">
            <CardTitle>Co ti teď chodí</CardTitle>
            <p className="text-sm text-inkoust-tlumeny">{summaryLine()}</p>
            <p className="text-xs text-inkoust-tlumeny">
              Změny se ukládají automaticky. Upozornění se počítají z dat, která máš
              v Daneru — po napojení brokera nebo nahrání výpisu se projeví hned další den.
            </p>
          </Card>

          <AutoSubmit />
        </form>
      )}
    </div>
  );
}
