import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as importers from '../src/index';
import * as anycoin from './fixtures/anycoin';
import * as coinbase from './fixtures/coinbase';
import * as coinmate from './fixtures/coinmate';
import * as degiro from './fixtures/degiro';
import * as etoro from './fixtures/etoro';
import * as fio from './fixtures/fio';
import * as ibkr from './fixtures/ibkr';
import * as kraken from './fixtures/kraken';
import * as metatrader from './fixtures/metatrader';
import * as portu from './fixtures/portu';
import * as revolut from './fixtures/revolut';
import * as saxo from './fixtures/saxo';
import * as schwab from './fixtures/schwab';
import * as swissquote from './fixtures/swissquote';
import * as t212 from './fixtures/t212';
import * as tastytrade from './fixtures/tastytrade';
import * as xtb from './fixtures/xtb';

/**
 * Fuzz importu s pevným seedem.
 *
 * Do `decodeUpload`, do snifferů a do každého parseru jdou náhodné bajty
 * a poškozené varianty našich fixtur (useknutí, jed v čísle a v datu, cizí
 * kódování, přeházené sloupce, rozbitý zip). Hlídá se jediné: nahraný soubor
 * nesmí import shodit neošetřenou výjimkou ani ho zdržet na sekundy. Špatný
 * soubor má skončit chybou v `errors`, kterou uživatel uvidí — ne pádem
 * serverové akce.
 *
 * Běh je deterministický: každý případ má vlastní seed odvozený z hlavního
 * seedu a pořadí, takže hlášený případ jde pustit znovu sám
 * (`FUZZ_ONLY_CASE=<číslo>`). `FUZZ_SEED` a `FUZZ_CASES` jsou na ruční
 * průzkum; CI běží s výchozími hodnotami.
 *
 * Mez, se kterou je potřeba počítat: parser, který se zacyklí synchronně,
 * časový limit testu nepřeruší — ukáže se až jako visící běh.
 */
const MASTER_SEED = Number(process.env.FUZZ_SEED ?? 20261008);
const CASES = Number(process.env.FUZZ_CASES ?? 2000);
const ONLY_CASE = process.env.FUZZ_ONLY_CASE ? Number(process.env.FUZZ_ONLY_CASE) : null;
/** Nejdelší dovolený čas procesoru na jedno volání (ne hodiny — stroj bývá vytížený). */
const SLOW_CPU_MS = 2000;

