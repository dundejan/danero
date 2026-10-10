import { notFound } from 'next/navigation';
import { AppToolbar } from '@/components/app-toolbar';
import { Toast } from '@/components/toast';
import { YearSwitcher } from '@/components/year-switcher';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Disclosure, DisclosureRow } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { Checkbox, Field, Input, Select, Textarea, describedByError } from '@/components/ui/field';
import { InfoPopover } from '@/components/ui/info-popover';
import { FieldRow, Group, GroupItem, Row } from '@/components/ui/list';
import { Notice } from '@/components/ui/notice';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Section } from '@/components/ui/section';
import { Stat } from '@/components/ui/stat';
import { StatusLabel } from '@/components/ui/status';
import { Switch } from '@/components/ui/switch';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { TextLink } from '@/components/ui/link';
import { EngineErrorCard } from '@/lib/fx-error';
import { SegmentedDemo, SheetDemo } from './sheet-demo';

export const metadata = {
  title: 'Primitiva — Danero',
  robots: { index: false, follow: false },
};

/** Vstupy pro sekci „Dlouhý obsah“ — smyšlené, jen dlouhé. */
const LONG_WORD = 'nejneobhospodařovávatelnějšími';
const LONG_NAME =
  'Ukázkový fond akcií celého světa s velmi dlouhým názvem (dříve Jiný ukázkový fond) – třída pro drobné investory';
const LONG_EMAIL =
  'velmi.dlouhe-jmeno-a-prijmeni+danero-investice-osobni-ucet@investicni-klub-ukazkove-mesto.priklad.test';

/** Stav „výpočet nejde dokončit“ s ukázkovou hláškou enginu. */
function EngineErrorSample() {
  return <EngineErrorCard message="Pro měnu HUF a rok 2026 chybí jednotný i denní kurz." />;
}

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
            <Row wrap label="Vratka kapitálu" value="daněna jako dividenda (bezpečný výklad)" />
            <Row strong label="Orientační daň z investic" value="2 180 Kč" />
            <GroupItem>
              <p className="font-medium">Položka s volným obsahem</p>
              <p className="type-footnote mt-1 text-ink-muted">
                Cokoli, co není „popisek — hodnota“ ani rozbalovací řádek.
              </p>
            </GroupItem>
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
            <FieldRow label="Souhrn" htmlFor="galerie-souhrn" hint="V úzkém okně se pole složí pod popisek.">
              <Select id="galerie-souhrn" defaultValue="tydne">
                <option value="denne">Denně</option>
                <option value="tydne">Týdně</option>
              </Select>
            </FieldRow>
            <Row label="Klikací řádek s tichým údajem" value="Změnit" href="/demo/prehled" />
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
            {/* vnořené rozbalovátko má vlastní šipku — neřídí se otevřeným řádkem */}
            <Disclosure summary="Jednotlivé nákupy (2)">
              <p>10 ks z 23. 10. 2023, 5 ks z 2. 11. 2023.</p>
            </Disclosure>
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

      <Section title="Stav celé stránky">
        {/* stránka v tomhle stavu nemá lištu, titulek je proto její h1 — tady,
            v galerii s vlastním h1, je to jen ukázka podoby */}
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl bg-canvas px-4">
            <EmptyState
              headingAs="p"
              title="Něco se pokazilo"
              action={
                <>
                  <Button>Zkusit znovu</Button>
                  <TextLink href="/demo/prehled" chevron>
                    Přehled
                  </TextLink>
                </>
              }
              note="Kód chyby: 1234567890"
            >
              Stránku se nepodařilo načíst. Tvoje data jsou v pořádku.
            </EmptyState>
          </div>
          <div className="rounded-xl bg-canvas px-4">
            <EngineErrorSample />
          </div>
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

      {/* Nejhorší vstupy, které primitiva musí unést bez přetečení stránky:
          zkus zúžit okno na 320 px a zvětšit písmo prohlížeče na 200 %. */}
      <Section title="Dlouhý obsah" count="pojistky">
        <div className="max-w-[22rem] space-y-8">
          <AppToolbar
            pinned={false}
            title={LONG_NAME}
            back={{ href: '/dev/primitiva', label: 'Zpět na velmi dlouhý název nadřazené stránky' }}
            className="mx-0 mt-0 mb-0 px-0"
          />
          <YearSwitcher
            years={Array.from({ length: 12 }, (_, index) => 2026 - index)}
            active={2017}
            hrefBase="/dev/primitiva"
          />
          <Group>
            <Row label="E-mail" value={LONG_EMAIL} />
            <Row label="Částka při velkém písmu" value="−12 345 678 901,23 Kč" />
            <Row label={LONG_WORD} value="ano" />
            <Row wrap label={`Vratka kapitálu u ${LONG_WORD}`} value="daněna jako dividenda (bezpečný výklad)" />
            <Row href="/dev/primitiva" label="Účet" value={LONG_EMAIL} />
          </Group>
          <Group>
            <DisclosureRow title={LONG_NAME} meta={`${LONG_WORD} · 10. 10. 2026`}>
              <p>Tichý údaj vpravo si bere nejvýš 40 % řádku.</p>
            </DisclosureRow>
          </Group>
          <StatusLabel tone="danger">
            Limit 50 000 Kč pro paušální daň — přes limit o částku, která se na jeden řádek nevejde
          </StatusLabel>
          <Notice
            tone="caution"
            title="Výpis se nepodařilo přečíst"
            action={<Button size="sm">Nahrát jiný výpis s {LONG_WORD} sloupci</Button>}
          />
          <Button>Stáhnout podklady s {LONG_WORD} přílohami k přiznání</Button>
          <EmptyState compact title={`${LONG_WORD}pozemkovýmifondy nenalezeny`}>
            Nezlomitelné slovo v titulku se zalomí.
          </EmptyState>
        </div>
      </Section>
    </main>
  );
}
