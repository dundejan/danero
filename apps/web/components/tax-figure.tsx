import type { TaxYearResult } from '@danero/engine';
import { InfoPopover } from '@/components/ui/info-popover';
import { Row } from '@/components/ui/list';
import { Stat } from '@/components/ui/stat';
import { czk } from '@/lib/format';
import {
  taxSummary,
  unpaidUnderLimitCzk,
  type DividendTaxation,
  type TaxSummary,
} from '@/lib/payable-tax';
import { tidy } from '@/lib/typography';

/**
 * Hlavní číslo daně a jeho rozpad — JEDINÝ zdroj pro přehled, report
 * i simulátor (nálezy R1B-02, R1B-03, R5-03).
 *
 * Jména jsou dvě a všude stejná:
 * - **Orientační daň z investic** — daň, kdyby se podávalo přiznání,
 * - **Doplatek daně** — táž daň po odečtení záloh z paušálního režimu; hlavní
 *   číslo jen tam, kde se zálohy opravdu odečítají (`taxSummary`).
 *
 * Kde stojí obě, stojí mezi nimi zálohy: u velkého čísla třemi slovy
 * („daň 2 180 Kč − zálohy 1 200 Kč“), v rozpadu jako řádek s minusem.
 */
export const TAX_NAME = 'Orientační daň z investic';
export const DUE_NAME = 'Doplatek daně';

/**
 * Dva způsoby zdanění zahraničních dividend obyčejnými slovy. Tiskopis jim
 * říká „obecný“ a „samostatný základ daně“ — to patří do vysvětlivky, ne do
 * řádku s číslem (pravidlo 3).
 */
