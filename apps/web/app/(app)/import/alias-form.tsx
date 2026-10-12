import { XTB_BROKER, xtbCurrencyFromTicker } from '@danero/importers';
import { Card } from '@/components/ui/card';
import { FieldHint, Input } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Section } from '@/components/ui/section';
import { StatusLabel } from '@/components/ui/status';
import { SubmitButton } from '@/components/ui/submit-button';
import type { UnmappedSymbol } from '@/lib/import-service';
import { saveAliasesAction } from './actions';
import { platformName } from '@/lib/brokers-catalog';

/**
 * Číselník titulů: symboly, ke kterým broker ve výpisu neposílá ISIN
 * (u XTB ani měnu). Dokud je uživatel nedoplní, obchody těch symbolů se
 * neimportují — proto sekce stojí na stránce úplně nahoře.
 *
 * Na obrazovce je jen to, co je potřeba vyplnit; kde údaje vzít a co udělat
 * po uložení, říká vysvětlivka (a po uložení i hláška).
 */
export function AliasForm({ symbols }: { symbols: UnmappedSymbol[] }) {
  // Měnu u XTB jen navrhujeme (L14-05): pole zůstává k přepsání a ukládá se až
  // to, co uživatel odešle. ISIN z reportu zjistit nejde, ten se nenavrhuje.
  const suggestedCurrency = (item: UnmappedSymbol): string | undefined =>
    item.broker === XTB_BROKER ? xtbCurrencyFromTicker(item.symbol) : undefined;
  const anyCurrencySuggested = symbols.some(
    (item) => item.needsCurrency && suggestedCurrency(item) !== undefined,
  );
  const needsCurrency = symbols.some((item) => item.needsCurrency);

  return (
    <Section
      title="Doplň chybějící údaje instrumentů"
      info={
        <InfoPopover label="Chybějící údaje instrumentů" title="Kde je vezmu" align="start">
          <p>
            Broker k těmhle symbolům neexportuje ISIN{needsCurrency && ' ani měnu instrumentu'}.
            Najdeš je na jeho výpisu nebo vyhledáním „[symbol] ISIN“.
          </p>
          <p>
            Po uložení nahraj soubor znovu — doplněné symboly se naimportují a nic se nezdvojí.
          </p>
        </InfoPopover>
      }
    >
      <Card>
        <StatusLabel tone="caution">Bez nich se obchody těchhle symbolů nenaimportují.</StatusLabel>
        <form action={saveAliasesAction} className="mt-2">
          <input type="hidden" name="pocet" value={symbols.length} />
          <div className="divide-y divide-line/70">
            {symbols.map((item, index) => (
              <div
                key={`${item.broker}|${item.symbol}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
              >
                <input type="hidden" name={`broker-${index}`} value={item.broker} />
                <input type="hidden" name={`symbol-${index}`} value={item.symbol} />
                <span className="type-callout min-w-28 flex-1 font-medium tabular-nums">
                  {item.symbol}
                  <span className="type-footnote block font-normal text-ink-muted">
                    {platformName(item.broker)}
                  </span>
                </span>
                <Input
                  name={`isin-${index}`}
                  placeholder="ISIN (US0378331005)"
                  aria-label={`ISIN pro ${item.symbol}`}
                  required
                  pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-48 tabular-nums"
                />
                {item.needsCurrency && (
                  <Input
                    name={`currency-${index}`}
                    placeholder="Měna (USD)"
                    aria-label={`Měna pro ${item.symbol}`}
                    defaultValue={suggestedCurrency(item)}
                    required
                    pattern="[A-Za-z]{3}"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-28 tabular-nums"
                  />
                )}
              </div>
            ))}
          </div>
          {anyCurrencySuggested && (
            <FieldHint>
              Měnu jsme u tickerů s příponou .US předvyplnili (USD) — zkontroluj ji.
            </FieldHint>
          )}
          <SubmitButton variant="secondary" pendingLabel="Ukládám…" className="mt-4">
            Uložit číselník
          </SubmitButton>
        </form>
      </Card>
    </Section>
  );
}