// ---------------------------------------------------------------- generátor

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function caseSeed(master: number, index: number): number {
  let h = (master ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }
  range(a: number, b: number): number {
    return a + this.int(b - a + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = this.int(256);
    return out;
  }
}

// ------------------------------------------------------------------- korpus

const FIXTURE_MODULES: Record<string, Record<string, unknown>> = {
  anycoin,
  coinbase,
  coinmate,
  degiro,
  etoro,
  fio,
  ibkr,
  kraken,
  metatrader,
  portu,
  revolut,
  saxo,
  schwab,
  swissquote,
  t212,
  tastytrade,
  xtb,
};

interface TextSample {
  name: string;
  text: string;
}
interface XlsxSample {
  name: string;
  bytes: Uint8Array;
}

/** Každý textový export fixtur (CSV, XML, HTML) + univerzální šablona. */
function collectTexts(): TextSample[] {
  const texts: TextSample[] = [];
  for (const moduleName of Object.keys(FIXTURE_MODULES).sort()) {
    const fixtureModule = FIXTURE_MODULES[moduleName]!;
    for (const key of Object.keys(fixtureModule).sort()) {
      const value = fixtureModule[key];
      if (typeof value === 'string' && value.length >= 20) {
        texts.push({ name: `${moduleName}.${key}`, text: value });
      }
    }
  }
  texts.push({ name: 'universal.TEMPLATE', text: importers.UNIVERSAL_TEMPLATE_CSV });
  return texts;
}

async function buildXlsxSamples(): Promise<XlsxSample[]> {
  const revolutTable = importers.parseCsv(revolut.REVOLUT_INVEST_CSV, ',');
  const builders: Array<[string, () => Promise<Uint8Array>]> = [
    ['etoro-happy', () => etoro.buildEtoroHappyPath()],
    ['etoro-eu', () => etoro.buildEtoroEuLocale()],
    ['revolut', () => revolut.buildRevolutXlsx(revolutTable.headers, revolutTable.rows)],
    ['saxo', () => saxo.buildSaxoXlsx()],
    ['mt5', () => metatrader.buildMt5Xlsx()],
    ['foreign', () => metatrader.buildForeignXlsx()],
    ['xtb-new', () => xtb.buildXtbNewReportXlsx()],
    ['xtb-old', () => xtb.buildXtbXlsx()],
  ];
  const samples: XlsxSample[] = [];
  for (const [name, build] of builders) {
    samples.push({ name, bytes: new Uint8Array(await build()) });
  }
  return samples;
}

// ------------------------------------------------------------------- mutace

const NUMBER_POISON = [
  'NaN',
  'Infinity',
  '-Infinity',
  '1e999999999',
  '1e-999999999',
  '-',
  '--5',
  '+',
  '0x1F',
  '1,2,3',
  '1.2.3',
  '1 000,50',
  '1.000',
  '1,000',
  '١٢٣',
  '１２３',
  '9'.repeat(400),
  `0.${'0'.repeat(400)}1`,
  '',
  ' ',
  '−5',
  '5-',
  '(5)',
  '1e5',
  '.5',
  '5.',
  '$5',
  '5%',
  '1/0',
  'null',
  'undefined',
  'true',
  '-0',
  `1${'0'.repeat(2000)}`,
  '1e+400',
  '-1e-400',
  '00012',
  '1_000',
];
const DATE_POISON = [
  '0000-00-00',
  '9999-99-99',
  '2025-02-30',
  '31/02/2025',
  '13/13/2025',
  '2025-13-01 25:61:61',
  '1970-01-01',
  '99999-01-01',
  '-2025-01-01',
  '2025-01-01T00:00:00+99:99',
  '01.01.25',
  '1.1.2025',
  '2025/01/01',
  'Jan 5, 2025',
  '',
  'NaT',
  '2025-01-01\u0000',
  '20250101',
  '2025-1-1',
  '2025-01-01 24:00:00',
  '29.02.2023',
  '00/00/0000',
  '2025-01-01T',
  '275760-09-14',
];
/**
 * Neviditelné znaky jsou zapsané čísly kódových bodů: v literálu by nešly
 * přečíst a editor nebo formátovač je umí potichu zaměnit.
 */
const UNICODE_POISON = [
  [0xd800], // osamělý surrogát
  [0xdfff],
  [0xfeff], // BOM uprostřed textu
  [0xa0], // nedělitelná mezera
  [0x202f],
  [0x202e], // přepnutí směru textu
  [0x301, 0x301], // kombinující čárky bez základu
  [0x1f600],
  [0x2028],
  [0x200b], // mezera nulové šířky
  [0xfffd],
  [0x0],
  [0x1b, 0x5b, 0x33, 0x31, 0x6d], // ANSI sekvence
  [0xffff],
  [0x130], // velké I s tečkou
  [0xdf],
  [0xd],
  [0x85],
].map((codePoints) => String.fromCodePoint(...codePoints));

const guessDelimiter = (line: string): string => {
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![0];
};

function replaceToken(text: string, pattern: RegExp, r: Rng, values: readonly string[]): string {
  const matches: Array<{ index: number; length: number }> = [];
  for (const match of text.matchAll(pattern)) {
    matches.push({ index: match.index, length: match[0].length });
    if (matches.length >= 3000) break;
  }
  if (matches.length === 0) return text;
  let out = text;
  const count = r.range(1, 4);
  for (let i = 0; i < count; i += 1) {
    const hit = r.pick(matches);
    if (hit.index + hit.length > out.length) continue;
    out = out.slice(0, hit.index) + r.pick(values) + out.slice(hit.index + hit.length);
  }
  return out;
}

type TextMutator = (text: string, r: Rng, texts: readonly TextSample[]) => string;

/** [název, váha, mutace] — velké vstupy mají nízkou váhu, každý stojí desítky ms. */
const TEXT_MUTATORS: Array<[string, number, TextMutator]> = [
  ['identity', 2, (t) => t],
  ['header-only', 3, (t, r) => t.split('\n')[0]! + (r.chance(0.5) ? '\n' : '')],
  ['truncate', 8, (t, r) => t.slice(0, r.int(t.length + 1))],
  [
    'repeat-header',
    6,
    (t, r) => {
      const lines = t.split('\n');
      const header = lines[0]!;
      const count = r.chance(0.2) ? r.range(20, 200) : r.range(1, 4);
      for (let i = 0; i < count; i += 1) lines.splice(r.int(lines.length + 1), 0, header);
      return lines.join('\n');
    },
  ],
  [
    'blank-lines',
    6,
    (t, r) => {
      const lines = t.split('\n');
      const filler = ['', ' ', '\t', ',,,,', ';;;', '""', '\r', '   \t  '];
      const count = r.range(1, 30);
      for (let i = 0; i < count; i += 1) lines.splice(r.int(lines.length + 1), 0, r.pick(filler));
      return lines.join('\n');
    },
  ],
  [
    'open-quote',
    8,
    (t, r) => {
      let out = t;
      const count = r.range(1, 3);
      for (let i = 0; i < count; i += 1) {
        const at = r.int(out.length + 1);
        out = `${out.slice(0, at)}"${out.slice(at)}`;
      }
      return out;
    },
  ],
  [
    'line-endings',
    4,
    (t, r) => {
      const kind = r.int(3);
      if (kind === 0) return t.replace(/\n/g, '\r\n');
      if (kind === 1) return t.replace(/\n/g, '\r');
      return t.replace(/\n/g, () => r.pick(['\n', '\r\n', '\r', '\n\n']));
    },
  ],
  [
    'swap-delimiter',
    4,
    (t, r) => t.split(guessDelimiter(t.split('\n')[0]!)).join(r.pick([',', ';', '\t', '|', ' '])),
  ],
  ['number-poison', 10, (t, r) => replaceToken(t, /-?\d+(?:[.,]\d+)?/g, r, NUMBER_POISON)],
  [
    'date-poison',
    7,
    (t, r) =>
      replaceToken(t, /\d{4}[-./]\d{2}[-./]\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/g, r, DATE_POISON),
  ],
  [
    'unicode',
    7,
    (t, r) => {
      let out = t;
      const count = r.range(1, 8);
      for (let i = 0; i < count; i += 1) {
        const at = r.int(out.length + 1);
        out = out.slice(0, at) + r.pick(UNICODE_POISON) + out.slice(at);
      }
      return out;
    },
  ],
  [
    'edit-header',
    8,
    (t, r) => {
      const lines = t.split('\n');
      const row = r.chance(0.8) ? 0 : r.int(Math.min(lines.length, 5));
      const delimiter = guessDelimiter(lines[row]!);
      const cols = lines[row]!.split(delimiter);
      const at = r.int(cols.length);
      const kind = r.int(7);
      if (kind === 0) cols.splice(at, 1);
      else if (kind === 1) cols.splice(at, 0, cols[at]!);
      else if (kind === 2) cols[at] = `${cols[at]} (UTC)`;
      else if (kind === 3) cols[at] = cols[at]!.toUpperCase();
      else if (kind === 4) cols[at] = ` ${cols[at]}  `;
      else if (kind === 5) cols.reverse();
      else cols[at] = '';
      lines[row] = cols.join(delimiter);
      return lines.join('\n');
    },
  ],
  [
    'shuffle-rows',
    4,
    (t, r) => {
      const lines = t.split('\n');
      for (let i = lines.length - 1; i > 1; i -= 1) {
        const j = 1 + r.int(i);
        [lines[i], lines[j]] = [lines[j]!, lines[i]!];
      }
      return lines.join('\n');
    },
  ],
  [
    'drop-fields',
    6,
    (t, r) => {
      const lines = t.split('\n');
      const delimiter = guessDelimiter(lines[0]!);
      const count = r.range(1, 6);
      for (let i = 0; i < count; i += 1) {
        const row = r.int(lines.length);
        const cols = lines[row]!.split(delimiter);
        const kind = r.int(3);
        if (kind === 0) cols[r.int(cols.length)] = '';
        else if (kind === 1) cols.splice(r.int(cols.length), 1);
        else cols.push('extra', '', '""');
        lines[row] = cols.join(delimiter);
      }
      return lines.join('\n');
    },
  ],
  [
    'glue-fixtures',
    5,
    (t, r, texts) => {
      const other = r.pick(texts).text;
      return (
        t.slice(0, r.int(t.length + 1)) +
        (r.chance(0.5) ? '\n' : '') +
        other.slice(r.int(other.length))
      );
    },
  ],
  [
    'drop-markup',
    5,
    (t, r) => {
      let out = t;
      const count = r.range(1, 10);
      for (let i = 0; i < count; i += 1) {
        const at = out.indexOf(r.pick([...'<>"/=&;,']), r.int(out.length + 1));
        if (at >= 0) out = out.slice(0, at) + out.slice(at + 1);
      }
      return out;
    },
  ],
  [
    'huge-field',
    1,
    (t, r) => {
      const payload = r.pick(['A', '7', ' ', '1,', 'ž']).repeat(r.range(2000, 40_000));
      const lines = t.split('\n');
      const row = r.int(lines.length);
      const delimiter = guessDelimiter(lines[0]!);
      const cols = lines[row]!.split(delimiter);
      cols[r.int(cols.length)] = payload;
      lines[row] = cols.join(delimiter);
      return lines.join('\n');
    },
  ],
  [
    'many-rows',
    0.7,
    (t, r) => {
      const lines = t.split('\n');
      const body = lines.slice(1).join('\n');
      if (body.length === 0) return t;
      return `${lines[0]}\n${`${body}\n`.repeat(Math.ceil(r.range(2000, 30_000) / (body.length + 1)))}`;
    },
  ],
  [
    'deep-nesting',
    0.6,
    (t, r) => {
      const tag = r.pick(['<a>', '<table><tr><td>', '<div>', '<FlexStatement>', '<Trades><Trade>']);
      const at = t.indexOf('>', r.int(t.length + 1));
      const cut = at < 0 ? 0 : at + 1;
      return t.slice(0, cut) + tag.repeat(r.range(20, 2000)) + t.slice(cut);
    },
  ],
];

type ByteMutator = (bytes: Uint8Array, r: Rng) => Uint8Array;

const concatBytes = (...parts: Uint8Array[]): Uint8Array => new Uint8Array(Buffer.concat(parts));

const BYTE_MUTATORS: Array<[string, number, ByteMutator]> = [
  ['truncate', 6, (b, r) => b.slice(0, r.int(b.length + 1))],
  [
    'flip-bits',
    8,
    (b, r) => {
      const out = b.slice();
      const count = r.range(1, 8);
      for (let i = 0; i < count && out.length > 0; i += 1) out[r.int(out.length)]! ^= 1 << r.int(8);
      return out;
    },
  ],
  [
    'overwrite-range',
    5,
    (b, r) => {
      const out = b.slice();
      const at = r.int(out.length);
      out.set(r.bytes(Math.min(r.range(1, 64), out.length - at)), at);
      return out;
    },
  ],
  [
    'insert-noise',
    4,
    (b, r) => {
      const at = r.int(b.length + 1);
      return concatBytes(b.slice(0, at), r.bytes(r.range(1, 256)), b.slice(at));
    },
  ],
  [
    'cut-middle',
    4,
    (b, r) => {
      const at = r.int(b.length + 1);
      return concatBytes(b.slice(0, at), b.slice(Math.min(b.length, at + r.range(1, 512))));
    },
  ],
  ['duplicate-tail', 2, (b, r) => concatBytes(b, b.slice(r.int(b.length + 1)))],
];

function weighted<T>(
  items: ReadonlyArray<readonly [string, number, T]>,
  r: Rng,
): readonly [string, T] {
  const total = items.reduce((sum, item) => sum + item[1], 0);
  let roll = r.int(Math.round(total * 1000)) / 1000;
  for (const [name, weight, value] of items) {
    if (roll < weight) return [name, value];
    roll -= weight;
  }
  const last = items[items.length - 1]!;
  return [last[0], last[2]];
}

const MAGIC_PREFIXES: Uint8Array[] = [
  Uint8Array.of(0x50, 0x4b, 0x03, 0x04), // zip (xlsx)
  Uint8Array.of(0x25, 0x50, 0x44, 0x46), // %PDF
  Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), // starý .xls
  Uint8Array.of(0xef, 0xbb, 0xbf),
  Uint8Array.of(0xff, 0xfe),
  Uint8Array.of(0xfe, 0xff),
  new Uint8Array(Buffer.from('<?xml version="1.0"?><FlexQueryResponse>', 'utf8')),
  new Uint8Array(Buffer.from('<html><table>', 'utf8')),
];

