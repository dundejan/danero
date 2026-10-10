/**
 * Barva lišty prohlížeče (meta `theme-color`) = plocha úplně nahoře na stránce,
 * tedy token `--surface` v daném vzhledu. Bydlí zvlášť, protože ji čte serverové
 * rozložení (`app/layout.tsx`, výchozí hodnoty podle systému) i klientský
 * `ThemeProvider`, který ji přepisuje po ruční volbě vzhledu.
 */
export const THEME_COLOR = { light: '#ffffff', dark: '#000000' } as const;
