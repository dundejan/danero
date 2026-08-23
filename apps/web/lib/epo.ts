import { d, Decimal, roundBaseDownTo100, ZERO, type Money } from '@danero/shared';
import { TAXPAYER_CREDIT_CZK, type EngineOptions, type TaxYearResult } from '@danero/engine';
import { base10Values, priloha2, wholeCzkParts } from '@/lib/priloha2';

/**
 * Generátor XML písemnosti DPFDP7 (přiznání k dani z příjmů fyzických osob)
 * pro EPO / mojedane.cz. Čistá funkce bez I/O — tvar XML se drží empiricky
 * validovaných vzorů (prošly oficiální testovací podatelnou) a XSD dpfdp7_epo2.
 *
 * Do XML se propisují VÝHRADNĚ investiční příjmy z enginu (§ 8 + § 10);
 * přiznání může obsahovat i jiné příjmy (§ 6, § 7, § 9) — ty si uživatel
 * doplní v EPO a řádky výpočtu daně se tam přepočítají. Je to podklad,
 * nikoli hotové přiznání.
 */

/** Osobní údaje poplatníka — jen protečou do XML, Danero je nikde neukládá. */
export interface EpoPersonalData {
  dic?: string;
  rodneCislo?: string;
  prijmeni?: string;
  jmeno?: string;
  ulice?: string;
  cisloPopisne?: string;
  obec?: string;
  psc?: string;
  /** Kód finančního úřadu (číselník ÚFO) — VetaD.c_ufo_cil. */
  ufoCil?: string;
  /** Kód územního pracoviště (číselník PRACUFO) — VetaP.c_pracufo. */
  pracUfo?: string;
  email?: string;
}

/**
 * Typ přiznání (položka `dap_typ`, číselník tiskopisu DPFDP7):
 * `B` řádné · `O` opravné (před uplynutím lhůty) · `D` dodatečné ·
 * `E` opravné dodatečné. XSD připouští všechny čtyři.
 */
export type EpoDapTyp = 'B' | 'O' | 'D' | 'E';

/** Typy, u kterých podatelna vyžaduje 6. oddíl (dodatečné přiznání). */
export const DODATECNE_DAP_TYPY: readonly EpoDapTyp[] = ['D', 'E'];

/**
 * 6. oddíl tiskopisu — vyplňuje se JEN u dodatečného přiznání.
 *
 * ⚠️ Změřeno na zkušební podatelně 23. 8. 2026: `dap_typ="D"` bez tohohle
 * oddílu podání neprojde (`[N] Oddíl 6/ř.79`, `[N] Oddíl 6/ř.82`). Backlog
 * počítal jen s datem zjištění — podatelna ale kontroluje i vzorce
 * ř. 80 = ř. 79 − ř. 78 a ř. 83 = ř. 82 − ř. 81, takže poslední známou daň
 * a ztrátu musí zadat uživatel: pocházejí z dřív podaného přiznání, které
 * Danero nevidí (mohlo obsahovat i § 6 a § 7).
 */
export interface EpoDodatecne {
  /** Den zjištění důvodů pro podání (ISO `YYYY-MM-DD`) — § 141 odst. 1 DŘ. */
  zjistenoDne: string;
  /** ř. 78 — poslední známá daň z dříve podaného přiznání. */
  posledniZnamaDanCzk?: string;
  /** ř. 81 — poslední známá daňová ztráta. */
  posledniZnamaZtrataCzk?: string;
}

export interface EpoInput {
  year: number;
  result: TaxYearResult;
  personal: EpoPersonalData;
  varianta?: 'GENERAL' | 'SEPARATE_16A';
  /** Typ přiznání; výchozí `B` (řádné). */
  dapTyp?: EpoDapTyp;
  /** 6. oddíl — povinný u `D` i `E`. */
  dodatecne?: EpoDodatecne;
}

/** Roky, pro které oficiální struktura DPFDP7 existuje (kritická kontrola EPO na položce rok). */
export const EPO_SUPPORTED_YEARS = [2024, 2025];