const cp1250Cache = new Map<string, number>();

/** CP1250 přes mapu z fixtury Fio; znak, který v ní není, se zapíše jako otazník. */
function encodeCp1250Lossy(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => {
    let byte = cp1250Cache.get(ch);
    if (byte === undefined) {
      try {
        byte = fio.encodeCp1250(ch)[0] ?? 0x3f;
      } catch {
        byte = 0x3f;
      }
      cp1250Cache.set(ch, byte);
    }
    return byte;
  });
}

function encodeText(text: string, r: Rng, trace: string[]): Uint8Array {
  const kind = r.int(10);
  if (kind <= 4) return new Uint8Array(Buffer.from(text, 'utf8'));
  if (kind === 5) {
    trace.push('utf8-bom');
    return concatBytes(Uint8Array.of(0xef, 0xbb, 0xbf), new Uint8Array(Buffer.from(text, 'utf8')));
  }
  if (kind === 6) {
    trace.push('utf16le');
    return concatBytes(Uint8Array.of(0xff, 0xfe), new Uint8Array(Buffer.from(text, 'utf16le')));
  }
  if (kind === 7) {
    trace.push('utf16be');
    return concatBytes(
      Uint8Array.of(0xfe, 0xff),
      new Uint8Array(Buffer.from(text, 'utf16le')).reverse(),
    );
  }
  if (kind === 8) {
    trace.push('cp1250');
    return encodeCp1250Lossy(text);
  }
  trace.push('latin1');
  return new Uint8Array(Buffer.from(text, 'latin1'));
}

