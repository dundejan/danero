import { AutoSubmit } from '@/components/ui/auto-submit';
import { Select } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { FieldRow, Group, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { Section } from '@/components/ui/section';
import { Switch } from '@/components/ui/switch';
import { typeset } from '@/components/typeset';
import { getDb } from '@/db';
import { ownerTag } from '@/lib/owner-tag';
import { requireUser } from '@/lib/session';
import { getNotificationPrefs } from '@/lib/notifications';
import {
  DEADLINE_LEAD_OPTIONS,
  LIMIT_THRESHOLD_OPTIONS,
  notificationRules,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';
import { BASELINE_FIELD, encodeBaseline } from '@/lib/form-baseline';
import { plural } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { SettingsToolbar } from '../settings-nav';
import { autoSaveNotificationPrefsAction } from '../actions';
import { NOTIFICATION_FIELDS, notificationFormEntries } from '../form-state';

export const metadata = { title: 'Upozornění — Danero' };

/**
 * Volby, které bez svého vypínače nic neznamenají, se s ním schovají — hned,
 * bez čekání na server (`:has()` nad stavem přepínače). Schované pole se
 * odesílá dál (`display: none` formulář nevynechá), takže vypnutí a zapnutí
 * nic neztratí. Řádek se k vypínači hlásí třídou, skupina vyjmenuje, čí
 * vypínač hlídá — třídy musí stát v kódu celé, jinak je Tailwind nevygeneruje.
 */
const NEEDS_EMAIL = 'needs-email';
const NEEDS_SWITCH = 'needs-switch';
const HIDE_WITHOUT_EMAIL = '[&:has(#emaily-zapnute:not(:checked))_.needs-email]:hidden';
const HIDE_WITHOUT = {
  'upozorneni-casove-testy': 
    '[&:has(#upozorneni-casove-testy:not(:checked))>.needs-switch]:hidden [&:has(#upozorneni-casove-testy:not(:checked))>*]:border-b-0',
  'upozorneni-limity': 
    '[&:has(#upozorneni-limity:not(:checked))>.needs-switch]:hidden [&:has(#upozorneni-limity:not(:checked))>*]:border-b-0',
  'upozorneni-kalendar': 
    '[&:has(#upozorneni-kalendar:not(:checked))>.needs-switch]:hidden [&:has(#upozorneni-kalendar:not(:checked))>*]:border-b-0',
} as const;
/** Osamělý řádek s vypínačem nemá mít pod sebou linku ke schovaným sousedům. */
const LONE_EMAIL_SWITCH = '[&:has(#emaily-zapnute:not(:checked))>*]:border-b-0';

/**
 * Řádek s výběrem několika hodnot naráz (lhůty, hranice): popisek vlevo,
 * vpravo řada zaškrtávacích políček ve tvaru přepínacích tlačítek. Políčka
 * jsou nativní — formulář, klávesnice i čtečka fungují bez JavaScriptu;
 * čtečce `suffix` doplní, co číslo znamená („90 dní předem“).
 */
function ChoiceRow({
  id,
  label,
  name,
  options,
  className,
}: {
  id: string;
  label: string;
  name: string;
  options: { value: number; text: string; suffix: string; checked: boolean }[];
  className?: string;
}) {
  return (
    <FieldRow label={label} labelId={id} fit className={className}>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="type-footnote inline-flex h-7 min-w-10 items-center justify-center rounded-md bg-control px-2 tabular-nums text-ink has-checked:bg-accent-fill has-checked:font-semibold has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent pointer-coarse:h-11 pointer-coarse:min-w-11"
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={option.checked}
              className="sr-only"
            />
            {option.text}
            <span className="sr-only">{option.suffix}</span>
          </label>
        ))}
      </div>
    </FieldRow>
  );
}