/**
 * Hranice 23% sazby (§ 16 ZDP) = 36násobek průměrné mzdy dle nařízení vlády:
 * 2024: 43 967 Kč (NV č. 286/2023 Sb.), 2025: 46 557 Kč (NV č. 282/2024 Sb.).
 * Pro formulář držíme přesnou hodnotu daného roku (EPO ř. 57 kontroluje).
 */
export const PROGRESSIVE_THRESHOLD: Record<number, string> = {
  2024: '1582812',
  2025: '1676052',
};

/**
 * Základní sleva na poplatníka § 35ba odst. 1 písm. a) — EPO na ř. 64 vyžaduje
 * přesně 30 840 Kč. Jediná definice je v enginu, ať se dvě kopie nerozejdou.
 */
const SLEVA_POPLATNIK = d(TAXPAYER_CREDIT_CZK);

/** Nepovinná částka z formuláře — prázdné pole znamená nulu, ne chybu. */
function castka(value: string | undefined, popis: string): Money {
  if (value === undefined || value.trim() === '') return ZERO;
  const parsed = new Decimal(value.replace(/\s/g, '').replace(',', '.'));
  if (!parsed.isFinite()) throw new EpoInputError(`Zadej ${popis} jako číslo v korunách.`);
  return parsed;
}

/** ISO datum → tvar, ve kterém ho čekají písemnosti EPO („5.8.2026"). */
function epoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new EpoInputError(`Datum ${iso} není ve tvaru RRRR-MM-DD.`);
  return `${Number(match[3])}.${Number(match[2])}.${match[1]}`;
}

/** § 38b: daň se nepředepíše a neplatí, nepřesáhne-li 200 Kč (R-14e). */
const HRANICE_38B = d('200');

/**
 * Vada VSTUPU, kterou uživatel umí odstranit — nepodporovaný rok, kód státu
 * mimo číselník. Hláška je psaná pro něj a smí se mu ukázat.
 *
 * Vlastní typ existuje proto, že `/api/epo` do 23. 8. 2026 každou výjimku
 * zabalil do „Export se nepodařil. Zkus to prosím znovu." — u deterministické
 * vady je „zkus to znovu" nesmyslná rada a uživatel přišel i o jedinou větu,
 * která mu říkala, CO má opravit (nález K3-06).
 */
export class EpoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpoInputError';
  }
}

// ---------- zaokrouhlování (výhradně Decimal, žádné number) ----------

/** Celé Kč, matematicky. */
const round0 = (v: Money): Money => v.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
/** Celé Kč nahoru — daň (ř. 60). */
const ceil0 = (v: Money): Money => v.toDecimalPlaces(0, Decimal.ROUND_CEIL);
/** Dvě desetinná místa, matematicky (ř. 324–326, 413). */
const round2 = (v: Money): Money => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/** Částka v celých Kč jako atribut. */
const kc = (v: Money): string => round0(v).toFixed(0);
/** Částka s max. 2 des. místy (XSD fractionDigits=2) — bez koncových nul. */
const kc2 = (v: Money): string => round2(v).toString();

/**
 * Číselník zemí (ISO 3166-1 alpha-2), který podatelna u Přílohy 3 vyžaduje.
 *
 * Kód státu se odvozuje z prefixu ISIN, jenže **ne každý prefix je země**:
 * `XS` (eurobondy), `EU`, `QS` a celá řada `X…` jsou technické prefixy. Podatelna
 * na ně odpoví kritickou chybou „Kód země není uveden v číselníku zemí" a podání
 * odmítne (nález A3-06). Radši to poznáme my a řekneme uživateli, co doplnit,
 * než aby mu to spadlo až na podatelně.
 */
const KODY_ZEMI = new Set(
  ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
    'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
    'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '),
);

// ---------- XML ----------

/**
 * Vyhodí řídicí znaky, které XML 1.0 v obsahu nepřipouští vůbec (povolené jsou
 * z nich jen tabulátor, LF a CR). Do jména nebo ulice se dostanou snadno —
 * kopírováním z PDF nebo z Wordu — a syrový U+0001 v atributu udělá ze souboru
 * nevalidní XML, které podatelna vůbec nenačte („Chyba zpracování souboru").
 * Uživatel by přitom dostal ke stažení soubor, který vypadá v pořádku
 * (nález A3-07). Psáno smyčkou, ne regulárním výrazem — literál s řídicími
 * znaky neprojde lintem (no-control-regex).
 */