interface FuzzCase {
  kind: 'random' | 'text' | 'xlsx';
  trace: string;
  bytes: Uint8Array;
}

function makeCase(
  index: number,
  texts: readonly TextSample[],
  xlsx: readonly XlsxSample[],
): FuzzCase {
  const r = new Rng(caseSeed(MASTER_SEED, index));
  const roll = r.int(100);
  if (roll < 12) {
    const body = r.bytes(r.chance(0.1) ? 0 : r.range(1, 4096));
    const withMagic = r.chance(0.5);
    return {
      kind: 'random',
      trace: withMagic ? 'random+magic' : 'random',
      bytes: withMagic ? concatBytes(r.pick(MAGIC_PREFIXES), body) : body,
    };
  }
  if (roll < 75) {
    const sample = r.pick(texts);
    const trace = [sample.name];
    let text = sample.text;
    const rounds = r.range(1, 3);
    for (let i = 0; i < rounds; i += 1) {
      const [name, mutate] = weighted(TEXT_MUTATORS, r);
      trace.push(name);
      text = mutate(text, r, texts);
    }
    let bytes = encodeText(text, r, trace);
    if (r.chance(0.2)) {
      const [name, mutate] = weighted(BYTE_MUTATORS, r);
      trace.push(`bytes:${name}`);
      bytes = mutate(bytes, r);
    }
    return { kind: 'text', trace: trace.join(' > '), bytes };
  }
  const sample = r.pick(xlsx);
  const trace = [sample.name];
  let bytes = sample.bytes;
  if (!r.chance(0.1)) {
    const rounds = r.range(1, 2);
    for (let i = 0; i < rounds; i += 1) {
      const [name, mutate] = weighted(BYTE_MUTATORS, r);
      trace.push(name);
      bytes = mutate(bytes, r);
    }
  }
  return { kind: 'xlsx', trace: trace.join(' > '), bytes };
}

