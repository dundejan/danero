'use client';

import Form from 'next/form';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { describedByError, Field, FieldError, Input, Select } from '@/components/ui/field';
import { answeredSubmissions, simulationKey } from '@/lib/simulator-input';
import { cn } from '@/lib/utils';

/** Pozice, kterou jde v simulátoru prodat — jen to, co formulář potřebuje. */
export interface SimulatorOption {
  isin: string;
  /** Řádek výběru: ticker a název. */
  label: string;
  /** Držené kusy česky („12,5 ks“) — do nápovědy pole. */
  held: string;
  currency: string;
  /** Poslední známá cena v měně instrumentu, je-li k dispozici. */
  lastPrice?: string;
}

/** Pole formuláře, ke kterému může patřit chyba. */
export type SimulatorField = 'isin' | 'quantity' | 'price';

const ERROR_ID = 'simulator-error';

/** Pauza po posledním úhozu, než se výpočet spustí — aby se nepočítalo každé písmeno. */
const TYPING_PAUSE_MS = 250;

/**
 * Pracovní plocha simulátoru: vlevo zadání, vpravo výsledek (na telefonu pod
 * sebou). Výsledek počítá server; formulář se odesílá sám při každé změně,
 * takže žádné tlačítko „Spočítat“ není potřeba — odpověď stojí vedle vstupu
 * a mění se s ním.
 *
 * - Výběr pozice se odešle hned a předvyplní poslední známou cenu.
 * - Psaní se odešle po krátké pauze; Enter hned.
 * - Než server odpoví, výsledek zešedne — je vidět, že k novému zadání ještě
 *   nepatří (`resultKey` je zadání, pro které server výsledek spočítal).
 * - Neplatné zadání (víc kusů, než držíš; písmeno) výsledek nezahodí: poslední
 *   platný zůstane stát zešedlý a chyba je u pole. Dřív ho nahradila krátká
 *   hláška a sloupec při psaní skákal mezi 757 a 248 px (R3-09).
 * - Je to obyčejný formulář metodou GET: adresa nese zadání (jde sdílet
 *   a obnovit) a bez JavaScriptu ho odešle tlačítko v `<noscript>`.
 */
