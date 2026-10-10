'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/field';
import { TextLink } from '@/components/ui/link';
import { Group, Row } from '@/components/ui/list';
import { tidy } from '@/lib/typography';

/** Co průvodce o platformě potřebuje — výřez z `PlatformInfo` (jde přes hranici server → klient). */
export interface GuidePlatform {
  id: string;
  name: string;
  method: 'api' | 'file' | 'template';
  guide: string;
  connectAnchor?: `#${string}`;
}

export interface GuideGroup {
  label: string;
  platforms: GuidePlatform[];
}

const OTHER = 'other';

/**
 * Nápověda „kde výpis stáhnout“: člověk vybere svou platformu a dostane cestu
 * jejím menu — jednu, tu svou. Dřív tu stálo třicet rozbalovacích karet;
 * hledat mezi nimi tu vlastní je práce, kterou za uživatele udělá výběr
 * (na telefonu systémový).
 *
 * Texty návodů se nepřepisují, jdou z katalogu (`lib/brokers-catalog.ts`).
 */
export function PlatformGuide({
  groups,
  otherGuide,
  templateAnchor,
  contactEmail,
}: {
  groups: GuideGroup[];
  /** Návod pro platformu, která v katalogu není (univerzální šablona). */
  otherGuide: string;
  /** Kotva pravidel pro vyplnění šablony na téže stránce. */
  templateAnchor: string;
  contactEmail: string;
}) {
  const [selected, setSelected] = useState('');
  const platform = groups
    .flatMap((group) => group.platforms)
    .find((candidate) => candidate.id === selected);

  return (
    <>
      <Group>
        <Row label={<label htmlFor="guide-platform">Kde výpis stáhnout</label>}>
          <Select
            id="guide-platform"
            className="w-44 sm:w-56"
            value={selected}
            onChange={(event) => setSelected(event.currentTarget.value)}
          >
            <option value="">Vyber platformu…</option>
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.platforms.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OTHER}>Jiná platforma</option>
          </Select>
        </Row>
      </Group>

      {/* Čtečka se o návodu dozví hned po výběru, ne až když na něj dojde. */}
      <div aria-live="polite">
        {platform && (
          <div className="type-callout space-y-2 pb-3 pt-1 text-pretty">
            <p>{tidy(platform.guide)}</p>
            {platform.method === 'template' && (
              <p className="text-ink-muted">
                Tenhle výpis zatím sami nepřečteme — přepiš ho do{' '}
                <TextLink href="/api/sablona" download>
                  univerzální šablony
                </TextLink>{' '}
                (<TextLink href={`#${templateAnchor}`}>jak ji vyplnit</TextLink>) a nahraj ji
                tady. Vlastní čtečku připravujeme — pošli nám anonymizovaný vzorek na{' '}
                <TextLink href={`mailto:${contactEmail}`}>{contactEmail}</TextLink> a bude to
                rychlejší.
              </p>
            )}
            {platform.method === 'api' && platform.connectAnchor && (
              <p>
                <TextLink href={platform.connectAnchor} chevron>
                  Napojit automaticky
                </TextLink>
              </p>
            )}
          </div>
        )}
        {selected === OTHER && (
          <div className="type-callout space-y-2 pb-3 pt-1 text-pretty">
            <p>{tidy(otherGuide)}</p>
            <p>
              <TextLink href="/api/sablona" download>
                Stáhnout šablonu
              </TextLink>{' '}
              · <TextLink href={`#${templateAnchor}`}>jak ji vyplnit</TextLink>
            </p>
          </div>
        )}
      </div>
    </>
  );
}
