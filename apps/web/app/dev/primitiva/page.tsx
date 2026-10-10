import { notFound } from 'next/navigation';
import { Toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Checkbox, Field, Input, Select, Textarea, describedByError } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { Group, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Section } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { StatusLabel } from '@/components/ui/status';
import { Switch } from '@/components/ui/switch';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { TextLink } from '@/components/ui/link';
import { SegmentedDemo, SheetDemo } from './sheet-demo';

export const metadata = {
  title: 'Primitiva — Danero',
  robots: { index: false, follow: false },
};

/**
 * Galerie sdílených primitiv (docs/07-design.md) — jen pro vývoj: všechna
 * primitiva pohromadě na jedné ploše, ve stavech, které se na běžné stránce
 * špatně nahánějí. V produkčním sestavení trasa neexistuje (404).
 */
export default function PrimitivesPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-[64rem] space-y-14 px-(--page-gutter) py-10">
      <header>
        <h1 className="type-title-1">Primitiva</h1>
        <p className="type-callout mt-2 text-ink-muted">Vývojová galerie — v produkci neexistuje.</p>
      </header>

      <Section title="Tlačítka">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Hlavní akce</Button>
          <Button variant="tinted">Tónované</Button>
          <Button variant="secondary">Druhotné</Button>
          <Button variant="ghost">Textové</Button>
          <Button variant="danger">Smazat</Button>
          <Button disabled>Zakázané</Button>
          <Button size="sm">Malé</Button>
          <Button size="lg">Velké</Button>
          <TextLink href="/jak-pocitame" chevron>
            Jak Danero počítá
          </TextLink>
        </div>
      </Section>

      <Section
        title="Klíčová čísla a stav"
        info={
          <InfoPopover label="Klíčová čísla">
            <p>Vysvětlivka u nadpisu sekce — krátký text, nejvýš pár vět.</p>
          </InfoPopover>
        }
      >
        <StatusLabel tone="danger">Limit 50 000 Kč pro paušální daň — přes limit</StatusLabel>
        <dl className="mt-5 flex flex-wrap gap-x-16 gap-y-6">
          <Stat
            size="lg"
            label="Doplatek daně"
            value="980 Kč"
            note="orientačně, jen z investic"
            info={
              <InfoPopover label="Doplatek daně" title="Jak doplatek vznikl">
                <p>Daň z investic po odečtení zaplacených záloh.</p>
                <p>
                  <TextLink href="/jak-pocitame" chevron>
                    Jak Danero počítá
                  </TextLink>
                </p>
              </InfoPopover>
            }
          />
          <Stat label="Termín podání" value="3. 5. 2027" note="jen elektronicky" />
          <Stat label="Zbývá do limitu" value="9 085 Kč" tone="success" />
        </dl>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2">
          <StatusLabel tone="success">v pořádku</StatusLabel>
          <StatusLabel tone="caution">zvýšené čerpání</StatusLabel>
          <StatusLabel tone="warning">těsně pod limitem</StatusLabel>
          <StatusLabel tone="danger">přes limit</StatusLabel>
          <StatusLabel tone="neutral">čeká na data</StatusLabel>
        </div>
      </Section>

      <div className="grid gap-x-10 gap-y-14 md:grid-cols-2">
        <Section title="Seznam na ploše">
          <Group footer="Tichá věta pod skupinou.">
            <Row label="Základ daně z prodejů" hint="z toho deriváty 8 552 Kč" value="8 552 Kč" />
            <Row
              label="Daň v obecném základu"
              info={
                <InfoPopover label="Daň v obecném základu">
                  <p>Jednověté vysvětlení pojmu.</p>
                </InfoPopover>
              }
              value="2 180 Kč"
            />
            <Row label="Portfolio" value="52 pozic" href="/demo/portfolio" />
            <Row strong label="Orientační daň z investic" value="2 180 Kč" />
          </Group>
        </Section>

        <Section title="Skupina s výplní">
          <Group variant="inset" title="Upozornění">
            <Row label="E-mail při 85 % limitu">
              <Switch defaultChecked aria-label="E-mail při 85 % limitu" />
            </Row>
            <Row label="Měsíční přehled" hint="první den v měsíci">
              <Switch aria-label="Měsíční přehled" />
            </Row>
            <Row label="Zakázaná volba">
              <Switch disabled aria-label="Zakázaná volba" />
            </Row>
          </Group>
        </Section>
      </div>

      <Section title="Rozbalovací řádky" count={3}>
        <Group>
          <DisclosureRow title="Srážková daň nad smluvní strop" meta="8×">
            <p>Celé znění kontroly — dlouhý text z enginu, který se nepřepisuje.</p>
          </DisclosureRow>
          <DisclosureRow title="CSPX: osvobození za 13 dní" meta="10. 10. 2026" open>
            <p>15 ks CSPX splní tříletý časový test 23. 10. 2026.</p>
          </DisclosureRow>
          <DisclosureRow
            eyebrow={<span className="type-caption block font-semibold text-danger">Chyba</span>}
            title="Prodáno více kusů, než známe z historie"
          >
            <p>Detail chyby.</p>
          </DisclosureRow>
        </Group>
        <Disclosure summary="Jednotlivé případy (8)" className="mt-2">
          <p>Malý odkaz „ukaž víc“ pod textem.</p>
        </Disclosure>
      </Section>

      <Section title="Sdělení a prázdný stav">
        <div className="space-y-3">
          <Notice
            tone="caution"
            title="Pro rok 2027 ještě neznáme dvě státem vyhlašovaná čísla"
            action={<Button variant="secondary">Zjistit víc</Button>}
          >
            Hlídání limitů běží dál, jen odhad daně je méně přesný.
          </Notice>
          <Notice tone="danger" title="Synchronizace s brokerem selhala" />
          <Notice title="Podle mírnějšího výkladu by letošní prodeje byly osvobozené" />
          <Toast kind="ok" text="Nastavení uloženo." />
          <Toast kind="chyba" text="Soubor se nepodařilo přečíst — zkus ho nahrát znovu." />
          <EmptyState
            compact
            title="Žádné otevřené pozice"
            action={<Button size="sm">Nahrát výpisy</Button>}
          >
            Jakmile něco koupíš, uvidíš tady, kdy se nákup osvobodí od daně.
          </EmptyState>
        </div>
      </Section>

      <Section title="Formulář">
        <Card className="grid gap-5 md:grid-cols-2">
          <CardTitle className="md:col-span-2">Kdo jsi vůči dani</CardTitle>
          <Field
            label="Daňový režim"
            htmlFor="demo-regime"
            info={
              <InfoPopover label="Daňový režim">
                <p>Podle režimu Danero pozná, který limit ti hlídat.</p>
              </InfoPopover>
            }
          >
            <Select id="demo-regime" defaultValue="pausal">
              <option value="pausal">OSVČ v paušálním režimu</option>
              <option value="zamestnanec">Zaměstnanec</option>
            </Select>
          </Field>
          <Field label="Další příjmy za rok" htmlFor="demo-income" hint="V korunách, bez haléřů.">
            <Input id="demo-income" inputMode="numeric" defaultValue="0" />
          </Field>
          <Field
            label="E-mail"
            htmlFor="demo-email"
            error="Tohle není platná e-mailová adresa."
            errorId="demo-email-error"
          >
            <Input
              id="demo-email"
              type="email"
              defaultValue="nekdo@"
              {...describedByError(true, 'demo-email-error')}
            />
          </Field>
          <Field label="Zakázané pole" htmlFor="demo-disabled">
            <Input id="demo-disabled" disabled defaultValue="nelze změnit" />
          </Field>
          <Field label="Poznámka" htmlFor="demo-note" className="md:col-span-2">
            <Textarea id="demo-note" placeholder="Co se při importu stalo?" />
          </Field>
          <div className="md:col-span-2">
            <Checkbox
              defaultChecked
              label="Cenné papíry mám v obchodním majetku"
              hint="ruší osvobození — netypické"
            />
            <Checkbox label="Nezaškrtnutá volba" />
          </div>
        </Card>
      </Section>

      <Section title="Přepínač, sheet a dialog">
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedDemo />
          <SheetDemo />
          <ConfirmDialog
            trigger={<Button variant="danger">Smazat účet</Button>}
            title="Smazat účet?"
            description="Smažeme účet i všechna nahraná data. Tohle nejde vrátit."
            confirmLabel="Smazat účet"
          />
        </div>
      </Section>

      <Section title="Tabulka">
        <ScrollArea label="Ukázková tabulka">
          <Table>
            <caption className="sr-only">Ukázková tabulka pozic</caption>
            <thead>
              <tr>
                <Th>Titul</Th>
                <Th align="right">Kusy</Th>
                <Th align="right">Hodnota</Th>
                <Th align="right">Osvobození</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td>CSPX</Td>
                <Td align="right">15</Td>
                <Td align="right">212 400 Kč</Td>
                <Td align="right">23. 10. 2026</Td>
              </Tr>
              <Tr>
                <Td>ASML</Td>
                <Td align="right">4</Td>
                <Td align="right">71 920 Kč</Td>
                <Td align="right" className="text-success-text">
                  osvobozeno
                </Td>
              </Tr>
            </tbody>
          </Table>
        </ScrollArea>
      </Section>
    </main>
  );
}
