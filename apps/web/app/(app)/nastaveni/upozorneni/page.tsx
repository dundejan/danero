import { AutoSubmit } from '@/components/ui/auto-submit';
import { Select } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { FieldRow, Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { Switch } from '@/components/ui/switch';
import { getDb } from '@/db';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getNotificationPrefs } from '@/lib/notifications';
import {
  DEADLINE_LEAD_OPTIONS,
  LIMIT_THRESHOLD_OPTIONS,
  notificationRules,
  TIME_TEST_LEAD_OPTIONS,
} from '@/lib/notification-rules';
import { plural } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { cn, firstParam } from '@/lib/utils';
import { SettingsToolbar } from '../settings-nav';
import { SettingsToast } from '../settings-toast';
import { saveNotificationPrefsAction } from '../actions';

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
 * Uložení, po kterém stránka zůstane tam, kde byla. Akce po úspěchu
 * přesměruje na adresu bez kotvy a Next po takové navigaci odroluje na
 * začátek — přepnutí vypínače na konci dlouhé stránky by člověka pokaždé
 * vyhodilo nahoru. Kotva, která na stránce neexistuje, je pro Next „vyřízené
 * rolování“, takže poloha zůstane (stejně to má uložení profilu s `#dan`).
 */
async function saveInPlace(formData: FormData): Promise<void> {
  'use server';
  await requireUser();
  try {
    await saveNotificationPrefsAction(formData);
  } catch (error) {
    // úspěch končí přesměrováním (výjimka s otiskem NEXT_REDIRECT); cokoli
    // jiného je opravdová chyba a patří chybové stránce
    const digest = error instanceof Error ? (error as { digest?: unknown }).digest : undefined;
    if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) throw error;
  }
  redirect('/nastaveni/upozorneni?ok=notifikace#ulozeno');
}

