'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Group, Row } from '@/components/ui/list';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';

/** Klientské ukázky galerie: sheet a segmentový přepínač potřebují stav. */
export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Otevřít sheet
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} label="Ukázkový sheet" title="Limit paušální daně">
        <Group variant="inset">
          <Row label="Čerpáno" value="64 285 Kč" />
          <Row label="Limit" value="50 000 Kč" />
          <Row strong label="Překročeno o" value="14 285 Kč" />
        </Group>
      </Sheet>
    </>
  );
}

export function SegmentedDemo() {
  const [value, setValue] = useState('graf');
  const [section, setSection] = useState('tax');
  return (
    <>
      <SegmentedControl
        ariaLabel="Ukázka přepínače"
        value={value}
        onChange={setValue}
        segments={[
          { key: 'graf', label: 'Graf' },
          { key: 'tabulka', label: 'Tabulka' },
          { key: 'oboji', label: 'Obojí' },
        ]}
      />
      {/* větší velikost a šířka segmentů podle popisku */}
      <SegmentedControl
        ariaLabel="Ukázka většího přepínače"
        size="md"
        fit="content"
        value={section}
        onChange={setSection}
        segments={[
          { key: 'tax', label: 'Daň a výpočet' },
          { key: 'notifications', label: 'Upozornění' },
          { key: 'account', label: 'Účet' },
        ]}
      />
    </>
  );
}
