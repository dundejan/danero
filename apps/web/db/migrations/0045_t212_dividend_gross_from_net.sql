-- L14-01, R-07b: parser Trading 212 bral u dividendy sloupec „Price / share“
-- jako brutto na kus. Je to ale částka PO zahraniční srážce, takže uložené
-- brutto bylo nižší o sraženou daň (příjem § 8 i čerpání limitů podhodnocené
-- o 15/85, u německých titulů o víc). Parser to nově počítá správně:
--   brutto = kusy × cena + Withholding tax
-- a takto spočtenou dividendu značí v payloadu `grossFromNet: true`.
--
-- Tahle migrace srovnává už uložená data. Dividendě Trading 212 BEZ značky
-- a s nenulovou srážkou:
--   1. přičte srážku k `payload.gross`,
--   2. nastaví `payload.grossFromNet`,
--   3. přepočítá `dedupe_key` — brutto je součást obsahového otisku, takže bez
--      přepočtu by se každá taková dividenda při dalším nahrání téhož výpisu
--      nebo při synchronizaci uložila podruhé. Pořadí výskytu (třetí část
--      klíče) zůstává, jak bylo.
--
-- IDEMPOTENCE stojí na značce. Z payloadu samotného se nepozná, jestli brutto
-- srážku už obsahuje; řádek se značkou se proto nikdy nepřepočítává a druhý
-- běh (obnova ze zálohy, ruční spuštění) nezmění nic.
--
-- Co migrace nemění: dividendy bez srážky (brutto = čistá částka, klíč stejný
-- jako z nového parseru), dividendy se srážkou v jiné měně (parser tu srážku
-- nuluje, takže v payloadu je 0), ostatní brokery a ostatní typy transakcí.
--
-- Co migrace ZÁMĚRNĚ nedělá: nemaže. Kód a migrace se nenasazují v zaručeném
-- pořadí (docs/08, M-5); když nový parser stihne výpis uložit dřív, než
-- migrace doběhne, leží tatáž dividenda v databázi dvakrát a cílový klíč
-- starého řádku je obsazený. Takový řádek migrace nechá být — zůstane
-- poznatelný (Trading 212, dividenda se srážkou, bez značky) a rozhodnutí,
-- jestli ho smazat, patří člověku. Stejně se přeskočí řádek, o jehož cílový
-- klíč by se hlásily dva řádky naráz. Migrace tak nemůže spadnout na
-- primárním klíči.
--
-- ZNÁMÁ MEZ: řádky ze starého formátu exportu bez kusů a ceny (brutto odhadnuté
-- z čisté částky Total v měně účtu) se od ostatních v payloadu nepoznají —
-- migrace jim srážku přičte také. Při shodné měně je to správně; při různých
-- měnách jde o drobnou odchylku směrem k vyššímu příjmu (bezpečný směr).
-- Parser takovému řádku srážku nepřičítá, takže opakované nahrání TAKOVÉHO
-- starého souboru by dividendu uložilo znovu. Reálné exporty z ověření takový
-- řádek nemají (všechny dividendové řádky nesou kusy i cenu).

-- FNV-1a 64bit, přesná kopie `fnv1a64` z packages/importers/src/dedupe.ts:
-- XORuje se CELÁ UTF-16 kódová jednotka, ne jen spodní bajt (viz 0032).
-- Shodu s TypeScriptem hlídá apps/web/test/dedupe-migration.test.ts.
CREATE OR REPLACE FUNCTION danero_fnv1a64(input text) RETURNS text AS $$
DECLARE
  hash numeric := 14695981039346656037;   -- 0xcbf29ce484222325
  prime numeric := 1099511628211;         -- 0x100000001b3
  modulo numeric := 18446744073709551616; -- 2^64
  i int;
BEGIN
  FOR i IN 1..length(input) LOOP
    hash := (hash - (hash % 65536)) + ((hash % 65536)::int # ascii(substr(input, i, 1)));
    hash := (hash * prime) % modulo;
  END LOOP;
  -- 64bit hodnota se do `bigint` nevejde (přetéká přes 2^63−1), takže se hex
  -- skládá ze dvou 32bitových půlek
  RETURN lpad(to_hex(div(hash, 4294967296)::bigint), 8, '0')
      || lpad(to_hex((hash % 4294967296)::bigint), 8, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;--> statement-breakpoint

-- Částka z payloadu jako číslo — jen když je to obyčejný desetinný zápis.
-- Cokoli jiného (exponent, znaménko, prázdno) vrátí NULL a řádek se přeskočí:
-- přetypování tak nemůže migraci shodit a součet zůstane v rozsahu, kde
-- `Decimal.toString()` píše číslo bez exponentu (od 0,000001 do 10^21).
CREATE OR REPLACE FUNCTION danero_plain_amount(input text) RETURNS numeric AS $$
  SELECT CASE WHEN input ~ '^[0-9]{1,20}(\.[0-9]+)?$' THEN input::numeric END;
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint

UPDATE transactions AS t
SET
  payload = t.payload || jsonb_build_object('gross', n.gross, 'grossFromNet', true),
  dedupe_key = n.target_key
FROM (
  SELECT
    user_id,
    dedupe_key,
    gross,
    target_key,
    count(*) OVER (PARTITION BY user_id, target_key) AS claimants
  FROM (
    SELECT
      user_id,
      dedupe_key,
      gross,
      -- pořadí polí MUSÍ doslova odpovídat `contentParts` v importérech
      'trading212|' || danero_fnv1a64(
        concat_ws('|', 'DIVIDEND', isin, paid_on, gross, withholding, currency)
      ) || '|' || split_part(dedupe_key, '|', 3) AS target_key
    FROM (
      SELECT
        user_id,
        dedupe_key,
        coalesce(payload ->> 'isin', '') AS isin,
        coalesce(payload ->> 'date', '') AS paid_on,
        coalesce(payload ->> 'currency', '') AS currency,
        -- `trim_scale` = zápis bez koncových nul, stejně jako Decimal.toString()
        -- (28,22 + 4,98 je v numeric „33.20“, v TypeScriptu „33.2“)
        trim_scale(danero_plain_amount(payload ->> 'withholdingTax'))::text AS withholding,
        trim_scale(
          danero_plain_amount(payload ->> 'gross')
            + danero_plain_amount(payload ->> 'withholdingTax')
        )::text AS gross
      FROM transactions
      WHERE broker = 'trading212'
        AND type = 'DIVIDEND'
        AND payload ->> 'type' = 'DIVIDEND'
        -- značka z nového parseru nebo z dřívějšího běhu téhle migrace
        AND payload -> 'grossFromNet' IS DISTINCT FROM 'true'::jsonb
        AND danero_plain_amount(payload ->> 'withholdingTax') > 0
        AND danero_plain_amount(payload ->> 'gross') IS NOT NULL
        -- jen klíč ve tvaru `<broker>|<otisk>|<pořadí>`; jiný tvar žádný kód
        -- nevyrábí a jeho pořadí by nešlo převzít
        AND dedupe_key ~ '^trading212\|[0-9a-f]{16}\|[0-9]+$'
    ) candidate
  ) keyed
) n
WHERE t.user_id = n.user_id
  AND t.dedupe_key = n.dedupe_key
  AND n.claimants = 1
  AND NOT EXISTS (
    SELECT 1
    FROM transactions AS taken
    WHERE taken.user_id = n.user_id AND taken.dedupe_key = n.target_key
  );--> statement-breakpoint

DROP FUNCTION danero_plain_amount(text);--> statement-breakpoint
DROP FUNCTION danero_fnv1a64(text);