const bezRidicichZnaku = (value: string): string => {
  let out = '';
  for (const znak of value) {
    const kod = znak.codePointAt(0) ?? 0;
    if (kod > 0x1f || kod === 0x09 || kod === 0x0a || kod === 0x0d) out += znak;
  }
  return out;
};

const escapeXml = (value: string): string =>
  bezRidicichZnaku(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Věta jako self-closing element; atributy s hodnotou undefined se vynechají. */
const veta = (name: string, attrs: Record<string, string | undefined>): string => {
  const parts = Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`);
  return `<${name} ${parts.join(' ')}/>`;
};

// ---------- očista osobních údajů ----------

const clean = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** DIČ jen číselná část — případný prefix „CZ“ a mezery pryč. */
const cleanDic = (value?: string): string | undefined =>
  clean(clean(value)?.replace(/^cz/i, '').replace(/\s+/g, ''));

/** Rodné číslo bez lomítka a mezer (XSD chce jen číslice). */
const cleanRodneCislo = (value?: string): string | undefined =>
  clean(clean(value)?.replace(/[\s/]+/g, ''));

/** PSČ bez mezer (XSD: 5 znaků bez mezer). */
const cleanPsc = (value?: string): string | undefined =>
  clean(clean(value)?.replace(/\s+/g, ''));

/**
 * Příjmy ze státu, u nichž se použije metoda prostého zápočtu — ř. 321 Přílohy 3
 * (a ř. 411 Přílohy 4). § 38f odst. 3 jimi rozumí příjmy, které v zahraničí
 * podléhají zdanění **v souladu s uzavřenou mezinárodní smlouvou**, ne všechno,
 * co ze státu přiteklo:
 *
 * - **dividendy** ano — čl. 10 smluv zdanění ve státě zdroje dovoluje (proto má
 *   engine tabulku smluvních stropů),
 * - **úroky** jen tam, kde je smlouva u zdroje zdanit vůbec nechává (čl. 11,
 *   R-07f): u US, DE, NL, IE i GB je strop 0 %, u JP 10 %. Úrok, ze kterého
 *   broker srazil daň proti smlouvě, do koeficientu zápočtu nepatří — zvedl by
 *   strop zápočtu i pro dividendy téhož státu, na který nárok není (přeplatek
 *   se vrací ve státě zdroje, ne v českém přiznání).
 *
 * Engine do `interestGrossCzk` dává jen úroky, ze kterých se v zahraničí daň
 * skutečně strhla (R-07f); nezdaněný úrok zůstává v § 8 na ř. 38, ale do
 * zápočtu nevstupuje. Exportováno, aby report ukazoval po státech tatáž čísla
 * jako XML (nález A3-12).
 */
export function prijmyZeStatuProZapocet(
  country: string,
  agg: { grossCzk: Money; interestGrossCzk: Money },
  options: Pick<EngineOptions, 'treatyInterestWithholdingCap' | 'defaultInterestTreatyCap'>,
): Money {
  const stropUroku = d(
    options.treatyInterestWithholdingCap[country] ?? options.defaultInterestTreatyCap,
  );
  return stropUroku.gt(0) ? agg.grossCzk.plus(agg.interestGrossCzk) : agg.grossCzk;
}

/** Daň podle § 16: 15 % do hranice, 23 % nad ní; vstupem základ zaokrouhlený na sta dolů. */
const danPodle16 = (zdZaokrouhleny: Money, threshold: Money): Money =>
  zdZaokrouhleny.lte(threshold)
    ? zdZaokrouhleny.mul('0.15')
    : threshold.mul('0.15').plus(zdZaokrouhleny.sub(threshold).mul('0.23'));

export function generateDpfdp7(input: EpoInput): { xml: string } {
  const { year, result, personal } = input;
  if (!EPO_SUPPORTED_YEARS.includes(year)) {
    // dva různé důvody: rok NAD podporované (struktura teprve vyjde) × rok POD
    // nejstarší podporovaný (starší struktury záměrně nepodporujeme)
    const minYear = Math.min(...EPO_SUPPORTED_YEARS);
    throw new EpoInputError(
      year < minYear
        ? `Roky před ${minYear} v XML nepodporujeme. Čísla pro ruční vyplnění formuláře jsou v reportu.`
        : `Pro rok ${year} oficiální struktura písemnosti DPFDP7 zatím neexistuje — EPO přijímá jen roky 2024 a 2025. Strukturu pro další rok zveřejňuje finanční správa až začátkem následujícího roku.`,
    );
  }
  const varianta = input.varianta ?? result.tax.recommended;
  const dapTyp: EpoDapTyp = input.dapTyp ?? 'B';
  const jeDodatecne = DODATECNE_DAP_TYPY.includes(dapTyp);
  // Dodatečné přiznání se podává do konce měsíce následujícího po měsíci, kdy
  // poplatník důvody zjistil (§ 141 odst. 1 daňového řádu) — bez toho data
  // nejde lhůtu posoudit a podatelna položku vyžaduje.
  if (jeDodatecne && !input.dodatecne?.zjistenoDne) {
    throw new EpoInputError(
      'U dodatečného přiznání musíš vyplnit den, kdy jsi zjistil důvody pro jeho podání — bez něj ho podatelna nepřijme.',
    );
  }
  const dZjist = jeDodatecne ? epoDate(input.dodatecne!.zjistenoDne) : undefined;
  const poslednDan = castka(input.dodatecne?.posledniZnamaDanCzk, 'poslední známou daň');
  const poslednZtrata = castka(
    input.dodatecne?.posledniZnamaZtrataCzk,
    'poslední známou daňovou ztrátu',
  );
  const threshold = d(PROGRESSIVE_THRESHOLD[year]!);

  // ---------- Příloha 2 (§ 10) — druhy: CP (kód D), krypto (kód C), deriváty (kód F) ----------
  // Jediný zdroj čísel, sdílený s průvodcem v reportu (lib/priloha2.ts): vlastní
  // kopie tady vedla k tomu, že report radil zapsat NEzastropované výdaje,
  // zatímco XML neslo min(výdaje, příjmy) podle § 10 odst. 4 — nález K3-03.
  // Pořadí řádků VetaJ v XML = pořadí v `priloha2` (D → C → F).
  const p2 = priloha2(result);
  const druhy10 = p2.rows.map((row) => ({
    kod: row.kod,
    popis: row.popis,
    prij: row.prijmyCzk,
    vyd: row.vydajeCzk,
    zd: row.rozdilCzk,
    zahranicni: row.zahranicniZdroj,
  }));
  const prij10 = p2.prijmyCzk; // ř. 207
  const vyd10 = p2.vydajeCzk; // ř. 208
  const zd10 = p2.rozdilCzk; // ř. 209
  const hasPriloha2 = prij10.gt(0);

  // ---------- § 8 — dividendy + úroky brutto (celé Kč) ----------
  // V obecném základu je § 8 posledním dílem rozdělení výše. V samostatném
  // základu § 16a jde do Přílohy 4 s vlastním zaokrouhlením na sta dolů
  // (ř. 409) — i tam zaokrouhlujeme na celé koruny dolů, aby ř. 409 vyšel
  // stejně jako `roundBaseDownTo100` v enginu.
  // § 8 je posledním dílem TÉHOŽ rozdělení celých korun jako druhy § 10 — běžící
  // součet zaručí, že se řádky Přílohy 2 přidáním § 8 na konec nepohnou.
  const base8 =
    varianta === 'GENERAL'
      ? wholeCzkParts([...base10Values(result), result.dividends.base8Czk]).at(-1)!
      : result.dividends.base8Czk.toDecimalPlaces(0, Decimal.ROUND_FLOOR);

  // ---------- rozpad zahraničních příjmů a započitatelné srážky po státech (P3 / P4) ----------
  const staty = Object.entries(result.dividends.creditableByCountry)
    .map(([country, agg]) => ({
      country,
      gross: round0(prijmyZeStatuProZapocet(country, agg, result.options)),
      creditable: agg.creditableCzk,
    }))
    .sort((a, b) => a.country.localeCompare(b.country));

  // ---------- 2. oddíl — dílčí základy (VetaO) ----------
  // ř. 38: § 8 jen v obecném základu (GENERAL); u § 16a jde do Přílohy 4
  const r38 = varianta === 'GENERAL' ? base8 : ZERO;
  const r40 = hasPriloha2 ? zd10 : ZERO; // ř. 40 = ř. 209 Přílohy 2
  const r41 = r38.plus(r40); // ř. 41 = ř. 37 + 38 + 39 + 40 (u nás jen 38 + 40)
  const r42 = r41; // ř. 42 = ř. 36 + kladný ř. 41 (§ 6 nemáme)
  const r45 = r42; // ř. 45 — bez uplatněné ztráty
  const r55 = r45; // ř. 55 — bez nezdanitelných částí
  const r56 = roundBaseDownTo100(r55); // ř. 56: celá sta Kč dolů (§ 16 odst. 2)
  const r57 = danPodle16(r56, threshold); // ř. 57

  // ---------- Příloha 3 — prostý zápočet po státech (jen GENERAL, § 38f) ----------
  const hasPriloha3 =
    varianta === 'GENERAL' && result.dividends.creditableWithholdingCzk.gt(0) && r57.gt(0);
  // Kód státu jde do Přílohy 3 i do Seznamu; podatelna ho kontroluje proti
  // číselníku zemí a neplatný kód shodí CELÉ podání (A3-06). Prefix ISIN ale
  // není vždy země — `XS` (eurobondy), `EU`, `QS`. Radši to poznáme tady
  // a řekneme uživateli, co doplnit, než aby mu podání odmítla podatelna.
  const neznameZeme = [
    ...new Set(staty.filter((s) => s.creditable.gt(0) && !KODY_ZEMI.has(s.country)).map((s) => s.country)),
  ];
  if (hasPriloha3 && neznameZeme.length > 0) {
    throw new EpoInputError(
      `Kód státu ${neznameZeme.join(', ')} není zemí podle číselníku finanční správy — vznikl z prefixu ISIN (např. XS u eurobondů). Doplň u těchhle dividend zemi zdroje v importu, jinak podatelna podání odmítne.`,
    );
  }
  const p3 = (hasPriloha3 ? staty.filter((s) => s.creditable.gt(0)) : []).map((s) => {
    const r321 = s.gross; // příjmy ze státu (metoda zápočtu)
    // ř. 323: daň zaplacená v zahraničí JEN do výše dle smlouvy (R-07c) — přeplatek
    // (např. US 30 % bez W-8BEN) se do přiznání nedostane vůbec; testovací
    // podatelna vynucuje ř. 326 = min(ř. 323, ř. 325) bez dalších stropů
    const r323 = round0(s.creditable);
    const r324 = round2(r321.div(r42).mul(100)); // koeficient zápočtu v %
    const r325 = round2(r57.mul(r324).div(100)); // maximálně lze započítat
    const r326 = round2(Decimal.min(r323, r325)); // uznaná daň (vzorec EPO)
    const r327 = round2(Decimal.max(ZERO, r323.sub(r326))); // neuznaný zbytek
    return { country: s.country, r321, r323, r324, r325, r326, r327 };
  });
  const r328 = p3.reduce((acc, row) => acc.plus(row.r326), ZERO); // daň uznaná k zápočtu
  const r329 = p3.reduce((acc, row) => acc.plus(row.r327), ZERO); // daň neuznaná
  const r330 = Decimal.max(ZERO, r57.sub(r328)); // daň po zápočtu → ř. 58

  // ---------- Příloha 4 — samostatný základ § 16a (varianta SEPARATE_16A) ----------
  const has16a = varianta === 'SEPARATE_16A' && base8.gt(0);
  let p4: {
    r401a: Money; r406: Money; r409: Money; r410: Money;
    r411: Money; r412: Money; r413: Money; r414: Money;
  } | undefined;
  if (has16a) {
    const r401a = base8; // příjmy § 8 ze zahraničí
    const r406 = r401a; // ř. 401 + ř. 401a
    const r409 = roundBaseDownTo100(r406); // součet dílčích základů, celá sta dolů
    const r410 = r409.mul('0.15'); // daň 15 % (násobek 100 → celé Kč)
    const zapocetStaty = staty.filter((s) => s.creditable.gt(0));
    const r411 = zapocetStaty.reduce((acc, s) => acc.plus(s.gross), ZERO);
    // ř. 412: daň zaplacená v zahraničí jen do výše dle smluv (R-07c, jako ř. 323)
    const r412 = round0(zapocetStaty.reduce((acc, s) => acc.plus(s.creditable), ZERO));
    // ř. 413: přesně vzorec EPO — ř. 412, max. 15 % z ř. 411
    const r413 = round2(Decimal.min(r412, r411.mul('0.15')));
    // ř. 414 → ř. 74a je v celých Kč; daň zaokrouhlujeme nahoru (princip ř. 60).
    // Clamp na nulu (vzor ř. 330): r410 je 15 % ze základu zaokrouhleného na sta
    // DOLŮ, r413 z NEzaokrouhleného úhrnu — při plné smluvní srážce může r413
    // převýšit r410 a bez clampu by vznikla záporná daň ze samostatného základu.
    const r414 = Decimal.max(ZERO, ceil0(r410.sub(r413)));
    p4 = { r401a, r406, r409, r410, r411, r412, r413, r414 };
  }

  // ---------- 4.–7. oddíl (VetaD) ----------
  const r58 = hasPriloha3 ? r330 : r57; // daň § 16, příp. po zápočtu z P3
  const r60 = ceil0(r58); // daň celkem, celé Kč nahoru
  const r71 = Decimal.max(ZERO, r60.sub(SLEVA_POPLATNIK)); // po slevě na poplatníka
  const r74 = r71; // sleva § 35c nemáme
  const r74a = p4?.r414;
  const r75 = r74.plus(r74a ?? ZERO); // daň celkem
  const r77 = r75; // bez daňového bonusu
  // ř. 91 „zbývá doplatit“ (R-14d, R-14e): kontrolní vzorec EPO je ř.91 = ř.77
  // (mínus zálohy a zápočty, které Danero nevyplňuje), a § 38b daň do 200 Kč
  // včetně nepředepisuje. Změřeno sondou na zkušební podatelně: ř.77 = 200 → 0,
  // ř.77 = 201 → 201.
  //
  // ⚠️ Do 23. 8. 2026 tu stálo `max(0, ř.60 − sleva + ř.74a)`, tedy nevyčerpaný
  // zbytek slevy proti dani § 16a. Podatelna takové XML ODMÍTÁ
  // (`[N] kc_zbyvpred :: Oddíl 7/ř.91`) a je to i proti § 35ba odst. 1. Vzorec
  // se sem dostal z jediného pokusu s ř.77 = 30 Kč — uvnitř okna § 38b, kde
  // oba vzorce shodně dávají nulu. Vzorek, který rozdíl pozná, musí mít
  // zároveň ř.60 < 30 840 a ř.414 > 200 Kč.
  const r91 = r77.lte(HRANICE_38B) ? ZERO : r77;

  // ---------- sestavení XML (pořadí vět dle XSD sekvence) ----------
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<Pisemnost nazevSW="Danero" verzeSW="1.0">');
  lines.push('<DPFDP7 verzePis="01.01">');

  lines.push(
    veta('VetaD', {
      c_ufo_cil: clean(personal.ufoCil), // bez FÚ: uživatel doplní po načtení v EPO
      // K3-07: typ přiznání byl natvrdo „řádné", ačkoli UI navádí i na
      // dodatečné. V EPO jde po načtení přepnout, ale kdo to neudělá, podá
      // řádné přiznání za období, které už jednou přiznal.
      dap_typ: dapTyp,
      d_zjist: dZjist,
      dokument: 'DP7',
      k_uladis: 'DPF',
      rok: String(year),
      pln_moc: 'N',
      audit: 'N',
      zdobd_od: `1.1.${year}`,
      zdobd_do: `31.12.${year}`,
      da_slezap: kc2(r58),
      da_celod13: kc(r60),
      kc_dztrata: '0',
      kc_op15_1a: kc(SLEVA_POPLATNIK),
      uhrn_slevy35ba: kc(SLEVA_POPLATNIK),
      da_slevy35ba: kc(r71),
      da_slevy35c: kc(r74),
      da_samzakl: r74a === undefined ? undefined : kc(r74a),
      kc_dan_celk: kc(r75),
      kc_dan_po_db: kc(r77),
      kc_db_po_odpd: '0',
      // ---------- 6. oddíl — jen u dodatečného přiznání ----------
      // Vzorce ř. 80 = ř. 79 − ř. 78 a ř. 83 = ř. 82 − ř. 81 podatelna
      // KONTROLUJE (změřeno 23. 8. 2026), takže se posílají všechny řádky
      // naráz, nebo žádný.
      kc_pzdp: jeDodatecne ? kc(poslednDan) : undefined,
      kc_zjidp: jeDodatecne ? kc(r77) : undefined,
      kc_rozdil_dp: jeDodatecne ? kc(r77.sub(poslednDan)) : undefined,
      kc_pzzt: jeDodatecne ? kc(poslednZtrata) : undefined,
      kc_zjizt: jeDodatecne ? '0' : undefined, // naše ř. 61 je vždy 0
      kc_rozdil_zt: jeDodatecne ? kc(ZERO.sub(poslednZtrata)) : undefined,
      kc_zbyvpred: kc(r91),
    }),
  );

  const vetaP: Record<string, string | undefined> = {
    dic: cleanDic(personal.dic),
    rod_c: cleanRodneCislo(personal.rodneCislo),
    prijmeni: clean(personal.prijmeni),
    jmeno: clean(personal.jmeno),
    ulice: clean(personal.ulice),
    c_pop: clean(personal.cisloPopisne),
    naz_obce: clean(personal.obec),
    psc: cleanPsc(personal.psc),
    c_pracufo: clean(personal.pracUfo),
    email: clean(personal.email),
  };
  if (Object.values(vetaP).some((value) => value !== undefined)) {
    lines.push(veta('VetaP', { ...vetaP, stat: 'ČESKÁ REPUBLIKA' }));
  }

  // Ř. 41 je součet ř. 38–40 a podatelna ten vzorec kontroluje: chybějící
  // sčítanec NENÍ totéž co nula. Vynechání `kc_zakldan8`/`kc_zd10` u roku bez
  // zdanitelných investičních příjmů proto shodilo celé podání na věcné chybě
  // „Oddíl 2/ř.41 — hodnota položky se nerovná hodnotě příslušného vzorce“
  // (ověřeno zkušební podatelnou, nález A3-01). Dosažitelné pro buy-and-hold
  // investora, který si podklady zaplatil: všechny prodeje osvobozené nebo pod
  // limitem 100k. Jakmile vyplňujeme úhrn, musí být vyplněné i sčítance.
  lines.push(
    veta('VetaO', {
      kc_zakldan8: varianta === 'GENERAL' ? kc(base8) : undefined,
      kc_zd10: kc(r40),
      kc_uhrn: kc(r41),
      kc_zakldan23: kc(r42),
      kc_zakldan: kc(r45),
    }),
  );
  lines.push(veta('VetaS', { kc_zdsniz: kc(r55), kc_zdzaokr: kc(r56), da_dan16: kc2(r57) }));

  // VetaB: přehled příloh (P2 jako „A“, P3 + seznam a P4 jako počty dle XSD)
  const prilohCelkem =
    (hasPriloha2 ? 1 : 0) + (hasPriloha3 ? p3.length + 1 : 0) + (has16a ? 1 : 0);
  if (prilohCelkem > 0) {
    lines.push(
      veta('VetaB', {
        priloha2: hasPriloha2 ? 'A' : undefined,
        priloha4: has16a ? '1' : undefined,
        pril3_samlist: hasPriloha3 ? String(p3.length) : undefined,
        seznam: hasPriloha3 ? '1' : undefined,
        priloh_celk: String(prilohCelkem),
      }),
    );
  }

  if (hasPriloha2) {
    lines.push(
      veta('VetaV', {
        kc_prij10: kc(prij10),
        kc_vyd10: kc(vyd10),
        kc_zd10p: kc(zd10),
        uhrn_prijmy10: kc(prij10),
        uhrn_vydaje10: kc(vyd10),
        // Úhrn 4. sloupce tabulky je součet KLADNÝCH rozdílů. Skončily-li
        // všechny druhy nanejvýš na nule (rok jen se ztrátovým prodejem —
        // výdaje jsou stropované příjmy druhu, § 10 odst. 4), není co sčítat
        // a políčko zůstává prázdné: napsané „0" podatelna hlásí jako rozpor
        // se součtem kladných hodnot sloupce (nález A3-13, ověřeno zkušební
        // podatelnou). Řádky tabulky se ale vypisují dál — bez nich přestanou
        // sedět úhrny 2. a 3. sloupce (ř. 207 a 208) a to je už věcná chyba.
        uhrn_rozdil10: zd10.gt(0) ? kc(zd10) : undefined,
      }),
    );
    for (const druh of druhy10) {
      if (druh.prij.lte(0)) continue;
      lines.push(
        veta('VetaJ', {
          kod_dr_prij10: druh.kod,
          druh_prij10: druh.popis,
          prijmy10: kc(druh.prij),
          vydaje10: kc(druh.vyd),
          rozdil10: kc(druh.zd),
          // 'Z' jen u skutečně zahraničního zdroje; u tuzemského se atribut vynechá
          kod10: druh.zahranicni ? 'Z' : undefined,
        }),
      );
    }
  }

  if (hasPriloha3) {
    lines.push(
      veta('VetaW', { uhrn_uzndan: kc2(r328), uhrn_neuzndan: kc2(r329), da_zazahr: kc2(r330) }),
    );
    for (const row of p3) {
      lines.push(
        veta('VetaL', {
          kod_statu: row.country,
          kc_prijzap: kc(row.r321),
          kc_vydzap: '0',
          da_zahr: kc(row.r323),
          proczahr: kc2(row.r324),
          kc_k_zapzahr: kc2(row.r325),
          da_uznzap: kc2(row.r326),
          roz_od12: kc2(row.r327),
        }),
      );
    }
    // Seznam dle § 38f odst. 10 — identifikace zahraničních plátců po státech;
    // podatelna vyžaduje všech 5 údajů, proto i zapl_dan (uvádíme v přepočtu na Kč)
    for (const row of p3) {
      lines.push(
        veta('Vetad', {
          ident_udaje:
            'Zahraniční plátci dividend a úroků dle výpisů brokera — viz evidence Danero; daň v přepočtu na Kč',
          k_stat_zdroj: row.country,
          zapl_dan: kc(row.r323),
          prijmy_seznam: kc(row.r321),
          dan_seznam: kc(row.r323),
        }),
      );
    }
  }

  if (p4) {
    lines.push(
      veta('VetaZ', {
        kc_prij48: kc(p4.r401a),
        kc_zd48: kc(p4.r406),
        kc_uhrndzd: kc(p4.r409),
        kc_dan415: kc(p4.r410),
        kc_uh415: p4.r411.gt(0) ? kc(p4.r411) : undefined,
        kc_zahr415: p4.r411.gt(0) ? kc(p4.r412) : undefined,
        kc_uznzap415: p4.r411.gt(0) ? kc2(p4.r413) : undefined,
        da_samzakl4: kc(p4.r414),
      }),
    );
  }

  lines.push('</DPFDP7>');
  lines.push('</Pisemnost>');
  return { xml: lines.join('\n') + '\n' };
}
