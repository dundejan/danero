'use client';

import { Fragment, useId, useState } from 'react';
import { Input } from '@/components/ui/field';

export interface PlatformSearchGroup {
  key: string;
  label: string;
  items: {
    id: string;
    /** Podle čeho se hledá: název a zkratka platformy. */
    keywords: string;
    /** Hotový řádek seznamu (vykreslený na serveru). */
    row: React.ReactNode;
  }[];
}

/** Malá písmena bez diakritiky a bez mezer — „csob“ najde ČSOB, „j&t“ i „jt“ J&T. */
const normalize = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * Hledání v katalogu platforem. Řádky přicházejí hotové ze serveru (návody
 * čtou kontakt provozovatele z prostředí, které prohlížeč nemá) — tady se jen
 * rozhoduje, které z nich jsou vidět. Bez JavaScriptu zůstane celý seznam.
 */
export function PlatformSearch({ groups }: { groups: PlatformSearchGroup[] }) {
  const [query, setQuery] = useState('');
  const statusId = useId();
  const needle = normalize(query);
  const visible = groups
    .map((group) => ({
      ...group,
      items: needle
        ? group.items.filter((item) => normalize(item.keywords).includes(needle))
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Hledat platformu"
        aria-label="Hledat platformu"
        aria-describedby={statusId}
        autoComplete="off"
        spellCheck={false}
        className="max-w-sm"
      />
      {/* čtečce oznámí výsledek hledání; vidět je jen, když se nic nenašlo */}
      <p id={statusId} role="status" className={visible.length > 0 ? 'sr-only' : 'type-body mt-6 text-ink-muted'}>
        {needle &&
          (visible.length > 0
            ? `Nalezeno: ${visible.reduce((count, group) => count + group.items.length, 0)}`
            : `„${query.trim()}“ v seznamu není. Jakýkoli výpis ale jde nahrát přes univerzální šablonu — návod je níž.`)}
      </p>
      <div className="@container">
        {visible.map((group) => (
          <div key={group.key} className="mt-8">
            <h2 className="type-title-3 pb-3">{group.label}</h2>
            <div role="list" className="grid items-start gap-x-(--column-gap) @2xl:grid-cols-2">
              {group.items.map((item) => (
                <Fragment key={item.id}>{item.row}</Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
