/**
 * Skladba a vzhled odchozích e-mailů.
 *
 * Obsah se popisuje JEDNOU jako bloky a vykresluje se z něj text i HTML.
 * Kdyby se psaly zvlášť, rozejdou se — a rozejít se nesmí: textová verze je
 * to, co uvidí čtečka, spamový filtr a klient s vypnutým HTML, a u potvrzení
 * objednávky je to navíc plnění na trvalém nosiči (§ 1824a OZ).
 *
 * HTML je schválně staré a hloupé: tabulky, inline styly, žádné obrázky ani
 * externí zdroje. Gmail, Outlook ani Seznam nic modernějšího spolehlivě
 * nevykreslí a externí obrázek by navíc prozradil, kdy si člověk zprávu
 * otevřel.
 */

import { tidy } from '@/lib/typography';

/**
 * Barvy z `globals.css` — v e-mailu musí být natvrdo, proměnné tam neplatí.
 * Světlé hodnoty jdou do inline stylů (ty přečte každý klient), tmavé do
 * `<style>` v hlavičce (viz `DARK_STYLES`).
 */
const COLORS = {
  /** Pozadí zprávy — `canvas`. */
  page: '#f5f5f7',
  /** Plocha s obsahem — `surface`. */
  surface: '#ffffff',
  /** Tichý panel s přehledem — `canvas`. */
  panel: '#f5f5f7',
  ink: '#1d1d1f',
  muted: '#6e6e73',
  /** Tečka značky — `accent`. */
  accent: '#0071e3',
  /** Výplň tlačítka — `accent-fill` (bílý text 4,7 : 1, v obou režimech stejná). */
  accentFill: '#0071e3',
  /** Odkaz v textu — `accent-text`. */
  link: '#0066cc',
  /** Dělicí linka mezi položkami — `line`. */
  line: '#d2d2d7',
  /** Prázdná dráha měřáku — `line` (na panelu `canvas` by `control` zanikl). */
  track: '#d2d2d7',
  /** Měřák nad hranicí, kde se už ozýváme naléhavě — `caution`. */
  caution: '#b26b00',
  /** Prolomený limit a naléhavá událost — `danger`. */
  danger: '#d70015',
} as const;

const DARK = {
  /** `surface` tmavého režimu. */
  page: '#000000',
  /** `canvas` — obsah je o stupeň světlejší než pozadí. */
  surface: '#1c1c1e',
  /** `control` — panel uvnitř obsahu ještě o stupeň. */
  panel: '#2c2c2e',
  ink: '#f5f5f7',
  muted: '#98989d',
  accent: '#0a84ff',
  link: '#2997ff',
  line: '#38383a',
  /** Dráha leží na panelu (`control`), proto o stupeň světlejší — `line`. */
  track: '#38383a',
  caution: '#ffd60a',
  danger: '#ff453a',
} as const;

/**
 * Tmavý režim. Inline styly nejdou přebít jinak než `!important`, proto
 * každý obarvený prvek nese i třídu. Klient, který `prefers-color-scheme` umí
 * (Apple Mail, Outlook.com), dostane plnohodnotnou tmavou podobu; klient,
 * který ho neumí (Gmail), `<style>` ignoruje a světlou zprávu si případně
 * ztmaví po svém — proto je světlá podoba poskládaná tak, aby převrácení
 * snesla: text na ploše, žádný text přes barevné pozadí kromě tlačítka, jehož
 * modrá s bílým písmem obstojí na světlém i tmavém.
 */
