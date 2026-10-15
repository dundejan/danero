'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Chevron, DisclosureRow } from '@/components/ui/disclosure';
import { DetailsOnce } from '@/components/ui/details-once';
import { describedByError, FieldError, Input } from '@/components/ui/field';
import { Group } from '@/components/ui/list';
import { SubmitButton } from '@/components/ui/submit-button';
import { heldActionResult, type ActionResult } from '@/lib/action-result';
import { ALIAS_LIST_ANCHOR, isAliasRowError, type AliasRowError } from '@/lib/alias-feedback';
import { plural } from '@/lib/format';
import { typeset } from '@/components/typeset';
import { deleteAliasAction, updateAliasAction } from './actions';

/**
 * Doplněné údaje instrumentů: záznamy číselníku, které si uživatel uložil
 * (nebo které import doplnil sám), se změnou a smazáním. Bez nich šel špatně
 * opsaný ISIN opravit jen teoreticky — symbol po uložení z formuláře zmizel
 * a po vrácení importu se použil zase ten uložený.
 *
 * Výsledek akce drží prohlížeč (`lib/action-result.ts`): adresa s kódem se
 * po zobrazení uklízí a obnovení stránky ze serveru by jinak řádek s chybou
 * zavřelo i s tím, co v něm uživatel napsal.
 *
 * `name` atributy polí jsou česky a čtou je server actions.
 */

export interface AliasListItem {
  /** `aliasRowKey(broker, symbol)` */
  key: string;
  broker: string;
  brokerName: string;
  /** Záznam by import doplnil sám (a po smazání ho doplní znovu) — odkud. */
  origin?: string;
  symbol: string;
  isin: string;
  currency: string | null;
}

/** Import, který je potřeba vrátit, než jde záznam změnit nebo smazat. */
export interface BlockingImport {
  id: string;
  filename: string;
  date: string;
  /** Řádek importu je v historii na stránce — dá se na něj odkázat. */
  inHistory: boolean;
}

export interface AliasRowResult extends ActionResult {
  rowKey: string;
  /** Hodnoty, které uživatel odeslal — po chybě se vrací do polí. */
  entered: { isin?: string; currency?: string };
  imports: BlockingImport[];
}

/** Kolik importů hláška vyjmenuje; zbytek shrne počtem. */
const LISTED_IMPORTS = 3;

const ROW_ERROR_TEXTS: Record<
  Exclude<AliasRowError, 'zaznam-pouzity' | 'smazani-pouzite'>,
  string
> = {
  'zaznam-isin': 'ISIN má tvar 2 písmena + 10 znaků (např. US0378331005).',
  'zaznam-kontrola':
    'ISIN nesedí: jeho poslední číslice je kontrolní a ke zbytku kódu nepasuje — nejspíš překlep. Zkontroluj ho znak po znaku.',
  'zaznam-mena': 'Měna má tvar 3 písmena (např. USD).',
};

function ImportNames({ imports }: { imports: BlockingImport[] }) {
  const listed = imports.slice(0, LISTED_IMPORTS);
  const rest = imports.length - listed.length;
  return (
    <>
      {listed.map((item, index) => (
        <span key={item.id}>
          {index > 0 && ', '}
          {item.inHistory ? (
            <a href={`#import-${item.id}`} className="underline underline-offset-2">
              {item.filename}
            </a>
          ) : (
            item.filename
          )}{' '}
          ({item.date})
        </span>
      ))}
      {rest > 0 && ` a ${rest} ${plural(rest, 'další', 'další', 'dalších')}`}
    </>
  );
}

function RowErrorText({ code, imports }: { code: AliasRowError; imports: BlockingImport[] }) {
  if (code !== 'zaznam-pouzity' && code !== 'smazani-pouzite')
    return typeset(ROW_ERROR_TEXTS[code]);
  const verb = code === 'zaznam-pouzity' ? 'změnit' : 'smazat';
  const fix = code === 'zaznam-pouzity' ? 'pak záznam uprav' : 'pak záznam smaž';
  // Bez seznamu (import se mezitím vrátil) aspoň obecně, kudy dál.
  if (imports.length === 0) {
    return typeset(
      <>
        Záznam teď nejde {verb}, pod jeho ISIN jsou uložené transakce. Vrať v historii importů zpět
        import, který je uložil, {fix} a výpis nahraj znovu.
      </>,
    );
  }
  return typeset(
    <>
      Záznam teď nejde {verb} — pod jeho ISIN jsou uložené transakce z{' '}
      {imports.length === 1 ? 'importu' : 'importů'} <ImportNames imports={imports} />. Po dalším
      nahrání výpisu by se uložily podruhé. Nejdřív {imports.length === 1 ? 'ho' : 'je'} v historii
      importů vrať zpět, {fix} a výpis nahraj znovu.
    </>,
  );
}