export default async function NotificationSettingsPage() {
  const user = await requireUser();
  const db = await getDb();
  const prefs = await getNotificationPrefs(db, user.id);
  const rules = notificationRules(prefs);
  // Stav, se kterým se formulář vykreslí: výchozí hodnoty polí i skryté pole,
  // podle kterého server pozná, co člověk změnil (`lib/form-baseline.ts`).
  const baseline = encodeBaseline(notificationFormEntries(prefs));
  const shown = new URLSearchParams(baseline);

  // Souhrn „Co ti teď chodí“ tu býval jako sekce nad formulářem; v nové skladbě
  // jen větami opakoval přepínače a štítky o obrazovku níž (R1B-16). Zůstává
  // jediný stav, který z ovládání na první pohled vidět není: odesílání je
  // zapnuté, ale nic vybraného, takže nepřijde nic.
  const nothingSelected =
    prefs.emailEnabled &&
    !(prefs.timeTestEvents && (rules.timeTestLeadDays.length > 0 || rules.timeTestDone)) &&
    !(prefs.limitEvents && rules.limitThresholdsPct.length > 0) &&
    !prefs.calendarEmails &&
    rules.summaryFrequency === 'OFF';

  return (
    <>
      <SettingsToolbar active="notifications" />

      <div className="@container max-w-[44rem] space-y-14 pt-2 md:pt-4">
        {nothingSelected && (
          <Notice tone="caution" title="Odesílání je zapnuté, ale nic ti nepřijde">
            Není vybraná žádná událost ani pravidelný přehled.
          </Notice>
        )}
        {/* `autoComplete="off"`: prohlížeč do formuláře s auto-save nevrací po
            F5 staré hodnoty — viz `AutoSubmit`. Klíč: s jiným stavem ze
            serveru se formulář vykreslí celý znovu, aby pole a skrytý stav
            zůstaly v páru (proč, je u formuláře daňového profilu). */}
        <form
          key={baseline}
          autoComplete="off"
          className={cn('space-y-14', HIDE_WITHOUT_EMAIL)}
        >
          <input type="hidden" name={BASELINE_FIELD} value={baseline} />
          <Section
            title="Odesílání"
            info={
              <InfoPopover label="jak fungují e-maily z Danera" title="E-maily z Danera">
                <p>
                  {typeset(
                    'Danero hlídá limity a časové testy každý den. Tady si řekneš, o čem ti má dát vědět e-mailem a jak často — v aplikaci upozornění uvidíš vždycky.',
                  )}
                </p>
                <p>
                  {typeset(
                    'Upozornění se počítají z dat, která máš v Daneru: po napojení brokera nebo nahrání výpisu se projeví hned další den. Každý e-mail má odhlašovací odkaz.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Group variant="inset" className={LONE_EMAIL_SWITCH}>
              <Row
                label={<label htmlFor="emaily-zapnute">{typeset('Posílat e-maily')}</label>}
                hint="V aplikaci upozornění uvidíš vždycky."
                info={
                  <InfoPopover label="hlavní vypínač e-mailů" title="Posílat e-maily">
                    <p>
                      {typeset(
                        'Hlavní vypínač. Vypnuté typy se po zapnutí nehromadí zpětně a každý e-mail má odhlašovací odkaz.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Switch
                  id="emaily-zapnute"
                  name="emaily-zapnute"
                  defaultChecked={shown.has(NOTIFICATION_FIELDS.emailEnabled)}
                />
              </Row>
              <FieldRow
                className={NEEDS_EMAIL}
                label="Souhrn"
                htmlFor="frekvence-emailu"
                info={
                  <InfoPopover label="jak funguje souhrn" title="Souhrn">
                    <p>
                      {typeset(
                        'Souhrn sbírá události od posledního e-mailu, takže z jednoho rušného dne nepřijde pět zpráv.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Select
                  id="frekvence-emailu"
                  name="frekvence-emailu"
                  defaultValue={shown.get(NOTIFICATION_FIELDS.emailFrequency) ?? ''}
                >
                  <option value="DAILY">Nejvýš jednou denně</option>
                  <option value="WEEKLY">Jednou týdně</option>
                </Select>
              </FieldRow>
              <Row
                className={NEEDS_EMAIL}
                label={<label htmlFor="nalehave-hned">Naléhavé posílat hned</label>}
                hint="I mimo souhrn."
                info={
                  <InfoPopover label="co je naléhavé" title="Naléhavé posílat hned">
                    <p>
                      {typeset(
                        'Naléhavé = prolomený limit, osvobození do sedmi dní a blížící se termín přiznání. Bez tohohle by v týdenním režimu dorazily klidně až šest dní po tom, co se staly.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Switch
                  id="nalehave-hned"
                  name="nalehave-hned"
                  defaultChecked={shown.has(NOTIFICATION_FIELDS.urgentImmediately)}
                />
              </Row>
              <FieldRow
                className={NEEDS_EMAIL}
                label="Pravidelný přehled"
                htmlFor="pravidelny-prehled"
                info={
                  <InfoPopover label="co je v pravidelném přehledu" title="Pravidelný přehled">
                    <p>
                      {typeset(
                        'Jediný e-mail, který přijde, i když se nic nestalo: čerpání limitů, nejbližší osvobození a orientační daň. Hodí se, když chceš mít jistotu, že hlídač běží.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Select
                  id="pravidelny-prehled"
                  name="pravidelny-prehled"
                  defaultValue={shown.get(NOTIFICATION_FIELDS.summaryFrequency) ?? ''}
                >
                  <option value="OFF">Neposílat</option>
                  <option value="MONTHLY">Jednou měsíčně</option>
                  <option value="QUARTERLY">Jednou za čtvrtletí</option>
                </Select>
              </FieldRow>
            </Group>
          </Section>

          <Section title="Co hlídat" className={NEEDS_EMAIL}>
            <div className="space-y-5">
              <Group variant="inset" className={HIDE_WITHOUT['upozorneni-casove-testy']}>
                <Row
                  label={<label htmlFor="upozorneni-casove-testy">Blížící se osvobození</label>}
                  info={
                    <InfoPopover label="hlídání časových testů" title="Blížící se osvobození">
                      <p>
                        {typeset(
                          'Tříletý časový test u konkrétních kusů. Vyber, kolik dní předem chceš vědět, že se prodej stane osvobozeným.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-casove-testy"
                    name="upozorneni-casove-testy"
                    defaultChecked={shown.has(NOTIFICATION_FIELDS.timeTestEvents)}
                  />
                </Row>
                <ChoiceRow
                  className={NEEDS_SWITCH}
                  id="lhuta-casoveho-testu-popisek"
                  label="Kolik dní předem"
                  name="lhuta-casoveho-testu"
                  options={TIME_TEST_LEAD_OPTIONS.map((days) => ({
                    value: days,
                    text: String(days),
                    suffix: ` ${plural(days, 'den', 'dny', 'dní')} předem`,
                    checked: shown.getAll(NOTIFICATION_FIELDS.timeTestLeadDays).includes(String(days)),
                  }))}
                />
                <Row
                  className={NEEDS_SWITCH}
                  label={<label htmlFor="osvobozeno-hotovo">I ve chvíli, kdy pozice test splní</label>}
                >
                  <Switch
                    id="osvobozeno-hotovo"
                    name="osvobozeno-hotovo"
                    defaultChecked={shown.has(NOTIFICATION_FIELDS.timeTestDone)}
                  />
                </Row>
              </Group>

              <Group variant="inset" className={HIDE_WITHOUT['upozorneni-limity']}>
                <Row
                  label={<label htmlFor="upozorneni-limity">Limity</label>}
                  info={
                    <InfoPopover label="které limity se hlídají" title="Limity">
                      <p>
                        {typeset(
                          'Roční limity, které Danero vede podle tvého režimu — osvobození prodejů i krypta a hranice pro podání přiznání. Ozveme se při každé vybrané hranici čerpání.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-limity"
                    name="upozorneni-limity"
                    defaultChecked={shown.has(NOTIFICATION_FIELDS.limitEvents)}
                  />
                </Row>
                <ChoiceRow
                  className={NEEDS_SWITCH}
                  id="hranice-limitu-popisek"
                  label="Při čerpání"
                  name="hranice-limitu"
                  options={LIMIT_THRESHOLD_OPTIONS.map((percent) => ({
                    value: percent,
                    text: tidy(`${percent} %`),
                    suffix: percent === 100 ? ' — prolomení limitu' : ' limitu',
                    checked: shown
                      .getAll(NOTIFICATION_FIELDS.limitThresholdsPct)
                      .includes(String(percent)),
                  }))}
                />
              </Group>

              <Group variant="inset" className={HIDE_WITHOUT['upozorneni-kalendar']}>
                <Row
                  label={<label htmlFor="upozorneni-kalendar">Termíny přiznání</label>}
                  info={
                    <InfoPopover label="co chodí k termínům" title="Termíny přiznání">
                      <p>
                        {typeset('Lednové shrnutí uplynulého roku a připomínka termínu přiznání.')}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-kalendar"
                    name="upozorneni-kalendar"
                    defaultChecked={shown.has(NOTIFICATION_FIELDS.calendarEmails)}
                  />
                </Row>
                <FieldRow
                  className={NEEDS_SWITCH}
                  label="Připomenout termín"
                  htmlFor="lhuta-terminu"
                >
                  <Select
                    id="lhuta-terminu"
                    name="lhuta-terminu"
                    defaultValue={shown.get(NOTIFICATION_FIELDS.deadlineLeadDays) ?? ''}
                  >
                    {DEADLINE_LEAD_OPTIONS.map((days) => (
                      <option key={days} value={days}>
                        {days} dní předem
                      </option>
                    ))}
                  </Select>
                </FieldRow>
              </Group>
            </div>
          </Section>

          <AutoSubmit
            action={autoSaveNotificationPrefsAction}
            endpoint="/api/settings/notifications"
            owner={await ownerTag(user.id)}
          />
        </form>
      </div>
    </>
  );
}
