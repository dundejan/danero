import { FIRST_CONFIGURED_TAX_YEAR, LAST_CONFIGURED_TAX_YEAR } from '@danero/engine';
import { Disclosure } from '@/components/ui/disclosure';
import { Notice } from '@/components/ui/notice';
import { isConfiguredTaxYear } from '@/lib/tax-config';

/**
 * R-15e: co uživatel uvidí, když si otevře rok, pro který v Danerovi nejsou
 * dvě státem vyhlašovaná čísla — hranice 23% sazby a výše paušální zálohy.
 *
 * Do 31. 8. 2026 se konfigurace neznámého roku odvozovala recyklací posledního
 * známého, takže aplikace mlčky počítala daň loňskými čísly (nález K1-01).
 * Dneska o tom poctivě řekne „nevím“ — a tohle sdělení je to místo, kde se to
 * dozví člověk. Vidět je titulek a jedna věta o dopadu; celé vysvětlení se
 * rozbalí pod ním. Musí splnit troje: nesmí vypadat jako chyba (hlídání běží dál),
 * musí říct, CO přesně tím pádem chybí, a musí přiznat, že odhad daně vychází
 * spíš nižší než skutečnost.
 *
 * Dva různé případy, dvě různé věty: rok, který teprve přijde (čísla ještě
 * neexistují — vláda je vyhlašuje nařízením do 30. 9., R-15c), a rok starší,
 * než kam registr sahá (čísla dávno existují, jen je Danero nezná).
 */
export function TaxYearConfigNotice({
  year,
  pausal = false,
}: {
  /** Zdaňovací období, na které se uživatel dívá. */
  year: number;
  /** Paušální režim — pak chybí i výše zaplacených záloh (R-08f). */
  pausal?: boolean;
}) {
  if (isConfiguredTaxYear(year)) return null;
  const ahead = year > LAST_CONFIGURED_TAX_YEAR;
  return (
    <Notice
      tone="caution"
      title={
        ahead
          ? `Pro rok ${year} ještě neznáme dvě státem vyhlašovaná čísla`
          : `Pro rok ${year} nemáme dvě čísla, která se vyhlašují na každý rok zvlášť`
      }
    >
      <p>Hlídání limitů běží dál, jen odhad daně je méně přesný.</p>
      <Disclosure summary="Co to znamená" className="[&_p+p]:mt-2">
      <p>
        Není to chyba tvých dat a hlídání běží dál: prodeje, limit 100 000 Kč, limit
        50 000 Kč i tříletý časový test na nich nestojí a počítají se normálně.
      </p>
      <p>
        Chybí <strong>hranice, nad kterou se z výdělku platí vyšší daň</strong>.{' '}
        {ahead
          ? `Tu vyhlašuje vláda nařízením, a to až na podzim ${year}.`
          : `V Danerovi máme vyhlášená čísla od roku ${FIRST_CONFIGURED_TAX_YEAR}, starší roky
             jsme zpětně nedoplňovali.`}{' '}
        Do té doby počítáme celý výdělek nižší sazbou, takže odhad daně může vyjít{' '}
        <strong>nižší</strong>, než nakonec zaplatíš. Týká se to jen opravdu vysokých
        výdělků — hranice se pohybuje kolem 1,8 milionu korun za rok.
        {pausal && (
          <>
            {' '}
            A neznáme <strong>výši měsíční zálohy paušálního režimu</strong> pro tenhle
            rok, takže když se stane, že daň platit budeš, nezapočítáme ti do ní, co jsi
            už na zálohách zaplatil — doplatek proto vychází vyšší, než bude ve
            skutečnosti.
          </>
        )}
      </p>
      {ahead ? (
        <p>
          Jakmile obě čísla vyjdou, doplníme je a všechno se přepočítá samo — nemusíš
          dělat nic. Podklady k přiznání za rok {year} se stejně podávají až v roce{' '}
          {year + 1}.
        </p>
      ) : (
        <p>
          U takhle starého roku to obvykle nevadí: hranici vyšší daně překročí jen velmi
          vysoký výdělek. Pokud se tě týká, napiš nám a čísla za ten rok doplníme.
        </p>
      )}
      </Disclosure>
    </Notice>
  );
}
