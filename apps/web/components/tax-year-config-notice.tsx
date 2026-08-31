import { FIRST_CONFIGURED_TAX_YEAR, LAST_CONFIGURED_TAX_YEAR } from '@danero/engine';
import { Card, CardTitle } from '@/components/ui/card';
import { isConfiguredTaxYear } from '@/lib/tax-config';

/**
 * R-15e: co uživatel uvidí, když si otevře rok, pro který v Danerovi nejsou
 * dvě státem vyhlašovaná čísla — hranice 23% sazby a výše paušální zálohy.
 *
 * Do 31. 8. 2026 se konfigurace neznámého roku odvozovala recyklací posledního
 * známého, takže aplikace mlčky počítala daň loňskými čísly (nález K1-01).
 * Dneska o tom poctivě řekne „nevím“ — a tahle karta je to místo, kde se to
 * dozví člověk. Musí splnit troje: nesmí vypadat jako chyba (hlídání běží dál),
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
    <Card className="space-y-2 border-jantar bg-jantar/5">
      <CardTitle>
        {ahead
          ? `Pro rok ${year} ještě neznáme dvě státem vyhlašovaná čísla`
          : `Pro rok ${year} nemáme dvě čísla, která se vyhlašují na každý rok zvlášť`}
      </CardTitle>
      <p className="text-sm text-inkoust-tlumeny">
        Není to chyba tvých dat a hlídání běží dál: prodeje, limit 100 000 Kč, limit
        50 000 Kč i tříletý časový test na nich nestojí a počítají se normálně.
      </p>
      <p className="text-sm text-inkoust-tlumeny">
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
        <p className="text-sm text-inkoust-tlumeny">
          Jakmile obě čísla vyjdou, doplníme je a všechno se přepočítá samo — nemusíš
          dělat nic. Podklady k přiznání za rok {year} se stejně podávají až v roce{' '}
          {year + 1}.
        </p>
      ) : (
        <p className="text-sm text-inkoust-tlumeny">
          U takhle starého roku to obvykle nevadí: hranici vyšší daně překročí jen velmi
          vysoký výdělek. Pokud se tě týká, napiš nám a čísla za ten rok doplníme.
        </p>
      )}
    </Card>
  );
}
