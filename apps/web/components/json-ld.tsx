/**
 * Vloží strukturovaná data (schema.org) do stránky. Obsah skládá `lib/json-ld.ts`,
 * tohle je jen obal.
 *
 * Každé `<` se escapuje na unicode zápis: uvnitř `<script>` by řetězec `</script>`
 * v datech blok předčasně ukončil. Data jsou dnes jen naše konstanty, ale to je
 * vlastnost volajícího, ne tohoto komponentu.
 *
 * CSP tenhle inline blok pouští (`script-src 'self' 'unsafe-inline'`
 * v `next.config.ts`) a prohlížeč ho nespouští — `application/ld+json` je datový.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