export const DIVIDEND_TAXATION_LABEL: Record<DividendTaxation, string> = {
  GENERAL: 'S ostatními příjmy',
  SEPARATE_16A: 'Zvlášť sazbou 15 %',
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const otherOf = (variant: DividendTaxation): DividendTaxation =>
  variant === 'GENERAL' ? 'SEPARATE_16A' : 'GENERAL';

/**
 * Kolik by vyšla daň při druhém způsobu zdanění dividend — bez tečky, do věty
 * i do řádku. Shodné částky se neopisují dvakrát: pod hranicí vyšší sazby
 * vycházejí oba způsoby na korunu stejně a dvě stejná čísla vedle sebe by
 * vypadala jako rozdíl, který není.
 */
function otherVariantNote(summary: TaxSummary): string {
  const other = lowerFirst(DIVIDEND_TAXATION_LABEL[otherOf(summary.variant)]);
  const otherTax = summary.otherVariantTaxCzk;
  if (!otherTax) return '';
  return czk(otherTax) === czk(summary.taxCzk)
    ? `${other} by daň vyšla stejně`
    : `${other} by daň vyšla ${czk(otherTax)}`;
}

/** Výklad obou způsobů zdanění dividend — na obrazovce za „i“, v tisku rozepsaný. */
export function DividendTaxationInfo() {
  return (
    <>
      <p>
        {tidy(
          'Zahraniční dividendy a úroky jde zdanit dvěma způsoby a vybíráš si až v přiznání: spolu s ostatními příjmy (tiskopis tomu říká obecný základ daně, sazba 15 nebo 23 %), nebo zvlášť sazbou 15 % (samostatný základ daně, § 16a).',
        )}
      </p>
      <p>
        {tidy(
          'Obě částky jsou před slevami. Při zdanění zvlášť nejdou uplatnit slevy na dani ani nezdanitelné části základu, takže o výsledku rozhoduje i zbytek tvého přiznání, který Danero nevidí.',
        )}
      </p>
    </>
  );
}

/** Pár slov pod číslem, která nesmí zmizet (docs/07 §5.3). */
function figureNote(summary: TaxSummary, unpaidUnderLimit: boolean): React.ReactNode {
  if (summary.flatTaxBroken) {
    return (
      <>
        <span className="block tabular-nums">
          {summary.advances
            ? tidy(`daň ${czk(summary.taxCzk)} − zálohy ${czk(summary.advances.totalCzk)}`)
            : 'před odečtením záloh'}
        </span>
        {/* R5-03: doplatek daně není celá cena prolomení — u paušalisty ji
            nese hlavně pojistné, a to musí být vidět bez otevření vysvětlivky */}
        <span className="block">
          {summary.advances ? 'orientačně, jen z investic' : 'jen z investic'} · navíc pojistné a
          přehledy
        </span>
      </>
    );
  }
  // R-09f (L24-02): pod limitem režimu se tahle daň neplatí — bez téhle výhrady
  // stála částka hned vedle verdiktu „povinnost nevzniká“ a vypadala jako dluh
  if (unpaidUnderLimit && summary.taxCzk.gt(0)) return 'Platí se jen při podání přiznání';
  return 'orientačně, jen z investic';
}

/**
 * Obsah vysvětlivky hlavního čísla. Report ho tiskne i na papír (`InfoPrint`),
 * proto je to samostatná komponenta, ne jen vnitřek `TaxFigure`.
 */
export function TaxFigureInfo({ result }: { result: TaxYearResult }) {
  const summary = taxSummary(result);
  const unpaidUnderLimit = unpaidUnderLimitCzk(result);
  const variantTax = summary.variant === 'GENERAL' ? result.tax.general : result.tax.separate16a;
  // rozdíl zaokrouhlených členů, ať věta sedí i po zaokrouhlení na celé Kč
  const appliedCreditCzk = variantTax.taxBeforeCreditCzk
    .toDecimalPlaces(0)
    .sub(variantTax.taxCzk.toDecimalPlaces(0));
  return (
    <>
      {summary.advances && summary.dueCzk && (
        <dl className="space-y-1 tabular-nums">
          <div className="flex justify-between gap-4">
            <dt>{TAX_NAME}</dt>
            <dd>{czk(summary.taxCzk)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>
              − zaplacené zálohy na daň ({summary.advances.months} ×{' '}
              {czk(summary.advances.monthlyCzk)} z paušální zálohy)
            </dt>
            <dd>{czk(summary.advances.totalCzk)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-semibold">
            <dt>{DUE_NAME}</dt>
            <dd>{czk(summary.dueCzk)}</dd>
          </div>
        </dl>
      )}
      <p>
        {tidy(
          `Daň před zápočtem ${czk(variantTax.taxBeforeCreditCzk)} − uplatněný zápočet zahraniční daně ${czk(appliedCreditCzk)} = ${lowerFirst(TAX_NAME)} ${czk(summary.taxCzk)}.`,
        )}
        {summary.otherVariantTaxCzk &&
          ` ${tidy(
            `Dividendy počítáme zdaněné ${lowerFirst(DIVIDEND_TAXATION_LABEL[summary.variant])}; ${otherVariantNote(summary)}.`,
          )}`}
      </p>
      {summary.flatTaxBroken ? (
        <>
          <p>
            {tidy(
              'Číslo je orientační a jen z investic — daň z podnikání (§ 7) Danero nevidí. K tomu přibude přehled ČSSZ a zdravotní pojišťovně a doplatek pojistného ze skutečných příjmů; ten spočítat neumíme, protože neznáme tvůj základ z § 7.',
            )}
          </p>
          {summary.advances ? (
            <p>
              {tidy(
                `Zálohy počítáme za ${summary.advances.months} měsíců v paušálním režimu a v 1. pásmu. Kdo v něm byl jen část roku, zaplatil na zálohách míň a doplatí o ${czk(summary.advances.monthlyCzk)} víc za každý měsíc mimo režim.`,
              )}
            </p>
          ) : (
            <p>
              {tidy(
                'Výši paušální zálohy pro tenhle rok neznáme, takže zaplacené zálohy od daně neodečítáme — doplatek bude o ně nižší.',
              )}
            </p>
          )}
        </>
      ) : (
        <p>{tidy(result.tax.note)}</p>
      )}
      {unpaidUnderLimit && (
        <p>
          Dokud jsi pod limitem {czk(unpaidUnderLimit)}, přiznání nepodáváš a tuhle daň neplatíš —
          počítáme jen s příjmy, o kterých Danero ví.
        </p>
      )}
    </>
  );
}

/**
 * Velké číslo daně vedle verdiktu — na přehledu i v reportu totéž: doplatek,
 * když se odečítají zálohy z paušálního režimu, jinak orientační daň.
 */
export function TaxFigure({ result }: { result: TaxYearResult }) {
  const summary = taxSummary(result);
  const unpaidUnderLimit = unpaidUnderLimitCzk(result) !== null;
  const due = summary.dueCzk !== null;
  const name = due ? DUE_NAME : TAX_NAME;
  return (
    <Stat
      size="lg"
      label={name}
      value={czk(summary.dueCzk ?? summary.taxCzk)}
      note={figureNote(summary, unpaidUnderLimit)}
      info={
        <InfoPopover label={name} title={due ? 'Jak doplatek vznikl' : 'Jak daň vznikla'}>
          <TaxFigureInfo result={result} />
        </InfoPopover>
      }
    />
  );
}

/**
 * Řádek „Zdanění dividend a úroků“ do rozpadu daně: volba se dvěma možnostmi.
 * Vpravo je ta, se kterou počítáme, pod popiskem, kolik by vyšla ta druhá.
 *
 * Dřív tu stály dva řádky „Daň v obecném základu“ a „Daň v samostatném
 * základu“ nad tučným výsledkem — četlo se to jako sčítance a součet
 * (2 180 + 2 175 = 2 180), ačkoli jde o dvě varianty téhož (R1B-02).
 */
export function DividendTaxationRow({ summary }: { summary: TaxSummary }) {
  if (!summary.otherVariantTaxCzk) return null;
  return (
    <Row
      label="Zdanění dividend a úroků"
      info={
        <InfoPopover label="Dva způsoby zdanění dividend">
          <DividendTaxationInfo />
        </InfoPopover>
      }
      hint={tidy(otherVariantNote(summary))}
      value={lowerFirst(DIVIDEND_TAXATION_LABEL[summary.variant])}
    />
  );
}

/**
 * Konec rozpadu daně: orientační daň, a když se odečítají zálohy z paušálního
 * režimu, tak i ony a doplatek — vztah mezi oběma čísly je vidět řádek po
 * řádku. Bez záloh je výsledkem sama daň.
 */
export function TaxResultRows({ summary }: { summary: TaxSummary }) {
  if (!summary.advances || summary.dueCzk === null) {
    return <Row strong label={TAX_NAME} value={czk(summary.taxCzk)} />;
  }
  return (
    <>
      <Row label={TAX_NAME} value={czk(summary.taxCzk)} />
      <Row
        label="− Zálohy z paušálního režimu"
        hint={`${summary.advances.months} × ${czk(summary.advances.monthlyCzk)}, daňová část zálohy`}
        value={czk(summary.advances.totalCzk)}
      />
      <Row strong label={DUE_NAME} value={czk(summary.dueCzk)} />
    </>
  );
}