/** Výsledek poslední akce nad seznamem — drží ho, dokud nepřijde další. */
function useAliasResult(incoming: AliasRowResult | null): AliasRowResult | null {
  const params = useSearchParams();
  const fresh = params.has('zaznam');
  const [held, setHeld] = useState(() => heldActionResult(null, incoming, fresh));
  const current = heldActionResult(held, incoming, fresh);
  if (current !== held) setHeld(current);
  return current;
}

export function AliasList({
  items,
  result,
}: {
  items: AliasListItem[];
  result: AliasRowResult | null;
}) {
  const shown = useAliasResult(result);
  // Každý výsledek vykreslí seznam nanovo: chyba otevře svůj řádek, úspěch ho
  // zavře. Seznam jako celek zůstane po akci otevřený, ať je výsledek vidět.
  const generation = shown?.id ?? 'initial';
  const rowError = shown?.error != null && isAliasRowError(shown.error) ? shown.error : null;

  return (
    <DetailsOnce
      key={`list-${generation}`}
      id={ALIAS_LIST_ANCHOR}
      className="disclosure scroll-mt-20"
      defaultOpen={shown !== null}
    >
      <summary className="type-callout inline-flex min-h-11 items-center gap-1.5 font-medium text-accent-text active:opacity-60 md:min-h-7">
        <Chevron />
        {items.length} {plural(items.length, 'záznam', 'záznamy', 'záznamů')}
      </summary>
      <Group aria-label="Doplněné údaje instrumentů" className="mt-1">
        {items.map((item) => {
          const errorHere = rowError !== null && shown?.rowKey === item.key ? rowError : null;
          const errorId = `zaznam-chyba-${item.key}`;
          const editError =
            errorHere === 'zaznam-isin' ||
            errorHere === 'zaznam-kontrola' ||
            errorHere === 'zaznam-pouzity';
          return (
            <DisclosureRow
              key={`${item.key}-${generation}`}
              title={
                <>
                  {item.symbol}
                  <span className="type-footnote block font-normal text-ink-muted">
                    {item.brokerName}
                    {item.origin && ` · ${item.origin}`}
                  </span>
                </>
              }
              meta={item.currency ? `${item.isin} · ${item.currency}` : item.isin}
              defaultOpen={errorHere !== null}
            >
              <form
                action={updateAliasAction}
                className="flex flex-wrap items-end gap-3 pt-1 text-ink"
              >
                <input type="hidden" name="broker" value={item.broker} />
                <input type="hidden" name="symbol" value={item.symbol} />
                <Input
                  name="isin"
                  aria-label={`ISIN pro ${item.symbol}`}
                  defaultValue={errorHere ? (shown?.entered.isin ?? item.isin) : item.isin}
                  required
                  pattern="[A-Za-z]{2}[A-Za-z0-9]{9}[0-9]"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-48 tabular-nums"
                  {...describedByError(editError, errorId)}
                />
                {item.broker === 'xtb' && (
                  <Input
                    name="mena"
                    aria-label={`Měna pro ${item.symbol}`}
                    defaultValue={
                      errorHere
                        ? (shown?.entered.currency ?? item.currency ?? '')
                        : (item.currency ?? '')
                    }
                    required
                    pattern="[A-Za-z]{3}"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-24 tabular-nums"
                    {...describedByError(errorHere === 'zaznam-mena', errorId)}
                  />
                )}
                <SubmitButton variant="tinted" size="sm" pendingLabel="Ukládám…">
                  Uložit změnu
                </SubmitButton>
              </form>
              <form action={deleteAliasAction} className="mt-3">
                <input type="hidden" name="broker" value={item.broker} />
                <input type="hidden" name="symbol" value={item.symbol} />
                <SubmitButton variant="danger" size="sm" pendingLabel="Mažu…">
                  Smazat záznam
                </SubmitButton>
              </form>
              {errorHere && (
                <FieldError id={errorId} className="mt-3">
                  <RowErrorText code={errorHere} imports={shown?.imports ?? []} />
                </FieldError>
              )}
            </DisclosureRow>
          );
        })}
      </Group>
    </DetailsOnce>
  );
}
