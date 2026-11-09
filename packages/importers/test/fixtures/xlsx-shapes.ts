import JSZip from 'jszip';

/**
 * Sešit přepsaný do tvaru, jaký píšou generátory nad .NET OpenXML SDK:
 * prvky s prefixem jmenného prostoru (`<x:workbook xmlns:x="…">`) místo
 * výchozího jmenného prostoru. Podle specifikace XML je to totéž, exceljs
 * ale na `xl/workbook.xml` v tomhle tvaru padá („Cannot read properties of
 * undefined (reading 'sheets')“) — tak skončil 9. 11. 2026 výpis z eToro.
 *
 * Obsah se nemění, jen zápis: z výstupu exceljs se dá postavit libovolný
 * sešit (eToro, XTB…) a porovnat s nepřepsaným.
 */
export async function withNamespacePrefixes(xlsx: Buffer): Promise<Buffer> {
  const PREFIXES: Record<string, string> = {
    'http://schemas.openxmlformats.org/spreadsheetml/2006/main': 'x',
    'http://schemas.openxmlformats.org/package/2006/relationships': 'pr',
    'http://schemas.openxmlformats.org/package/2006/content-types': 'ct',
  };
  const zip = await JSZip.loadAsync(xlsx);
  for (const part of zip.file(/\.(?:xml|rels)$/i)) {
    let xml = await part.async('string');
    const defaultNamespace = /\sxmlns="([^"]*)"/.exec(xml)?.[1];
    const prefix = defaultNamespace ? PREFIXES[defaultNamespace] : undefined;
    if (prefix) {
      xml = xml
        .replace(/\sxmlns="([^"]*)"/, ` xmlns:${prefix}="$1"`)
        // jen prvky BEZ prefixu — `mc:AlternateContent` a spol. zůstávají
        .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, `<$1${prefix}:$2`);
    }
    // atributy vztahů pod jiným prefixem než `r` (exceljs čte jen `r:id`)
    xml = xml.replace(/\sxmlns:r="/g, ' xmlns:rel="').replace(/(\s)r:(\w+=)/g, '$1rel:$2');
    zip.file(part.name, xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Archiv v pořádku se sešitem, na kterém exceljs spadne (list bez vztahů). */
export const buildUnreadableWorkbook = (): Promise<Buffer> =>
  zipOf({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml':
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet/></sheets></workbook>',
  });

/** Dokument Wordu: zip OOXML se stejným začátkem jako sešit, ale bez `xl/`. */
export const buildWordDocument = (): Promise<Buffer> =>
  zipOf({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'word/document.xml': '<w:document xmlns:w="urn:w"/>',
  });
