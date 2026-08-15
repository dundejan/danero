import { d } from '@danero/shared';
import { Card, CardTitle } from '@/components/ui/card';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { SubmitButton } from '@/components/ui/submit-button';
import { Input, Label, Select } from '@/components/ui/field';
import { getDb } from '@/db';
import { getProfile, listPinnedTaxYears } from '@/lib/portfolio';
import { requireUser } from '@/lib/session';
import { czDateTime, FX_METHOD_LABEL, limit100kLabel, METHOD_LABEL } from '@/lib/format';
import { firstParam } from '@/lib/utils';
import { SettingsNav } from './settings-nav';
import { SettingsToast } from './settings-toast';
import { saveProfileAction, unpinTaxYearAction } from './actions';

export const metadata = { title: 'Daň a výpočet — Danero' };

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

  return (
    // jeden sloupec s šířkou pro formulář — nastavení se nečte přes celou
    // obrazovku a dva sloupce vedle sebe nikdy nevyjdou stejně vysoké
    <div className="max-w-4xl space-y-8">
      <header className="space-y-4">
        <div>
          {/* nadpis pojmenovává SEKCI, ne celé nastavení: /nastaveni je první
              ze tří záložek a „Nastavení“ nahoře nad aktivní záložkou
              „Daň a výpočet“ vypadalo, že se stránka nepřepnula */}
          <h1 className="font-display text-3xl font-bold">
            {profile ? 'Daň a výpočet' : 'Nastav svůj daňový profil'}
          </h1>
          <p className="mt-1 text-sm text-inkoust-tlumeny">
            Profil určuje, které limity Danero hlídá a jak počítá. Vše jde kdykoli změnit —
            výpočty se přepočítají od nuly.
            {profile && ' Změny se ukládají automaticky.'}
          </p>
        </div>
        <SettingsNav active="tax" />
      </header>

      <SettingsToast ok={firstParam(params.ok)} chyba={firstParam(params.chyba)} />

      <form action={saveProfileAction} className="space-y-6" id="dan">
        <Card className="space-y-4">
          <CardTitle>Kdo jsi vůči dani</CardTitle>
          {/* dvě pole vedle sebe (stejně jako u metod výpočtu) — přes celou
              šířku karty by se z nich staly zbytečně roztažené ovládací prvky.
              `items-end`: druhý popisek se na užším displeji zalomí na dva
              řádky a pole by si bez toho stála v jiné výšce */}
          <div className="grid items-end gap-4 sm:grid-cols-2">
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
              <Label htmlFor="parovani">
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
                Které kusy se prodejem spotřebují dřív — mění zisk i to, jestli prodané
                kusy splnily tříletý test.
              </p>
            </div>
            <div>
              <Label htmlFor="kurzy">
                Měnové kurzy
              </Label>
              <Select id="kurzy" name="kurzy" defaultValue={profile?.fxMethod ?? 'UNIFIED'}>
                <option value="UNIFIED">Jednotný kurz GFŘ</option>
                <option value="CNB_DAILY">Denní kurzy ČNB</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                V jednom roce platí jedna soustava — kombinovat je nelze. Rozdíl mezi
                nimi bývají i desítky tisíc korun, report ti ukáže obě varianty.
              </p>
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
              <Label htmlFor="zaklad-casoveho-testu">
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
              <Label htmlFor="derivaty-vydaje">
                Prémie bezcenně expirovaných opcí
              </Label>
              <Select
                id="derivaty-vydaje"
                name="derivaty-vydaje"
                defaultValue={(profile?.derivativesExpensesPerType ?? false) ? 'perType' : 'restrictive'}
              >
                <option value="restrictive">Bezpečný výklad — neuplatnit jako výdaj (doporučeno)</option>
                <option value="perType">Mírnější výklad — výdaj celého druhu deriváty (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Když koupená opce vyprší bezcenná, oficiální výklad chybí. Mírnější čtení
                (výdaje se posuzují za celý druh příjmů) prémii uplatní proti ostatním
                derivátovým ziskům roku — sníží daň, ale neseš riziko doměrku.
              </p>
            </div>
            <div>
              <Label htmlFor="emt-casovy-test">
                Stablecoiny a časový test
              </Label>
              <Select
                id="emt-casovy-test"
                name="emt-casovy-test"
                defaultValue={(profile?.emtTimeTestExempt ?? false) ? 'lenient' : 'safe'}
              >
                <option value="safe">Bezpečný výklad — stablecoiny se daní i po 3 letech (doporučeno)</option>
                <option value="lenient">Mírnější výklad — po 3 letech držení bez daně i stablecoiny (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Stablecoiny (USDT, USDC…) zákon vylučuje z osvobození do 100 000 Kč — jejich
                prodej se daní vždy. Zda pro ně platí aspoň tříleté osvobození, jasné není;
                mírnější čtení má oporu v textu zákona, ale neseš riziko doměrku.
              </p>
            </div>
            <div>
              <Label htmlFor="vratka-kapitalu">Vratka kapitálu</Label>
              <Select
                id="vratka-kapitalu"
                name="vratka-kapitalu"
                defaultValue={(profile?.returnOfCapitalReducesBasis ?? false) ? 'lenient' : 'safe'}
              >
                <option value="safe">Bezpečný výklad — zdanit jako dividendu (doporučeno)</option>
                <option value="lenient">Mírnější výklad — snížit nabývací cenu pozice (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Některé fondy a REITy vracejí část vloženého kapitálu (broker to hlásí jako
                „Return of capital“). Není to podíl na zisku, takže věcně jen snižuje
                nabývací cenu a daň přijde až s prodejem — zákon to ale u zahraničních
                fondů neřeší. Bezpečný výklad daní hned a čerpá limit 50 000 Kč.
                Volba se týká jen výplat, které jsou ve výpisu takhle označené — u výpisů
                nahraných před 12. 8. 2026 příznak v datech chybí, takže je potřeba ve
                Zdrojích dat vrátit import zpět a výpis nahrát znovu.
              </p>
            </div>
            <div>
              <Label htmlFor="short-prijem">Prodej nakrátko (short)</Label>
              <Select
                id="short-prijem"
                name="short-prijem"
                defaultValue={(profile?.shortSaleIncomeOnSale ?? true) ? 'safe' : 'lenient'}
              >
                <option value="safe">Bezpečný výklad — příjem už prodejem (doporučeno)</option>
                <option value="lenient">Mírnější výklad — příjem až uzavřením pozice (sporné)</option>
              </Select>
              <p className="mt-1 text-xs text-inkoust-tlumeny">
                Prodáš-li vypůjčené akcie, peníze ti přijdou hned — daň se podle bezpečného
                výkladu platí už za ten rok a zpětný nákup je výdaj až v roce, kdy ho
                zaplatíš. Rozdíl uvidíš jen u shortu drženého přes Silvestr, zato velký:
                zdaní se celá tržba bez výdaje. K prodeji nakrátko neexistuje v Česku
                žádné oficiální stanovisko, takže obojí je výklad — mírnější je pro tebe
                výhodnější, ale hůř se obhajuje.
                Značka „prodej nakrátko“ jde jen z výpisů Interactive Brokers a Tastytrade
                (a z univerzální šablony) — u výpisů nahraných před 13. 8. 2026 v datech
                chybí, takže je potřeba ve Zdrojích dat vrátit import zpět a nahrát znovu.
              </p>
            </div>
          </div>
          <p className="text-xs text-inkoust-tlumeny">
            Přednastavené hodnoty jsou konzervativní a průkazné. Zvolená konfigurace se
            tiskne do každého reportu. Párování prodejů, měnové kurzy a výklad limitu
            100 000 Kč se u každého skončeného roku zafixují ve chvíli, kdy si za něj
            vygeneruješ podklady k přiznání — změna tady se pak projeví jen v letech
            bez fixace, aby se čísla v už podaném přiznání zpětně nezměnila.
            {profile && ' Seznam zafixovaných roků je pod formulářem.'}
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
          <CardTitle>Zafixované daňové roky</CardTitle>
          {pinnedYears.length === 0 ? (
            <p className="text-sm text-inkoust-tlumeny">
              Zatím žádný. Jakmile si za skončený rok vygeneruješ podklady k přiznání,
              zapamatujeme si, jak se ten rok počítal — pozdější změna nastavení už ho
              nepřepočítá, aby čísla v odeslaném přiznání zůstala platná.
            </p>
          ) : (
            <>
              <p className="text-sm text-inkoust-tlumeny">
                Za tyhle roky sis už vygeneroval podklady, takže se počítají pořád
                stejně — i když nahoře vybereš něco jiného.
              </p>
              <ul className="space-y-3">
                {pinnedYears.map((pinned) => (
                  <li key={pinned.taxYear} className="border-t border-linka pt-3 first:border-0 first:pt-0">
                    <p className="text-sm font-semibold">
                      {pinned.taxYear}{' '}
                      <span className="font-normal text-inkoust-tlumeny">
                        (zafixováno {czDateTime(pinned.pinnedAt)})
                      </span>
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm text-inkoust-tlumeny">
                      <li>
                        Párování prodejů:{' '}
                        <span className="text-inkoust">
                          {METHOD_LABEL[pinned.matchingMethod] ?? pinned.matchingMethod}
                        </span>
                      </li>
                      <li>
                        Měnové kurzy:{' '}
                        <span className="text-inkoust">
                          {FX_METHOD_LABEL[pinned.fxMethod] ?? pinned.fxMethod}
                        </span>
                      </li>
                      <li>
                        Limit 100 000 Kč:{' '}
                        <span className="text-inkoust">{limit100kLabel(pinned.limit100kStrict)}</span>
                      </li>
                    </ul>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm text-inkoust-tlumeny hover:text-inkoust">
                        Zrušit fixaci roku {pinned.taxYear}
                      </summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-inkoust-tlumeny">
                          Rok {pinned.taxYear} se pak přepočítá podle nastavení výš (
                          {METHOD_LABEL[profile.matchingMethod] ?? profile.matchingMethod},{' '}
                          {FX_METHOD_LABEL[profile.fxMethod] ?? profile.fxMethod},{' '}
                          {limit100kLabel(profile.limit100kStrict)}) a čísla se můžou lišit
                          od těch, které jsi už poslal na finanční úřad. Dělej to jen tehdy,
                          když za ten rok budeš podávat dodatečné přiznání.
                        </p>
                        <form action={unpinTaxYearAction}>
                          <input type="hidden" name="rok" value={pinned.taxYear} />
                          <SubmitButton variant="danger" pendingLabel="Ruším…">
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
  );
}