/** „90, 30 a 7“ — výčet čísel tak, jak se čte. */
const numberList = (values: readonly number[]): string =>
  values.length < 2
    ? values.join('')
    : `${values.slice(0, -1).join(', ')} a ${values.at(-1)}`;

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

  /** Co teď opravdu chodí — ať uživatel nemusí nastavení zkoušet naostro. */
  const incoming: string[] = [];
  if (prefs.emailEnabled) {
    if (prefs.timeTestEvents && rules.timeTestLeadDays.length > 0) {
      incoming.push(
        `${numberList(rules.timeTestLeadDays)} ${plural(rules.timeTestLeadDays.at(-1) ?? 0, 'den', 'dny', 'dní')} před osvobozením pozice`,
      );
    }
    if (prefs.limitEvents && rules.limitThresholdsPct.length > 0) {
      incoming.push(`Při ${numberList(rules.limitThresholdsPct)} % čerpání limitu`);
    }
    if (prefs.calendarEmails) incoming.push(`${rules.deadlineLeadDays} dní před termínem přiznání`);
    if (rules.summaryFrequency !== 'OFF') {
      incoming.push(rules.summaryFrequency === 'MONTHLY' ? 'Měsíční přehled' : 'Čtvrtletní přehled');
    }
  }
  const nothingIncoming = !prefs.emailEnabled
    ? 'Žádné e-maily — upozornění najdeš jen v aplikaci.'
    : incoming.length === 0
      ? 'Odesílání je zapnuté, ale není vybraná žádná událost — nic ti nepřijde.'
      : null;

  return (
    <>
      <SettingsToolbar active="notifications" />
      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      <div className="@container max-w-[44rem] space-y-12 pt-2 md:pt-4">
        {/* odpověď na otázku, kvůli které člověk stránku otevřel — až pod ní volby */}
        <Section
          title="Co ti teď chodí"
          info={
            <InfoPopover label="Co ti teď chodí">
              <p>
                {tidy(
                  'Danero hlídá limity a časové testy každý den. Tady si řekneš, o čem ti má dát vědět e-mailem a jak často — v aplikaci upozornění uvidíš vždycky.',
                )}
              </p>
              <p>
                {tidy(
                  'Upozornění se počítají z dat, která máš v Daneru: po napojení brokera nebo nahrání výpisu se projeví hned další den. Každý e-mail má odhlašovací odkaz.',
                )}
              </p>
            </InfoPopover>
          }
        >
          {nothingIncoming ? (
            <p className="text-pretty">{nothingIncoming}</p>
          ) : (
            <>
              <ul className="space-y-1">
                {incoming.map((line) => (
                  <li key={line} className="text-pretty">
                    {tidy(line)}
                  </li>
                ))}
              </ul>
              <p className="type-footnote mt-2 text-ink-muted">
                {prefs.emailFrequency === 'WEEKLY'
                  ? 'V souhrnu jednou týdně.'
                  : 'V souhrnu nejvýš jednou denně.'}
              </p>
            </>
          )}
        </Section>

        <form action={saveInPlace} className={cn('space-y-12', HIDE_WITHOUT_EMAIL)}>
          <Section title="Odesílání">
            <Group variant="inset" className={LONE_EMAIL_SWITCH}>
              <Row
                label={<label htmlFor="emaily-zapnute">Posílat e-maily</label>}
                info={
                  <InfoPopover label="hlavní vypínač e-mailů" title="Posílat e-maily">
                    <p>
                      {tidy(
                        'Hlavní vypínač. Vypnuté typy se po zapnutí nehromadí zpětně a každý e-mail má odhlašovací odkaz.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Switch
                  id="emaily-zapnute"
                  name="emaily-zapnute"
                  defaultChecked={prefs.emailEnabled}
                />
              </Row>
              <FieldRow
                className={NEEDS_EMAIL}
                label="Souhrn"
                htmlFor="frekvence-emailu"
                info={
                  <InfoPopover label="jak funguje souhrn" title="Souhrn">
                    <p>
                      {tidy(
                        'Souhrn sbírá události od posledního e-mailu, takže z jednoho rušného dne nepřijde pět zpráv.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Select
                  id="frekvence-emailu"
                  name="frekvence-emailu"
                  defaultValue={prefs.emailFrequency === 'WEEKLY' ? 'WEEKLY' : 'DAILY'}
                >
                  <option value="DAILY">Nejvýš jednou denně</option>
                  <option value="WEEKLY">Jednou týdně</option>
                </Select>
              </FieldRow>
              <Row
                className={NEEDS_EMAIL}
                label={<label htmlFor="nalehave-hned">Naléhavé posílat hned</label>}
                hint="I mimo týdenní souhrn."
                info={
                  <InfoPopover label="co je naléhavé" title="Naléhavé posílat hned">
                    <p>
                      {tidy(
                        'Naléhavé = prolomený limit, osvobození do sedmi dní a blížící se termín přiznání. Bez tohohle by v týdenním režimu dorazily klidně až šest dní po tom, co se staly.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Switch
                  id="nalehave-hned"
                  name="nalehave-hned"
                  defaultChecked={rules.urgentImmediately}
                />
              </Row>
              <FieldRow
                className={NEEDS_EMAIL}
                label="Pravidelný přehled"
                htmlFor="pravidelny-prehled"
                info={
                  <InfoPopover label="co je v pravidelném přehledu" title="Pravidelný přehled">
                    <p>
                      {tidy(
                        'Jediný e-mail, který přijde, i když se nic nestalo: čerpání limitů, nejbližší osvobození a orientační daň. Hodí se, když chceš mít jistotu, že hlídač běží.',
                      )}
                    </p>
                  </InfoPopover>
                }
              >
                <Select
                  id="pravidelny-prehled"
                  name="pravidelny-prehled"
                  defaultValue={rules.summaryFrequency}
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
                        {tidy(
                          'Tříletý časový test u konkrétních kusů. Vyber, kolik dní předem chceš vědět, že se prodej stane osvobozeným.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-casove-testy"
                    name="upozorneni-casove-testy"
                    defaultChecked={prefs.timeTestEvents}
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
                    checked: rules.timeTestLeadDays.includes(days),
                  }))}
                />
                <Row
                  className={NEEDS_SWITCH}
                  label={<label htmlFor="osvobozeno-hotovo">I ve chvíli, kdy pozice test splní</label>}
                >
                  <Switch
                    id="osvobozeno-hotovo"
                    name="osvobozeno-hotovo"
                    defaultChecked={rules.timeTestDone}
                  />
                </Row>
              </Group>

              <Group variant="inset" className={HIDE_WITHOUT['upozorneni-limity']}>
                <Row
                  label={<label htmlFor="upozorneni-limity">Limity</label>}
                  info={
                    <InfoPopover label="které limity se hlídají" title="Limity">
                      <p>
                        {tidy(
                          'Roční limity, které Danero vede podle tvého režimu — osvobození prodejů i krypta a hranice pro podání přiznání. Ozveme se při každé vybrané hranici čerpání.',
                        )}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-limity"
                    name="upozorneni-limity"
                    defaultChecked={prefs.limitEvents}
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
                    checked: rules.limitThresholdsPct.includes(percent),
                  }))}
                />
              </Group>

              <Group variant="inset" className={HIDE_WITHOUT['upozorneni-kalendar']}>
                <Row
                  label={<label htmlFor="upozorneni-kalendar">Termíny přiznání</label>}
                  info={
                    <InfoPopover label="co chodí k termínům" title="Termíny přiznání">
                      <p>
                        {tidy('Lednové shrnutí uplynulého roku a připomínka termínu přiznání.')}
                      </p>
                    </InfoPopover>
                  }
                >
                  <Switch
                    id="upozorneni-kalendar"
                    name="upozorneni-kalendar"
                    defaultChecked={prefs.calendarEmails}
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
                    defaultValue={String(rules.deadlineLeadDays)}
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

          <AutoSubmit />
        </form>
      </div>
    </>
  );
}
