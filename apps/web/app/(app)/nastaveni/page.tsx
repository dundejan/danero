import { d } from '@danero/shared';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { FieldRow, Group, Row } from '@/components/ui/list';
import { Section } from '@/components/ui/section';
import { SubmitButton } from '@/components/ui/submit-button';
import { Switch } from '@/components/ui/switch';
import { getDb } from '@/db';
import { getProfile, listPinnedTaxYears } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { currentTaxYear } from '@/lib/clock';
import { filingLimitTexts } from '@/lib/filing-limits';
import { czDateTime, FX_METHOD_LABEL, limit100kLabel, METHOD_LABEL } from '@/lib/format';
import { tidy } from '@/lib/typography';
import { firstParam } from '@/lib/utils';
import { DisputedHint } from './disputed-hint';
import { SettingsToolbar } from './settings-nav';
import { SettingsToast } from './settings-toast';
import { saveProfileAction, unpinTaxYearAction } from './actions';

export const metadata = { title: 'Daň a výpočet — Danero' };

/** Věta u sporného výkladu, když je zapnutá mírnější varianta. */
const DISPUTED_ON = 'Sporný výklad — neseš riziko doměrku.';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string | string[]; ok?: string | string[] }>;
}) {
  const user = await requireUser();
  const db = await getDb();
  const profile = await getProfile(db, user.id);
  const params = await searchParams;
  // R-05c: roky, které si drží konfiguraci z doby, kdy se za ně generovaly podklady
  const pinnedYears = await listPinnedTaxYears(db, user.id);
  // R-09a, R-09b: limity § 38g se rok od roku liší (do ZO 2026 50 000 /
  // 20 000 Kč, od ZO 2027 100 000 / 40 000 Kč). Profil platí pro všechny roky,
  // takže volba režimu jmenuje limit běžného roku.
  const filingLimits = filingLimitTexts(currentTaxYear());

  const taxProfile = (
    <Section title="Daňový profil">
      <Group variant="inset">
        <FieldRow
          label="Daňový režim"
          htmlFor="rezim"
          hintId="rezim-napoveda"
          info={
            <InfoPopover label="proč se ptáme na režim" title="Daňový režim">
              <p>
                {tidy(
                  'Podle režimu Danero pozná, který limit ti hlídat a kdy ti říct, že přiznání podávat nemusíš. Z výpisů se zjistit nedá, proto se na něj ptáme.',
                )}
              </p>
            </InfoPopover>
          }
          // Důsledek volby je vidět hned pod popiskem a přepíná se s nabídkou
          // (`:has()` nad vybranou položkou) — text položek tak může zůstat
          // krátký a limit přitom nezmizí.
          hint={
            <>
              <span className="hidden group-has-[option:disabled:checked]/field-row:inline">
                Z výpisů se zjistit nedá.
              </span>
              <span className="hidden group-has-[option[value=PAUSAL]:checked]/field-row:inline">
                {tidy('Hlídá se limit 50 000 Kč.')}
              </span>
              <span className="hidden group-has-[option[value=ZAMESTNANEC]:checked]/field-row:inline">
                {tidy(`Hlídá se limit ${filingLimits.employee}.`)}
              </span>
              <span className="hidden group-has-[option[value=OSVC]:checked]/field-row:inline">
                Přiznání podáváš tak jako tak.
              </span>
              <span className="hidden group-has-[option[value=JINE]:checked]/field-row:inline">
                {tidy(`Hlídá se obecný limit ${filingLimits.general}.`)}
              </span>
            </>
          }
        >
          {/* L7i-01 (R8): bez předvolby. Režim z dat zjistit nejde a rozhoduje
              o verdiktu — předvolený paušál hlídal zaměstnanci limit
              50 000 Kč místo 20 000 Kč a tvrdil mu, že přiznání nepodává.
              Prázdná položka je jen u nového profilu; uložený režim se
              na ni vrátit nedá. */}
          <Select
            id="rezim"
            name="rezim"
            defaultValue={profile?.regime ?? ''}
            required
            aria-describedby="rezim-napoveda"
          >
            {!profile && (
              <option value="" disabled>
                Vyber, co na tebe sedí…
              </option>
            )}
            <option value="PAUSAL">OSVČ v paušálním režimu</option>
            <option value="ZAMESTNANEC">Zaměstnanec</option>
            <option value="OSVC">OSVČ mimo paušál</option>
            <option value="JINE">Jiné</option>
          </Select>
        </FieldRow>
        {/* R-08f, R-09a, R-09b: profil má tuhle částku jen jednu a engine ji
            přičte ke každému roku — i ke skončenému a zafixovanému (fixace
            R-05c drží párování, kurzy a výklad limitu 100 000 Kč, tohle pole
            ne). Letošní nájem tak bez vysvětlení přepsal verdikt loňského
            roku (L24-03): výhrada proto stojí přímo u pole, zbytek ve
            vysvětlivce. */}
        <FieldRow
          label="Další zdanitelné příjmy"
          htmlFor="ostatni-prijmy"
          hintId="ostatni-prijmy-napoveda"
          hint="Třeba nájem, v Kč za rok. Platí pro všechny roky, i skončené a zafixované."
          info={
            <InfoPopover label="co se počítá do dalších příjmů" title="Další zdanitelné příjmy">
              <p>{tidy('Zdanitelné příjmy podle § 8–10 mimo investice, třeba nájem.')}</p>
              <p>
                {tidy(
                  'Částka platí pro všechny roky naráz — Danero ji přičte ke každému roku, i ke skončenému a zafixovanému. Když ji změníš, změní se i to, co hlásí za minulé roky (třeba jestli za ně podáváš přiznání).',
                )}
              </p>
            </InfoPopover>
          }
        >
          <Input
            id="ostatni-prijmy"
            name="ostatni-prijmy"
            inputMode="decimal"
            autoComplete="off"
            // DB numeric vrací „0.00“ — do pole patří lidské „0“ (uložení/parsování beze změny)
            defaultValue={d(profile?.otherIncomeCzk ?? '0').toString()}
            aria-describedby="ostatni-prijmy-napoveda"
            className="tabular-nums"
          />
        </FieldRow>
        <Row
          label={<label htmlFor="obchodni-majetek">Cenné papíry v obchodním majetku</label>}
          hint="Ruší osvobození — netypické."
        >
          <Switch
            id="obchodni-majetek"
            name="obchodni-majetek"
            defaultChecked={profile?.hasBusinessAssets ?? false}
          />
        </Row>
      </Group>
    </Section>
  );

  const calculation = (
    <>
      <Section
        title="Výpočet"
        info={
          <InfoPopover label="Výpočet">
            <p>
              {tidy(
                'Přednastavené hodnoty jsou konzervativní a průkazné. Zvolená konfigurace se tiskne do každého reportu.',
              )}
            </p>
            <p>
              {tidy(
                'Párování prodejů, měnové kurzy a výklad limitu 100 000 Kč se u každého skončeného roku zafixují ve chvíli, kdy si za něj vygeneruješ podklady k přiznání — změna tady se pak projeví jen v letech bez fixace.',
              )}
            </p>
          </InfoPopover>
        }
      >
        <Group variant="inset">
          <FieldRow
            label="Párování prodejů"
            htmlFor="parovani"
            info={
              <InfoPopover label="jak se párují prodeje" title="Párování prodejů">
                <p>
                  {tidy(
                    'Které kusy se prodejem spotřebují dřív — mění zisk i to, jestli prodané kusy splnily tříletý test.',
                  )}
                </p>
                <ul>
                  <li>FIFO — nejstarší kusy první (doporučeno)</li>
                  <li>LIFO — nejnovější kusy první</li>
                  <li>Max. zisk — nejlevnější kusy první</li>
                  <li>Max. ztráta — nejdražší kusy první</li>
                </ul>
              </InfoPopover>
            }
          >
            <Select id="parovani" name="parovani" defaultValue={profile?.matchingMethod ?? 'FIFO'}>
              <option value="FIFO">FIFO — nejstarší první</option>
              <option value="LIFO">LIFO — nejnovější první</option>
              <option value="MAX_PROFIT">Max. zisk — nejlevnější první</option>
              <option value="MAX_LOSS">Max. ztráta — nejdražší první</option>
            </Select>
          </FieldRow>
          <FieldRow
            label="Měnové kurzy"
            htmlFor="kurzy"
            info={
              <InfoPopover label="volba kurzů" title="Měnové kurzy">
                <p>
                  {tidy(
                    'V jednom roce platí jedna soustava — kombinovat je nelze. Rozdíl mezi nimi bývají i desítky tisíc korun, report ti ukáže obě varianty.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select id="kurzy" name="kurzy" defaultValue={profile?.fxMethod ?? 'UNIFIED'}>
              <option value="UNIFIED">Jednotný kurz GFŘ</option>
              <option value="CNB_DAILY">Denní kurzy ČNB</option>
            </Select>
          </FieldRow>
          <FieldRow
            label="Začátek časového testu"
            htmlFor="zaklad-casoveho-testu"
            info={
              <InfoPopover label="odkdy běží časový test" title="Začátek časového testu">
                <p>
                  {tidy(
                    'Od kterého data se počítají 3 roky držení. Datum vypořádání odpovídá pokynu D-59.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select
              id="zaklad-casoveho-testu"
              name="zaklad-casoveho-testu"
              defaultValue={profile?.timeTestBasis ?? 'settlement'}
            >
              <option value="settlement">Datum vypořádání</option>
              <option value="trade">Datum obchodu</option>
            </Select>
          </FieldRow>
        </Group>
      </Section>

      <Section
        title="Sporné výklady"
        info={
          <InfoPopover label="Sporné výklady">
            <p>
              {tidy(
                'Kde zákon není jednoznačný, je přednastavený bezpečný výklad. Mírnější může daň snížit, ale neseš riziko doměrku. Zvolená varianta se tiskne do každého reportu.',
              )}
            </p>
          </InfoPopover>
        }
      >
        <Group variant="inset">
          <FieldRow
            label={tidy('Co se počítá do limitu 100 000 Kč')}
            htmlFor="limit-100k"
            hintId="limit-100k-napoveda"
            hint={
              <DisputedHint
                safe="Mírnější výklad osvobodí víc, ale hrozí doměrek."
                lenient={DISPUTED_ON}
              />
            }
            info={
              <InfoPopover label="Limit 100 000 Kč">
                <p>
                  {tidy(
                    'Zákon jednoznačný není; finanční správa se kloní k přísnějšímu čtení. Mírnější výklad ti může osvobodit víc, ale neseš riziko doměrku.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select
              id="limit-100k"
              name="limit-100k"
              defaultValue={(profile?.limit100kStrict ?? true) ? 'strict' : 'lenient'}
              aria-describedby="limit-100k-napoveda"
            >
              <optgroup label="Bezpečný výklad">
                <option value="strict">Všechny prodeje</option>
              </optgroup>
              <optgroup label="Mírnější výklad (sporný)">
                <option value="lenient" data-disputed="">
                  Jen prodeje bez časového testu
                </option>
              </optgroup>
            </Select>
          </FieldRow>
          <FieldRow
            label="Prémie bezcenně expirovaných opcí"
            htmlFor="derivaty-vydaje"
            hintId="derivaty-vydaje-napoveda"
            hint={
              <DisputedHint
                safe="Mírnější výklad sníží daň, ale hrozí doměrek."
                lenient={DISPUTED_ON}
              />
            }
            info={
              <InfoPopover label="opce, které vypršely bezcenné" title="Prémie bezcenně expirovaných opcí">
                <p>
                  {tidy(
                    'Když koupená opce vyprší bezcenná, oficiální výklad chybí. Mírnější čtení (výdaje se posuzují za celý druh příjmů) prémii uplatní proti ostatním derivátovým ziskům roku — sníží daň, ale neseš riziko doměrku.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select
              id="derivaty-vydaje"
              name="derivaty-vydaje"
              defaultValue={
                (profile?.derivativesExpensesPerType ?? false) ? 'perType' : 'restrictive'
              }
              aria-describedby="derivaty-vydaje-napoveda"
            >
              <optgroup label="Bezpečný výklad">
                <option value="restrictive">Neuplatnit jako výdaj</option>
              </optgroup>
              <optgroup label="Mírnější výklad (sporný)">
                <option value="perType" data-disputed="">
                  Výdaj celého druhu deriváty
                </option>
              </optgroup>
            </Select>
          </FieldRow>
          <FieldRow
            label="Stablecoiny a časový test"
            htmlFor="emt-casovy-test"
            hintId="emt-casovy-test-napoveda"
            hint={
              <DisputedHint
                safe="Mírnější výklad osvobodí prodej po 3 letech, ale hrozí doměrek."
                lenient={DISPUTED_ON}
              />
            }
            info={
              <InfoPopover label="stablecoiny po třech letech" title="Stablecoiny a časový test">
                <p>
                  {tidy(
                    'Stablecoiny (USDT, USDC…) zákon vylučuje z osvobození do 100 000 Kč — jejich prodej se daní vždy. Zda pro ně platí aspoň tříleté osvobození, jasné není; mírnější čtení má oporu v textu zákona, ale neseš riziko doměrku.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select
              id="emt-casovy-test"
              name="emt-casovy-test"
              defaultValue={(profile?.emtTimeTestExempt ?? false) ? 'lenient' : 'safe'}
              aria-describedby="emt-casovy-test-napoveda"
            >
              <optgroup label="Bezpečný výklad">
                <option value="safe">Daní se i po 3 letech</option>
              </optgroup>
              <optgroup label="Mírnější výklad (sporný)">
                <option value="lenient" data-disputed="">
                  Po 3 letech držení bez daně
                </option>
              </optgroup>
            </Select>
          </FieldRow>
          <FieldRow
            label="Vratka kapitálu"
            htmlFor="vratka-kapitalu"
            hintId="vratka-kapitalu-napoveda"
            hint={
              <DisputedHint
                safe="Mírnější výklad daň odloží až na prodej, je ale sporný."
                lenient="Sporný výklad — zákon to u zahraničních fondů neřeší."
              />
            }
            info={
              <InfoPopover label="jak se daní vratky kapitálu" title="Vratka kapitálu">
                <p>
                  {tidy(
                    'Některé fondy a REITy vracejí část vloženého kapitálu (broker to hlásí jako „Return of capital“). Není to podíl na zisku, takže věcně jen snižuje nabývací cenu a daň přijde až s prodejem — zákon to ale u zahraničních fondů neřeší. Bezpečný výklad daní hned a čerpá limit 50 000 Kč.',
                  )}
                </p>
                <p>
                  Volba se týká jen výplat, které jsou ve výpisu takhle označené. Příznak čteme
                  z výpisů Trading 212 a Interactive Brokers a jde vyplnit i ručně ve sloupci{' '}
                  <span className="tabular-nums">return_of_capital</span> univerzální šablony.
                </p>
                <p>
                  {tidy(
                    'U výpisů nahraných před 12. 8. 2026 v datech chybí, takže je potřeba ve Zdrojích dat vrátit import zpět a výpis nahrát znovu.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            <Select
              id="vratka-kapitalu"
              name="vratka-kapitalu"
              defaultValue={(profile?.returnOfCapitalReducesBasis ?? false) ? 'lenient' : 'safe'}
              aria-describedby="vratka-kapitalu-napoveda"
            >
              <optgroup label="Bezpečný výklad">
                <option value="safe">Zdanit jako dividendu</option>
              </optgroup>
              <optgroup label="Mírnější výklad (sporný)">
                <option value="lenient" data-disputed="">
                  Snížit nabývací cenu
                </option>
              </optgroup>
            </Select>
          </FieldRow>
          {/* R-13b: prodej nakrátko volbu NEMÁ. Příjem plyne vždy prodejem —
              opačný výklad se objevuje jen v diskusích, které short zaměňují
              s CFD, a oporu v zákoně nemá. Vysvětlení, jak se short daní, nese
              karta „Prodeje nakrátko“ v reportu. */}
        </Group>
      </Section>
    </>
  );

  return (
    <>
      <SettingsToolbar active="tax" />
      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      {/* jeden sloupec s šířkou pro seznam — nastavení se nečte přes celou obrazovku */}
      <div className="@container max-w-[44rem] space-y-12 pt-2 md:pt-4">
        {/* Formulář schválně NEMÁ `id="dan"`: akce po uložení přesměruje na
            `#dan` a kotva, která neexistuje, nechá stránku stát tam, kde je.
            S kotvou by každá změna dole odrolovala zpátky nahoru. */}
        <form action={saveProfileAction} className="space-y-12">
          {taxProfile}
          {profile ? (
            <>
              {calculation}
              {/* auto-save: každá změna se uloží sama */}
              <AutoSubmit />
            </>
          ) : (
            // Nový uživatel potřebuje jen režim: zbytek je přednastavený
            // bezpečně a čeká o úroveň níž. Pole ve sbaleném detailu se
            // odesílají dál, takže profil vznikne úplný. První uložení
            // potvrzuje tlačítko — auto-save by nováčka po první změně
            // přesměroval na /prehled uprostřed vyplňování.
            <div className="space-y-4">
              <SubmitButton pendingLabel="Ukládám…">Uložit profil</SubmitButton>
              <Disclosure summary="Výpočet a sporné výklady — přednastaveno bezpečně">
                <div className="type-body space-y-12 pt-6 text-ink">{calculation}</div>
              </Disclosure>
            </div>
          )}
        </form>

        {/* R-05c — mimo formulář profilu: vnořené <form> HTML nedovoluje
            (a auto-save nahoře by se se zrušením fixace pral) */}
        {profile && (
          <Section
            id="fixace"
            title="Zafixované roky"
            info={
              <InfoPopover label="Zafixované roky">
                <p>
                  {tidy(
                    'Jakmile si za skončený rok vygeneruješ podklady k přiznání, zapamatujeme si, jak se ten rok počítal — pozdější změna nastavení už ho nepřepočítá, aby čísla v odeslaném přiznání zůstala platná.',
                  )}
                </p>
              </InfoPopover>
            }
          >
            {pinnedYears.length === 0 ? (
              <EmptyState compact headingAs="p" title="Zatím žádný">
                Rok se zafixuje, když si za něj vygeneruješ podklady k přiznání.
              </EmptyState>
            ) : (
              <Group>
                {pinnedYears.map((pinned) => (
                  <DisclosureRow
                    key={pinned.taxYear}
                    title={<span className="tabular-nums">{pinned.taxYear}</span>}
                    meta={`zafixováno ${czDateTime(pinned.pinnedAt)}`}
                  >
                    <ul className="space-y-0.5">
                      <li>
                        Párování prodejů:{' '}
                        <span className="text-ink">
                          {METHOD_LABEL[pinned.matchingMethod] ?? pinned.matchingMethod}
                        </span>
                      </li>
                      <li>
                        Měnové kurzy:{' '}
                        <span className="text-ink">
                          {FX_METHOD_LABEL[pinned.fxMethod] ?? pinned.fxMethod}
                        </span>
                      </li>
                      <li>
                        {tidy('Limit 100 000 Kč:')}{' '}
                        <span className="text-ink">{limit100kLabel(pinned.limit100kStrict)}</span>
                      </li>
                    </ul>
                    <div className="mt-3">
                      <ConfirmDialog
                        trigger={
                          <Button variant="danger" size="sm">
                            Zrušit fixaci roku {pinned.taxYear}
                          </Button>
                        }
                        title={`Zrušit fixaci roku ${pinned.taxYear}?`}
                        description={tidy(
                          `Rok ${pinned.taxYear} se přepočítá podle dnešního nastavení (${
                            METHOD_LABEL[profile.matchingMethod] ?? profile.matchingMethod
                          }, ${FX_METHOD_LABEL[profile.fxMethod] ?? profile.fxMethod}, ${limit100kLabel(
                            profile.limit100kStrict,
                          )}) a čísla se můžou lišit od těch, které jsi už poslal na finanční úřad. Dělej to jen tehdy, když za ten rok budeš podávat dodatečné přiznání.`,
                        )}
                        confirmLabel="Zrušit fixaci"
                        cancelLabel="Ponechat"
                        action={unpinTaxYearAction}
                        fields={{ rok: pinned.taxYear }}
                      />
                    </div>
                  </DisclosureRow>
                ))}
              </Group>
            )}
          </Section>
        )}
      </div>
    </>
  );
}