const DARK_STYLES = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){
.e-page{background:${DARK.page}!important}
.e-surface{background:${DARK.surface}!important}
.e-panel{background:${DARK.panel}!important}
.e-ink{color:${DARK.ink}!important}
.e-muted{color:${DARK.muted}!important}
.e-dot{background:${DARK.accent}!important}
.e-bar{background:${DARK.ink}!important}
.e-link{color:${DARK.link}!important}
.e-danger{color:${DARK.danger}!important}
.e-line{border-color:${DARK.line}!important}
.e-track{background:${DARK.track}!important}
.e-fill-accent{background:${DARK.accent}!important}
.e-fill-caution{background:${DARK.caution}!important}
.e-fill-danger{background:${DARK.danger}!important}
}`;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export type EmailBlock =
  /** Běžný odstavec. */
  | { kind: 'p'; text: string }
  /** Mezinadpis. */
  | { kind: 'h'; text: string }
  /** Hlavní tlačítko. V textové verzi se vypíše jako popisek a URL pod ním. */
  | { kind: 'cta'; label: string; url: string }
  /** Dvousloupcový přehled (co / za kolik). */
  | { kind: 'rows'; rows: [string, string][] }
  /** Vysvětlivka drobným písmem — právní poučení, které nemá překřičet obsah. */
  | { kind: 'note'; text: string }
  /**
   * Seznam událostí (upozornění hlídače): tučný titulek a věta pod ním,
   * oddělené linkou. Naléhavou událost uvozuje červené „Naléhavé“.
   */
  | { kind: 'items'; items: EmailItem[] }
  /** Měřáky čerpání (limity): popisek, hodnota a pruh s podílem. */
  | { kind: 'meters'; rows: EmailMeter[] }
  /** Drobné odkazy pod obsahem (nastavení, odhlášení). */
  | { kind: 'links'; links: { label: string; url: string }[] };

export interface EmailItem {
  title: string;
  text: string;
  urgent?: boolean;
}

export interface EmailMeter {
  label: string;
  /** Čerpání slovy („41 200 Kč z 50 000 Kč“) — pod pruhem. */
  value: string;
  /** Podíl v procentech, jak ho píše aplikace („82 %“) — vpravo nahoře. */
  percent: string;
  /** Podíl čerpání (1 = celý limit); pruh se kreslí nejvýš do plna. */
  ratio: number;
  /** `caution` od hranice, kde hlídač píše naléhavěji; `danger` = prolomeno. */
  tone?: 'normal' | 'caution' | 'danger';
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Text obsahu do HTML: pevné mezery jako v aplikaci (`tidy`), aby se na úzkém
 * displeji neodtrhlo „3.“ od „12. 2026“ ani „Kč“ od částky. Textová verze
 * je bez nich — tam řádky láme `wrapText` a pevná mezera by mu překážela.
 */
const content = (value: string): string => escape(tidy(value));

/**
 * Zalomení textové verze na 78 znaků. Delší řádky některé klienty zalomí samy
 * a ošklivě (uprostřed slova nebo za URL), takže si to raději uděláme sami —
 * ale URL se nikdy nezalamuje, jinak přestane být klikatelná.
 */
function wrapText(text: string, width = 78): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

const indent = (text: string, prefix: string): string =>
  text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');

/** Textová verze — to, co uvidí čtečka i klient bez HTML. */
export function renderText(blocks: EmailBlock[], footer: string[]): string {
  const parts = blocks.map((block) => {
    switch (block.kind) {
      case 'p':
        return wrapText(block.text);
      case 'h':
        return `${block.text.toUpperCase()}\n${'—'.repeat(Math.min(block.text.length, 40))}`;
      case 'cta':
        return `${block.label}:\n${block.url}`;
      case 'rows':
        return block.rows.map(([label, value]) => `${label}: ${value}`).join('\n');
      case 'note':
        return wrapText(block.text);
      case 'items':
        return block.items
          .map(
            (item) =>
              `• ${item.urgent ? '(naléhavé) ' : ''}${item.title}\n${indent(wrapText(item.text, 76), '  ')}`,
          )
          .join('\n\n');
      case 'meters':
        return block.rows.map((row) => `${row.label}: ${row.value} (${row.percent})`).join('\n');
      case 'links':
        return block.links.map((link) => `${link.label}:\n${link.url}`).join('\n\n');
    }
  });
  return [...parts, '', ...footer].join('\n\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * Značka Danero: akcentní tečka (nákup) + tmavá linie (dnešek) + slovo —
 * stejné tvary a barvy jako `components/logo.tsx`.
 *
 * Skládá se z HTML, ne z obrázku — schválně. Obrázek by musel viset na
 * danero.cz (data: URI Gmail u `<img>` zahazuje), takže by prozrazoval, kdy
 * si příjemce zprávu otevřel, a půlka klientů ho stejně blokuje, dokud
 * uživatel neklikne na „zobrazit obrázky". Tvary jsou dost jednoduché na to,
 * aby je zvládl obyčejný `border-radius`.
 *
 * ⚠️ Outlook pro Windows (jádro Wordu) `border-radius` ignoruje — tečka tam
 * vyjde jako čtvereček a linie jako obdélník. Značka se tím nerozpadne, jen
 * zhranatí; alternativa (hostovaný PNG) by stála za to leda tehdy, kdyby se
 * ukázalo, že tenhle klient používá reálná část zákazníků.
 */
function brandMark(): string {
  const shape = (className: string, style: string) =>
    `<div class="${className}" style="${style};font-size:0;line-height:0">&nbsp;</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="padding:0;vertical-align:bottom">${shape('e-dot', `width:11px;height:11px;border-radius:50%;background:${COLORS.accent}`)}</td>