// ------------------------------------------------------------------- měření

interface Report {
  calls: number;
  controlled: number;
  crashes: string[];
  slow: string[];
}

const newReport = (): Report => ({ calls: 0, controlled: 0, crashes: [], slow: [] });

/** Jediné dvě výjimky, které import umí převést na hlášku pro uživatele. */
const isControlled = (error: unknown): boolean =>
  error instanceof importers.XlsxTooLargeError || error instanceof importers.XlsxUnreadableError;

function recordFailure(report: Report, label: string, target: string, error: unknown): void {
  if (isControlled(error)) {
    report.controlled += 1;
    return;
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (report.crashes.length < 40) {
    // eslint-disable-next-line no-control-regex -- do hlášky testu jen tisknutelné znaky
    const printable = message.replace(/[\u0000-\u001f]/g, '?').slice(0, 200);
    report.crashes.push(`${label} ${target}: ${printable}`);
  }
}

function settle(report: Report, label: string, target: string, started: NodeJS.CpuUsage): void {
  const used = process.cpuUsage(started);
  const cpuMs = (used.user + used.system) / 1000;
  report.calls += 1;
  if (cpuMs > SLOW_CPU_MS && report.slow.length < 40) {
    report.slow.push(`${label} ${target}: ${Math.round(cpuMs)} ms procesoru`);
  }
}

function call<T>(report: Report, label: string, target: string, fn: () => T): T | undefined {
  const started = process.cpuUsage();
  let out: T | undefined;
  try {
    out = fn();
  } catch (error) {
    recordFailure(report, label, target, error);
  }
  settle(report, label, target, started);
  return out;
}

async function callAsync<T>(
  report: Report,
  label: string,
  target: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const started = process.cpuUsage();
  let out: T | undefined;
  try {
    out = await fn();
  } catch (error) {
    recordFailure(report, label, target, error);
  }
  settle(report, label, target, started);
  return out;
}

class BadResultShape extends Error {
  override name = 'BadResultShape';
}

/** Parser smí vrátit jen `ImportResult`; cokoli jiného by spadlo až o krok dál. */
function checkResult(report: Report, label: string, target: string, result: unknown): void {
  if (result === undefined) return;
  const shaped = result as { transactions?: unknown; errors?: unknown } | null;
  if (!shaped || !Array.isArray(shaped.transactions) || !Array.isArray(shaped.errors)) {
    recordFailure(report, label, target, new BadResultShape('parser nevrátil ImportResult'));
  }
}

// --------------------------------------------------------------------- cíle

type TextTarget = [string, (text: string) => unknown];

const TEXT_SNIFFERS: TextTarget[] = [
  ['sniffTrading212Csv', importers.sniffTrading212Csv],
  ['isTruncatedTrading212Export', importers.isTruncatedTrading212Export],
  ['isDegiroCsv', importers.isDegiroCsv],
  ['sniffPortuCsv', importers.sniffPortuCsv],
  ['sniffCoinmateCsv', importers.sniffCoinmateCsv],
  ['sniffSwissquoteCsv', importers.sniffSwissquoteCsv],
  ['sniffKrakenCsv', importers.sniffKrakenCsv],
  ['sniffCoinbaseCsv', importers.sniffCoinbaseCsv],
  ['findCoinbaseHeaderLine', importers.findCoinbaseHeaderLine],
  ['sniffAnycoinCsv', importers.sniffAnycoinCsv],
  ['sniffRevolutInvestCsv', importers.sniffRevolutInvestCsv],
  ['sniffRevolutCryptoCsv', importers.sniffRevolutCryptoCsv],
  ['sniffSchwabCsv', importers.sniffSchwabCsv],
  ['sniffTastytradeCsv', importers.sniffTastytradeCsv],
  ['sniffMt4Html', importers.sniffMt4Html],
  ['sniffMt5Html', importers.sniffMt5Html],
  ['sniffFioCsv', (text) => importers.sniffFioCsv(importers.firstLine(text))],
  ['isSpreadsheetMlXml', importers.isSpreadsheetMlXml],
];

const textParsers = (withMaps: boolean): TextTarget[] => [
  ['parseTrading212Csv', importers.parseTrading212Csv],
  ['parseDegiroTransactionsCsv', importers.parseDegiroTransactionsCsv],
  ['parseDegiroAccountCsv', importers.parseDegiroAccountCsv],
  ['parsePortuCsv', importers.parsePortuCsv],
  ['parseCoinmateCsv', importers.parseCoinmateCsv],
  ['parseSwissquoteCsv', importers.parseSwissquoteCsv],
  ['parseKrakenCsv', importers.parseKrakenCsv],
  ['parseCoinbaseCsv', importers.parseCoinbaseCsv],
  ['parseAnycoinCsv', importers.parseAnycoinCsv],
  [
    'parseRevolutInvestCsv',
    (text) =>
      importers.parseRevolutInvestCsv(text, withMaps ? revolut.REVOLUT_INSTRUMENT_MAP : undefined),
  ],
  ['parseRevolutCryptoCsv', importers.parseRevolutCryptoCsv],
  [
    'parseSchwabCsv',
    (text) => importers.parseSchwabCsv(text, withMaps ? schwab.SCHWAB_INSTRUMENT_MAP : undefined),
  ],
  [
    'parseTastytradeCsv',
    (text) =>
      importers.parseTastytradeCsv(text, withMaps ? tastytrade.TASTY_INSTRUMENT_MAP : undefined),
  ],
  ['parseUniversalCsv', importers.parseUniversalCsv],
  ['parseIbkrFlexXml', importers.parseIbkrFlexXml],
  ['parseMt4Html', importers.parseMt4Html],
  ['parseMt5Html', importers.parseMt5Html],
  [
    'parseFioCsv',
    (text) => importers.parseFioCsv(text, withMaps ? { symbolMap: fio.FIO_SYMBOL_MAP } : undefined),
  ],
];

const TOKEN_HELPERS: TextTarget[] = [
  ['cleanNumber', importers.cleanNumber],
  ['cleanNumberEu', importers.cleanNumberEu],
  ['isAmbiguousThousands', importers.isAmbiguousThousands],
  ['isAmbiguousThousandGroup', importers.isAmbiguousThousandGroup],
  ['parseEuroDate', importers.parseEuroDate],
  ['parseUsDate', importers.parseUsDate],
  ['isValidIsoDate', importers.isValidIsoDate],
  ['normalizeHeader', importers.normalizeHeader],
  ['normalizeKrakenAsset', importers.normalizeKrakenAsset],
  ['parseEtoroNumber', importers.parseEtoroNumber],
  [
    'parseRevolutMoney',
    (token) => [
      importers.parseRevolutMoney(token),
      importers.parseRevolutMoney(token, ','),
      importers.parseRevolutMoney(token, '.'),
    ],
  ],
  ['fnv1a64', importers.fnv1a64],
];

type Workbook = Awaited<ReturnType<typeof importers.loadXlsxWorkbook>>;

const XLSX_SNIFFERS: Array<[string, (workbook: Workbook) => unknown]> = [
  ['sniffXtbXlsx', importers.sniffXtbXlsx],
  ['sniffEtoroXlsx', importers.sniffEtoroXlsx],
  ['sniffSaxoXlsx', importers.sniffSaxoXlsx],
  ['sniffMt5Xlsx', importers.sniffMt5Xlsx],
  ['sniffRevolutXlsx', importers.sniffRevolutXlsx],
];

const xlsxParsers = (
  withMaps: boolean,
): Array<[string, (data: ArrayBuffer) => Promise<unknown>]> => [
  [
    'parseXtbXlsx',
    (data) =>
      importers.parseXtbXlsx(data, withMaps ? xtb.XTB_INSTRUMENT_MAP : undefined, {
        filename: withMaps ? 'CZK_1234567_2025-01-01_2025-12-31.xlsx' : 'vypis.xlsx',
      }),
  ],
  [
    'parseEtoroXlsx',
    (data) => importers.parseEtoroXlsx(data, withMaps ? etoro.ETORO_INSTRUMENT_MAP : undefined),
  ],
  ['parseSaxoXlsx', (data) => importers.parseSaxoXlsx(data)],
  ['parseMt5Xlsx', (data) => importers.parseMt5Xlsx(data)],
  [
    'parseRevolutXlsx',
    (data) =>
      importers.parseRevolutXlsx(data, withMaps ? revolut.REVOLUT_INSTRUMENT_MAP : undefined),
  ],
];

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

class InconsistentFormat extends Error {
  override name = 'InconsistentFormat';
}

async function runCase(report: Report, index: number, fuzzCase: FuzzCase): Promise<void> {
  const { bytes } = fuzzCase;
  const label = `případ ${index} [${fuzzCase.trace}]`;
  const withMaps = index % 2 === 1;

  const format = call(report, label, 'sniffFileFormat', () => {
    const viaView = importers.sniffFileFormat(bytes);
    if (viaView !== importers.sniffFileFormat(toArrayBuffer(bytes))) {
      throw new InconsistentFormat('Uint8Array a ArrayBuffer dávají jiný formát');
    }
    return viaView;
  });
  if (format)
    call(report, label, 'unsupportedFormatMessage', () =>
      importers.unsupportedFormatMessage(format),
    );

  if (format === 'xlsx' || fuzzCase.kind === 'xlsx') {
    call(report, label, 'assertXlsxUnpackedSize', () =>
      importers.assertXlsxUnpackedSize(toArrayBuffer(bytes)),
    );
    const workbook = await callAsync(report, label, 'loadXlsxWorkbook', () =>
      importers.loadXlsxWorkbook(toArrayBuffer(bytes)),
    );
    const parsers = xlsxParsers(withMaps);
    if (workbook) {
      for (const [name, sniff] of XLSX_SNIFFERS) call(report, label, name, () => sniff(workbook));
      for (const [name, parse] of parsers) {
        checkResult(
          report,
          label,
          name,
          await callAsync(report, label, name, () => parse(toArrayBuffer(bytes))),
        );
      }
      return;
    }
    // sešit nejde načíst: stejnou řízenou chybu musí dát i parser volaný napřímo
    const [name, parse] = parsers[index % parsers.length]!;
    checkResult(
      report,
      label,
      name,
      await callAsync(report, label, name, () => parse(toArrayBuffer(bytes))),
    );
    if (format === 'xlsx') return;
  }

  const decoded =
    call(report, label, 'decodeUpload', () => importers.decodeUpload(bytes)) ??
    Buffer.from(bytes).toString('latin1');
  call(report, label, 'decodeCp1250', () => importers.decodeCp1250(bytes));
  call(report, label, 'decodeFioCsv', () => importers.decodeFioCsv(bytes));

  call(report, label, 'csv-helpers', () => {
    const header = importers.firstLine(decoded);
    for (const delimiter of [',', ';', '\t'] as const) importers.parseCsv(decoded, delimiter);
    importers.parseCsv(header, importers.sniffDelimiter(header));
    importers.printableSample(decoded, 200);
    const tokens = decoded
      .slice(0, 20_000)
      .split(/[,;\t\n\r]/)
      .slice(0, 80);
    importers.detectDecimalSeparator(tokens);
    for (const token of tokens.slice(0, 40)) for (const [, helper] of TOKEN_HELPERS) helper(token);
  });
  for (const [name, sniff] of TEXT_SNIFFERS) call(report, label, name, () => sniff(decoded));
  for (const [name, parse] of textParsers(withMaps)) {
    const result = call(report, label, name, () => parse(decoded));
    checkResult(report, label, name, result);
    const parsed = result as
      | { broker: string; transactions: Parameters<typeof importers.dedupeTransactions>[1] }
      | undefined;
    if (parsed && Array.isArray(parsed.transactions) && parsed.transactions.length > 0) {
      call(report, label, `dedupeTransactions(${name})`, () =>
        importers.dedupeTransactions(parsed.broker, parsed.transactions),
      );
    }
  }
  checkResult(
    report,
    label,
    'parseFioCsv(bytes)',
    call(report, label, 'parseFioCsv(bytes)', () =>
      importers.parseFioCsv(bytes, { symbolMap: fio.FIO_SYMBOL_MAP }),
    ),
  );
}

// -------------------------------------------------------------------- testy

describe('fuzz importu (pevný seed)', () => {
  let texts: TextSample[] = [];
  let xlsx: XlsxSample[] = [];

  beforeAll(async () => {
    texts = collectTexts();
    // ExcelJS zapisuje do sešitu aktuální čas — bez pevného data by se bajty
    // korpusu (a s nimi i mutace) mezi běhy lišily
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1)));
    try {
      xlsx = await buildXlsxSamples();
    } finally {
      vi.useRealTimers();
    }
  });

  it('korpus pokrývá fixtury všech importérů', () => {
    // kdyby se fixtury přejmenovaly, fuzz by mlčky mutoval prázdno
    expect(texts.length).toBeGreaterThanOrEqual(40);
    expect(xlsx.length).toBe(8);
    for (const moduleName of ['t212', 'degiro', 'ibkr', 'metatrader', 'fio', 'kraken']) {
      expect(
        texts.some((sample) => sample.name.startsWith(`${moduleName}.`)),
        moduleName,
      ).toBe(true);
    }
  });

  it('generátor je deterministický: stejný seed dává stejné bajty', () => {
    for (const index of [0, 1, 7, 123, 1999]) {
      const first = makeCase(index, texts, xlsx);
      const second = makeCase(index, texts, xlsx);
      expect(second.trace).toBe(first.trace);
      expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    }
    const kinds = new Set<string>();
    for (let index = 0; index < 200; index += 1) kinds.add(makeCase(index, texts, xlsx).kind);
    expect([...kinds].sort()).toEqual(['random', 'text', 'xlsx']);
  });

  it('měření pozná neošetřenou výjimku, špatný tvar výsledku i řízenou chybu', async () => {
    // negativní kontrola: bez ní by prázdný seznam pádů neznamenal nic
    const report = newReport();
    call(report, 'kontrola', 'throwing', () => {
      throw new TypeError('schválně');
    });
    await callAsync(report, 'kontrola', 'rejecting', () =>
      Promise.reject(new RangeError('schválně')),
    );
    checkResult(report, 'kontrola', 'shapeless', { transactions: 'nic' });
    call(report, 'kontrola', 'controlled', () => {
      throw new importers.XlsxUnreadableError('poškozený sešit');
    });
    expect(report.crashes).toEqual([
      'kontrola throwing: TypeError: schválně',
      'kontrola rejecting: RangeError: schválně',
      'kontrola shapeless: BadResultShape: parser nevrátil ImportResult',
    ]);
    expect(report.controlled).toBe(1);
    expect(report.calls).toBe(3);
  });

  it(
    `${CASES} poškozených souborů neshodí žádný parser a žádné volání netrvá přes ${SLOW_CPU_MS} ms`,
    { timeout: 180_000 },
    async () => {
      const report = newReport();
      const indexes = ONLY_CASE === null ? Array.from({ length: CASES }, (_, i) => i) : [ONLY_CASE];
      for (const index of indexes) {
        await runCase(report, index, makeCase(index, texts, xlsx));
      }
      expect(report.crashes, `seed ${MASTER_SEED}`).toEqual([]);
      expect(report.slow, `seed ${MASTER_SEED}`).toEqual([]);
      // každý případ projde desítkami cílů — nízké číslo znamená, že se běh někde zkrátil
      expect(report.calls).toBeGreaterThan(indexes.length * 10);
    },
  );

  // Známý dluh, který výchozích 2 000 případů nezasáhne: nečíselný znak
  // v množství nebo částce IBKR Flex XML (např. „−5“ s typografickým minusem)
  // dojde až do Decimal a parser vyhodí „[DecimalError] Invalid argument“
  // místo chyby u záznamu. Reprodukce: FUZZ_ONLY_CASE=25209.
  it.todo('parseIbkrFlexXml: jed v čísle skončí chybou u záznamu, ne výjimkou');
});
