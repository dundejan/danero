/**
 * Tichá věta u sporného výkladu, která se mění podle zvolené varianty — bez
 * JavaScriptu, jen podle toho, která `<option data-disputed>` je vybraná
 * (`:has()` nad řádkem `FieldRow`). Bezpečná varianta ukazuje, co by mírnější přinesla
 * a co stojí; mírnější varianta barvou i slovem říká, že je zapnutá.
 */
export function DisputedHint({ safe, lenient }: { safe: string; lenient: string }) {
  return (
    <>
      <span className="group-has-[option[data-disputed]:checked]/field-row:hidden">{safe}</span>
      <span className="hidden font-medium text-caution-text group-has-[option[data-disputed]:checked]/field-row:inline">
        {lenient}
      </span>
    </>
  );
}