<td style="padding:0 0 0 1px;vertical-align:bottom">${shape('e-bar', `width:3px;height:18px;border-radius:2px;background:${COLORS.ink}`)}</td>
<td style="padding:0 0 0 8px;vertical-align:bottom"><span class="e-ink" style="font-size:19px;font-weight:600;letter-spacing:-.02em;line-height:1;color:${COLORS.ink};font-family:${FONT}">Danero</span></td>
</tr></table>`;
}

/**
 * Seznam událostí v panelu. Každá položka je vlastní řádek tabulky s linkou
 * nahoře (kromě první) — `border-top` na buňce zvládne i Outlook.
 */
function renderItems(items: EmailItem[]): string {
  const rows = items
    .map((item, i) => {
      const separator = i === 0 ? '' : `border-top:1px solid ${COLORS.line};`;
      // Naléhavost slovem, ne jen barevnou tečkou: tečku nepřečte čtečka
      // a Outlook pro Windows rozměry u `span` nedodrží, takže by zmizela.
      const marker = item.urgent
        ? `<p class="e-danger" style="margin:0 0 2px;font-size:12px;line-height:1.4;font-weight:600;color:${COLORS.danger}">Naléhavé</p>\n`
        : '';
      return `<tr><td class="e-line" style="${separator}padding:14px 16px">
${marker}<p class="e-ink" style="margin:0 0 4px;font-size:15px;line-height:1.4;font-weight:600;color:${COLORS.ink}">${content(item.title)}</p>
<p class="e-muted" style="margin:0;font-size:14px;line-height:1.55;color:${COLORS.muted}">${content(item.text)}</p>
</td></tr>`;
    })
    .join('\n');
  return `<table class="e-panel" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${COLORS.panel};border-radius:12px">
${rows}
</table>`;
}

const METER_FILL = {
  normal: { className: 'e-fill-accent', color: COLORS.accent },
  caution: { className: 'e-fill-caution', color: COLORS.caution },
  danger: { className: 'e-fill-danger', color: COLORS.danger },
} as const;

/**
 * Měřáky čerpání: popisek a hodnota na řádku, pod nimi pruh. Pruh je tabulka
 * se dvěma buňkami v poměru čerpání — šířka v procentech na buňce je jediné,
 * co spolehlivě vykreslí Gmail, Outlook i Seznam.
 */
function renderMeters(rows: EmailMeter[]): string {
  const bar = (ratio: number, tone: EmailMeter['tone']): string => {
    const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
    const fill = METER_FILL[tone ?? 'normal'];
    const cell = (className: string, color: string, width: number) =>
      // `height` jako atribut a řádek přesně na výšku: Outlook (Word) jinak
      // nechá buňce výšku písma a pruh vyjde kolem 15 px
      `<td class="${className}" width="${width}%" height="6" style="width:${width}%;height:6px;background:${color};font-size:6px;line-height:6px;mso-line-height-rule:exactly">&nbsp;</td>`;
    const cells = [
      ...(pct > 0 ? [cell(fill.className, fill.color, pct)] : []),
      ...(pct < 100 ? [cell('e-track', COLORS.track, 100 - pct)] : []),
    ].join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-radius:3px;overflow:hidden"><tr>${cells}</tr></table>`;
  };
  // Popisek a procento nahoře, částky pod pruhem: v jednom řádku se na
  // telefonu dlouhý název limitu lámal po slovech vedle „112 400 Kč z …“.
  const items = rows
    .map(
      (row, i) => `<tr><td style="padding:${i === 0 ? '14px' : '16px'} 16px ${i === rows.length - 1 ? '14px' : '0'}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px"><tr>
<td class="e-ink" style="font-size:14px;line-height:1.4;font-weight:500;color:${COLORS.ink}">${content(row.label)}</td>
<td class="e-ink" style="font-size:14px;line-height:1.4;font-weight:600;text-align:right;white-space:nowrap;padding-left:12px;color:${COLORS.ink}">${content(row.percent)}</td>
</tr></table>
${bar(row.ratio, row.tone)}
<p class="e-muted" style="margin:6px 0 0;font-size:13px;line-height:1.4;color:${COLORS.muted}">${content(row.value)}</p>
</td></tr>`,
    )
    .join('\n');
  return `<table class="e-panel" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${COLORS.panel};border-radius:12px">
${items}
</table>`;
}