export function SimulatorWorkbench({
  action,
  options,
  selectedIsin,
  quantity: initialQuantity,
  price: initialPrice,
  resultKey,
  error,
  hasResult,
  children,
}: {
  /** Adresa stránky simulátoru (ostrá, nebo demo). */
  action: string;
  options: SimulatorOption[];
  selectedIsin: string;
  quantity: string;
  price: string;
  resultKey: string;
  error: { field: SimulatorField; message: string } | null;
  /** `children` je spočítaný výsledek simulace, ne prázdný nebo chybový stav. */
  hasResult: boolean;
  /** Výsledek simulace vykreslený na serveru. */
  children: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [isin, setIsin] = useState(selectedIsin);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [price, setPrice] = useState(initialPrice);
  // zadání odeslaná serveru, na která ještě nepřišla odpověď (od nejstaršího);
  // dokud nějaké čeká, je výsledek na obrazovce zastaralý
  const [pending, setPending] = useState<string[]>([]);
  // naposledy viděná odpověď serveru: nový výsledek = nové `children`
  const [seen, setSeen] = useState({ key: resultKey, children });
  // poslední platný výsledek a pozice, ke které patří
  const [lastResult, setLastResult] = useState<{ isin: string; node: React.ReactNode } | null>(
    hasResult ? { isin: selectedIsin, node: children } : null,
  );

  // Ze serveru přišel nový výsledek. Buď je to odpověď na něco, co odeslal
  // tenhle formulář — pak formulář nechávám být, uživatel mezitím mohl psát
  // dál —, nebo navigace odjinud (klik na „Simulátor“ v navigaci, odkaz
  // z detailu pozice, tlačítko zpět). Tu formulář převezme: dřív zůstal
  // vyplněný vedle výsledku „Vyber pozici“ a oblast zůstala zešedlá (R4-06).
  if (seen.children !== children) {
    setSeen({ key: resultKey, children });
    const remaining = answeredSubmissions(pending, resultKey);
    if (remaining !== null) {
      setPending(remaining);
    } else if (seen.key !== resultKey) {
      setIsin(selectedIsin);
      setQuantity(initialQuantity);
      setPrice(initialPrice);
      setPending([]);
    }
    if (hasResult) setLastResult({ isin: selectedIsin, node: children });
  }

  const stale = pending.length > 0;
  // po chybě zadání stojí dál poslední platný výsledek téže pozice
  const keptResult =
    !hasResult && error !== null && lastResult?.isin === selectedIsin ? lastResult.node : null;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const selected = options.find((option) => option.isin === isin);

  const submitAfter = (delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => formRef.current?.requestSubmit(), delay);
  };

  // Enter odešle hned: formulář má dvě textová pole a žádné odesílací tlačítko,
  // takže prohlížeč sám Enterem neodešle nic — odeslal to až časovač (R4-08).
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!isin) return;
    window.clearTimeout(timer.current);
    formRef.current?.requestSubmit();
  };

  return (
    <div className="@container">
      <div className="grid gap-x-(--column-gap) gap-y-10 @3xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @3xl:items-start">
        <Card className="@3xl:sticky @3xl:top-[calc(var(--toolbar-height)+1rem)]">
          <Form
            ref={formRef}
            action={action}
            replace
            scroll={false}
            className="space-y-4"
            onSubmit={() => {
              window.clearTimeout(timer.current);
              const key = simulationKey(isin, quantity, price);
              // totéž zadání podruhé (Enter bez změny) novou odpověď přinést
              // nemusí — čekat na ni by nechalo výsledek zešedlý napořád
              setPending((keys) =>
                key === resultKey && keys.length === 0 ? keys : [...keys, key],
              );
            }}
          >
            <Field label="Pozice" htmlFor="isin">
              <Select
                id="isin"
                name="isin"
                value={isin}
                onChange={(event) => {
                  const next = options.find((option) => option.isin === event.target.value);
                  setIsin(event.target.value);
                  // nová pozice = nový prodej: všechny kusy za poslední známou cenu
                  setQuantity('');
                  setPrice(next?.lastPrice ?? '');
                  submitAfter(0);
                }}
                {...describedByError(error?.field === 'isin', ERROR_ID)}
              >
                <option value="" disabled>
                  Vyber pozici…
                </option>
                {options.map((option) => (
                  <option key={option.isin} value={option.isin}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Počet kusů" htmlFor="kusy">
                <Input
                  id="kusy"
                  name="kusy"
                  inputMode="decimal"
                  autoComplete="off"
                  value={quantity}
                  placeholder={selected ? `vše (${selected.held})` : 'vše'}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    if (isin) submitAfter(TYPING_PAUSE_MS);
                  }}
                  onKeyDown={submitOnEnter}
                  {...describedByError(error?.field === 'quantity', ERROR_ID)}
                />
              </Field>
              <Field
                label={selected ? `Cena za kus (${selected.currency})` : 'Cena za kus'}
                htmlFor="cena"
                hint={
                  selected?.lastPrice && price.trim() === selected.lastPrice
                    ? 'poslední známá cena'
                    : undefined
                }
              >
                <Input
                  id="cena"
                  name="cena"
                  inputMode="decimal"
                  autoComplete="off"
                  value={price}
                  onChange={(event) => {
                    setPrice(event.target.value);
                    if (isin) submitAfter(TYPING_PAUSE_MS);
                  }}
                  onKeyDown={submitOnEnter}
                  {...describedByError(error?.field === 'price', ERROR_ID)}
                />
              </Field>
            </div>
            {/* jedna hláška pod poli — ve sloupci širokém půl panelu by se lámala po slovech */}
            {error && <FieldError id={ERROR_ID}>{error.message}</FieldError>}
            <noscript>
              <Button type="submit">Spočítat dopad</Button>
            </noscript>
          </Form>
        </Card>

        <div
          aria-busy={stale}
          className={cn(
            'min-w-0 transition-opacity duration-150 ease-(--ease-out)',
            // zešednutí až po chvilce: rychlá odpověď nemá bliknout
            stale && 'opacity-50 delay-150',
          )}
        >
          {keptResult ? (
            // Výsledek k dřívějšímu zadání: zešedlý a mimo dosah klávesnice
            // i čtečky (`inert`) — čísla v něm k tomu, co je teď v polích,
            // nepatří, a říká to hláška u pole.
            <div inert className="opacity-50">
              {keptResult}
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