/** HTML verze. */
export function renderHtml(args: {
  title: string;
  preheader: string;
  blocks: EmailBlock[];
  footer: string[];
}): string {
  const body = args.blocks
    .map((block, index) => {
      switch (block.kind) {
        case 'p':
          return `<p class="e-ink" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLORS.ink}">${content(block.text)}</p>`;
        case 'h':
          // váha místo verzálek — stejně jako nadpisy v aplikaci
          // první nadpis nemá nad sebou co oddělovat
          return `<p class="e-ink" style="margin:${index === 0 ? '0' : '28px'} 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:${COLORS.ink}">${content(block.text)}</p>`;
        case 'cta':
          // tabulka místo <a> s paddingem: Outlook padding na odkazu ignoruje
          return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:980px;background:${COLORS.accentFill}"><a href="${escape(block.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:980px">${escape(block.label)}</a></td></tr></table>
<p class="e-muted" style="margin:-12px 0 20px;font-size:12px;line-height:1.6;color:${COLORS.muted}">Kdyby tlačítko nefungovalo, zkopíruj si tuhle adresu:<br><span style="word-break:break-all">${escape(block.url)}</span></p>`;
        case 'rows':
          return `<table class="e-panel" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;background:${COLORS.panel};border-radius:12px">
${block.rows
  .map(
    ([label, value], i) =>
      `<tr><td class="e-muted" style="padding:${i === 0 ? '14px' : '10px'} 16px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;color:${COLORS.muted}">${escape(label)}</td><td class="e-ink" style="padding:${i === 0 ? '14px' : '10px'} 16px ${i === block.rows.length - 1 ? '14px' : '0'};font-size:14px;line-height:1.5;font-weight:500;text-align:right;color:${COLORS.ink}">${escape(value)}</td></tr>`,
  )
  .join('\n')}
</table>`;
        case 'note':
          return `<p class="e-muted" style="margin:0 0 14px;font-size:13px;line-height:1.55;color:${COLORS.muted}">${content(block.text)}</p>`;
        case 'items':
          return renderItems(block.items);
        case 'meters':
          return renderMeters(block.rows);
        case 'links':
          return `<p class="e-muted" style="margin:0 0 14px;font-size:13px;line-height:1.7;color:${COLORS.muted}">${block.links
            .map(
              (link) =>
                `<a class="e-link" href="${escape(link.url)}" style="color:${COLORS.link};text-decoration:none">${escape(link.label)}</a>`,
            )
            .join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</p>`;
      }
    })
    .join('\n');

  const footer = args.footer
    .map(
      (line) =>
        `<p class="e-muted" style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${COLORS.muted}">${escape(line)}</p>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(args.title)}</title>
<style>${DARK_STYLES}</style>
</head>
<body class="e-page" style="margin:0;padding:0;background:${COLORS.page};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(args.preheader)}</div>
<table class="e-page" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.page}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
${brandMark()}
</td></tr>
<tr><td class="e-surface" style="background:${COLORS.surface};border-radius:16px;padding:32px 28px 20px;font-family:${FONT}">
${body}
</td></tr>
<tr><td style="padding:20px 4px 0;font-family:${FONT}">
${footer}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
